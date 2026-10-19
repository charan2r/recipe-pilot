import os
import re
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env')
DATA_DIR = Path(os.getenv('DATA_DIR', str(ROOT / 'data'))).resolve()
API_KEY = os.getenv('GEMMA_API_KEY', '').strip()
MODEL = os.getenv('GEMMA_MODEL', 'gemma-4-31b-it').strip()
if not re.fullmatch(r'gemma-[a-zA-Z0-9.-]+', MODEL):
    raise ValueError('GEMMA_MODEL must be a Gemma model ID, without models/ prefix.')
ORIGINS = [v.strip() for v in os.getenv('FRONTEND_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(',') if v.strip()]
MAX_BYTES = 10 * 1024 * 1024
MAX_PAGES = 5
