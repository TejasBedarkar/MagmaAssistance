"""
VibeVoiceTTS/TTS.py

Minimal in-process TTS wrapper around microsoft/VibeVoice-Realtime-0.5B.

Setup:
    pip install torch "transformers==4.51.3" diffusers accelerate tqdm numpy soundfile sounddevice
    pip install git+https://github.com/microsoft/VibeVoice.git

Expects:
    VibeVoiceTTS/
        TTS.py
        voices/                         <- en-Carter_man.pt, en-Emma_woman.pt, etc.
        models/vibevoice-realtime-0.5b/ <- weights from ModelDownload.py
"""

import copy
import glob
import os

import soundfile as sf
import sounddevice as sd
import torch

from vibevoice.modular.modeling_vibevoice_streaming_inference import (
    VibeVoiceStreamingForConditionalGenerationInference,
)
from vibevoice.processor.vibevoice_streaming_processor import VibeVoiceStreamingProcessor

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL_PATH = os.path.join(_THIS_DIR, "models")
DEFAULT_VOICES_DIR = os.path.join(_THIS_DIR, "voices")


class VibeVoiceTTS:
    def __init__(self, model_path=DEFAULT_MODEL_PATH, voices_dir=DEFAULT_VOICES_DIR, speaker_name="Emma", cfg_scale=1.5, ddpm_steps=10, device=None):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.cfg_scale = cfg_scale

        self.voices = {
            os.path.basename(p).split("-", 1)[-1].split("_", 1)[0].lower(): p
            for p in glob.glob(os.path.join(voices_dir, "*.pt"))
        }
        self.speaker_name = speaker_name.lower()
        if self.speaker_name not in self.voices:
            raise ValueError(f"Unknown speaker '{speaker_name}'. Available: {sorted(self.voices)}")

        dtype = torch.bfloat16 if self.device == "cuda" else torch.float32
        self.processor = VibeVoiceStreamingProcessor.from_pretrained(model_path)
        self.model = VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
            model_path, torch_dtype=dtype, device_map=self.device, attn_implementation="sdpa"
        )
        self.model.eval()
        self.model.set_ddpm_inference_steps(num_steps=ddpm_steps)

    def synthesize_to_file(self, text: str, output_path: str = "output.wav") -> str:
        # NOTE: weights_only=False is required here because the cached voice
        # prompt stores a transformers.modeling_outputs.BaseModelOutputWithPast
        # object, which PyTorch's restricted (weights_only=True) unpickler
        # cannot reconstruct (it only allows SETITEMS for plain dict /
        # OrderedDict / Counter, not dict subclasses like this one).
        # This is safe as long as these .pt voice files are ones you created
        # or trust the source of -- do not load arbitrary/untrusted .pt files
        # this way, since it re-enables full unpickling.
        cached_prompt = torch.load(
            self.voices[self.speaker_name],
            map_location=self.device,
            weights_only=False,
        )

        inputs = self.processor.process_input_with_cached_prompt(
            text=text, cached_prompt=cached_prompt, padding=True,
            return_tensors="pt", return_attention_mask=True,
        )
        inputs = {k: (v.to(self.device) if torch.is_tensor(v) else v) for k, v in inputs.items()}

        outputs = self.model.generate(
            **inputs, max_new_tokens=None, cfg_scale=self.cfg_scale,
            tokenizer=self.processor.tokenizer, generation_config={"do_sample": False},
            all_prefilled_outputs=copy.deepcopy(cached_prompt),
        )
        self.processor.save_audio(outputs.speech_outputs[0], output_path=output_path)
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
    tts = VibeVoiceTTS(speaker_name="Carter")
    tts.speak("Hello, this is a test of the VibeVoice text to speech system.")