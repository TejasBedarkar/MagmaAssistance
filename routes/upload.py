"""
Document upload and Vision OCR processing routes.
"""

import logging
import mimetypes
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from agent import _execute_tool
import db.postgres_audit_log as audit_log
from ERP.erp_client import erp_client
from LLM import document_reader
from LLM.LLM import LLM
from storage import s3_storage
import state

logger = logging.getLogger("agent-server")
router = APIRouter(tags=["upload"])

llm_ocr_engine = LLM()

MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "10")) * 1024 * 1024


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
            state.add_session_document(
                session_id,
                file.filename,
                ocr_result.get("raw_text", ""),
                file_type="pdf" if "pdf" in (file.content_type or "").lower() else "image",
                method=ocr_result.get("method", ""),
            )
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
    file_type: str = ""
    truncated: bool = False


@router.post("/api/upload-document", response_model=GeneralDocumentUploadResponse)
async def upload_general_document(
    file: UploadFile = File(...),
    session_id: str = Form("default"),
    user_id: str = Form("anonymous"),
    sid: Optional[str] = Form(None),
    csrf_token: Optional[str] = Form(None),
):
    """Reads ANY supported file -- images (JPG/PNG/WEBP/GIF/BMP/TIFF), PDF,
    Excel (XLSX/XLSM), CSV/TSV, JSON, Word (DOCX), TXT/MD -- extracts its
    content as text, and stores it against session_id. stream_agent_turn()
    then puts it in front of the model on every turn, so the user can ask
    about it (or act on it) in normal chat."""
    if sid and session_id not in state.session_identities:
        try:
            state.session_identities[session_id] = erp_client.resolve_session_identity(
                sid, user_id=user_id, csrf_token=csrf_token
            )
        except Exception as exc:
            logger.warning("Could not resolve session identity on upload for %s: %s", session_id, exc)

    filename = file.filename or "upload"
    kind = document_reader.detect_kind(filename, file.content_type)
    if kind is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file format '{os.path.splitext(filename)[1] or file.content_type}'. "
                f"Please upload {document_reader.SUPPORTED_DESCRIPTION}."
            ),
        )

    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="The uploaded file is empty.")
        if len(file_bytes) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"File size exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)}MB limit.",
            )

        logger.info("File '%s' (%s) uploaded for session '%s'. Extracting content...", filename, kind, session_id)

        content_type = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"

        # Archiving the original in S3 is nice-to-have: if it fails, the user must
        # still be able to talk about the document they just uploaded.
        upload_meta = None
        if s3_storage.is_configured():
            try:
                upload_meta = s3_storage.upload_file(
                    file_bytes=file_bytes,
                    original_filename=filename,
                    content_type=content_type,
                    upload_kind="general_document",
                    session_id=session_id,
                    user_id=user_id,
                )
            except Exception:
                logger.exception("S3 archive of '%s' failed -- continuing without it.", filename)
        else:
            logger.info("S3 not configured -- skipping original-file storage for '%s'.", filename)

        # extraction does blocking network / CPU work (Vision API, PDF, Excel) --
        # keep it off the event loop so chat and voice keep streaming meanwhile
        try:
            extraction = await run_in_threadpool(
                document_reader.read_file, file_bytes, filename, file.content_type, llm_ocr_engine
            )
        except document_reader.DocumentReadError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

        state.add_session_document(
            session_id,
            filename,
            extraction["text"],
            file_type=extraction["kind"],
            method=extraction["method"],
            detail=extraction["detail"],
            truncated=extraction["truncated"],
        )

        if upload_meta:
            try:
                audit_log.record_file_upload(
                    **upload_meta,
                    extracted_metadata={
                        "file_type": extraction["kind"],
                        "detail": extraction["detail"],
                        "page_count": extraction["page_count"],
                        "pages_read": extraction["pages_read"],
                        "method": extraction["method"],
                    },
                    status="processed",
                )
            except Exception:
                logger.exception("Could not write file_uploads audit row for '%s'.", filename)

        message = f"Read {filename} ({extraction['detail']})."
        if extraction["truncated"]:
            message += " Note: the file is large, so only the first part could be read."

        return GeneralDocumentUploadResponse(
            status="success",
            filename=filename,
            message=message,
            page_count=extraction["page_count"],
            extraction_method=extraction["method"],
            file_type=extraction["kind"],
            truncated=extraction["truncated"],
        )

    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.exception("Error handling document upload in /api/upload-document")
        raise HTTPException(status_code=500, detail=f"Failed to process uploaded file: {str(e)}")