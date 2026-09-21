"""HTTP API for durable ERP business plans and signed ERP events."""

import hashlib
import hmac
import json
import os
from typing import Any, Literal, Optional

from fastapi import APIRouter, Header, HTTPException, Request, status
from pydantic import BaseModel, Field

from business_plans import business_plan_store
from business_plans.erp_graph import ERPRelationshipExplorer
from business_plans.executor import plan_executor
from business_plans.radar import erp_radar
from ERP.erp_client import erp_client, use_identity
import state

router = APIRouter(prefix="/api/plans", tags=["business-plans"])

_MANAGER_ROLES = {"System Manager", "ERP Manager", "Manufacturing Manager", "Sales Manager"}


class EntityRef(BaseModel):
    doctype: str = Field(min_length=1, max_length=140)
    name: str = Field(min_length=1, max_length=140)
    relationship: str = Field(default="context", min_length=1, max_length=80)
    company: Optional[str] = Field(default=None, max_length=140)
    source: str = Field(default="user", max_length=40)
    confidence: Optional[float] = Field(default=None, ge=0, le=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ActionDraft(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    action_type: str = Field(min_length=1, max_length=120)
    target_ref: dict[str, Any]
    source_refs: list[dict[str, Any]] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)
    preconditions: list[str] = Field(default_factory=list)
    postconditions: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)
    required_permission: Optional[str] = Field(default=None, max_length=120)
    risk: Literal["low", "medium", "high", "critical"] = "medium"
    idempotency_key: Optional[str] = Field(default=None, max_length=255)


class CreatePlanRequest(BaseModel):
    objective: str = Field(min_length=5, max_length=4000)
    session_id: str = Field(default="default", max_length=255)
    user_id: Optional[str] = Field(default=None, max_length=255)
    tenant_id: str = Field(default="default", max_length=255)
    source: Literal["chat", "voice", "erp_event", "api"] = "api"
    assumptions: list[str] = Field(default_factory=list)
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    entities: list[EntityRef] = Field(default_factory=list)
    actions: list[ActionDraft] = Field(default_factory=list)


class DecisionRequest(BaseModel):
    session_id: str = Field(default="default", max_length=255)
    user_id: Optional[str] = Field(default=None, max_length=255)
    action_ids: list[str] = Field(min_length=1, max_length=100)
    decision: Literal["approve", "reject"]
    note: Optional[str] = Field(default=None, max_length=2000)


class ERPEvent(BaseModel):
    event_id: str = Field(min_length=1, max_length=255)
    tenant_id: str = Field(default="default", max_length=255)
    event_type: str = Field(min_length=1, max_length=120)
    doctype: str = Field(min_length=1, max_length=140)
    document_name: str = Field(min_length=1, max_length=140)
    document_version: Optional[str] = Field(default=None, max_length=140)
    actor_user_id: Optional[str] = Field(default=None, max_length=255)
    payload: dict[str, Any] = Field(default_factory=dict)


def _actor(session_id: str, supplied_user_id: Optional[str]) -> tuple[str, set[str]]:
    identity = state.session_identities.get(session_id)
    if identity:
        return identity.user, set(identity.roles or [])
    return supplied_user_id or f"anonymous:{session_id}", set()


def _ensure_visible(plan: dict[str, Any], actor: str, roles: set[str]) -> None:
    if plan["owner_user_id"] != actor and not (_MANAGER_ROLES & roles):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot access this business plan.")


@router.post("", status_code=status.HTTP_201_CREATED)
def create_plan(req: CreatePlanRequest):
    """Create a draft plan. This endpoint does not execute ERP writes."""
    owner, _ = _actor(req.session_id, req.user_id)
    plan = business_plan_store.create_plan(
        tenant_id=req.tenant_id, owner_user_id=owner, session_id=req.session_id,
        objective=req.objective, source=req.source, assumptions=req.assumptions, evidence=req.evidence,
    )
    for entity in req.entities:
        plan = business_plan_store.add_entity(plan["id"], **entity.model_dump())
    for action in req.actions:
        plan = business_plan_store.add_action(plan["id"], **action.model_dump())
    return plan


@router.get("")
def list_plans(session_id: str = "default", user_id: Optional[str] = None, tenant_id: Optional[str] = None, limit: int = 50):
    actor, roles = _actor(session_id, user_id)
    # Only manager roles can inspect every plan in their selected tenant.
    plans = business_plan_store.list_plans(
        tenant_id=tenant_id,
        owner_user_id=None if (_MANAGER_ROLES & roles) else actor,
        limit=limit,
    )
    return {"plans": plans}


@router.get("/radar")
def get_radar_briefing(session_id: str = "default", user_id: Optional[str] = None, company: Optional[str] = None):
    """Proactively evaluate the ERP pulse and return recommendations, plans and action cards."""
    actor, _ = _actor(session_id, user_id)
    identity = state.session_identities.get(session_id)
    with use_identity(identity):
        return erp_radar.scan_erp_state(company=company, session_id=session_id, user_id=actor)


@router.get("/{plan_id}")
def get_plan(plan_id: str, session_id: str = "default", user_id: Optional[str] = None):
    plan = business_plan_store.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Business plan not found.")
    actor, roles = _actor(session_id, user_id)
    _ensure_visible(plan, actor, roles)
    return plan


@router.get("/{plan_id}/context")
def get_plan_context(plan_id: str, session_id: str = "default", user_id: Optional[str] = None):
    """Read the exact plan records and return their metadata-derived ERP links."""
    plan = business_plan_store.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Business plan not found.")
    actor, roles = _actor(session_id, user_id)
    _ensure_visible(plan, actor, roles)
    identity = state.session_identities.get(session_id)
    roots = [
        {"doctype": entity["doctype"], "name": entity["name"], "company": entity.get("company")}
        for entity in plan["entities"]
    ]
    with use_identity(identity):
        return ERPRelationshipExplorer(erp_client).explore(roots)


@router.post("/{plan_id}/decisions")
def decide_actions(plan_id: str, req: DecisionRequest):
    """Approve/reject stored action payloads; execution is intentionally not wired yet."""
    plan = business_plan_store.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Business plan not found.")
    actor, roles = _actor(req.session_id, req.user_id)
    _ensure_visible(plan, actor, roles)
    try:
        return business_plan_store.decide_actions(
            plan_id, req.action_ids, decision=req.decision, decided_by=actor, note=req.note
        )
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{plan_id}/execute")
def execute_plan(plan_id: str, session_id: str = "default", user_id: Optional[str] = None):
    """Execute all approved or pending actions in a business plan."""
    plan = business_plan_store.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Business plan not found.")
    actor, roles = _actor(session_id, user_id)
    _ensure_visible(plan, actor, roles)
    identity = state.session_identities.get(session_id)
    results = []
    with use_identity(identity):
        for action in plan.get("actions", []):
            if action.get("status") in {"approved", "pending_approval"}:
                res = plan_executor.execute_action(
                    plan_id=plan_id,
                    action_key=action.get("idempotency_key", f"action:{action['id']}"),
                    payload=action.get("payload") or {},
                    actor_user_id=actor,
                )
                results.append(res)
    return {"plan_id": plan_id, "executed_actions": len(results), "results": results}


@router.post("/events/erp", status_code=status.HTTP_202_ACCEPTED)
async def receive_erp_event(request: Request, x_magma_event_signature: Optional[str] = Header(default=None)):
    """Record a signed Frappe event once; event-to-plan analysis comes next."""
    secret = os.environ.get("ERP_EVENT_SECRET")
    if not secret:
        raise HTTPException(status_code=503, detail="ERP event intake is not configured.")
    raw_body = await request.body()
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    if not x_magma_event_signature or not hmac.compare_digest(expected, x_magma_event_signature):
        raise HTTPException(status_code=401, detail="Invalid ERP event signature.")
    try:
        event = ERPEvent.model_validate(json.loads(raw_body))
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid ERP event payload.") from exc
    event_data = event.model_dump()
    external_event_id = event_data.pop("event_id")
    saved, created = business_plan_store.record_event(
        external_event_id=external_event_id, **event_data
    )
    return {"accepted": True, "deduplicated": not created, "event": saved}
