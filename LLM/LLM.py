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
    "- If data is unavailable or a tool call fails, say so in one plain sentence — "
    "never invent values.\n"
    "- When creating or updating a record, only use information the user actually "
    "gave you. If something required is missing, ask for it — never guess a name, "
    "ID, phone number, email, or amount.\n"
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
    def extract_po_data_from_document(self, file_bytes: bytes, mime_type: str) -> dict:
        """
        Extracts structured Purchase Order details from Image OR PDF bytes
        using GPT-4o Multi-modal Vision API.
        Converts PDF pages into PNG images before sending to OpenAI Vision.
        """
        try:
            image_content_payloads = []

            # 1. Check if the file is PDF or regular Image
            if "pdf" in mime_type.lower():
                logger.info("PDF document detected. Converting pages to PNG images for Vision API...")
                
                # Open PDF document from bytes stream
                pdf_doc = fitz.open(stream=file_bytes, filetype="pdf")
                
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
            raw_content = res_json["choices"][0]["message"]["content"]

            parsed_data = json.loads(raw_content.strip())
            logger.info("Successfully extracted document data via OCR Vision.")
            return parsed_data

        except Exception as e:
            logger.exception("Error extracting PO data via Vision OCR")
            raise RuntimeError(f"OCR extraction failed: {str(e)}")


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