import asyncio
from unittest.mock import patch

from agent.agent import stream_agent_turn


def test_proactive_greeting_triggers_briefing():
    async def _run():
        mock_briefing = {
            "summary": "👋 ERP Status Briefing: Detected Sales Order SO-0001 needing manufacturing.",
            "recommendations": [{"title": "SO-0001"}],
            "primary_card": {
                "title": "Ready to Manufacture: SO-0001",
                "badge": "Action Plan Ready",
                "action_key": "so_fulfilment:SO-0001",
                "summary_fields": [{"label": "Order", "value": "SO-0001"}],
            },
            "suggested_actions": ["⚡ Execute Manufacturing Plan for SO-0001"],
        }

        with patch("agent.agent.erp_radar.scan_erp_state", return_value=mock_briefing):
            events = []
            async for ev in stream_agent_turn("hello", session_id="test_chat", history=[]):
                events.append(ev)

            token_events = [e for e in events if e.get("type") == "token"]
            assert len(token_events) > 0

            done_events = [e for e in events if e.get("type") == "done"]
            assert len(done_events) == 1
            done = done_events[0]
            assert "SO-0001" in done["text"]
            assert done["action_card"]["action_key"] == "so_fulfilment:SO-0001"
            assert done["suggested_actions"] == ["⚡ Execute Manufacturing Plan for SO-0001"]

    asyncio.run(_run())


def test_direct_chip_execution():
    async def _run():
        mock_exec_result = {
            "success": True,
            "doctype": "Production Plan",
            "docname": "PROD-PLAN-001",
            "message": "Production Plan PROD-PLAN-001 generated successfully for Sales Order SO-0001!",
            "next_actions": ["⚙️ Generate Work Orders for PROD-PLAN-001"],
        }

        with patch("agent.agent.plan_executor.execute_action", return_value=mock_exec_result):
            events = []
            async for ev in stream_agent_turn("⚡ Execute Manufacturing Plan for SO-0001", session_id="test_chat", history=[]):
                events.append(ev)

            done_events = [e for e in events if e.get("type") == "done"]
            assert len(done_events) == 1
            done = done_events[0]
            assert "PROD-PLAN-001" in done["text"]
            assert done["suggested_actions"] == ["⚙️ Generate Work Orders for PROD-PLAN-001"]

    asyncio.run(_run())
