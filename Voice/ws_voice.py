"""
Voice/ws_voice.py — live voice WebSocket (/ws/voice).

  mic PCM → RealtimeTranscriber → partial/final transcript
  actionable final → stream_agent_turn() → token/tool events
  each sentence → OpenAITTS PCM out (tts_chunk_start/end + turn_id)

Same agent, tools, write gate, and history as /api/chat/stream.
HTTP TTS lives in routes/voice.py; this file is the duplex session only.
"""

import asyncio
import json
import random
import re
import threading
import time

from fastapi import WebSocket, WebSocketDisconnect

from ERP.erp_client import use_identity, erp_client
from Voice.realtime_stt import RealtimeTranscriber, is_actionable_transcript

_ws_bg_tasks = set()


def safe_create_task(coro):
    task = asyncio.create_task(coro)
    _ws_bg_tasks.add(task)
    task.add_done_callback(_ws_bg_tasks.discard)
    return task


# Short lines spoken while a tool call is running, so a slow one doesn't go silent.
_TOOL_FILLER_PHRASES = {
    "web_company_search": ["Let me search for that.", "Looking that up online."],
    "web_company_extract": ["Extracting their details now.", "Pulling up their contact info."],
    "web_crawl": ["Looking into their website."],
    "web_search": ["Searching for that."],
    "web_fetch_page": ["Pulling that page up."],
    "erp_describe_fields": ["One moment."],
    "erp_send_email": ["Sending that now."],
    "convert_crm_record": ["Converting that record now."],
    "onboard_new_lead": ["Setting that up."],
    "batch_manage_project_tasks": ["Setting up those tasks."],
    "reassign_tasks": ["Reassigning that now."],
}
_ERP_OP_FILLERS = {
    "list": ["Checking your records.", "Looking that up in MagnaERP."],
    "get": ["Pulling that record up."],
    "create": ["Setting that up in MagnaERP."],
    "update": ["Updating that now."],
    "submit": ["Submitting that now."],
}
_DEFAULT_FILLER = ["Working on it.", "One moment."]


def _tool_filler_phrase(tool_name: str, args: dict) -> str:
    if tool_name == "erp_data_tool":
        op = str((args or {}).get("operation") or "").strip().lower()
        options = _ERP_OP_FILLERS.get(op, _DEFAULT_FILLER)
    else:
        options = _TOOL_FILLER_PHRASES.get(tool_name, _DEFAULT_FILLER)
    return random.choice(options)


def register_voice_ws(app, stream_agent_turn, tts, logger, load_stream_history, save_stream_history):

    @app.websocket("/ws/voice")
    async def ws_voice(
        ws: WebSocket,
        session_id: str = "voice-default",
        user_id: str = None,
        sid: str = None,
        csrf_token: str = None,
    ):
        await ws.accept()
        logger.info(
            "[WS/voice] OPEN  session=%s user=%s sid=%s csrf=%s",
            session_id, user_id, bool(sid), bool(csrf_token),
        )

        class ConnectionClosed(Exception):
            """Raised when a background task tries to use a closed websocket."""

        connected = True
        state = {
            "turn_task": None,
            "tts_active": False,
            "tts_inflight": 0,
            "turn_id": 0,
            "pending_text": None,
        }
        send_lock = asyncio.Lock()
        speak_lock = asyncio.Lock()  # keeps sentence audio in order
        audio_seconds_in = 0.0
        turn_start_time = time.monotonic()

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

        async def send_bytes(chunk: bytes):
            nonlocal connected
            if not connected:
                raise ConnectionClosed
            try:
                async with send_lock:
                    await ws.send({"type": "websocket.send", "bytes": chunk})
            except (WebSocketDisconnect, RuntimeError, OSError) as exc:
                connected = False
                raise ConnectionClosed from exc

        try:
            await send_json({"type": "status", "status": "connecting"})
        except ConnectionClosed:
            return

        stt = RealtimeTranscriber()
        try:
            await stt.connect()
        except Exception as exc:
            logger.exception("[WS/voice] STT connect failed: %s", exc)
            try:
                await send_json({"type": "error", "message": f"Speech recognition unavailable: {exc}"})
            except ConnectionClosed:
                pass
            await ws.close()
            return

        try:
            await send_json({"type": "ready"})
        except ConnectionClosed:
            await stt.close()
            return
        logger.info("[WS/voice] STT ready  session=%s  %.0fms", session_id, (time.monotonic() - turn_start_time) * 1000)

        async def cancel_turn():
            """Cancel in-flight turn; return its turn_id for the interrupted event. Leaves pending_text alone -- callers decide whether to start it."""
            cancelled_turn_id = state["turn_id"]
            # Invalidate in-flight TTS so speak_chunk stops sending.
            state["turn_id"] = cancelled_turn_id + 1
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
            state["tts_active"] = False
            state["tts_inflight"] = 0
            return cancelled_turn_id

        def start_pending_turn():
            """Starts whatever transcript got queued behind the turn that just ended, if any."""
            pending = state.get("pending_text")
            state["pending_text"] = None
            if pending:
                state["turn_task"] = asyncio.create_task(run_turn(pending))

        _ACTION_TAG_RE = re.compile(r'\[Action:[^\]]*\]')
        _CODE_BLOCK_RE = re.compile(r'```[\s\S]*?```')
        _TABLE_LINE_RE = re.compile(r'^\s*\|.*\|\s*$')
        _MD_LINK_RE = re.compile(r'\[([^\]]+)\]\(([^)]+)\)')
        _BARE_URL_RE = re.compile(r'https?://\S+')
        _EMPTY_BULLET_RE = re.compile(r'^\s*[-*]\s*$')

        def clean_for_speech(text: str) -> str:
            """Strip markdown that sounds bad when spoken."""
            text = _ACTION_TAG_RE.sub('', text)
            text = _CODE_BLOCK_RE.sub('', text)
            lines = [
                l for l in text.split('\n')
                if not _TABLE_LINE_RE.match(l) and not _EMPTY_BULLET_RE.match(l)
            ]
            text = '\n'.join(lines)
            text = _MD_LINK_RE.sub(r'\1', text)
            text = _BARE_URL_RE.sub('', text)
            text = text.replace('**', '').replace('*', '').replace('#', '')
            text = re.sub(r'\s+', ' ', text).strip()
            return text

        async def speak_chunk(text_chunk: str, my_turn_id: int):
            cleaned = clean_for_speech(text_chunk)
            if not cleaned or state["turn_id"] != my_turn_id:
                return
            try:
                await send_json({"type": "tts_chunk_start", "turn_id": my_turn_id})
            except ConnectionClosed:
                return

            state["tts_inflight"] += 1
            state["tts_active"] = True
            try:
                loop = asyncio.get_running_loop()
                queue: asyncio.Queue = asyncio.Queue()

                def producer():
                    try:
                        for pcm_chunk in tts.synthesize_stream(cleaned, response_format="pcm"):
                            loop.call_soon_threadsafe(queue.put_nowait, pcm_chunk)
                    except Exception as exc:  # noqa: BLE001
                        loop.call_soon_threadsafe(queue.put_nowait, exc)
                    finally:
                        loop.call_soon_threadsafe(queue.put_nowait, None)

                threading.Thread(target=producer, daemon=True).start()

                while True:
                    item = await queue.get()
                    if item is None:
                        break
                    if isinstance(item, Exception):
                        logger.warning("[WS/voice] TTS stream error: %s", item)
                        break
                    if state["turn_id"] != my_turn_id:
                        break
                    try:
                        await send_bytes(item)
                    except ConnectionClosed:
                        return
            finally:
                # Stays true across the gap between sentences too, so a barge-in
                # landing between two sentences still cancels the turn right away.
                state["tts_inflight"] = max(0, state["tts_inflight"] - 1)
                try:
                    await send_json({"type": "tts_chunk_end", "turn_id": my_turn_id})
                except ConnectionClosed:
                    pass

        async def run_turn(text: str):
            t0 = time.monotonic()
            logger.info("[WS/voice] turn START  session=%s  text=%r", session_id, text[:120])
            state["turn_id"] += 1
            my_turn_id = state["turn_id"]
            token_buf = ""
            speak_tasks = []
            filler_spoken = False

            async def enqueue_speech(sentence: str):
                """Schedule TTS without blocking the agent stream."""
                async def _speak():
                    async with speak_lock:
                        if state["turn_id"] != my_turn_id:
                            return
                        await speak_chunk(sentence, my_turn_id)

                task = asyncio.create_task(_speak())
                speak_tasks.append(task)

            history = await load_stream_history(session_id)
            start_len = len(history)

            identity = getattr(app.state, "session_identities", {}).get(session_id)
            if not identity and sid:
                try:
                    identity = erp_client.resolve_session_identity(
                        sid, user_id=user_id, csrf_token=csrf_token
                    )
                    if hasattr(app.state, "session_identities"):
                        app.state.session_identities[session_id] = identity
                except Exception as exc:
                    logger.warning("[WS/voice] Could not resolve session identity: %s", exc)
            elif identity and csrf_token and not getattr(identity, "csrf_token", None):
                identity.csrf_token = csrf_token

            try:
                effective_user = identity.user if identity else user_id
                with use_identity(identity):
                    async for event in stream_agent_turn(
                        text, session_id=session_id, user_id=effective_user, history=history
                    ):
                        if state["turn_id"] != my_turn_id:
                            break
                        etype = event["type"]

                        if etype == "token":
                            raw = event["text"]
                            await send_json({"type": "token", "text": raw})
                            token_buf += raw

                            parts = re.split(r'(?<!\d\.)(?<!\d\d\.)(?<=[.!?।])\s+', token_buf)
                            if len(parts) > 1:
                                for sentence in parts[:-1]:
                                    await enqueue_speech(sentence)
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
                            await enqueue_speech(_tool_filler_phrase(event["name"], event.get("args", {})))

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
                            if token_buf.strip():
                                await enqueue_speech(token_buf)
                            token_buf = ""
                            if speak_tasks:
                                await asyncio.gather(*speak_tasks, return_exceptions=True)
                            elapsed = (time.monotonic() - t0) * 1000
                            logger.info("[WS/voice] turn DONE  %.0fms  session=%s", elapsed, session_id)
                            await send_json({"type": "done"})

            except asyncio.CancelledError:
                logger.info("[WS/voice] turn CANCELLED  session=%s", session_id)
                for task in speak_tasks:
                    task.cancel()
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
                if state["turn_id"] == my_turn_id:
                    state["tts_active"] = False
                delta = history[start_len:]
                if delta:
                    try:
                        await save_stream_history(session_id, delta)
                    except Exception as save_err:
                        logger.warning(
                            "[WS/voice] Could not save stream history for %s: %s",
                            session_id, save_err,
                        )
                if connected and state["turn_id"] == my_turn_id:
                    start_pending_turn()

        async def stt_loop():
            try:
                async for event in stt.events():
                    etype = event["type"]
                    if etype == "speech_started":
                        if state["tts_active"]:
                            cancelled_turn_id = await cancel_turn()
                            # A reply already queued behind this one (see stt's
                            # transcript_done handling) shouldn't be lost just
                            # because trailing noise also triggered a cancel.
                            start_pending_turn()
                            try:
                                await send_json({"type": "interrupted", "turn_id": cancelled_turn_id})
                            except ConnectionClosed:
                                break
                    elif etype == "transcript_delta":
                        if event["text"]:
                            try:
                                await send_json({"type": "partial_transcript", "text": event["text"]})
                            except ConnectionClosed:
                                break
                    elif etype == "transcript_done":
                        text = (event["text"] or "").strip()
                        if not text or not is_actionable_transcript(text):
                            if text:
                                logger.info(
                                    "[WS/voice] ignoring short transcript  %r  session=%s",
                                    text[:120], session_id,
                                )
                            # Discard whatever partial draft the frontend already
                            # showed for this -- otherwise stray noise/breath
                            # picked up as "." or similar sits stuck in the chat.
                            try:
                                await send_json({"type": "transcript_discarded"})
                            except ConnectionClosed:
                                break
                            continue
                        logger.info(
                            "[WS/voice] final_transcript  %r  session=%s",
                            text[:120], session_id,
                        )
                        try:
                            await send_json({"type": "final_transcript", "text": text})
                        except ConnectionClosed:
                            break
                        if state["turn_task"] and not state["turn_task"].done():
                            state["pending_text"] = text
                            logger.info(
                                "[WS/voice] queued transcript while turn in progress  session=%s",
                                session_id,
                            )
                        else:
                            state["pending_text"] = None
                            state["turn_task"] = asyncio.create_task(run_turn(text))
                    elif etype == "error":
                        logger.warning("[WS/voice] STT error event: %s", event.get("error"))
                        try:
                            await send_json({
                                "type": "error",
                                "message": f"Speech recognition error: {event.get('error')}",
                            })
                        except ConnectionClosed:
                            break
            except Exception:
                logger.exception("[WS/voice] stt_loop crashed  session=%s", session_id)
                try:
                    await send_json({
                        "type": "error",
                        "message": "Speech recognition disconnected. Close and reopen voice.",
                    })
                except Exception:
                    pass

        stt_task = safe_create_task(stt_loop())

        try:
            while True:
                message = await ws.receive()

                if message.get("type") == "websocket.disconnect":
                    logger.info("[WS/voice] DISCONNECT  session=%s", session_id)
                    connected = False
                    break

                audio_bytes = message.get("bytes")
                if audio_bytes is not None:
                    audio_seconds_in += len(audio_bytes) / 2 / stt.sample_rate
                    try:
                        await stt.send_audio(audio_bytes)
                    except Exception as exc:
                        logger.warning("[WS/voice] STT send_audio failed: %s", exc)
                        try:
                            await send_json({
                                "type": "error",
                                "message": "Speech recognition disconnected. Close and reopen voice.",
                            })
                        except ConnectionClosed:
                            pass
                        connected = False
                        break
                    continue

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
                    text = (control.get("text") or "").strip()
                    if not text:
                        continue
                    logger.info(
                        "[WS/voice] user_speech (text fallback)  %r  session=%s",
                        text[:120], session_id,
                    )
                    await cancel_turn()
                    state["pending_text"] = None  # this typed message supersedes anything queued
                    state["turn_task"] = asyncio.create_task(run_turn(text))

                elif msg_type == "flush_stt":
                    # Client muted — finalize any in-progress utterance so the
                    # agent turn still starts without waiting for more mic audio.
                    logger.info("[WS/voice] flush_stt  session=%s", session_id)
                    try:
                        await stt.flush()
                    except Exception as exc:
                        logger.warning("[WS/voice] flush_stt failed: %s", exc)

                elif msg_type == "interrupt":
                    logger.info("[WS/voice] interrupt requested  session=%s", session_id)
                    cancelled_turn_id = await cancel_turn()
                    start_pending_turn()
                    await send_json({"type": "interrupted", "turn_id": cancelled_turn_id})

                elif msg_type == "end":
                    logger.info("[WS/voice] end received  session=%s", session_id)
                    break

        except (WebSocketDisconnect, ConnectionClosed):
            connected = False
        finally:
            connected = False
            await cancel_turn()
            stt_task.cancel()
            await stt.close()
            elapsed_total = time.monotonic() - turn_start_time
            logger.info(
                "[WS/voice] CLOSED  session=%s  mic_audio_seconds=%.1f  connection_duration=%.1fs",
                session_id, audio_seconds_in, elapsed_total,
            )
