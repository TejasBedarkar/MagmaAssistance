"""
Configuration settings and constants for MagmaAssistance.
"""

import os

LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-4o-mini")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "gpt-4o-mini-transcribe")
TTS_VOICE = os.environ.get("TTS_VOICE", "alloy")

LLM_MAX_TOKENS = int(os.environ.get("LLM_MAX_TOKENS", "4096"))
MAX_COMPLETION_ROUNDS = int(os.environ.get("LLM_MAX_COMPLETION_ROUNDS", "4"))
LLM_REQUEST_TIMEOUT_SECONDS = float(os.environ.get("LLM_REQUEST_TIMEOUT_SECONDS", "90"))

# Business plans use an isolated SQLite store during the single-process pilot.
# Move this to a PostgreSQL-backed implementation before multi-worker,
# proactive production execution.
BUSINESS_PLAN_DB_PATH = os.environ.get("BUSINESS_PLAN_DB_PATH", "db/business_plans.db")

TOOL_RAG_TOP_K = int(os.environ.get("TOOL_RAG_TOP_K", "3"))
TOOL_RAG_MIN_SCORE = float(os.environ.get("TOOL_RAG_MIN_SCORE", "0.25"))
TOOL_RAG_BYPASS_THRESHOLD = int(os.environ.get("TOOL_RAG_BYPASS_THRESHOLD", "100"))

MAX_HISTORY_TOKENS = 60000  # Approximated: 1 token ~= 4 chars

# Live voice STT (Voice/realtime_stt.py → /ws/voice). gpt-live-transcribe rejects server_vad.
REALTIME_STT_MODEL = os.environ.get("REALTIME_STT_MODEL", "gpt-transcribe")
REALTIME_STT_LANGUAGE = os.environ.get("REALTIME_STT_LANGUAGE", "en")
REALTIME_STT_PROMPT = os.environ.get(
    "REALTIME_STT_PROMPT",
    "Business conversation with an ERP assistant. Expect company names, "
    "person names, and ERP terms like Lead, Opportunity, Quotation, Sales Order.",
)
REALTIME_STT_VAD_THRESHOLD = float(os.environ.get("REALTIME_STT_VAD_THRESHOLD", "0.6"))
REALTIME_STT_SILENCE_MS = int(os.environ.get("REALTIME_STT_SILENCE_MS", "650"))
REALTIME_STT_PREFIX_PADDING_MS = int(os.environ.get("REALTIME_STT_PREFIX_PADDING_MS", "400"))
REALTIME_STT_MIN_WORDS = int(os.environ.get("REALTIME_STT_MIN_WORDS", "2"))
REALTIME_STT_SAMPLE_RATE = int(os.environ.get("REALTIME_STT_SAMPLE_RATE", "24000"))
