"""
Main.py

Full voice assistant pipeline:
    Microphone audio -> Whisper (STT) -> LangChain prompt -> ChatOllama (LLM) -> Kokoro (TTS) -> speakers

Requirements:
    pip install langchain-ollama langchain-core openai-whisper sounddevice numpy
    pip install torch tqdm soundfile
    pip install kokoro

Make sure Ollama is running and the model is pulled:
    ollama pull llama3.2
"""

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnableLambda

from WhisperSTT.STT import Whisper
from LLM.LLM import LLM, DEFAULT_SYSTEM_PROMPT
from KokoroTTS.TTS import KokoroTTS


class VoiceAssistant:
    def __init__(self, whisper_model: str = "base", llm_model: str = "llama3.2", system_prompt: str = DEFAULT_SYSTEM_PROMPT, record_duration: int = 5, tts_voice: str = "af_heart", speak_replies: bool = True,):
        self.record_duration = record_duration
        self.speak_replies = speak_replies

        self.whisper = Whisper(model_size=whisper_model)
        self.llm = LLM(model=llm_model, system_prompt=system_prompt)
        self._tts_voice = tts_voice
        self._tts = None

        self.prompt = ChatPromptTemplate.from_messages(
            [
                ("system", self.llm.system_prompt),
                ("human", "{input}"),
            ]
        )

        # LLM output feeds straight into TTS.speak(), which plays audio and
        # passes the text through unchanged so the chain's return value is
        # still the reply text.
        chain = self.prompt | self.llm.model | StrOutputParser()
        if self.speak_replies:
            chain = chain | RunnableLambda(self.tts.speak)
        self.chain = chain

    @property
    def tts(self):
        if self._tts is None:
            self._tts = KokoroTTS(voice=self._tts_voice)
        return self._tts


    def process_text(self, text: str) -> str:
        return self.chain.invoke({"input": text})

    def run_once(self):
        text = self.whisper.listen(duration=self.record_duration)
        print(f"You said: {text}")

        if not text:
            print("[No speech detected, skipping]\n")
            return None

        response = self.process_text(text)
        print(f"AI: {response}\n")
        return response

    def run_loop(self):
        print("Voice assistant started. Speak after the recording prompt. Press Ctrl+C to stop.\n")
        while True:
            try:
                self.run_once()
            except KeyboardInterrupt:
                print("\nStopped.")
                break
            except Exception as e:
                print(f"[Error: {e}]\n")


if __name__ == "__main__":
    assistant = VoiceAssistant(whisper_model="base", llm_model="llama3.2", record_duration=5, tts_voice="af_heart", speak_replies=True,)
    assistant.run_loop()