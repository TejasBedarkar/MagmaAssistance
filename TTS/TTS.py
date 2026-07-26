import os
import tempfile
from elevenlabs.client import ElevenLabs
from elevenlabs import save

DEFAULT_VOICE = "Rachel"


class ELTTS:
    def __init__(
        self,
        voice=DEFAULT_VOICE,
        model="eleven_multilingual_v2"
    ):
        api_key = os.getenv("ELEVENLABS_API_KEY")

        if not api_key:
            raise RuntimeError("ELEVENLABS_API_KEY not found.")

        self.client = ElevenLabs(api_key=api_key)
        self.voice = voice
        self.model = model

    def synthesize_to_file(self, text: str, output_path=None):

        if output_path is None:
            fd, output_path = tempfile.mkstemp(suffix=".mp3")
            os.close(fd)

        audio = self.client.text_to_speech.convert(
            voice_id=self.voice,
            model_id=self.model,
            text=text
        )

        save(audio, output_path)

        return output_path

    def play_file(self, audio_path):
        from playsound import playsound
        playsound(audio_path)

    def speak(self, text):
        if not text.strip():
            return text

        path = self.synthesize_to_file(text)

        try:
            self.play_file(path)
        finally:
            if os.path.exists(path):
                os.remove(path)

        return text