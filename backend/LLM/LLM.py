"""
LLM.py

A reusable LLM wrapper class around Ollama's llama3.2 model, built with LangChain.
Can be imported and used in other LangChain projects, or run directly as a CLI chat.

Requirements:
    pip install langchain-ollama

Make sure Ollama is installed and running, and that the model is pulled:
    ollama pull llama3.2
"""

from langchain_ollama import ChatOllama
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage


# Tuned for a professional ERP assistant: direct, factual, and short.
# Kept as guidance for the model — the actual hard cap on reply length is
# `num_predict` on the ChatOllama instance below, since small local models
# don't always respect prompt-only length instructions.
DEFAULT_SYSTEM_PROMPT = (
    "You are Magma, a professional AI assistant for a manufacturing ERP system. "
    "You help the team look up and manage sales, customer, lead, opportunity, "
    "quotation, and order data.\n\n"
    "Response style:\n"
    "- Be concise. Answer directly in 1-4 sentences, or a short bullet/table for "
    "multiple items. Do not restate the question or add filler like 'Sure, I can "
    "help with that.'\n"
    "- Format numbers, currency, and dates clearly; round large figures sensibly.\n"
    "- If data is unavailable or a tool call fails, say so in one plain sentence — "
    "never invent values.\n"
    "- When creating or updating a record, only use information the user actually "
    "gave you. If something required is missing, ask for it — never guess a name, "
    "ID, phone number, email, or amount.\n"
    "- Keep a professional, courteous tone at all times."
)


class LLM:

    def __init__(
        self,
        model: str = "llama3.2",
        system_prompt: str = DEFAULT_SYSTEM_PROMPT,
        temperature: float = 0.7,
        base_url: str = "http://localhost:11434",
        num_predict: int = 350,
    ):
        """
        num_predict: caps the number of tokens Ollama generates per reply
        (roughly a few short paragraphs). This is what actually enforces
        "short answers" — the system prompt asks nicely, this backs it up.
        Pass a higher value (or None to disable the cap) if you need long
        outputs from this instance.
        """
        self.model_name = model
        self.system_prompt = system_prompt
        self.temperature = temperature

        ollama_kwargs = {}
        if num_predict is not None:
            ollama_kwargs["num_predict"] = num_predict

        self.model = ChatOllama(
            model=self.model_name,
            temperature=self.temperature,
            base_url=base_url,
            **ollama_kwargs,
        )

        self.history = [SystemMessage(content=self.system_prompt)]

    def set_system_prompt(self, system_prompt: str, reset_history: bool = True):
        self.system_prompt = system_prompt
        if reset_history:
            self.history = [SystemMessage(content=self.system_prompt)]
        else:
            self.history[0] = SystemMessage(content=self.system_prompt)

    def chat(self, user_input: str, remember: bool = True):
        messages = self.history + [HumanMessage(content=user_input)]
        response = self.model.invoke(messages)

        if remember:
            self.history.append(HumanMessage(content=user_input))#type:ignore
            self.history.append(AIMessage(content=response.content))#type:ignore

        return response.content#type:ignore

    def reset(self):
        self.history = [SystemMessage(content=self.system_prompt)]


def run_cli():
    print(f"LLM CLI - Ollama (llama3.2). Type 'exit' or 'quit' to stop, 'reset' to clear history.\n")
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
            print(f"[Error contacting Ollama: {e}]\n")


if __name__ == "__main__":
    run_cli()