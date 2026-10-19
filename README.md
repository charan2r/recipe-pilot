# ReceiptPilot

A functional, single-user receipt and expense organizer built with React, FastAPI, SQLite and **hosted Gemma**. The product is **ReceiptPilot**; the folder is intentionally named **`recipe-pilot`**, as requested.

## What works

- JPEG, PNG, WebP and PDF upload, including scanned PDFs (1–5 pages, 10 MB maximum per receipt).
- Hosted Gemma extracts merchant, date, currency, subtotal, tax, total, category and line items.
- Strict server validation, missing-field warnings and subtotal/tax/total consistency checks.
- Side-by-side original receipt preview and editable fields, including line items and notes.
- Explicit human verification; extraction always starts as `needs_review`.
- Manual expense entry without an API key; persistent SQLite storage.
- Merchant/notes/filename search, status/category/currency filters and currency-separated totals.
- CSV export of **all** saved expenses with review status and currency, protected against spreadsheet formula injection.
- Exact-file duplicate detection, original download/preview, and deletion of record and stored file.
- Useful errors for missing configuration, unsupported or corrupt files, oversized uploads, unavailable models, invalid model responses, provider quota and network failures.

The workspace starts empty. There is no simulated extraction, seeded financial data or embedded API credential.

## Layout

```text
recipe-pilot/
  frontend/               React + TypeScript + Vite
    src/                  Interface, API client and tests
    .env.example          Optional development proxy configuration; no secrets
  backend/
    app/                  FastAPI routes, schema, storage, file processing, Gemma adapter
    tests/                API and provider-contract tests
    .env.example          Server-side configuration template
    requirements.txt
    requirements-dev.txt
    data/                 Created at runtime; ignored by Git
```

## Quick start on Windows (PowerShell)

Requires **Python 3.11+** and **Node.js 20.19+** with npm. Open a terminal in `recipe-pilot`.

### 1. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `backend/.env` and set `GEMMA_API_KEY` to your own [Google AI Studio API key](https://aistudio.google.com/apikey). Keep this file private. The example deliberately contains **no key**. You can leave it blank to use manual expense entry; receipt extraction will remain disabled.

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### 2. Frontend (second terminal, from `recipe-pilot`)

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

Open **[http://127.0.0.1:5173](http://127.0.0.1:5173)**. Keep both terminals running. Stop each with Ctrl+C. The development server proxies `/api` to `http://127.0.0.1:8000`. If port 5173 is occupied, free it or update `FRONTEND_ORIGINS` for the port Vite actually uses.

### macOS / Linux

```bash
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
# Edit .env with your own key, then:
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In a second terminal run `cd frontend`, `npm ci`, `npm run dev` from the project folder.

## Hosted Gemma configuration

The provider is **Google AI Studio / Gemini Developer API**, calling **Gemma**, not a Gemini model. The server uses `generateContent` over HTTPS with the key in the `x-goog-api-key` header. No provider SDK or browser-side credentials are required.

| Backend environment variable | Default / purpose                                                               |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `GEMMA_API_KEY`              | Empty; your own provider API key is required for extraction.                    |
| `GEMMA_MODEL`                | `gemma-4-31b-it`; must be an image-capable Gemma model your project can access. |

### How a receipt moves through the app

1. Choose one receipt image or a PDF containing pages of the same receipt. Unrelated receipts should be split before upload.
2. Read the hosted-inference notice and confirm consent for that upload.
3. The backend bounds the request, checks actual file content and decodes it. PDF pages render locally with PDFium; images are auto-oriented, resized to at most 2400 px per side and converted to JPEG without metadata for the model request. The exact original is stored only after successful extraction.
4. Images go to Google's hosted Gemma. File content is treated as untrusted data in the prompt. No tools or arbitrary model actions are enabled.
5. Valid extracted data is stored as **Needs review**, even if every validation check passes. Compare with the original and correct fields.
6. Save a draft at any time. **Save & verify** requires merchant, valid date, valid ISO currency and nonnegative total, and no outstanding date/tax/total warnings. Subtotal and tax may be blank when absent from the receipt.
7. Filter, export or delete. Export always includes all expenses; the button says **Export all CSV**. Totals include drafts and verified expenses, grouped by currency; entries missing total or currency are excluded and counted explicitly.

No live hosted call was made during development without a user-supplied key. Automated tests exercise the real adapter against mocked HTTP responses; this checks the request/response contract, not live model quality or account access. To smoke-test live extraction after configuring a key, upload a nonsensitive sample, compare the extracted fields, correct one, save and verify, refresh, export and delete it.

## API

Interactive API docs: **[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)**.

| Method | Route                        | Behavior                                                                |
| ------ | ---------------------------- | ----------------------------------------------------------------------- |
| GET    | `/api/health`                | Health, selected model and configuration status; never the key.         |
| POST   | `/api/receipts/upload`       | Multipart `file` and `consent=true`; extract and create a review draft. |
| GET    | `/api/expenses`              | All expenses, newest first, including validation warnings.              |
| POST   | `/api/expenses`              | Create manual expense from JSON fields and optional status.             |
| GET    | `/api/expenses/{id}`         | One expense.                                                            |
| PUT    | `/api/expenses/{id}`         | Replace editable fields and status; revalidate.                         |
| GET    | `/api/expenses/{id}/receipt` | Stream stored original for inline preview.                              |
| DELETE | `/api/expenses/{id}`         | Delete record and original; 204 on success.                             |
| GET    | `/api/expenses/export.csv`   | All saved expenses, UTF-8 CSV with BOM.                                 |
