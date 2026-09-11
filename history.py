"""
SQLite conversation history persistence for stream_agent_turn.
"""

import copy
import logging
from datetime import datetime, timezone

from langgraph.checkpoint.base import empty_checkpoint
from langgraph.checkpoint.base.id import uuid6

import state

logger = logging.getLogger("agent-server")


async def load_stream_history(session_id: str) -> list:
    if not state.saver:
        return []
    config = {"configurable": {"thread_id": session_id, "checkpoint_ns": ""}}
    tup = await state.saver.aget_tuple(config)
    if tup and tup.checkpoint:
        return list(tup.checkpoint["channel_values"].get("messages", []))
    return []


async def save_stream_history(session_id: str, new_messages: list):
    if not new_messages or not state.saver:
        return
    config = {"configurable": {"thread_id": session_id, "checkpoint_ns": ""}}

    prev = await state.saver.aget_tuple(config)
    if prev and prev.checkpoint:
        checkpoint = copy.deepcopy(prev.checkpoint)
        existing = list(checkpoint["channel_values"].get("messages", []))
        checkpoint["channel_values"]["messages"] = existing + new_messages
        version = checkpoint["channel_versions"].get("messages", 0) + 1
    else:
        checkpoint = empty_checkpoint()
        checkpoint["channel_values"]["messages"] = list(new_messages)
        version = 1

    checkpoint["id"] = str(uuid6(clock_seq=-2))
    checkpoint["ts"] = datetime.now(timezone.utc).isoformat()
    checkpoint["channel_versions"]["messages"] = version

    metadata = {"source": "update", "step": -1, "writes": {}, "parents": {}}
    await state.saver.aput(config, checkpoint, metadata, {"messages": version})

    if state._checkpoint_conn:
        try:
            await state._checkpoint_conn.commit()
        except Exception:
            pass
