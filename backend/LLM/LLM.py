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


DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful, concise, and knowledgeable AI assistant. "
    "Answer clearly and accurately. If you are unsure of something, say so "
    "instead of making up an answer."
)


class LLM:

    def __init__(self, model: str = "llama3.2", system_prompt: str = DEFAULT_SYSTEM_PROMPT, temperature: float = 0.7, base_url: str = "http://localhost:11434",):
        self.model_name = model
        self.system_prompt = system_prompt
        self.temperature = temperature
        self.model = ChatOllama(
            model=self.model_name,
            temperature=self.temperature,
            base_url=base_url,
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