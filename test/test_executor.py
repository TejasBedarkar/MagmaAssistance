from business_plans.executor import PlanActionExecutor
from business_plans.store import BusinessPlanStore


class MockExecutorERPClient:
    def __init__(self):
        self.created = []

    def call_method(self, method, **kwargs):
        if method == "erpnext.crm.doctype.lead.lead.make_opportunity":
            return {"doctype": "Opportunity", "party_name": kwargs.get("source_name"), "opportunity_from": "Lead"}
        return {}

    def create_doc(self, doctype, doc):
        name = f"NEW-{doctype.upper().replace(' ', '-')}-001"
        self.created.append((doctype, doc, name))
        return {"name": name, **doc}


def test_executor_runs_crm_conversion(tmp_path):
    store = BusinessPlanStore(tmp_path / "plans.db")
    plan = store.create_plan(
        tenant_id="default", owner_user_id="sales@example.com", session_id="s1",
        objective="Convert Lead", source="test"
    )
    act = store.add_action(
        plan["id"], title="Convert", action_type="crm_convert",
        target_ref={"doctype": "Opportunity"},
        idempotency_key="key-1"
    )

    client = MockExecutorERPClient()
    executor = PlanActionExecutor(client=client, store=store)

    result = executor.execute_action(
        plan_id=plan["id"],
        action_key="convert_lead:LEAD-001",
        payload={"source_doctype": "Lead", "source_name": "LEAD-001", "target_doctype": "Opportunity"},
        actor_user_id="sales@example.com"
    )

    assert result["success"] is True
    assert result["doctype"] == "Opportunity"
    assert result["docname"] == "NEW-OPPORTUNITY-001"

    # Plan actions should now be approved
    updated_plan = store.get_plan(plan["id"])
    assert updated_plan["status"] == "approved"
    assert updated_plan["actions"][0]["status"] == "approved"


def test_executor_runs_so_fulfilment(tmp_path):
    store = BusinessPlanStore(tmp_path / "plans.db")
    plan = store.create_plan(
        tenant_id="default", owner_user_id="manager@example.com", session_id="s2",
        objective="Manufacturing Plan", source="test"
    )
    store.add_action(
        plan["id"], title="Produce", action_type="erp_create",
        target_ref={"doctype": "Production Plan"},
        idempotency_key="key-2"
    )

    client = MockExecutorERPClient()
    executor = PlanActionExecutor(client=client, store=store)

    result = executor.execute_action(
        plan_id=plan["id"],
        action_key="so_fulfilment:SO-001",
        payload={"sales_order": "SO-001", "item_code": "SOLAR-01", "planned_qty": 25},
        actor_user_id="manager@example.com"
    )

    assert result["success"] is True
    assert result["doctype"] == "Production Plan"
    assert result["docname"] == "NEW-PRODUCTION-PLAN-001"
    assert "SO-001" in result["message"]
