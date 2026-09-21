from business_plans.radar import ERPProactiveRadar
from business_plans.store import BusinessPlanStore


class MockRadarERPClient:
    def get_list(self, doctype, filters=None, fields=None, limit_page_length=None):
        if doctype == "Sales Order":
            return [{"name": "SO-2026-0001", "customer": "Global Corp", "company": "Acme Inc"}]
        if doctype == "Production Plan Item":
            return []  # No production plan created yet!
        if doctype == "Bin":
            item = (filters or {}).get("item_code")
            if item == "PROD-SOLAR-PANEL":
                return [{"warehouse": "Finished Goods - A", "actual_qty": 5.0, "reserved_qty": 0.0, "projected_qty": 5.0}]
            if item == "RAW-SILICON-CELL":
                return [{"warehouse": "Stores - A", "actual_qty": 20.0, "reserved_qty": 0.0, "projected_qty": 20.0}]
            return []
        if doctype == "BOM":
            item = (filters or {}).get("item")
            if item == "PROD-SOLAR-PANEL":
                return [{"name": "BOM-SOLAR-01", "item": item, "quantity": 1.0}]
            return []
        if doctype == "Lead":
            return [{"name": "LEAD-00099", "lead_name": "Alice Smith", "company_name": "SolarTech", "status": "Interested"}]
        if doctype == "Opportunity":
            return []
        return []

    def get_doc(self, doctype, name):
        if doctype == "Sales Order" and name == "SO-2026-0001":
            return {
                "name": name,
                "customer": "Global Corp",
                "company": "Acme Inc",
                "items": [{"item_code": "PROD-SOLAR-PANEL", "qty": 20, "rate": 500, "warehouse": "Finished Goods - A"}],
            }
        if doctype == "BOM" and name == "BOM-SOLAR-01":
            return {
                "name": name,
                "item": "PROD-SOLAR-PANEL",
                "quantity": 1.0,
                "items": [
                    {"item_code": "RAW-SILICON-CELL", "item_name": "Silicon Cell", "qty": 4, "stock_uom": "Nos", "rate": 10},
                ],
            }
        return {"name": name}

    def get_meta(self, doctype):
        return {"fields": []}


def test_radar_scans_and_prepares_plan(tmp_path):
    store = BusinessPlanStore(tmp_path / "plans.db")
    client = MockRadarERPClient()
    radar = ERPProactiveRadar(client=client, store=store)

    briefing = radar.scan_erp_state(company="Acme Inc", session_id="test_sess", user_id="manager@example.com")

    assert len(briefing["recommendations"]) >= 1
    rec = briefing["recommendations"][0]
    assert "SO-2026-0001" in rec["title"]

    card = briefing["primary_card"]
    assert card is not None
    assert card["title"] == "Ready to Manufacture: SO-2026-0001"
    assert card["action_key"] == "so_fulfilment:SO-2026-0001"
    assert any("Silicon Cell" in f["value"] or "Raw Materials" in f["label"] for f in card["summary_fields"])

    # Verify plan was created in the store
    plan = store.get_plan(rec["plan_id"])
    assert plan is not None
    assert plan["status"] == "awaiting_approval"
    assert len(plan["actions"]) >= 1
    # Check actions include production plan
    action_titles = [a["title"] for a in plan["actions"]]
    assert any("Production Plan" in t for t in action_titles)
