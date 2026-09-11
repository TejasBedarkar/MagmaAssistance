"""
Session identity management routes for per-user RBAC.
"""

from typing import Optional

from fastapi import APIRouter, Form, HTTPException
from pydantic import BaseModel

from ERP.erp_client import erp_client
import state

router = APIRouter(tags=["session"])


class SessionIdentifyRequest(BaseModel):
    session_id: str
    erp_api_key: Optional[str] = None
    erp_api_secret: Optional[str] = None
    sid: Optional[str] = None
    user_id: Optional[str] = None
    csrf_token: Optional[str] = None


@router.post("/api/session/identify")
async def identify_session(req: SessionIdentifyRequest):
    """Bind a real ERPNext user to a chat session, via their personal
    API key/secret or active Frappe session cookie (sid)."""
    try:
        if req.erp_api_key and req.erp_api_secret:
            identity = erp_client.resolve_identity(req.erp_api_key, req.erp_api_secret)
        elif req.sid:
            identity = erp_client.resolve_session_identity(
                req.sid, user_id=req.user_id, csrf_token=req.csrf_token
            )
        else:
            raise HTTPException(status_code=400, detail="Either erp_api_key/secret or sid must be provided.")
    except PermissionError as e:
        raise HTTPException(status_code=401, detail=str(e))

    state.session_identities[req.session_id] = identity
    return {"authenticated": True, "user": identity.user, "roles": identity.roles}


@router.post("/api/session/logout")
async def logout_session(session_id: str = Form(...)):
    """Unbind whatever identity was set for this session -- subsequent
    turns fall back to the shared service account until re-identified."""
    state.session_identities.pop(session_id, None)
    return {"success": True}
