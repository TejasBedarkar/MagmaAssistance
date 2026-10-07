"""An interrupted approval must not be re-run by a later "proceed", and voice must not read record fields aloud."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from langchain_core.messages import AIMessage

import db.postgres_audit_log as audit_log
from agent import agent as agent_module
from Voice.ws_voice import clean_for_speech

OPP_ARGS = {"source_doctype": "Lead", "source_name": "CRM-LEAD-2026-00033", "target_doctype": "Opportunity"}


def test_voice_skips_record_field_bullets_but_keeps_sentences():
    reply = (
        "The Opportunity has been created.\n\n"
        "- **Opportunity ID:** CRM-OPP-2026-00011\n"
        "- **Customer Name**: Freshworks\n"
        "1. **Status:** Open\n"
        "- **Tip** reply with a name to see details\n\n"
        "Want me to create a quotation next?"
    )
    spoken = clean_for_speech(reply)
    assert "CRM-OPP" not in spoken and "Freshworks" not in spoken and "Open" not in spoken
    assert spoken.startswith("The Opportunity has been created.")
    assert "Tip reply with a name" in spoken
    assert spoken.endswith("Want me to create a quotation next?")


@pytest.fixture
def temp_audit_db(tmp_path, monkeypatch):
    monkeypatch.setattr(audit_log, "DB_PATH", tmp_path / "audit.db")
    audit_log.init_db()


def test_recent_executed_write_matches_same_action_ignoring_run_flags(temp_audit_db):
    audit_log.log_turn("s1", "tool", "{'name': 'CRM-OPP-2026-00011'}", tool_name="convert_crm_record",
                       tool_args={**OPP_ARGS, "dry_run": False, "session_id": "s1"}, tool_status="approved_executed")
    assert "CRM-OPP-2026-00011" in audit_log.recent_executed_write("s1", "convert_crm_record", {**OPP_ARGS, "dry_run": False})
    assert audit_log.recent_executed_write("s2", "convert_crm_record", OPP_ARGS) is None
    assert audit_log.recent_executed_write("s1", "convert_crm_record", {**OPP_ARGS, "source_name": "CRM-LEAD-2026-00034"}) is None


def test_recent_executed_write_ignores_previews(temp_audit_db):
    audit_log.log_turn("s1", "tool", "DRY RUN", tool_name="convert_crm_record", tool_args=OPP_ARGS, tool_status="success")
    assert audit_log.recent_executed_write("s1", "convert_crm_record", OPP_ARGS) is None


async def _interrupted_approval(history):
    async def cancelled_summary(*_args, **_kwargs):
        raise asyncio.CancelledError
        yield  # makes this an async generator

    pending = [{"tool_name": "convert_crm_record", "args": {**OPP_ARGS, "dry_run": False}}]
    with patch.object(audit_log, "get_pending_approvals", return_value=pending), \
         patch.object(audit_log, "clear_pending_approval"), \
         patch.object(agent_module, "_execute_tool", AsyncMock(return_value="{'name': 'CRM-OPP-2026-00011'}")), \
         patch.object(agent_module, "_stream_full_reply", cancelled_summary):
        with pytest.raises(asyncio.CancelledError):
            async for _ in agent_module.stream_agent_turn("Okay please go ahead", session_id="s1", history=history):
                pass


def test_interrupted_approval_still_records_the_action_as_done():
    history = [AIMessage(content="Shall I proceed with this conversion?")]
    asyncio.run(_interrupted_approval(history))
    last = history[-1]
    assert isinstance(last, AIMessage) and last.content.startswith("Done.")
    assert "CRM-OPP-2026-00011" in last.content
    assert not agent_module._PROSE_PROPOSAL_RE.search(last.content)
