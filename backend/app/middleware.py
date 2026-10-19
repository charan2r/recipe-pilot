from fastapi.responses import JSONResponse

from .config import MAX_BYTES


class UploadBodyLimit:
    """Bound the multipart body BEFORE Starlette spools it, even with chunked uploads."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['path'] != '/api/receipts/upload' or scope['method'] != 'POST':
            return await self.app(scope, receive, send)
        limit = MAX_BYTES + 64 * 1024  # bounded multipart envelope allowance
        chunks, size = [], 0
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            chunk = message.get('body', b'')
            size += len(chunk)
            if size > limit:
                response = JSONResponse({'detail': 'Upload exceeds the 10 MB receipt limit.'}, status_code=413)
                return await response(scope, receive, send)
            chunks.append(chunk)
            if not message.get('more_body', False):
                break
        body = b''.join(chunks)
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type': 'http.request', 'body': body, 'more_body': False}
            return await receive()

        await self.app(scope, replay, send)
