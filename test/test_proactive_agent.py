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


def test_manufacturing_feasibility_query():
    async def _run():
        mock_plan_result = {
            "summary": "Yes, we can manufacture 10,000 HB Pencils for Magna Data! Full plan prepared.",
            "primary_card": {
                "title": "Manufacturing Plan: 10,000 HB Pencils",
                "badge": "Plan Ready",
                "action_key": "mfg_goal:HB-PENCIL:10000",
                "summary_fields": [
                    {"label": "Customer", "value": "Magna Data"},
                    {"label": "Product", "value": "10,000x HB Pencil"},
                ],
            },
            "suggested_actions": ["⚡ Execute Manufacturing Plan for HB Pencil"],
        }

        with patch("agent.agent.erp_radar.prepare_manufacturing_goal", return_value=mock_plan_result):
            events = []
            prompt = "the company Magna Data want to buy 10000 pencils from us can we manufacture it"
            async for ev in stream_agent_turn(prompt, session_id="test_chat_mfg", history=[]):
                events.append(ev)

            done_events = [e for e in events if e.get("type") == "done"]
            assert len(done_events) == 1
            done = done_events[0]
            assert "10,000 HB Pencils" in done["text"]
            assert done["action_card"]["title"] == "Manufacturing Plan: 10,000 HB Pencils"
            assert done["suggested_actions"] == ["⚡ Execute Manufacturing Plan for HB Pencil"]

    asyncio.run(_run())
