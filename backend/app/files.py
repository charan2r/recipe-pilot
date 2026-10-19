import io
import warnings

import pypdfium2 as pdfium
from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

from .config import MAX_PAGES

Image.MAX_IMAGE_PIXELS = 25_000_000


def jpeg(image: Image.Image) -> bytes:
    image = ImageOps.exif_transpose(image)
    image.thumbnail((2400, 2400))
    if image.mode in ('RGBA', 'LA') or 'transparency' in image.info:
        rgba = image.convert('RGBA')
        canvas = Image.new('RGB', rgba.size, 'white')
        canvas.paste(rgba, mask=rgba.getchannel('A'))
        image = canvas
    else:
        image = image.convert('RGB')
    buffer = io.BytesIO()
    image.save(buffer, format='JPEG', quality=90)
    return buffer.getvalue()


def prepare_receipt(data: bytes) -> tuple[str, list[bytes]]:
    """Sniff and decode actual content; never trust extensions or browser MIME types."""
    if data.startswith(b'%PDF-'):
        try:
            with pdfium.PdfDocument(data) as doc:
                if not 1 <= len(doc) <= MAX_PAGES:
                    raise HTTPException(422, f'PDF must contain 1–{MAX_PAGES} pages. Split larger documents first.')
                pages = []
                for page in doc:
                    width, height = page.get_size()
                    if min(width, height) <= 0:
                        raise ValueError('Invalid page dimensions')
                    scale = min(2.0, 2400 / max(width, height))
                    bitmap = page.render(scale=scale)
                    try:
                        pages.append(jpeg(bitmap.to_pil()))
                    finally:
                        bitmap.close()
                        page.close()
                return 'application/pdf', pages
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(422, 'Cannot read this PDF. Upload an unlocked, valid PDF.') from None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format not in ('JPEG', 'PNG', 'WEBP'):
                    raise HTTPException(415, 'Use a JPEG, PNG, WebP image or PDF.')
                mime = Image.MIME[image.format]
                image.load()
                return mime, [jpeg(image)]
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, 'Cannot read this image. Use a valid image under 25 megapixels.') from None
