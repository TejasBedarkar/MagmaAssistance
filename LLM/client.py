import os
import json
import requests
import logging
from dotenv import load_dotenv

from LLM.prompts import GENERAL_ERP_PROMPT
from LLM.vision import VisionMixin, traceable

load_dotenv()

logger = logging.getLogger("llm-client")


class LLM(VisionMixin):
    def __init__(
        self,
        api_key: str = None,
        model: str = "gpt-4o-mini",
        system_prompt: str = GENERAL_ERP_PROMPT,
        temperature: float = 0.1,
        base_url: str = "https://api.openai.com/v1/chat/completions",
    ):
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
                if not line:
                    continue
                line = line.decode("utf-8")
                if not line.startswith("data: "):
                    continue
                payload = line[6:].strip()
                if payload == "[DONE]":
                    break
                try:
                    chunk = json.loads(payload)
                except Exception:
                    continue
                delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                if delta:
                    full += delta
                    yield delta
        if remember:
            self.history.append({"role": "user", "content": user_input})
            self.history.append({"role": "assistant", "content": full})

    def reset(self):
        self.history = [{"role": "system", "content": self.system_prompt}]
