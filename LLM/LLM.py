"""
LLM.py

A reusable LLM wrapper class around OpenAI's chat completions API.
Can be imported and used in other projects, or run directly as a CLI chat.

Requirements:
    pip install requests python-dotenv

.env file should contain:
    OPENAI_API_KEY=your_key_here
"""

import os
import requests
from dotenv import load_dotenv

load_dotenv()


# Tuned for a professional ERP assistant: direct, factual, and short.
# Kept as guidance for the model — the actual hard cap on reply length is
# `num_predict` on the ChatOllama instance below, since small local models
# don't always respect prompt-only length instructions.
DEFAULT_SYSTEM_PROMPT = (
    "You are Magna, a professional AI assistant for a manufacturing ERP system. "
    "You help the team look up and manage sales, customer, lead, opportunity, "
    "quotation, and order data, as well as manufacturing data — work orders, "
    "production plans, job cards, and stock movements.\n\n"
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
    "- Item Creation Workflow:\n"
    "  1. When creating an item, you MUST ask the user for the essentials: Item Code, Item Group, and Default Unit of Measure (UOM) if they are not already provided in the query.\n"
    "  2. ONLY after the item has been successfully created (the tool successfully returns the created item details), you MUST proactively ask the user the following two optional questions:\n"
    "     - 'Would you like to Maintain Stock? (ERPNext will make a stock ledger entry for each transaction of this item. Keep unchecked for non-stock or service items.)'\n"
    "     - 'Is it a Fixed Asset? (Enable if this item is a company asset like machinery or furniture.)'\n"
    "  3. If the user answers 'yes' to 'Is it a Fixed Asset', ask them for the 'Asset Category' next.\n"
    "  4. After receiving their answers, call the update_item tool to apply these optional configurations to the newly created item.\n"
    "- When the user asks for a manufacturing report, briefly ask which filters "
    "(if any) they'd like to apply, listing the report's optional filters and "
    "their defaults from the tool description. If they don't specify a filter, "
    "proceed with its default rather than asking again — only ask again for "
    "fields marked required that are still missing.\n"
    "- After a report tool returns its whole data table, don't just paste the table — add "
    "1-3 sentences in plain, simple words explaining what it shows (using the "
    "table's **Summary** line: row counts, totals, status breakdowns) so a "
    "non-technical user understands it at a glance.\n"
    "- Keep a professional, courteous tone at all times."
)

class LLM:

    def __init__(self, api_key: str = None, model: str = "gpt-4o-mini", system_prompt: str = DEFAULT_SYSTEM_PROMPT, temperature: float = 0.7, base_url: str = "https://api.openai.com/v1/chat/completions",):
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