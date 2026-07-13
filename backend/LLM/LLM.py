"""
LLM.py

A reusable LLM wrapper class around OpenRouter's chat completions API.
Can be imported and used in other projects, or run directly as a CLI chat.

Requirements:
    pip install requests python-dotenv

.env file should contain:
    OPENROUTER_API_KEY=your_key_here
"""

import os
import requests
from dotenv import load_dotenv

load_dotenv()

DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful, concise, and knowledgeable AI assistant. "
    "Answer clearly and accurately. If you are unsure of something, say so "
    "instead of making up an answer."
)


class LLM:

    def __init__(self, api_key: str = None, model: str = "nvidia/nemotron-3-ultra-550b-a55b:free", system_prompt: str = DEFAULT_SYSTEM_PROMPT, temperature: float = 0.7, base_url: str = "https://openrouter.ai/api/v1/chat/completions",):
        self.api_key = api_key or os.environ.get("OPENROUTER_API_KEY")
        if not self.api_key:
            raise ValueError("No API key provided. Set OPENROUTER_API_KEY in your .env file or pass api_key directly.")

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
    print("LLM CLI - OpenRouter. Type 'exit' or 'quit' to stop, 'reset' to clear history.\n")
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
            print(f"[Error contacting OpenRouter: {e}]\n")


if __name__ == "__main__":
    run_cli()