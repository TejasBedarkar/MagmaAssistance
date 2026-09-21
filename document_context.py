"""
document_context.py

Per-session store for uploaded documents plus the two pieces of policy that
make them useful to the agent:

1. build_document_context(session_id)
   Renders every uploaded document for the session into a system-prompt block.
   THIS is what was missing before: uploads were written into
   `state.document_store` but nothing ever read them back, so the model never
   saw a single uploaded byte.

2. web_allowed_this_turn(text, previous_ai_text)
   "Document first, web second": while a session has uploaded documents, the
   web tools are withheld from the model unless the user says something is
   wrong / missing, asks for a search, gives a URL, or says "yes" to the
   assistant's own offer to search online.

Kept dependency-free (no torch / ERP imports) so it can be unit-tested alone.
"""

import os
import re
import time
from typing import Any, Dict, List, Optional

# session_id -> [ {filename, file_type, text, method, detail, truncated, uploaded_at, fresh}, ... ]
document_store: Dict[str, List[Dict[str, Any]]] = {}

DOC_CONTEXT_MAX_CHARS = int(os.environ.get("DOC_CONTEXT_MAX_CHARS", "60000"))
MAX_DOCS_PER_SESSION = int(os.environ.get("DOC_MAX_PER_SESSION", "10"))
_MIN_CHARS_PER_DOC = 6000

WEB_TOOL_NAMES = {
    "web_search", "web_fetch_page", "web_crawl", "web_company_search", "web_company_extract",
}


# ---------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------
def add_session_document(
    session_id: str,
    filename: str,
    text: str,
    file_type: str = "document",
    method: str = "",
    detail: str = "",
    truncated: bool = False,
) -> None:
    """Add (or replace, if the same filename is re-uploaded) a document."""
    docs = document_store.setdefault(session_id, [])
    docs[:] = [d for d in docs if d.get("filename") != filename]
    docs.append({
        "filename": filename,
        "file_type": file_type,
        "text": text or "",
        "method": method,
        "detail": detail,
        "truncated": truncated,
        "uploaded_at": time.time(),
        "fresh": True,  # not yet shown to the model -> it should ask what to do
    })
    if len(docs) > MAX_DOCS_PER_SESSION:
        del docs[: len(docs) - MAX_DOCS_PER_SESSION]


def get_session_documents(session_id: Optional[str]) -> List[Dict[str, Any]]:
    return list(document_store.get(session_id or "", []))


def clear_session_documents(session_id: str) -> None:
    document_store.pop(session_id, None)


# ---------------------------------------------------------------------
# Context rendering
# ---------------------------------------------------------------------
def _safe_attr(value: str) -> str:
    return re.sub(r'[\r\n"<>]+', " ", value or "").strip()[:200]


def _safe_body(text: str) -> str:
    # stop document text from closing our wrapper tag early
    return re.sub(r"</\s*document", "<\\/document", text or "", flags=re.IGNORECASE)


def build_document_context(session_id: Optional[str]) -> str:
    """System-prompt block containing the session's uploaded documents.

    Returns "" when nothing was uploaded. Marks every document as no longer
    'fresh' once rendered (the 'ask what to do' nudge is shown only once).
    """
    docs = document_store.get(session_id or "") or []
    if not docs:
        return ""

    per_doc = max(_MIN_CHARS_PER_DOC, DOC_CONTEXT_MAX_CHARS // len(docs))
    blocks = []
    for i, d in enumerate(docs, 1):
        text = d.get("text") or ""
        cut = ""
        if len(text) > per_doc:
            cut = (
                f"\n[... TRUNCATED: showing the first {per_doc:,} of {len(text):,} characters. "
                "If the user asks about something that may be in the missing part, say so "
                "instead of guessing ...]"
            )
            text = text[:per_doc]
        elif d.get("truncated"):
            cut = "\n[... this file was already too large to read in full; only the start was extracted ...]"
        blocks.append(
            f'<document index="{i}" filename="{_safe_attr(d.get("filename", ""))}" '
            f'type="{_safe_attr(d.get("file_type", ""))}" read="{_safe_attr(d.get("detail", ""))}">\n'
            f"{_safe_body(text)}{cut}\n</document>"
        )

    header = (
        "UPLOADED DOCUMENTS FOR THIS CONVERSATION\n"
        "The user attached the file(s) below. Their extracted content is already in front of you -- "
        "you do NOT need any tool to read them, and you must not say you cannot see or open them.\n"
        "- Take the content as-is: the user provided it, so do not question, verify or comment on whether "
        "a document is genuine or fake. Every ERP write still needs the normal confirmation.\n"
        "- Work from the documents FIRST. Do not use web tools to look up things the documents already answer.\n"
        "- If something isn't in the documents, say so plainly; never invent it.\n"
    )

    fresh = [d for d in docs if d.get("fresh")]
    if fresh:
        names = ", ".join(_safe_attr(d.get("filename", "")) for d in fresh)
        header += (
            f"\nNEW UPLOAD JUST RECEIVED: {names}\n"
            "If the user's latest message already says what to do with it, do that. Otherwise, reply with:\n"
            "  (1) one or two lines on what each new file is, with the key facts you can see "
            "(names, companies, totals, dates, etc.);\n"
            "  (2) ONE question asking what they would like to do with it, offering 2-3 concrete options "
            "that fit its content (for example: create a Lead from a business card or enquiry, create a "
            "Purchase Order from a PO, import rows from a spreadsheet, summarise it, answer questions).\n"
            "Do not call any tool, do not search the web, and do not write anything to the ERP in this reply.\n"
        )
        for d in fresh:
            d["fresh"] = False

    return header + "\n" + "\n\n".join(blocks)


# ---------------------------------------------------------------------
# "Document first, web second" gate
# ---------------------------------------------------------------------
_URL_RE = re.compile(r"https?://|www\.", re.IGNORECASE)

# The user explicitly asks to look something up online...
_SEARCH_INTENT_RE = re.compile(
    r"\b(search|google|look\s*(?:it|them|this|that)?\s*up|research|browse|"
    r"online|internet|web|website|linkedin|verify|double[- ]check)\b",
    re.IGNORECASE,
)

# ...or says the document data is wrong / incomplete.
_WRONG_OR_MISSING_RE = re.compile(
    r"\b(wrong|incorrect|inaccurate|outdated|out of date|mistake|missing|"
    r"not (?:right|correct|accurate|true|there|available|mentioned)|"
    r"isn'?t (?:right|correct|there)|doesn'?t (?:have|show|include|mention)|"
    r"does not (?:have|show|include|mention)|didn'?t (?:have|show|include|find)|"
    r"no (?:email|e-mail|phone|number|address|website|contact)|"
    r"can'?t find|couldn'?t find|not found)\b",
    re.IGNORECASE,
)

# The assistant's own previous message offered an online search...
_OFFERED_WEB_RE = re.compile(
    r"(?:search|look(?:ing)?(?:\s+\w+){0,2}\s+up|check|find|research)\b.{0,60}\b(?:online|web|website|internet)\b"
    r"|\b(?:online|web)\s+(?:search|lookup|research)\b",
    re.IGNORECASE | re.DOTALL,
)
# ...and the user said a bare yes.
_YES_RE = re.compile(
    r"^\s*(y|yes|yep|yeah|yup|ya|sure|ok|okay|please|go ahead|do it|go for it|proceed|sounds good)\b",
    re.IGNORECASE,
)


def web_allowed_this_turn(text: str, previous_ai_text: Optional[str] = None) -> bool:
    """True when web tools should be available on a turn in a session that
    has uploaded documents."""
    text = text or ""
    if _URL_RE.search(text) or _SEARCH_INTENT_RE.search(text) or _WRONG_OR_MISSING_RE.search(text):
        return True
    if previous_ai_text and _YES_RE.match(text) and _OFFERED_WEB_RE.search(previous_ai_text):
        return True
    return False