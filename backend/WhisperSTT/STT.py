"""
WhisperSTT/STT.py

A reusable speech-to-text wrapper class around OpenAI's Whisper model.
Can transcribe an existing audio file, or record from the microphone and transcribe.

Requirements:
    pip install openai-whisper sounddevice numpy

Note: openai-whisper also requires ffmpeg to be installed on your system.
"""

import os
import tempfile
import wave

import numpy as np
import sounddevice as sd
import whisper

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_WHISPER_DIR = os.path.join(_THIS_DIR, "model")


class Whisper:
    def __init__(self, model_size: str = "base", sample_rate: int = 16000, download_dir: str = DEFAULT_WHISPER_DIR,):
        self.model_size = model_size
        self.sample_rate = sample_rate
        self.download_dir = os.path.abspath(download_dir)

        checkpoint_path = os.path.join(self.download_dir, f"{self.model_size}.pt")
        if not os.path.isfile(checkpoint_path):
            raise FileNotFoundError(
                f"Whisper checkpoint not found at: {checkpoint_path}\n"
                f"Run ModelDownload.py first, or pass download_dir= pointing "
                f"at the folder that actually contains '{self.model_size}.pt'."
            )

        self.model = whisper.load_model(self.model_size, download_root=self.download_dir)

    def transcribe_file(self, audio_path: str) -> str:
        result = self.model.transcribe(audio_path,language="en")
        return result["text"].strip()#type:ignore

    def record_audio(self, duration: int = 5) -> str:
        print(f"[Whisper] Recording for {duration} seconds...")
        recording = sd.rec(
            int(duration * self.sample_rate),
            samplerate=self.sample_rate,
            channels=1,
            dtype="int16",
        )
        sd.wait()

        tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        with wave.open(tmp_file.name, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)  # int16 = 2 bytes
            wf.setframerate(self.sample_rate)
            wf.writeframes(recording.tobytes())

        return tmp_file.name

    def listen(self, duration: int = 5) -> str:
        audio_path = self.record_audio(duration=duration)
        return self.transcribe_file(audio_path)


if __name__ == "__main__":
    stt = Whisper(model_size="base")
    text = stt.listen(duration=5)
    print(f"Transcribed text: {text}")