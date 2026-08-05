"""
LLM.py

A reusable LLM wrapper class around OpenAI's chat completions API.
Can be imported and used in other projects, or run directly as a CLI chat.

Requirements:
    pip install requests python-dotenv pymupdf

.env file should contain:
    OPENAI_API_KEY=your_key_here
"""

import os
import requests
import base64
import json
import logging
from dotenv import load_dotenv
import fitz  # PyMuPDF: For converting PDF pages to PNG images

try:
    from langsmith import traceable
except ImportError:
    # LangSmith is optional -- fall back to a no-op decorator so this
    # module still works with tracing simply turned off, instead of
    # requiring the package.
    def traceable(*t_args, **t_kwargs):
        def decorator(fn):
            return fn
        if t_args and callable(t_args[0]) and not t_kwargs:
            return t_args[0]
        return decorator

load_dotenv()

logger = logging.getLogger("llm-ocr")

# Tuned for a professional ERP assistant: direct, factual, and short.
DEFAULT_SYSTEM_PROMPT = (
    "You are Magna, a professional AI assistant for a manufacturing ERP system. "
    "You help the team look up and manage sales, customer, lead, opportunity, "
    "quotation, and order data.\n\n"
    "Response style:\n"
    "- Be concise. Answer directly in 1-4 sentences, or a short bullet/table for "
    "multiple items. Do not restate the question or add filler like 'Sure, I can "
    "help with that.'\n"
    "- All currency values are in Indian Rupees (INR). Format amounts using the "
    "₹ symbol and the Indian numbering system (e.g., ₹1,25,000 or ₹12,50,00,000), "
    "rounding large figures sensibly.\n"
    "- Format numbers and dates clearly.\n"
    "- For relative dates such as today, yesterday, this month, or last month, "
    "calculate them from the current date supplied in the system message.\n"
    "- Never guess ERPNext fieldnames. Before a list/search call, use "
    "erp_describe_fields when exact fields or filter/date fields are uncertain, "
    "then use only fieldnames returned by that schema lookup. Common sales fields "
    "include Sales Order `transaction_date` and `grand_total`, and Sales Invoice "
    "`posting_date`, `name`, and `grand_total`.\n"
    "- If data is unavailable or a tool call fails, say so in one plain sentence — "
    "never invent values.\n"
    "- When the user asks to find, verify, enrich, or research a named person at a "
    "company on the public web, call research_lead_web. Present only evidence-backed "
    "Lead fields and put the supporting source URL beside each value. Search results "
    "are leads to verify, not automatically proven facts. Never create or update the "
    "Lead until the user explicitly approves the displayed research.\n"
    "- For Lead records, the researched employer/organization always maps to "
    "`company_name`. The `company` field is the internal ERP Company Link and must "
    "never contain the researched employer unless it is explicitly an existing "
    "internal Company selected by the user. Do not guess Link-field values.\n"
    "- Populate an email field only when the research evidence contains a complete, "
    "valid address with a real dotted domain (for example, name@example.com). If an "
    "email is missing, incomplete, malformed, or merely guessed, omit the field.\n"
    "- For researched Leads, copy first_name/middle_name/last_name exactly from the "
    "research tool's suggested_lead_fields. Never place company_name into a person's "
    "name field, including after short follow-ups such as yes, approve, or skip email.\n"
    "- When creating or updating a record, only use information the user actually "
    "gave you. If something required is missing, ask for it — never guess a name, "
    "ID, phone number, email, or amount.\n"
    "- After a tool call that creates or updates a single record (Customer, Lead, "
    "Opportunity, Quotation, Order, etc.), reply with one short confirmation "
    "sentence followed by a two-column Markdown table (`| Field | Value |`) "
    "listing each field that was set, instead of a bullet list. Example:\n"
    "  Customer **Rohan** has been created successfully.\n\n"
    "  | Field | Value |\n"
    "  |---|---|\n"
    "  | Customer Name | Rohan |\n"
    "  | Customer Type | Individual |\n"
    "  | Contact Number | 1234567890 |\n"
    "  | Email | rohan@email.in |\n"
    "- When a tool call returns multiple records (a list/search result), also use "
    "a Markdown table, one row per record.\n"
    "- Keep a professional, courteous tone at all times."
)

class LLM:

    def __init__(self, api_key: str = None, model: str = "gpt-4o-mini", system_prompt: str = DEFAULT_SYSTEM_PROMPT, temperature: float = 0.7, base_url: str = "https://api.openai.com/v1/chat/completions"):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("No API key provided. Set OPENAI_API_KEY in your .env file or pass api_key directly.")

        self.model_name = model
        self.system_prompt = system_prompt
        self.temperature = temperature
        self.base_url = base_url

        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        self.history = [{"role": "system", "content": self.system_prompt}]

    def set_system_prompt(self, system_prompt: str, reset_history: bool = True):
        self.system_prompt = system_prompt
        if reset_history:
            self.history = [{"role": "system", "content": self.system_prompt}]
        else:
            self.history[0] = {"role": "system", "content": self.system_prompt}

    @traceable(name="LLM.chat", run_type="llm")
    def chat(self, user_input: str, remember: bool = True):
        messages = self.history + [{"role": "user", "content": user_input}]

        data = {
            "model": self.model_name,
            "messages": messages,
            "temperature": self.temperature,
        }

        response = requests.post(
            self.base_url,
            json=data,
            headers=self.headers
        )

        reply = response.json()['choices'][0]['message']['content']

        if remember:
            self.history.append({"role": "user", "content": user_input})
            self.history.append({"role": "assistant", "content": reply})

        return reply

    def reset(self):
        self.history = [{"role": "system", "content": self.system_prompt}]

    # =====================================================================
    # MULTI-FORMAT OCR VISION METHOD (PDF + IMAGE SUPPORT)
    # =====================================================================
    @traceable(name="LLM._extract_strict_po", run_type="llm")
    def _extract_strict_po(self, file_bytes: bytes, mime_type: str) -> dict:
        """
        Extracts structured Purchase Order details from Image OR PDF bytes
        using GPT-4o Multi-modal Vision API.
        Converts PDF pages into PNG images before sending to OpenAI Vision.

        Internal helper -- raises RuntimeError if the document doesn't
        look like a PO. Call extract_po_data_from_document() instead,
        which wraps this with a general-text fallback.
        """
        try:
            image_content_payloads = []

            # 1. Check if the file is PDF or regular Image
            if "pdf" in mime_type.lower():
                logger.info("PDF document detected. Converting pages to PNG images for Vision API...")

                # Open PDF document from bytes stream
                try:
                    pdf_doc = fitz.open(stream=file_bytes, filetype="pdf")
                except Exception as e:
                    raise RuntimeError(f"Could not open PDF (it may be corrupted): {e}")

                if pdf_doc.is_encrypted:
                    # Most PO PDFs aren't password-protected, but if one is
                    # and we can't decrypt it with an empty password, fail
                    # clearly instead of rendering blank/garbled pages.
                    if not pdf_doc.authenticate(""):
                        pdf_doc.close()
                        raise RuntimeError(
                            "This PDF is password-protected and cannot be read."
                        )

                if len(pdf_doc) == 0:
                    pdf_doc.close()
                    raise RuntimeError("This PDF has no pages.")

                # Process up to first 3 pages (covers 99% of PO multi-page documents)
                for page_index in range(min(len(pdf_doc), 3)):
                    page = pdf_doc[page_index]
                    # Render page to PNG at 150 DPI for crystal clear text OCR
                    pix = page.get_pixmap(dpi=150)
                    img_bytes = pix.tobytes("png")
                    b64_str = base64.b64encode(img_bytes).decode("utf-8")
                    data_url = f"data:image/png;base64,{b64_str}"
                    
                    image_content_payloads.append({
                        "type": "image_url",
                        "image_url": {"url": data_url}
                    })
                    
                pdf_doc.close()
            else:
                # Regular image format (.png, .jpeg, .webp, etc.)
                b64_file = base64.b64encode(file_bytes).decode("utf-8")
                data_url = f"data:{mime_type};base64,{b64_file}"
                image_content_payloads.append({
                    "type": "image_url",
                    "image_url": {"url": data_url}
                })

            # 2. Strict PO Extraction System Prompt
            ocr_system_prompt = (
                "You are an expert Document OCR and Intelligent Data Extraction assistant.\n"
                "Extract all details from the provided Purchase Order document accurately.\n"
                "Return ONLY a valid JSON object matching this schema exactly with no extra text or markdown codeblocks:\n"
                "{\n"
                '  "vendor_name": "",\n'
                '  "vendor_address": "",\n'
                '  "gstin": "",\n'
                '  "po_number": "",\n'
                '  "po_date": "",\n'
                '  "delivery_date": "",\n'
                '  "payment_terms": "",\n'
                '  "currency": "INR",\n'
                '  "billing_address": "",\n'
                '  "shipping_address": "",\n'
                '  "subtotal": 0.0,\n'
                '  "tax": 0.0,\n'
                '  "discount": 0.0,\n'
                '  "grand_total": 0.0,\n'
                '  "items": [\n'
                '    {\n'
                '      "description": "",\n'
                '      "qty": 0.0,\n'
                '      "uom": "Nos",\n'
                '      "rate": 0.0,\n'
                '      "amount": 0.0\n'
                "    }\n"
                "  ]\n"
                "}"
            )

            # 3. Payload Construction for GPT-4o Vision
            user_content = [
                {"type": "text", "text": "Extract all fields from this document into structured JSON."}
            ] + image_content_payloads

            payload = {
                "model": "gpt-4o",
                "messages": [
                    {"role": "system", "content": ocr_system_prompt},
                    {
                        "role": "user",
                        "content": user_content
                    }
                ],
                "temperature": 0.0,
                "response_format": {"type": "json_object"}
            }

            # 4. API Execution
            response = requests.post(self.base_url, json=payload, headers=self.headers)
            response.raise_for_status()

            res_json = response.json()
            message = res_json["choices"][0]["message"]
            raw_content = message.get("content")

            # The model can legitimately come back with no content at all
            # -- e.g. a refusal (content flagged / doc isn't a PO), a
            # finish_reason of "length" cutting the JSON off, or the
            # provider just omitting the field. Every one of these used to
            # crash with "'NoneType' object has no attribute 'strip'"
            # instead of a readable error.
            if not raw_content or not raw_content.strip():
                refusal = message.get("refusal")
                finish_reason = res_json["choices"][0].get("finish_reason")
                if refusal:
                    raise RuntimeError(
                        f"The model declined to process this document: {refusal}"
                    )
                raise RuntimeError(
                    "The model returned no data for this document -- it likely "
                    "doesn't contain a recognizable Purchase Order "
                    f"(finish_reason={finish_reason}). Try the general "
                    "'/api/upload-document' endpoint instead if you just want "
                    "the text read out, not turned into a PO."
                )

            parsed_data = self._parse_json_response(raw_content)

            # The model can also "succeed" in the sense of returning
            # well-formed JSON that matches the schema, but with every
            # field blank/zero/N-A and no line items -- e.g. when it's
            # handed a document that plainly isn't a PO but still obeys
            # response_format=json_object rather than refusing. That's
            # not a usable extraction either, so treat it the same as a
            # refusal: let the caller fall back to general text reading.
            vendor = str(parsed_data.get("vendor_name") or "").strip()
            items = parsed_data.get("items") or []
            if not vendor or vendor.upper() in ("N/A", "NA", "NONE", "UNKNOWN") or not items:
                raise RuntimeError(
                    "The model returned an empty template (no vendor and/or "
                    "no line items) -- this document doesn't look like a "
                    "recognizable Purchase Order."
                )

            logger.info("Successfully extracted document data via OCR Vision.")
            return parsed_data

        except RuntimeError:
            raise
        except Exception as e:
            logger.exception("Error extracting PO data via Vision OCR")
            raise RuntimeError(f"OCR extraction failed: {str(e)}")

    @staticmethod
    def _parse_json_response(raw_content: str) -> dict:
        """Parse a model's JSON reply defensively. Even with
        response_format=json_object, models occasionally wrap the JSON in
        ```json ... ``` fences or add stray whitespace/prose around it --
        this strips that instead of letting json.loads() blow up."""
        text = raw_content.strip()

        if text.startswith("```"):
            # Drop the opening fence (``` or ```json) and closing ```.
            text = text.split("\n", 1)[1] if "\n" in text else text
            if text.rstrip().endswith("```"):
                text = text.rstrip()[:-3]
            text = text.strip()

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Last resort: grab the outermost {...} block in case there's
            # leading/trailing prose the model added despite instructions.
            start = text.find("{")
            end = text.rfind("}")
            if start != -1 and end != -1 and end > start:
                return json.loads(text[start:end + 1])
            raise

    @traceable(name="LLM.extract_po_data_from_document", run_type="chain")
    def extract_po_data_from_document(self, file_bytes: bytes, mime_type: str) -> dict:
        """
        Public entry point: tries strict Purchase Order extraction first.
        If the document doesn't look like a PO -- refusal, no content, or
        a blank/empty-template extraction -- this falls back to general
        text extraction (extract_document_text) instead of failing
        outright, so callers always get *something* useful back.

        Returns a dict that always has an "is_po" key:
          - is_po=True  -> normal strict PO fields (vendor_name, items,
            po_number, grand_total, etc.) -- safe to hand to the
            auto-create-Purchase-Order-in-ERPNext flow.
          - is_po=False -> {"is_po": False, "note": str, "raw_text": str,
            "page_count": int, "pages_read": int, "method": str}.

        Only raises if BOTH the strict extraction AND the general-text
        fallback fail (e.g. a genuinely corrupted/unreadable file).
        """
        try:
            parsed_data = self._extract_strict_po(file_bytes, mime_type)
            parsed_data["is_po"] = True
            return parsed_data
        except RuntimeError as strict_err:
            logger.warning(
                "Strict PO extraction failed (%s); falling back to general "
                "text extraction.", strict_err
            )
            try:
                fallback = self.extract_document_text(file_bytes, mime_type)
            except Exception as fallback_err:
                raise RuntimeError(
                    f"Could not extract Purchase Order data ({strict_err}); "
                    f"general document reading also failed ({fallback_err})."
                )

            return {
                "is_po": False,
                "note": (
                    "This document doesn't look like a Purchase Order "
                    f"({strict_err}). Returning the extracted context "
                    "instead so you can review it manually."
                ),
                "raw_text": fallback["text"],
                "page_count": fallback["page_count"],
                "pages_read": fallback["pages_read"],
                "method": fallback["method"],
            }

    # =====================================================================
    # GENERAL-PURPOSE DOCUMENT READER (ANY PDF / IMAGE, NOT JUST POs)
    # =====================================================================
    @traceable(name="LLM._vision_transcribe_image", run_type="llm")
    def _vision_transcribe_image(self, data_url: str) -> str:
        """Helper: sends one image to GPT-4o Vision and returns a plain
        transcription of everything visible on it (tables rendered as
        markdown tables). Used by extract_document_text() for scanned
        pages / plain images -- separate from the strict PO JSON prompt
        used in extract_po_data_from_document()."""
        payload = {
            "model": "gpt-4o",
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Transcribe ALL text visible in this document image "
                        "exactly as it appears, preserving reading order. "
                        "Render any tables as markdown tables. Do not "
                        "summarize, comment, or add anything not present in "
                        "the image."
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Transcribe this document."},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ],
            "temperature": 0.0,
        }
        response = requests.post(self.base_url, json=payload, headers=self.headers)
        response.raise_for_status()
        res_json = response.json()
        message = res_json["choices"][0]["message"]
        content = message.get("content")
        if content is None:
            refusal = message.get("refusal")
            logger.warning("Vision transcription returned no content: %s", refusal)
            return f"[Could not read this page: {refusal or 'no content returned'}]"
        return content.strip()

    @traceable(name="LLM.extract_document_text", run_type="chain")
    def extract_document_text(self, file_bytes: bytes, mime_type: str, max_pages: int = 20) -> dict:
        """
        Reads ANY PDF or image and returns its full text content, so the
        user can later ask free-form questions about it in chat. This is
        intentionally separate from extract_po_data_from_document(),
        which keeps doing the strict Purchase-Order JSON extraction for
        the auto-create-in-ERPNext flow -- that method is untouched.

        Strategy for PDFs: try PyMuPDF's native text layer first (fast,
        free, no API call needed) since most PDFs are digital-native.
        Only fall back to GPT-4o Vision OCR, page by page, for pages
        whose native text comes back empty/near-empty (i.e. scanned or
        image-only pages).

        Returns: {"text": str, "page_count": int, "pages_read": int,
                  "method": "native" | "vision" | "mixed"}
        """
        try:
            if "pdf" in mime_type.lower():
                try:
                    pdf_doc = fitz.open(stream=file_bytes, filetype="pdf")
                except Exception as e:
                    raise RuntimeError(f"Could not open PDF (it may be corrupted): {e}")

                if pdf_doc.is_encrypted:
                    if not pdf_doc.authenticate(""):
                        pdf_doc.close()
                        raise RuntimeError(
                            "This PDF is password-protected and cannot be read."
                        )

                if len(pdf_doc) == 0:
                    pdf_doc.close()
                    raise RuntimeError("This PDF has no pages.")

                page_count = len(pdf_doc)
                pages_to_read = min(page_count, max_pages)
                if page_count > max_pages:
                    logger.info(
                        "PDF has %d pages; only reading the first %d.",
                        page_count, max_pages
                    )

                page_texts = []
                used_native = False
                used_vision = False

                for page_index in range(pages_to_read):
                    page = pdf_doc[page_index]
                    native_text = page.get_text().strip()

                    if len(native_text) >= 40:
                        # Real digital text layer -- use it directly, no API call.
                        page_texts.append(native_text)
                        used_native = True
                    else:
                        # Likely a scanned/image-only page -- OCR just this page.
                        used_vision = True
                        pix = page.get_pixmap(dpi=150)
                        img_bytes = pix.tobytes("png")
                        b64_str = base64.b64encode(img_bytes).decode("utf-8")
                        data_url = f"data:image/png;base64,{b64_str}"
                        page_texts.append(self._vision_transcribe_image(data_url))

                pdf_doc.close()

                method = "mixed" if (used_native and used_vision) else ("vision" if used_vision else "native")
                full_text = "\n\n".join(
                    f"--- Page {i + 1} ---\n{t}" for i, t in enumerate(page_texts)
                )

                return {
                    "text": full_text,
                    "page_count": page_count,
                    "pages_read": pages_to_read,
                    "method": method,
                }

            else:
                # Plain image -- Vision OCR is the only option.
                b64_file = base64.b64encode(file_bytes).decode("utf-8")
                data_url = f"data:{mime_type};base64,{b64_file}"
                text = self._vision_transcribe_image(data_url)
                return {"text": text, "page_count": 1, "pages_read": 1, "method": "vision"}

        except Exception as e:
            logger.exception("Error extracting general document text")
            raise RuntimeError(f"Document text extraction failed: {str(e)}")

    @traceable(name="LLM.ask_about_document", run_type="llm")
    def ask_about_document(self, document_text: str, question: str, max_chars: int = 40000) -> str:
        """One-shot Q&A over already-extracted document text. Does NOT
        touch self.history, so it never pollutes normal chat memory --
        use this (or inject the text into a chat turn) for 'what does
        this document say about X' style questions."""
        trimmed = document_text[:max_chars]
        messages = [
            {
                "role": "system",
                "content": (
                    "Answer the user's question using ONLY the document "
                    "content below. If the answer isn't in the document, "
                    "say so plainly -- never invent information.\n\n"
                    "--- DOCUMENT CONTENT ---\n" + trimmed
                ),
            },
            {"role": "user", "content": question},
        ]
        data = {"model": self.model_name, "messages": messages, "temperature": 0.0}
        response = requests.post(self.base_url, json=data, headers=self.headers)
        response.raise_for_status()
        res_json = response.json()
        message = res_json["choices"][0]["message"]
        content = message.get("content")
        if content is None:
            refusal = message.get("refusal")
            return f"Could not answer: {refusal or 'no content returned from model'}"
        return content.strip()


def run_cli():
    print("LLM CLI - OpenAI. Type 'exit' or 'quit' to stop, 'reset' to clear history.\n")
    llm = LLM()

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting.")
            break

        if not user_input:
            continue
        if user_input.lower() in ("exit", "quit"):
            print("Exiting.")
            break
        if user_input.lower() == "reset":
            llm.reset()
            print("(history cleared)\n")
            continue

        try:
            reply = llm.chat(user_input)
            print(f"AI: {reply}\n")
        except Exception as e:
            print(f"[Error contacting OpenAI: {e}]\n")


if __name__ == "__main__":
    run_cli()
