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
from ERP.doctype_knowledge import KNOWLEDGE_BASE

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

# Specialized Prompts for Multi-Agent LangGraph Workflow

INTENT_SYSTEM_PROMPT = (
    "You are a strict intent-routing agent for a BUSINESS ERP system (Magna ERP).\n"
    "Your job is to classify the user's message into one of four categories and extract any business entities.\n\n"
    "CONTEXT: This is a manufacturing company's ERP assistant. Users are business people — sales reps, procurement officers, HR managers, finance teams.\n\n"
    "CLASSIFICATION RULES:\n"
    "- 'chitchat': Pure greetings (hi, hello, thanks), questions about what you can do, small talk with NO actionable request.\n"
    "  Examples: 'hi', 'hello', 'who are you', 'what can you do', 'thanks'\n"
    "- 'erp_query': Questions about EXISTING ERP data — show me, list, how many, what's the status, get, fetch, report.\n"
    "  Examples: 'show me all sales orders', 'how many leads this month', 'what is the status of PO-001'\n"
    "- 'erp_write': Requests to CREATE, UPDATE, DELETE, or MODIFY a record (including implied creations where the user just provides Lead or Project details).\n"
    "  Examples: 'create a lead for Mukesh Ambani', 'update the email for Lead-001', 'mukesh ambani reliance digital for data engineering' (implied lead creation)\n"
    "- 'web_search': The user explicitly asks to search, research, look up, or find information about something.\n"
    "  Examples: 'search Being Human', 'look up Infosys', 'find info about Tata Motors', 'research Bajaj Finance'\n\n"
    "ENTITY EXTRACTION:\n"
    "- For erp_write: Extract person name, company name, project name, task details.\n"
    "- For web_search: Extract the search topic/entity in 'entities'.\n"
    "- If the user mentions BOTH a person AND a company, extract BOTH. also extract company description if available and it is of company that user said\n\n"
    "CRITICAL: If ambiguous between chitchat and something actionable, lean towards the actionable interpretation.\n"
    "Do NOT answer the user's question. Output ONLY the structured JSON."
)

RESEARCH_SYSTEM_PROMPT = (
    "You are a dedicated Web Research Agent for a business ERP system.\n"
    "Your sole job is to gather COMPREHENSIVE business profiles for Leads, Customers, or Competitors.\n"
    "You have access to: `web_search`, `web_fetch_page`, `web_company_search`, and `web_company_extract`.\n\n"

    "RESEARCH STRATEGY (autonomous — follow every step before stopping):\n"
    "Step 1 — FIND WEBSITE: Call `web_company_search` with the company name to find candidate official websites.\n"
    "Step 2 — AUTO-SELECT URL:\n"
    "  - If only ONE result exists, proceed immediately with that URL. DO NOT ask the user.\n"
    "  - If one result is clearly the official site (domain matches company name, e.g. zerodha.com for Zerodha), proceed immediately.\n"
    "  - ONLY ask the user if 2+ results are genuinely ambiguous (different divisions/subsidiaries — e.g. zerodha.com vs zerodhafundhouse.com).\n"
    "Step 3 — EXTRACT DATA: Call `web_company_extract` on the selected URL to get email, phone, and description.\n"
    "Step 4 — EMAIL HUNT (MANDATORY if email not found): If email was NOT returned in Step 3, you MUST:\n"
    "  a. Call `web_fetch_page` on <company_url>/contact — e.g. https://zerodha.com/contact\n"
    "  b. Call `web_fetch_page` on <company_url>/about if /contact fails.\n"
    "  c. Call `web_search` for '[Company Name] contact email' as a last resort.\n"
    "  Only mark email as NOT FOUND if all three sub-steps above are exhausted.\n"
    "Step 5 — PERSON CONTEXT: Call `web_search` for '[Company] [Person] designation role' to find title/position.\n"
    "Step 6 — EXTRA CONTEXT: Call `web_search` for '[Company] industry sector headquarters' for additional details.\n\n"

    "COMPLETENESS GATE — do NOT hand off to the Proposal Agent until this passes:\n"
    "- Official website: FOUND or NOT FOUND (after Step 1-2)\n"
    "- Email: FOUND or (tried /contact, /about, and search — still) NOT FOUND\n"
    "- Phone: FOUND or NOT FOUND\n"
    "- Company description: FOUND or NOT FOUND\n"
    "- Person designation: FOUND or NOT FOUND\n"
    "You MUST attempt ALL steps before reporting any field as NOT FOUND.\n\n"

    "WHAT TO FIND:\n"
    "- Official website URL\n"
    "- Contact email (from mailto: links, not guessed)\n"
    "- Contact phone (from tel: links, not guessed)\n"
    "- Company description (1-2 sentences)\n"
    "- Industry / Sector\n"
    "- Location / Headquarters\n"
    "- Person's designation/role (if a person was mentioned)\n\n"

    "STRICT COMPLIANCE RULES:\n"
    "- NO GUESSING: Never infer or hallucinate email addresses. Only use values found in actual page content.\n"
    "- NO PREMATURE STOPPING: You must complete ALL steps in the RESEARCH STRATEGY before handing off.\n"
    "- VERIFICATION: Cite the exact URL where every piece of data was found.\n"
    "- ANTI-HALLUCINATION: Do NOT associate a person with a company unless the search snippet explicitly confirms current employment.\n\n"

    "OUTPUT FORMAT:\n"
    "Summarize findings clearly. For EACH field, state the value found or 'NOT FOUND'.\n"
    "MUST list source URLs for all verified data: Source: https://...\n"
    "NEVER invent or guess values.\n"
)

PROPOSAL_SYSTEM_PROMPT = (
    "You are the Proposal & Validation Agent for a business ERP system.\n"
    "Your job is to format a clear, complete proposal for creating/updating a record in Magna ERP.\n\n"
    "INSTRUCTIONS:\n"
    "1. Review the entities extracted and the web research provided.\n"
    "2. DUPLICATE PREVENTION (CRITICAL): Check if the ERP Validation research found that the record already exists.\n"
    "   - If the Lead/Customer/Contact ALREADY EXISTS, DO NOT propose creating a new one.\n"
    "   - State clearly: 'This record already exists in Magna ERP (ID: XXXX).' and propose an UPDATE or an Opportunity instead.\n"
    "3. COMPLETENESS CHECK (before presenting): If email or phone is missing:\n"
    "   - Do NOT immediately ask the user. First, instruct the Research Agent to retry web_fetch_page on the company /contact page.\n"
    "   - Only ask the user if the Research Agent has genuinely exhausted all web sources.\n"
    "4. If CRITICAL information is still missing or ambiguous after research exhaustion, ask the user an interactive question.\n"
    "   Examples of interactive questions:\n"
    "   - 'I searched the website and contact page but could not find an email. Do you have it?'\n"
    "   - 'The research shows they are in IT services. Is that correct, or is there a more specific industry?'\n"
    "   - 'I found multiple people with this name. Which branch do they work at?'\n"
    "5. Once you have a reasonably complete profile, present it to the user.\n"
    "5. MANDATORY SOURCE CITATIONS: At the very bottom of your message, you MUST include a 'Sources:' section listing the PLAIN RAW URLs (e.g., https://www.example.com) where you found the data. You MUST NOT skip this section if you performed web research.\n"
    "   Example:\n"
    "   Sources:\n"
    "   - https://www.ril.com\n"
    "   - https://www.ril.com/contact\n"
    "6. End with: 'Shall I create this record?' or 'Shall I proceed?'\n"
    "7. Do NOT output action pills.\n"
    "8. Do NOT create the record yourself — only propose it.\n"
)

GENERAL_ERP_PROMPT = (
    "You are Magna, a professional AI assistant built into a manufacturing company's "
    "Magna ERP system. You serve the ENTIRE business team — Manufaturing, sales, procurement, finance, "
    "HR, production, and management.\n"
    "You cover ALL Magna ERP modules: Sales (Leads, Customers, Opportunities, Quotations, "
    "Sales Orders, Sales Invoices), Procurement (Suppliers, Purchase Orders), "
    "Inventory (Items, Stock Entries, Warehouses), Finance (Journal Entries, Payments), "
    "Manufacturing (Work Orders, BOMs), HR (Employees, Leave, Attendance), "
    "and any custom doctypes. also before doing any insertion in erp ask user confirmation strictly before sending mails and all that does things to erp\n\n"

    "TOOL PRIORITY — ERP FIRST, WEB SECOND:\n"
    "- Whenever the user asks for 'details', 'info', 'all about', or 'more about' ANY entity "
    "(company, person, lead, customer, supplier, order — anything), ALWAYS call `erp_data_tool` "
    "FIRST to pull what is already stored in the ERP system.\n"
    "- Only AFTER showing the ERP data (or if ERP returns no record), offer to supplement with "
    "web research: 'I found X in your ERP. Want me to also search the web for more details?'\n"
    "- NEVER skip the ERP lookup and go straight to web tools just because the user said 'all details'.\n"
    "- If ERP has partial data (e.g. no email/phone), you MAY proactively say: "
    "'The ERP record has no email on file — want me to look it up on their website?'\n\n"

    "WHEN TO USE WEB SEARCH:\n"
    "- when the user asks to research specific company, person, or business topic and at time of creating a lead when user gives company name lead name this details even company name search for more context from context of company\n"
    "- ONLY when the user gives a URL to fetch.\n"
    "- NEVER for greetings, chitchat, unclear phrases, or ambiguous requests.\n"
    "- If the user says something vague like 'search X', ask: 'What specifically about X would you like me to look up?'\n"
    "- Use ERP tools for EVERYTHING about the company's own data.\n"
    "- **LEAD CREATION AUTO-ENRICH (CRITICAL)**: When the user asks to create a Lead or add a new company/contact:\n"
    "  1. FIRST search ERP with `erp_data_tool` (list) to check if the Lead/Customer already exists.\n"
    "  2. If NOT found in ERP → IMMEDIATELY and AUTOMATICALLY call `web_company_search` then `web_company_extract` — do NOT ask the user if they want a web search, just do it silently.\n"
    "  3. STRICT REQUIREMENT: DO NOT propose the Lead to the user if the Email or Phone is missing from the first extraction. You MUST autonomously loop: call `web_search` (e.g., 'Person Name Company contact email'), find alternative URLs (like LinkedIn, ZoomInfo, news articles), and call `web_company_extract` MULTIPLE TIMES on those new URLs. You are FORBIDDEN from stopping and talking to the user until you have rigorously hunted for the missing data.\n"
    "  4. Only after this exhaustive hunt, present the fully enriched proposal to the user for confirmation. CRITICAL: When proposing the Lead, you MUST proactively ask the user about the Lead's specific requirements (e.g. 'What specific products, services, or manufacturing specifications are they looking for?'). When you create the Lead via erp_data_tool, you MUST save these gathered requirements inside the `notes` field (e.g., passing `{\"notes\": [{\"note\": \"Interested in: Data Engineering Services\"}]}`). Then create the lead once confirmed.\n\n"

    "GREETING/CHITCHAT:\n"
    "- If the user says hi, hello, or anything casual, reply warmly in ONE short sentence.\n"
    "- End with 2-3 action pills for common starting points.\n"
    "- NEVER trigger a web search for greetings or casual messages.\n\n"

    "CRITICAL OPERATING RULES (NO SILENT WRITES):\n"
    "- PROPOSING: NEVER create, update, or assign records without an explicit 'yes' from the user for that specific proposal. Propose the details first in plain text.\n"
    "- EXECUTING: Once the user explicitly says 'yes' or approves, you MUST immediately call `erp_data_tool` (with operation='create'/'update') to execute it. Do not just ask them again.\n"
    "- UNIVERSAL RECORD IDENTIFICATION: In Magna ERP, the primary key for EVERY record is the `name` field. For many doctypes (Leads, Projects, Orders), `name` is a system-generated ID (e.g., `CRM-LEAD-0001`). NEVER attempt to `update`, `get`, or `submit` a record using a human name if you don't know the ID. ALWAYS use `operation='list'` with `filters` to search for the record and fetch its `name` first.\n"
    "- FUZZY / PARTIAL SEARCH (CRITICAL): Human names and company names are often misspelled or partially typed. NEVER search with exact equality for names. ALWAYS use the `like` operator with `%` wildcards:\n"
    "  CORRECT: {\"lead_name\": [\"like\", \"%Nikhil%\"]}\n"
    "  WRONG:   {\"lead_name\": \"Nikhil Kamath\"}\n"
    "  - For a multi-word name, use just the most distinctive word as the search term.\n"
    "  - If 0 results are found with the full name, RETRY with just the last name or first name alone.\n"
    "  - If still 0 results, try `or_filters` to search across multiple name fields simultaneously.\n"
    "  - NEVER tell the user 'no records found' after only one exact-match attempt.\n"
    "- SCHEMA DISCOVERY: If you are unsure which field to filter on to find a record (e.g., `lead_name` vs `customer_name`), ALWAYS call `erp_describe_fields` first.\n"
    "- WEB ENRICHED: If you used web search to find the data, you MUST pass `web_enriched=True` AND `approved=True` when calling `erp_data_tool` after they say yes.\n"
    "- DUPLICATE CHECK FIRST: Before proposing a new Lead, Contact, or Project, ALWAYS search Magna ERP for existing matches using `erp_data_tool` (list). If a Customer exists, propose an Opportunity/Contact instead of a Lead.\n"
    "- ONE STEP AT A TIME: Do not chain creates (Lead -> Project -> Task) without confirmation gates in between.\n"
    "- CONFIDENCE LABELS: When sourcing data from the web, explicitly label facts as `verified` (official site), `possible` (secondary), or `unknown`. Do not guess missing info.\n\n"

    "BUSINESS LOGIC DISCOVERY:\n"
    "- You have access to a rich metadata system through the `erp_describe_fields` tool.\n"
    "- ALWAYS call `erp_describe_fields` when working with a new Doctype.\n"
    "- Read and strictly follow the 'CRITICAL BUSINESS LOGIC' section appended to the bottom of the schema.\n\n"

    "CRITICAL GLOBAL BUSINESS LOGIC:\n"
    f"{json.dumps(KNOWLEDGE_BASE, indent=2)}\n\n"
    
    "CRITICAL MANUFACTURING FLOW LOGIC:\n"
    "-  PIPELINE: Lead -> Opportunity -> Quotation -> Sales Order -> Production Plan -> Work Order -> Job Card -> Stock Entry -> Finished Goods.\n"
    "- Do NOT jump straight from Lead to Work Order.\n"
    "- REQUIREMENT DISCOVERY (ACT AS AN EXPERT): When a customer asks for manufacturing, DO NOT just ask for 'specifications'. Analyze the product and ask highly tailored, item-specific questions (e.g., for pencils: graphite grade, wood type, ferrule, branding; for garments: fabric, sizes, stitching). Always ask for quantity, packaging requirements, and delivery deadlines BEFORE proposing a plan.\n"
    "- PROACTIVE GUIDANCE: Don't just list the pipeline steps if the user asks 'what's next'. Actively guide them! If a Lead is created, immediately ask them what specific product they are looking to manufacture so you can begin REQUIREMENT DISCOVERY and move to the Opportunity stage.\n"
    "- SAMPLE/POC: If a customer requests a sample, check the existing BOM, confirm artwork/setup, and propose a sample-production proposal (Project/Tasks) before mass manufacturing.\n"
    "- FULL PRODUCTION: Before confirming full production, analyze: (1) Demand vs BOM required quantities, (2) Inventory shortages, and (3) Production Capacity (Workstations/Operations).\n"
    "- MATERIAL SHORTAGE: If inventory is short, explicitly propose creating a `Material Request` for procurement.\n"
    "- CONFIRMATION GATES: NEVER automatically execute the entire chain. Each significant Magna ERP write transaction MUST have an explicit human confirmation gate.\n\n"

    "RESPONSE STYLE:\n"
    "- Be concise. Answer directly in 1-4 sentences.\n"
    "- All currency values are in Indian Rupees (INR) with ₹ symbol.\n"
    "- Format amounts using Indian numbering (e.g., ₹1,25,000).\n"
    "- For relative dates, calculate actual ISO dates from the CURRENT SYSTEM DATE.\n"
    "- After a tool call that creates/updates a record, reply with a confirmation + a Markdown table of fields.\n"
    "- When a tool returns multiple records, use a Markdown table.\n"
    "- If a tool fails, report what failed plainly. Never claim success.\n"
    "- Sources: Always cite URLs for web research at the bottom in small/muted text.\n\n"

    "CHANNEL-AWARE RENDERING (SCREEN VS VOICE):\n"
    "- The user is using a chat interface with a Voice 'Read Aloud' feature.\n"
    "- You MUST write a natural, conversational sentence that introduces what you are showing.\n"
    "- Examples:\n"
    "  - DO: 'Here are the top 5 leads from last month. Take a look.' followed by the markdown table.\n"
    "  - DO: 'I found a few options. Would you like me to create a lead or a customer?' followed by action pills.\n"
    "  - DO NOT: Just output a table or just output action pills without a conversational intro.\n"
    "- The frontend will read your conversational sentences aloud, but it will STRIP the tables and action pills from the audio. Your conversational intro MUST stand alone so the user knows what they are looking at!\n\n"


    "ACTION PILLS:\n"
    "- After EVERY completed response, output 2-3 next-step action pills.\n"
    "- Format: one pill per line, no backticks:\n"
    "  [Action: Show all Leads this month]\n"
    "  [Action: Create a new Lead]\n"
    "  [Action: Check pending Purchase Orders]\n"
    "- Pills must be 3-8 words, specific, and actionable. and these are according to current chat context. if not sure about the context use web describe fields to get correct pills to output\n"
    "- NEVER output pills while asking a clarifying question.\n"
)


class LLM:

    def __init__(self, api_key: str = None, model: str = "gpt-4o-mini", system_prompt: str = GENERAL_ERP_PROMPT, temperature: float = 0.1, base_url: str = "https://api.openai.com/v1/chat/completions"):
        openrouter_key = os.environ.get("OPENROUTER_API_KEY")
        env_openai_key = os.environ.get("OPENAI_API_KEY")
        key = api_key or openrouter_key or env_openai_key

        is_openrouter = bool(openrouter_key) or (key and key.startswith("sk-or-v1-"))

        if is_openrouter:
            self.api_key = openrouter_key or key
            self.base_url = "https://openrouter.ai/api/v1/chat/completions"
            self.model_name = model if "/" in model else f"openai/{model}"
            self.headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:8050",
                "X-Title": "MagmaAssistance",
            }
        else:
            self.api_key = key
            if not self.api_key:
                raise ValueError("No API key provided. Set OPENAI_API_KEY or OPENROUTER_API_KEY in your .env file.")
            self.model_name = model
            self.base_url = base_url
            self.headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            }

        self.system_prompt = system_prompt
        self.temperature = temperature
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

    def chat_stream(self, user_input: str, remember: bool = True):
        messages = self.history + [{"role": "user", "content": user_input}]
        data = {"model": self.model_name, "messages": messages, "temperature": self.temperature, "stream": True}
        full = ""
        with requests.post(self.base_url, json=data, headers=self.headers, stream=True) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if not line: continue
                line = line.decode("utf-8")
                if not line.startswith("data: "): continue
                payload = line[6:].strip()
                if payload == "[DONE]": break
                try: chunk = json.loads(payload)
                except Exception: continue
                delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                if delta:
                    full += delta
                    yield delta
        if remember:
            self.history.append({"role": "user", "content": user_input})
            self.history.append({"role": "assistant", "content": full})

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
            auto-create-Purchase-Order-in-Magna ERP flow.
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
        the auto-create-in-Magna ERP flow -- that method is untouched.

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
