"""
Streaming chat endpoint (/api/chat/stream) returning Server-Sent Events (SSE).
"""

import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agent import stream_agent_turn
import db.postgres_audit_log as audit_log
from ERP.erp_client import erp_client, use_identity
from history import load_stream_history, save_stream_history
from llm_client import convert_message_to_dict
import state

logger = logging.getLogger("agent-server")
router = APIRouter(tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"
    user_id: Optional[str] = None
    sid: Optional[str] = None
    csrf_token: Optional[str] = None


@router.get("/api/chat/sessions")
def list_chat_sessions(user_id: Optional[str] = None, limit: int = 50):
    """Past chats for the sidebar: one row per session_id this user has actually
    talked in, most recently active first. `user_id` omitted lists every session
    (local/no-auth setups with no real identity)."""
    return {"sessions": audit_log.list_chat_sessions(user_id, limit=limit)}


@router.post("/api/chat/sessions/{session_id}/pin")
def pin_chat_session(session_id: str, pinned: bool = True, user_id: Optional[str] = None):
    audit_log.set_chat_session_pinned(session_id, user_id, pinned)
    return {"session_id": session_id, "pinned": pinned}


@router.delete("/api/chat/sessions/{session_id}")
async def delete_chat_session(session_id: str):
    audit_log.delete_chat_session(session_id)
    if state.saver:
        await state.saver.adelete_thread(session_id)
    return {"session_id": session_id, "deleted": True}


@router.get("/api/chat/sessions/{session_id}/messages")
async def get_chat_session_messages(session_id: str):
    """Replays one past session as the plain {sender, text} shape the chat UI
    already renders, so clicking an old chat in the sidebar can resume it.
    Tool calls/results aren't replayed (they're audit_log's job, not this) --
    only the user/assistant text, in order."""
    history = await load_stream_history(session_id)
    messages = []
    for m in history:
        d = convert_message_to_dict(m)
        if d["role"] == "user" and d["content"]:
            messages.append({"sender": "user", "text": d["content"]})
        elif d["role"] == "assistant" and d["content"]:
            messages.append({"sender": "bot", "text": d["content"]})
    return {"session_id": session_id, "messages": messages}


@router.post("/api/chat/stream")
async def chat_stream(req: ChatRequest):
    """SSE variant of /api/chat for token-by-token terminal streaming with
    inline tool-call/tool_result markers, same event shape /ws/voice uses."""
    text = (req.message or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="message is required")

    # Resolve per-user ERP identity (if sid or API credentials provided)
    identity = state.session_identities.get(req.session_id)
    if not identity and req.sid:
        try:
            identity = erp_client.resolve_session_identity(
                req.sid, user_id=req.user_id, csrf_token=req.csrf_token
            )
            state.session_identities[req.session_id] = identity
        except Exception as exc:
            logger.warning("Could not resolve session identity for %s: %s", req.session_id, exc)
    elif identity and req.csrf_token and not getattr(identity, "csrf_token", None):
        identity.csrf_token = req.csrf_token

    history = await load_stream_history(req.session_id)
    start_len = len(history)

    async def event_gen():
        yield ": connected\n\n"
        effective_user_id = identity.user if identity else req.user_id
        try:
            with use_identity(identity):
                async for event in stream_agent_turn(
                    text,
                    session_id=req.session_id,
                    user_id=effective_user_id,
                    history=history,
                ):
                    if event.get("type") == "ping":
                        yield ": ping\n\n"
                        continue
                    browser_event = {k: v for k, v in event.items() if k != "_delta"}
                    yield f"data: {json.dumps(browser_event)}\n\n"
        except Exception as exc:  # noqa: BLE001
            logger.exception("Streaming agent turn failed: %s", text)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        finally:
            delta = history[start_len:]
            if delta:
                try:
                    await save_stream_history(req.session_id, delta, user_id=effective_user_id)
                except Exception as save_err:
                    logger.warning("Could not save stream history for %s: %s", req.session_id, save_err)

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
