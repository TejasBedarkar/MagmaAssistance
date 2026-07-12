"""
KokoroTTS/TTS.py

Minimal in-process TTS wrapper around hexgrad/Kokoro-82M — a lightweight
(~82M parameter) TTS model well suited to real-time inference, replacing
the previous VibeVoice backend.

Setup:
    pip install kokoro soundfile sounddevice numpy
    # Kokoro's phonemizer needs the espeak-ng system binary:
    #   Windows: choco install espeak-ng   (or download the installer from
    #            https://github.com/espeak-ng/espeak-ng/releases)
    #   Linux:   sudo apt-get install espeak-ng
    #   macOS:   brew install espeak-ng

Expects:
    KokoroTTS/
        TTS.py
        models/kokoro-82m/   <- weights + voice packs from ModelDownload.py
"""

import os

import numpy as np
import soundfile as sf
import sounddevice as sd
import torch

from kokoro import KModel, KPipeline

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL_PATH = os.path.join(_THIS_DIR, "models", "kokoro-82m")

# Kokoro voice names look like "af_heart", "am_michael", "bf_emma", etc.
# The first letter is language (a=English-US, b=English-UK, ...) and the
# second is gender (f/m). lang_code must match the voice's language prefix.
DEFAULT_VOICE = "af_heart"
DEFAULT_LANG_CODE = "a"
SAMPLE_RATE = 24000
REPO_ID = "hexgrad/Kokoro-82M"


class KokoroTTS:
    def __init__(
        self,
        model_path=DEFAULT_MODEL_PATH,
        voice=DEFAULT_VOICE,
        lang_code=DEFAULT_LANG_CODE,
        speed: float = 1.0,
        device=None,
    ):
        self.voice = voice
        self.speed = speed

        # ModelDownload.py fetches the model via snapshot_download(local_dir=...),
        # which lays files out flat (config.json, kokoro-v1_0.pth, voices/*.pt) —
        # NOT the models--org--repo/snapshots/<hash>/ layout huggingface_hub's
        # cache expects. Pointing HF_HOME at that flat folder doesn't help Kokoro
        # find it, so it silently re-downloads into the real cache every run.
        # Instead, load the weights/config/voice pack directly from disk so no
        # Hub lookup happens at all when the local files are present.
        config_path = os.path.join(model_path, "config.json")
        weights_path = os.path.join(model_path, "kokoro-v1_0.pth")
        voice_path = os.path.join(model_path, "voices", f"{voice}.pt")

        if os.path.isfile(config_path) and os.path.isfile(weights_path):
            model = KModel(repo_id=REPO_ID, config=config_path, model=weights_path)
            self.pipeline = KPipeline(lang_code=lang_code, repo_id=REPO_ID, model=model, device=device)
            if os.path.isfile(voice_path):
                self.pipeline.voices[voice] = torch.load(voice_path, weights_only=True)
            # else: pipeline.load_voice(voice) will still fall back to a Hub
            # download for just the missing voice pack, later, on first use.
        else:
            # No local snapshot found — fall back to normal Hub-based loading.
            self.pipeline = KPipeline(lang_code=lang_code, device=device)

    def synthesize_to_file(self, text: str, output_path: str = "output.wav") -> str:
        audio_chunks = []
        for _, _, audio in self.pipeline(text, voice=self.voice, speed=self.speed):
            chunk = audio.detach().cpu().numpy() if hasattr(audio, "detach") else audio
            audio_chunks.append(chunk)

        full_audio = np.concatenate(audio_chunks) if len(audio_chunks) > 1 else audio_chunks[0]
        sf.write(output_path, full_audio, SAMPLE_RATE)
        return output_path

    def play_file(self, wav_path: str):
        data, samplerate = sf.read(wav_path, dtype="float32")
        sd.play(data, samplerate)
        sd.wait()

    def speak(self, text: str) -> str:
        if text and text.strip():
            self.play_file(self.synthesize_to_file(text))
        return text


if __name__ == "__main__":
    tts = KokoroTTS(voice="af_heart")
    tts.speak("Hello, this is a test of the Kokoro text to speech system.")
