"""
Text-to-speech (TTS) synthesis and streaming routes.
"""

import base64
import logging
import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import state

logger = logging.getLogger("agent-server")
router = APIRouter(tags=["voice"])


class TTSRequest(BaseModel):
    text: str


def _get_tts_audio(text: str):
    """Synthesizes text to a WAV file and returns its raw bytes."""
    wav_path = state.assistant.tts.synthesize_to_file(text)
    try:
        with open(wav_path, "rb") as f:
            return f.read()
    finally:
        try:
            os.remove(wav_path)
        except OSError:
            pass


@router.post("/api/tts")
async def synthesize_speech(req: TTSRequest):
    """Synthesizes arbitrary text to speech with assistant.tts."""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    try:
        wav_bytes = _get_tts_audio(text)
    except Exception as exc:  # noqa: BLE001
        logger.exception("TTS synthesis failed for /api/tts")
        raise HTTPException(status_code=500, detail=str(exc))

    if not wav_bytes:
        raise HTTPException(status_code=500, detail="TTS synthesis returned no audio")

    return {"audio": base64.b64encode(wav_bytes).decode("ascii")}


@router.post("/api/tts/stream")
async def synthesize_speech_stream(req: TTSRequest):
    """Streams TTS audio chunks directly from OpenAI as they are generated."""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    def generate_chunks():
        try:
            for chunk in state.assistant.tts.synthesize_stream(text, response_format="mp3"):
                yield chunk
        except Exception:
            logger.exception("Streaming TTS failed")

    return StreamingResponse(generate_chunks(), media_type="audio/mpeg")
