import asyncio
import csv
import hashlib
import io
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import config, storage
from .extraction import extract
from .files import prepare_receipt
from .models import CATEGORIES, Correction, ReceiptFields, review_warnings
from .middleware import UploadBodyLimit

upload_slots = asyncio.Semaphore(2)


@asynccontextmanager
async def lifespan(app):
    storage.initialize()
    yield


app = FastAPI(title='ReceiptPilot API', version='1.0.0', lifespan=lifespan)
app.add_middleware(UploadBodyLimit)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=['localhost', '127.0.0.1', '[::1]'])
app.add_middleware(CORSMiddleware, allow_origins=config.ORIGINS, allow_methods=['GET', 'POST', 'PUT', 'DELETE'], allow_headers=['Content-Type'])


@app.middleware('http')
async def local_security(request: Request, call_next):
    origin = request.headers.get('origin')
    if request.method in ('POST', 'PUT', 'DELETE') and origin and origin not in config.ORIGINS:
        return JSONResponse({'detail': 'Origin is not allowed.'}, status_code=403)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Cache-Control'] = 'no-store'
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    # Do not echo potentially sensitive receipt field values back in validation errors.
    messages = ['.'.join(str(v) for v in e['loc'][1:]) + ': ' + e['msg'] for e in exc.errors()]
    return JSONResponse({'detail': '; '.join(messages)}, status_code=422)


def now():
    return datetime.now(timezone.utc).isoformat()


def require_expense(expense_id):
    with storage.connection() as db:
        row = db.execute('SELECT * FROM expenses WHERE id = ?', (expense_id,)).fetchone()
    if row is None:
        raise HTTPException(404, 'Expense not found.')
    return row


def enriched(row):
    result = storage.public(row)
    result['warnings'] = review_warnings(ReceiptFields.model_validate_json(row['fields']))
    return result


@app.get('/api/health')
def health():
    return {'status': 'ok', 'extraction_configured': bool(config.API_KEY), 'model': config.MODEL, 'categories': CATEGORIES}


@app.get('/api/expenses')
def list_expenses():
    with storage.connection() as db:
        rows = db.execute('SELECT * FROM expenses ORDER BY created_at DESC').fetchall()
    return [enriched(row) for row in rows]


def safe_cell(value):
    text = '' if value is None else str(value)
    # Spreadsheet formula injection, including leading whitespace/control characters.
    return "'" + text if text.lstrip().startswith(('=', '+', '-', '@')) else text


@app.get('/api/expenses/export.csv')
def export_csv():
    stream = io.StringIO(newline='')
    writer = csv.writer(stream)
    columns = ['id', 'merchant', 'date', 'currency', 'subtotal', 'tax', 'total', 'category', 'status', 'notes', 'filename']
    writer.writerow(columns)
    for expense in list_expenses():
        writer.writerow([safe_cell(expense.get(key)) for key in columns])
    return Response('\ufeff' + stream.getvalue(), media_type='text/csv; charset=utf-8', headers={'Content-Disposition': 'attachment; filename="receiptpilot-expenses.csv"'})


@app.post('/api/expenses', status_code=201)
def create_manual(body: Correction):
    if body.status == 'verified' and review_warnings(body):
        raise HTTPException(422, 'Resolve missing fields and validation warnings before verifying.')
    expense_id, timestamp = str(uuid4()), now()
    fields = body.model_dump_json(exclude={'status'})
    with storage.connection() as db:
        db.execute('INSERT INTO expenses VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)', (expense_id, fields, body.status, timestamp, timestamp))
    return enriched(require_expense(expense_id))


@app.post('/api/receipts/upload', status_code=201)
async def upload_receipt(file: UploadFile = File(...), consent: bool = Form(False)):
    try:
        if not consent:
            raise HTTPException(422, 'Confirm that receipt images may be sent to Google for hosted Gemma extraction.')
        data = await file.read(config.MAX_BYTES + 1)
        if len(data) > config.MAX_BYTES:
            raise HTTPException(413, 'Receipt exceeds the 10 MB limit.')
        if not data:
            raise HTTPException(422, 'The uploaded file is empty.')
        digest = hashlib.sha256(data).hexdigest()
        with storage.connection() as db:
            duplicate = db.execute('SELECT id FROM expenses WHERE digest = ?', (digest,)).fetchone()
        if duplicate:
            raise HTTPException(409, 'This exact receipt is already in your expenses.')
        async with upload_slots:
            mime, pages = await asyncio.to_thread(prepare_receipt, data)
            fields = await extract(pages)
        expense_id, timestamp = str(uuid4()), now()
        # No user-controlled storage paths. Originals are never served from a public directory.
        path = config.DATA_DIR / 'receipts' / expense_id
        filename = (file.filename or 'receipt').replace('\\', '/').split('/')[-1][:200]
        await asyncio.to_thread(path.write_bytes, data)
        try:
            with storage.connection() as db:
                db.execute('INSERT INTO expenses VALUES (?, ?, ?, ?, ?, ?, ?, ?)', (expense_id, fields.model_dump_json(), 'needs_review', filename, mime, digest, timestamp, timestamp))
        except sqlite3.IntegrityError:
            path.unlink(missing_ok=True)
            raise HTTPException(409, 'This exact receipt is already in your expenses.') from None
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return enriched(require_expense(expense_id))
    finally:
        await file.close()


@app.get('/api/expenses/{expense_id}')
def get_expense(expense_id: str):
    return enriched(require_expense(expense_id))


@app.put('/api/expenses/{expense_id}')
def correct_expense(expense_id: str, body: Correction):
    require_expense(expense_id)
    if body.status == 'verified' and review_warnings(body):
        raise HTTPException(422, 'Resolve missing fields and validation warnings before verifying.')
    with storage.connection() as db:
        db.execute('UPDATE expenses SET fields=?, status=?, updated_at=? WHERE id=?', (body.model_dump_json(exclude={'status'}), body.status, now(), expense_id))
    return enriched(require_expense(expense_id))


@app.get('/api/expenses/{expense_id}/receipt')
def original_receipt(expense_id: str):
    row = require_expense(expense_id)
    path = config.DATA_DIR / 'receipts' / row['id']
    if not row['filename'] or not path.is_file():
        raise HTTPException(404, 'No original receipt is attached.')
    return FileResponse(path, media_type=row['mime'], filename=row['filename'], content_disposition_type='inline')


@app.delete('/api/expenses/{expense_id}', status_code=204)
def delete_expense(expense_id: str):
    row = require_expense(expense_id)
    # Keep the database record if the file cannot be removed, so deletion is retryable.
    (config.DATA_DIR / 'receipts' / row['id']).unlink(missing_ok=True)
    with storage.connection() as db:
        db.execute('DELETE FROM expenses WHERE id=?', (expense_id,))
