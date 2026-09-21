from business_plans.store import BusinessPlanStore


def test_plan_keeps_linked_entities_and_approval_state(tmp_path):
    store = BusinessPlanStore(tmp_path / "plans.db")
    plan = store.create_plan(
        tenant_id="ACME", owner_user_id="sales@example.com", session_id="s1",
        objective="Plan fulfilment for Sales Order SO-0001", source="chat",
    )
    plan = store.add_entity(
        plan["id"], doctype="Sales Order", name="SO-0001", relationship="source", company="ACME"
    )
    plan = store.add_action(
        plan["id"], title="Create a Production Plan", action_type="erp_create",
        target_ref={"doctype": "Production Plan"},
        source_refs=[{"doctype": "Sales Order", "name": "SO-0001"}],
        preconditions=["Sales Order is submitted"], postconditions=["Production Plan links SO-0001"],
        required_permission="create:Production Plan", idempotency_key="SO-0001:production-plan",
    )

    assert plan["status"] == "awaiting_approval"
    assert plan["entities"][0]["name"] == "SO-0001"
    action_id = plan["actions"][0]["id"]
    approved = store.decide_actions(plan["id"], [action_id], decision="approve", decided_by="planner@example.com")

    assert approved["status"] == "approved"
    assert approved["actions"][0]["status"] == "approved"
    assert approved["actions"][0]["approved_by"] == "planner@example.com"


def test_erp_event_is_idempotent(tmp_path):
    store = BusinessPlanStore(tmp_path / "plans.db")
    kwargs = dict(
        external_event_id="evt-1", tenant_id="ACME", event_type="on_submit", doctype="Sales Order",
        document_name="SO-0001", document_version="3", actor_user_id="sales@example.com", payload={"status": "To Deliver"},
    )
    first, created = store.record_event(**kwargs)
    second, repeated = store.record_event(**kwargs)

    assert created is True
    assert repeated is False
    assert first["id"] == second["id"]
