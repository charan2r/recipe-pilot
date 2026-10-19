import json
import sqlite3
from contextlib import contextmanager

from . import config


@contextmanager
def connection():
    with sqlite3.connect(config.DATA_DIR / 'receiptpilot.sqlite3', timeout=15) as db:
        db.row_factory = sqlite3.Row
        yield db


def initialize():
    (config.DATA_DIR / 'receipts').mkdir(parents=True, exist_ok=True)
    with connection() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS expenses (
            id TEXT PRIMARY KEY, fields TEXT NOT NULL, status TEXT NOT NULL,
            filename TEXT, mime TEXT, digest TEXT UNIQUE,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL)''')


def public(row):
    if row is None:
        return None
    return {**json.loads(row['fields']), **{key: row[key] for key in ('id', 'status', 'filename', 'mime', 'created_at', 'updated_at')}}
