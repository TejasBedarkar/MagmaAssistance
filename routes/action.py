"""
Routes for 1-click action execution invoked from ChatArea's ActionProposalCard.
"""

import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from business_plans.executor import plan_executor
from ERP.erp_client import use_identity
import state

logger = logging.getLogger("action-router")
router = APIRouter(prefix="/api/action", tags=["action"])


class ExecuteActionRequest(BaseModel):
    action_key: str = Field(min_length=1, max_length=255)
    payload: dict[str, Any] = Field(default_factory=dict)
    confirm_pending: bool = False
    session_id: str = "default"
    user_id: Optional[str] = None


@router.post("/execute", status_code=status.HTTP_200_OK)
def execute_action(req: ExecuteActionRequest):
    """Execute an approved action proposal immediately from an ActionProposalCard."""
    identity = state.session_identities.get(req.session_id)
    actor = identity.user if identity else (req.user_id or "Administrator")
    plan_id = req.payload.get("plan_id")

    try:
        with use_identity(identity):
            result = plan_executor.execute_action(
                plan_id=plan_id,
                action_key=req.action_key,
                payload=req.payload,
                actor_user_id=actor,
            )
            return result
    except Exception as exc:
        logger.exception("Failed to execute action %s", req.action_key)
        return {
            "success": False,
            "error": str(exc),
            "message": f"Execution failed: {exc}",
        }
