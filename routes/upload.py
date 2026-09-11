"""
Document upload and Vision OCR processing routes.
"""

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from agent import _execute_tool
import db.postgres_audit_log as audit_log
from ERP.erp_client import erp_client
from LLM.LLM import LLM
from storage import s3_storage
import state

logger = logging.getLogger("agent-server")
router = APIRouter(tags=["upload"])

llm_ocr_engine = LLM()


class DocumentUploadResponse(BaseModel):
    status: str
    filename: str
    message: str
    ocr_data: Optional[Dict[str, Any]] = None


@router.post("/api/upload-po", response_model=DocumentUploadResponse)
async def upload_purchase_order_file(
    file: UploadFile = File(...),
    session_id: str = Form("default"),
    user_id: str = Form("anonymous"),
):
    """
    Handles PO Image / PDF file upload, runs Vision OCR extraction, and --
    if the document actually looks like a Purchase Order -- creates it
    directly in ERPNext right here via the OCR-aware auto-create tool.
    """
    allowed_types = ["image/jpeg", "image/png", "application/pdf", "image/jpg"]

    if file.content_type.lower() not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{file.content_type}'. Please upload JPEG, PNG, or PDF."
        )

    try:
        file_bytes = await file.read()
        if len(file_bytes) > 10 * 1024 * 1024:
            raise HTTPException(
                status_code=400,
                detail="File size exceeds the 10MB limit."
            )

        logger.info(f"File '{file.filename}' uploaded successfully for session '{session_id}'. Extracting OCR data...")

        upload_meta = None
        if s3_storage.is_configured():
            upload_meta = s3_storage.upload_file(
                file_bytes=file_bytes,
                original_filename=file.filename,
                content_type=file.content_type,
                upload_kind="purchase_order",
                session_id=session_id,
                user_id=user_id,
            )
        else:
            logger.info("S3 not configured -- skipping original-file storage for '%s'.", file.filename)

        ocr_result = llm_ocr_engine.extract_po_data_from_document(
            file_bytes=file_bytes,
            mime_type=file.content_type
        )

        if not ocr_result.get("is_po"):
            state.document_store[session_id] = {
                "filename": file.filename,
                "text": ocr_result.get("raw_text", ""),
                "injected": False,
            }
            if upload_meta:
                audit_log.record_file_upload(
                    **upload_meta, extracted_metadata=ocr_result, status="processed",
                )
            return DocumentUploadResponse(
                status="not_a_po",
                filename=file.filename,
                message=ocr_result.get(
                    "note", "This document doesn't look like a Purchase Order."
                ) + " You can ask questions about it in chat.",
                ocr_data=ocr_result
            )

        create_args = {
            "vendor_name": ocr_result.get("vendor_name", ""),
            "items": ocr_result.get("items", []),
            "po_number": ocr_result.get("po_number", ""),
            "delivery_date": ocr_result.get("delivery_date", ""),
            "remarks": ocr_result.get("payment_terms", ""),
        }
        creation_result = await _execute_tool(
            "process_ocr_po_and_create_order", create_args, session_id=session_id,
            user_id=user_id, prompt_text=f"[uploaded PO file '{file.filename}']",
        )
        logger.info("PO auto-create result: %s", creation_result)

        if upload_meta:
            audit_log.record_file_upload(
                **upload_meta, extracted_metadata=ocr_result, status="processed",
            )

        return DocumentUploadResponse(
            status="success",
            filename=file.filename,
            message=str(creation_result),
            ocr_data=ocr_result
        )

    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.exception("Error handling document upload in /api/upload-po")
        raise HTTPException(status_code=500, detail=f"Failed to process uploaded file: {str(e)}")


class GeneralDocumentUploadResponse(BaseModel):
    status: str
    filename: str
    message: str
    page_count: int
    extraction_method: str


@router.post("/api/upload-document", response_model=GeneralDocumentUploadResponse)
async def upload_general_document(
    file: UploadFile = File(...),
    session_id: str = Form("default"),
    user_id: str = Form("anonymous"),
    sid: Optional[str] = Form(None),
    csrf_token: Optional[str] = Form(None),
):
    """Reads ANY PDF or image (not just Purchase Orders), extracts its
    full text, and stores it against session_id so the user can ask
    follow-up questions about it in normal chat."""
    if sid and session_id not in state.session_identities:
        try:
            state.session_identities[session_id] = erp_client.resolve_session_identity(
                sid, user_id=user_id, csrf_token=csrf_token
            )
        except Exception as exc:
            logger.warning("Could not resolve session identity on upload for %s: %s", session_id, exc)

    allowed_types = ["image/jpeg", "image/png", "application/pdf", "image/jpg"]

    if file.content_type.lower() not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{file.content_type}'. Please upload JPEG, PNG, or PDF."
        )

    try:
        file_bytes = await file.read()
        if len(file_bytes) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File size exceeds the 10MB limit.")

        logger.info(f"File '{file.filename}' uploaded for session '{session_id}'. Extracting document text...")

        upload_meta = None
        if s3_storage.is_configured():
            upload_meta = s3_storage.upload_file(
                file_bytes=file_bytes,
                original_filename=file.filename,
                content_type=file.content_type,
                upload_kind="general_document",
                session_id=session_id,
                user_id=user_id,
            )
        else:
            logger.info("S3 not configured -- skipping original-file storage for '%s'.", file.filename)

        extraction = llm_ocr_engine.extract_document_text(file_bytes=file_bytes, mime_type=file.content_type)

        state.document_store[session_id] = {
            "filename": file.filename,
            "text": extraction["text"],
            "injected": False,
        }

        if upload_meta:
            audit_log.record_file_upload(
                **upload_meta,
                extracted_metadata={
                    "page_count": extraction["page_count"],
                    "pages_read": extraction["pages_read"],
                    "method": extraction["method"],
                },
                status="processed",
            )

        return GeneralDocumentUploadResponse(
            status="success",
            filename=file.filename,
            message=(
                f"Document read successfully ({extraction['pages_read']}/{extraction['page_count']} "
                f"page(s), method={extraction['method']}). You can now ask questions about it in chat."
            ),
            page_count=extraction["page_count"],
            extraction_method=extraction["method"],
        )

    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.exception("Error handling document upload in /api/upload-document")
        raise HTTPException(status_code=500, detail=f"Failed to process uploaded file: {str(e)}")
