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

TOOL_RAG_TOP_K = int(os.environ.get("TOOL_RAG_TOP_K", "3"))
TOOL_RAG_MIN_SCORE = float(os.environ.get("TOOL_RAG_MIN_SCORE", "0.25"))
TOOL_RAG_BYPASS_THRESHOLD = int(os.environ.get("TOOL_RAG_BYPASS_THRESHOLD", "100"))

MAX_HISTORY_TOKENS = 60000  # Approximated: 1 token ~= 4 chars
