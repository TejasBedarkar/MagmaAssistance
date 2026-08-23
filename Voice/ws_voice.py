"""
Voice/ws_voice.py — WebSocket voice endpoint

Two supported input modes, auto-detected per message:

  1. Binary PCM16 mono @ 24kHz (current AssistantPortal.jsx "Live Voice
     Mode"): browser streams raw 40ms audio chunks continuously. This file
     runs a lightweight server-side VAD over the incoming chunks, buffers
     an utterance, transcribes it with OpenAI Whisper once the user stops
     talking, runs the agent turn, and streams OpenAI TTS PCM16 @ 24kHz
     straight back over the same socket as binary frames — which is what
     AssistantPortal.jsx's playPcm() expects.

  2. Legacy JSON {"type": "user_speech", "text": "..."} (older Web Speech
     API browser build): still supported unchanged — the browser did its
     own STT and speechSynthesis in that mode, so no PCM is exchanged.

Either way, ERP + Web tools and stream_history.sqlite are shared with the
text chat via `stream_agent_turn`.
"""

import asyncio
import json
import logging
import re
import struct
import time
from fastapi import WebSocket, WebSocketDisconnect

from Voice.openai_stt import transcribe as stt_transcribe

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Audio / VAD tuning                                                          #
# --------------------------------------------------------------------------- #
# The browser (AssistantPortal.jsx) already runs its own adaptive noise gate
# and zeroes out background-noise chunks before sending them, so a silent
# chunk arrives here as (near) all-zero PCM. We don't need our own energy
# threshold to be clever — we just need to notice "still basically zero" vs
# "not zero", and require a run of silent chunks before treating an utterance
# as finished (so a normal breath/pause mid-sentence doesn't cut it off).
SAMPLE_RATE = 24000
BYTES_PER_SAMPLE = 2
SILENCE_RMS_THRESHOLD = 40          # int16 units; client-gated silence is ~0
SILENCE_CHUNKS_TO_END_UTTERANCE = 15  # ~600ms of silence at 40ms/chunk
MIN_UTTERANCE_BYTES = int(SAMPLE_RATE * BYTES_PER_SAMPLE * 0.25)  # >=250ms of audio


def _pcm_rms(chunk: bytes) -> float:
    if not chunk:
        return 0.0
    sample_count = len(chunk) // 2
    if sample_count == 0:
        return 0.0
    samples = struct.unpack(f"<{sample_count}h", chunk[: sample_count * 2])
    return (sum(s * s for s in samples) / sample_count) ** 0.5


def _is_voiced(chunk: bytes) -> bool:
    return _pcm_rms(chunk) > SILENCE_RMS_THRESHOLD


def _wrap_pcm_as_wav(pcm_bytes: bytes, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Wrap raw PCM16 mono bytes in a minimal WAV header so Whisper accepts
    them as a real file instead of a headerless blob."""
    num_channels = 1
    bits_per_sample = 16
    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    data_size = len(pcm_bytes)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + data_size, b"WAVE",
        b"fmt ", 16, 1, num_channels, sample_rate, byte_rate, block_align, bits_per_sample,
        b"data", data_size,
    )
    return header + pcm_bytes


def register_voice_ws(app, stream_agent_turn, tts, logger, load_stream_history, save_stream_history):

    @app.websocket("/ws/voice")
    async def ws_voice(ws: WebSocket, session_id: str = "voice-default", user_id: str = None):
        await ws.accept()
        logger.info("[WS/voice] OPEN  session=%s user=%s", session_id, user_id)

        class ConnectionClosed(Exception):
            """Raised when a background task tries to use a closed websocket."""

        connected = True
        state = {
            "turn_task": None,
            "speaking": False,
            # PCM/VAD state for the binary-audio protocol
            "utterance_active": False,
            "pcm_buffer": bytearray(),
            "silence_run": 0,
        }
        send_lock = asyncio.Lock()

        # ------------------------------------------------------------------ #
        # Send helpers                                                         #
        # ------------------------------------------------------------------ #

        async def send_json(payload: dict):
            nonlocal connected
            if not connected:
                raise ConnectionClosed
            try:
                async with send_lock:
                    await ws.send({"type": "websocket.send", "text": json.dumps(payload)})
            except (WebSocketDisconnect, RuntimeError, OSError) as exc:
                connected = False
                raise ConnectionClosed from exc

        async def send_bytes(payload: bytes):
            nonlocal connected
            if not connected or not payload:
                return
            try:
                async with send_lock:
                    await ws.send({"type": "websocket.send", "bytes": payload})
            except (WebSocketDisconnect, RuntimeError, OSError) as exc:
                connected = False
                raise ConnectionClosed from exc

        # ------------------------------------------------------------------ #
        # Turn management                                                      #
        # ------------------------------------------------------------------ #

        async def cancel_turn():
            task = state["turn_task"]
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                except Exception:
                    logger.exception("[WS/voice] Turn task raised on cancel")
            state["turn_task"] = None
            state["speaking"] = False

        # ------------------------------------------------------------------ #
        # Text cleaning for TTS (removes markdown, tables, action tags)       #
        # ------------------------------------------------------------------ #

        _ACTION_TAG_RE = re.compile(r'\[Action:[^\]]*\]')
        _CODE_BLOCK_RE = re.compile(r'```[\s\S]*?```')
        _TABLE_LINE_RE = re.compile(r'^\s*\|.*\|\s*$')

        def clean_for_speech(text: str) -> str:
            """Strip markdown formatting that sounds awful when spoken."""
            text = _ACTION_TAG_RE.sub('', text)
            text = _CODE_BLOCK_RE.sub('', text)
            lines = [l for l in text.split('\n') if not _TABLE_LINE_RE.match(l)]
            text = '\n'.join(lines)
            text = text.replace('**', '').replace('*', '').replace('#', '')
            text = re.sub(r'\s+', ' ', text).strip()
            return text

        async def speak_sentence(text: str):
            """Synthesize one sentence to PCM16 and push it as a binary
            frame. tts.synthesize_stream() is a *sync* generator doing
            blocking HTTP calls, so it runs off-loop in a thread."""
            cleaned = clean_for_speech(text)
            if not cleaned:
                return
            try:
                pcm = await asyncio.to_thread(
                    lambda: b"".join(tts.synthesize_stream(cleaned, response_format="pcm"))
                )
                await send_bytes(pcm)
            except ConnectionClosed:
                raise
            except Exception:
                logger.exception("[WS/voice] TTS synth failed for sentence: %r", cleaned[:80])

        # ------------------------------------------------------------------ #
        # Core turn: call agent, stream events + audio back to browser        #
        # ------------------------------------------------------------------ #

        async def run_turn(text: str):
            t0 = time.monotonic()
            logger.info("[WS/voice] turn START  session=%s  text=%r", session_id, text[:120])
            state["speaking"] = True
            token_buf = ""   # accumulates cleaned text for speech
            full_reply = ""
            history = []

            try:
                history = await load_stream_history(session_id)
                async for event in stream_agent_turn(
                    text, session_id=session_id, user_id=user_id, history=history
                ):
                    etype = event["type"]

                    if etype == "token":
                        raw = event["text"]
                        await send_json({"type": "token", "text": raw})
                        token_buf += raw
                        full_reply += raw

                        # Emit a sentence's audio whenever a sentence boundary
                        # is detected so playback can start before the full
                        # reply is done — low latency.
                        parts = re.split(r'(?<=[.!?\u0964])\s+', token_buf)
                        if len(parts) > 1:
                            for sentence in parts[:-1]:
                                await speak_sentence(sentence)
                            token_buf = parts[-1]

                    elif etype == "tool_call":
                        logger.info(
                            "[WS/voice] tool_call  name=%s  args=%s",
                            event["name"], str(event.get("args", {}))[:200]
                        )
                        await send_json({
                            "type": "tool_call",
                            "name": event["name"],
                            "args": event.get("args", {})
                        })

                    elif etype == "tool_result":
                        logger.info(
                            "[WS/voice] tool_result  name=%s  result=%s",
                            event["name"], str(event.get("result", ""))[:200]
                        )
                        await send_json({
                            "type": "tool_result",
                            "name": event["name"],
                            "result": str(event.get("result", ""))
                        })

                    elif etype == "done":
                        # Flush any remaining text in the buffer
                        if token_buf:
                            await speak_sentence(token_buf)
                        token_buf = ""
                        elapsed = (time.monotonic() - t0) * 1000
                        logger.info("[WS/voice] turn DONE  %.0fms  session=%s", elapsed, session_id)
                        await send_json({"type": "done", "text": full_reply})

            except asyncio.CancelledError:
                logger.info("[WS/voice] turn CANCELLED  session=%s", session_id)
                raise
            except ConnectionClosed:
                pass
            except Exception as exc:
                logger.exception("[WS/voice] Turn failed: %s", exc)
                try:
                    await send_json({"type": "error", "message": str(exc)})
                except ConnectionClosed:
                    pass
            finally:
                state["speaking"] = False
                if history:
                    asyncio.create_task(save_stream_history(session_id, list(history)))

        # ------------------------------------------------------------------ #
        # Utterance handling (binary PCM protocol)                            #
        # ------------------------------------------------------------------ #

        async def handle_utterance(pcm_bytes: bytes):
            try:
                wav_bytes = _wrap_pcm_as_wav(pcm_bytes)
                result = await stt_transcribe(wav_bytes, language="en", filename="audio.wav")
                text = (result.get("transcript") or "").strip()
                if not text:
                    logger.info("[WS/voice] STT returned empty transcript, skipping turn")
                    return
                logger.info("[WS/voice] transcribed  %r  session=%s", text[:120], session_id)
                await send_json({"type": "final_transcript", "text": text})
                await run_turn(text)
            except asyncio.CancelledError:
                raise
            except ConnectionClosed:
                pass
            except Exception as exc:
                logger.exception("[WS/voice] Utterance handling failed: %s", exc)
                try:
                    await send_json({"type": "error", "message": str(exc)})
                except ConnectionClosed:
                    pass

        async def handle_audio_chunk(chunk: bytes):
            voiced = _is_voiced(chunk)

            if voiced:
                if not state["utterance_active"]:
                    state["utterance_active"] = True
                    state["pcm_buffer"] = bytearray()
                    state["silence_run"] = 0
                    # Barge-in: the user started talking again while the
                    # assistant was still generating/speaking — cut it off.
                    if state["turn_task"] and not state["turn_task"].done():
                        await cancel_turn()
                        await send_json({"type": "interrupted"})
                state["pcm_buffer"].extend(chunk)
                state["silence_run"] = 0
                return

            if not state["utterance_active"]:
                return  # silence with nothing buffered — nothing to do

            state["pcm_buffer"].extend(chunk)
            state["silence_run"] += 1
            if state["silence_run"] < SILENCE_CHUNKS_TO_END_UTTERANCE:
                return

            utterance = bytes(state["pcm_buffer"])
            state["utterance_active"] = False
            state["pcm_buffer"] = bytearray()
            state["silence_run"] = 0

            if len(utterance) >= MIN_UTTERANCE_BYTES:
                state["turn_task"] = asyncio.create_task(handle_utterance(utterance))

        # ------------------------------------------------------------------ #
        # Main receive loop                                                   #
        # ------------------------------------------------------------------ #

        try:
            while True:
                message = await ws.receive()

                if message.get("type") == "websocket.disconnect":
                    logger.info("[WS/voice] DISCONNECT  session=%s", session_id)
                    connected = False
                    break

                # Binary frame -> raw PCM16 audio chunk (current frontend)
                audio_bytes = message.get("bytes")
                if audio_bytes is not None:
                    await handle_audio_chunk(audio_bytes)
                    continue

                # Text frame -> legacy JSON control protocol
                text_msg = message.get("text")
                if not text_msg:
                    continue

                try:
                    control = json.loads(text_msg)
                except Exception:
                    logger.warning("[WS/voice] Bad JSON from client: %r", text_msg[:120])
                    continue

                msg_type = control.get("type")
                logger.debug("[WS/voice] recv  type=%s  session=%s", msg_type, session_id)

                if msg_type == "user_speech":
                    # Web Speech API STT → transcript text arrives here
                    text = (control.get("text") or "").strip()
                    if not text:
                        continue
                    logger.info("[WS/voice] user_speech  %r  session=%s", text[:120], session_id)
                    await cancel_turn()
                    state["turn_task"] = asyncio.create_task(run_turn(text))

                elif msg_type == "interrupt":
                    logger.info("[WS/voice] interrupt requested  session=%s", session_id)
                    await cancel_turn()
                    await send_json({"type": "interrupted"})

                elif msg_type == "end":
                    logger.info("[WS/voice] end received  session=%s", session_id)
                    break

        except (WebSocketDisconnect, ConnectionClosed):
            connected = False
        finally:
            connected = False
            await cancel_turn()
            logger.info("[WS/voice] CLOSED  session=%s", session_id)
