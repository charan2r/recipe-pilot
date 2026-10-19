import csv
import io
from decimal import Decimal
from unittest.mock import AsyncMock

import httpx
import pypdfium2 as pdfium
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from app import config, extraction, main
from app.models import ReceiptFields


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, 'DATA_DIR', tmp_path)
    monkeypatch.setattr(config, 'API_KEY', '')
    with TestClient(main.app, base_url='http://localhost') as client:
        yield client


@pytest.fixture
def png():
    buffer = io.BytesIO()
    Image.new('RGB', (100, 200), 'white').save(buffer, 'PNG')
    return buffer.getvalue()


@pytest.fixture
def fields():
    return {'merchant': 'Test merchant', 'date': '2026-01-02', 'currency': 'USD', 'subtotal': '10', 'tax': '1', 'total': '11', 'category': 'Meals & drinks', 'line_items': [{'description': 'Lunch', 'quantity': '1', 'amount': '10'}], 'notes': ''}


def upload(client, data, consent=True, filename='receipt.png'):
    return client.post('/api/receipts/upload', files={'file': (filename, data, 'application/octet-stream')}, data={'consent': str(consent).lower()})


def test_health_no_fake_configuration(client):
    assert client.get('/api/health').json()['extraction_configured'] is False
    assert client.get('/api/expenses').json() == []


def test_manual_correction_export_and_delete(client, fields):
    response = client.post('/api/expenses', json=fields)
    assert response.status_code == 201
    expense = response.json()
    assert expense['status'] == 'needs_review'
    assert expense['warnings'] == []
    response = client.put(f"/api/expenses/{expense['id']}", json={**fields, 'merchant': '=HYPERLINK("bad")', 'status': 'verified'})
    assert response.status_code == 200
    assert response.json()['status'] == 'verified'
    rows = list(csv.DictReader(io.StringIO(client.get('/api/expenses/export.csv').text.lstrip('\ufeff'))))
    assert rows[0]['merchant'].startswith("'=")
    assert rows[0]['currency'] == 'USD'
    assert rows[0]['total'] == '11'
    assert client.get(f"/api/expenses/{expense['id']}/receipt").status_code == 404
    assert client.delete(f"/api/expenses/{expense['id']}").status_code == 204
    assert client.get(f"/api/expenses/{expense['id']}").status_code == 404


def test_validation_and_warnings(client, fields):
    assert client.post('/api/expenses', json={**fields, 'currency':'ZZZ'}).status_code == 422
    assert client.post('/api/expenses', json={**fields, 'total':'NaN'}).status_code == 422
    assert client.post('/api/expenses', json={**fields, 'date':'2026-02-31'}).status_code == 422
    assert client.post('/api/expenses', json={**fields, 'total':'-1'}).status_code == 422
    assert client.post('/api/expenses', json={**fields, 'unexpected':'x'}).status_code == 422
    incomplete = client.post('/api/expenses', json={}).json()
    assert len(incomplete['warnings']) == 4
    assert client.post('/api/expenses', json={'status':'verified'}).status_code == 422
    mismatch = {**fields, 'total':'12'}
    assert 'does not match' in client.post('/api/expenses', json=mismatch).json()['warnings'][0]
    assert client.post('/api/expenses', json={**mismatch, 'status':'verified'}).status_code == 422
    assert client.post('/api/expenses', json={**fields, 'date':'2999-01-01', 'status':'verified'}).status_code == 422


def test_upload_consent_validation_and_missing_key(client, png):
    assert upload(client, png, consent=False).status_code == 422
    assert upload(client, b'').status_code == 422
    assert upload(client, b'not an image').status_code == 422
    assert upload(client, b'%PDF-corrupt', filename='bad.pdf').status_code == 422
    response = upload(client, png)
    assert response.status_code == 503
    assert 'GEMMA_API_KEY' in response.json()['detail']
    assert client.get('/api/expenses').json() == []
    assert not list((config.DATA_DIR / 'receipts').iterdir())


def test_upload_review_duplicate_preview_and_delete(client, png, fields, monkeypatch):
    fake_extract = AsyncMock(return_value=ReceiptFields(**fields))
    monkeypatch.setattr(main, 'extract', fake_extract)
    response = upload(client, png, filename='../../unsafe.png')
    assert response.status_code == 201
    expense = response.json()
    assert expense['filename'] == 'unsafe.png'
    assert expense['mime'] == 'image/png'
    assert expense['status'] == 'needs_review'
    assert fake_extract.await_args.args[0][0].startswith(b'\xff\xd8')
    assert upload(client, png).status_code == 409
    assert fake_extract.await_count == 1
    original = client.get(f"/api/expenses/{expense['id']}/receipt")
    assert original.content == png
    assert original.headers['cache-control'] == 'no-store'
    assert client.delete(f"/api/expenses/{expense['id']}").status_code == 204
    assert not list((config.DATA_DIR / 'receipts').iterdir())


def test_scanned_pdf_upload_and_page_limit(client, fields, monkeypatch):
    monkeypatch.setattr(main, 'extract', AsyncMock(return_value=ReceiptFields(**fields)))
    doc = pdfium.PdfDocument.new()
    doc.new_page(300, 400).close()
    buffer = io.BytesIO()
    doc.save(buffer)
    response = upload(client, buffer.getvalue(), filename='scan.pdf')
    assert response.status_code == 201
    assert response.json()['mime'] == 'application/pdf'
    for _ in range(5):
        doc.new_page(300, 400).close()
    buffer = io.BytesIO()
    doc.save(buffer)
    doc.close()
    assert upload(client, buffer.getvalue(), filename='too-long.pdf').status_code == 422


def test_upload_size_and_origin_restrictions(client):
    assert upload(client, b'x' * (config.MAX_BYTES + 1)).status_code == 413
    response = client.post('/api/receipts/upload', content=b'x' * (config.MAX_BYTES + 65537), headers={'Content-Type':'application/octet-stream'})
    assert response.status_code == 413
    assert client.post('/api/expenses', json={}, headers={'Origin':'https://untrusted.example'}).status_code == 403
    assert client.post('/api/expenses', json={}, headers={'Origin':'http://localhost:5173'}).status_code == 201
    assert client.get('/api/health', headers={'Host':'untrusted.example'}).status_code == 400


def test_failed_extraction_does_not_persist(client, png, monkeypatch):
    monkeypatch.setattr(main, 'extract', AsyncMock(side_effect=HTTPException(502, 'Provider unavailable')))
    assert upload(client, png).status_code == 502
    assert client.get('/api/expenses').json() == []
    assert not list((config.DATA_DIR / 'receipts').iterdir())


def test_parse_output_strict_json_and_schema(fields):
    import json
    assert extraction.parse_output('```json\n' + json.dumps(fields) + '\n```').total == Decimal('11')
    for content in ('prose with {"total": 12}', '{"total": NaN}', '{"total": -10}', '[]', '{"currency":"ZZZ"}'):
        with pytest.raises(ValueError):
            extraction.parse_output(content)


@pytest.mark.parametrize('status,expected', [(401,502), (403,502), (404,502), (429,429), (500,502)])
def test_provider_errors_sanitized(client, png, monkeypatch, status, expected):
    monkeypatch.setattr(config, 'API_KEY', 'test-only-sentinel')
    real_client = httpx.AsyncClient
    transport = httpx.MockTransport(lambda req: httpx.Response(status, json={'error': 'private upstream details'}))
    monkeypatch.setattr(extraction.httpx, 'AsyncClient', lambda **kwargs: real_client(transport=transport, **kwargs))
    response = upload(client, png)
    assert response.status_code == expected
    assert 'private upstream' not in response.text
    assert 'test-only-sentinel' not in response.text


def test_real_adapter_contract_without_live_credentials(client, png, fields, monkeypatch):
    import json
    monkeypatch.setattr(config, 'API_KEY', 'test-only-sentinel')
    real_client = httpx.AsyncClient

    def provider(req):
        assert req.url.host == 'generativelanguage.googleapis.com'
        assert 'gemma-' in req.url.path
        assert not req.url.query
        assert req.headers['x-goog-api-key'] == 'test-only-sentinel'
        payload = json.loads(req.content)
        assert payload['contents'][0]['parts'][1]['inlineData']['mimeType'] == 'image/jpeg'
        assert 'systemInstruction' not in payload
        return httpx.Response(200, json={'candidates':[{'finishReason':'STOP', 'content':{'parts':[{'thought':True,'text':'internal'}, {'text':json.dumps(fields)}]}}]})

    monkeypatch.setattr(extraction.httpx, 'AsyncClient', lambda **kwargs: real_client(transport=httpx.MockTransport(provider), **kwargs))
    assert upload(client, png).status_code == 201


@pytest.mark.parametrize('content', [{'candidates':[]}, {'candidates':[{'finishReason':'MAX_TOKENS'}]}, {'candidates':[{'content':{'parts':[{'text':'not JSON'}]}}]}])
def test_bad_provider_output_never_creates_expense(client, png, monkeypatch, content):
    monkeypatch.setattr(config, 'API_KEY', 'test-only-sentinel')
    real_client = httpx.AsyncClient
    monkeypatch.setattr(extraction.httpx, 'AsyncClient', lambda **kwargs: real_client(transport=httpx.MockTransport(lambda req: httpx.Response(200, json=content)), **kwargs))
    assert upload(client, png).status_code == 502
    assert client.get('/api/expenses').json() == []
