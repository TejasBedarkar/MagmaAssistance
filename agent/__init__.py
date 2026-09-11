"""
Agent package: live streaming ReAct agent loop, tool execution, and write-approval gate.
"""

from agent.agent import (
    _GATED_WRITE_OPERATIONS,
    _ALWAYS_GATED_TOOLS,
    _is_write_call,
    _describe_pending_action,
    _is_write_approval,
    _is_write_rejection,
    _execute_tool,
    _stream_chat_completion,
    _stream_full_reply,
    stream_agent_turn,
)

__all__ = [
    "_GATED_WRITE_OPERATIONS",
    "_ALWAYS_GATED_TOOLS",
    "_is_write_call",
    "_describe_pending_action",
    "_is_write_approval",
    "_is_write_rejection",
    "_execute_tool",
    "_stream_chat_completion",
    "_stream_full_reply",
    "stream_agent_turn",
]
