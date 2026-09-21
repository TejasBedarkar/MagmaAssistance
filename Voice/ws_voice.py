"""
Voice/ws_voice.py — live voice WebSocket (/ws/voice), Web Speech API mode.

  Browser SpeechRecognition → WS {type:"user_speech", text}
  stream_agent_turn()       → WS token / tool_call / tool_result / voice_sentence / done
  Browser speechSynthesis speaks each voice_sentence as it arrives

No audio flows in either direction. Same agent, tools, write gate and history as /api/chat/stream.
"""

import asyncio
import json
import random
import re
import time

from fastapi import WebSocket, WebSocketDisconnect

from ERP.erp_client import use_identity, erp_client

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


_ACTION_TAG_RE = re.compile(r'\[Action:[^\]]*\]')
_CODE_BLOCK_RE = re.compile(r'```[\s\S]*?```')
_TABLE_LINE_RE = re.compile(r'^\s*\|.*\|\s*$')
_MD_LINK_RE = re.compile(r'\[([^\]]+)\]\(([^)]+)\)')
_BARE_URL_RE = re.compile(r'https?://\S+')
_EMPTY_BULLET_RE = re.compile(r'^\s*[-*]\s*$')
_SENTENCE_SPLIT_RE = re.compile(r'(?<!\d\.)(?<!\d\d\.)(?<=[.!?।])\s+')


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
    return re.sub(r'\s+', ' ', text).strip()


def register_voice_ws(app, stream_agent_turn, logger, load_stream_history, save_stream_history):

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
        state: dict = {"turn_task": None}
        send_lock = asyncio.Lock()

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

        async def run_turn(text: str):
            t0 = time.monotonic()
            logger.info("[WS/voice] turn START  session=%s  text=%r", session_id, text[:120])
            token_buf = ""

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
                        etype = event["type"]

                        if etype == "token":
                            raw = event["text"]
                            await send_json({"type": "token", "text": raw})
                            token_buf += raw

                            parts = _SENTENCE_SPLIT_RE.split(token_buf)
                            if len(parts) > 1:
                                for sentence in parts[:-1]:
                                    cleaned = clean_for_speech(sentence)
                                    if cleaned:
                                        await send_json({"type": "voice_sentence", "text": cleaned})
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
                            await send_json({
                                "type": "voice_sentence",
                                "text": _tool_filler_phrase(event["name"], event.get("args", {})),
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
                            final = clean_for_speech(token_buf)
                            if final:
                                await send_json({"type": "voice_sentence", "text": final})
                            token_buf = ""
                            elapsed = (time.monotonic() - t0) * 1000
                            logger.info("[WS/voice] turn DONE  %.0fms  session=%s", elapsed, session_id)
                            await send_json({"type": "done"})

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
                delta = history[start_len:]
                if delta:
                    try:
                        await save_stream_history(session_id, delta)
                    except Exception as save_err:
                        logger.warning(
                            "[WS/voice] Could not save stream history for %s: %s",
                            session_id, save_err,
                        )

        try:
            await send_json({"type": "ready"})
            while True:
                message = await ws.receive()

                if message.get("type") == "websocket.disconnect":
                    logger.info("[WS/voice] DISCONNECT  session=%s", session_id)
                    break

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
            pass
        finally:
            connected = False
            await cancel_turn()
            logger.info("[WS/voice] CLOSED  session=%s", session_id)
