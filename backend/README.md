# Backend (Agent API)

Wraps the `VoiceAssistant` agent from `Main.py` in a small Flask API so the
React frontend can talk to it over HTTP.

## Quick start (Windows)

From the project root (the folder containing both `backend\` and
`frontend\`), just run `setup_and_run.bat`. It will ask if requirements are
already installed; if not, it creates a venv, installs
`backend\requirements.txt`, downloads the Whisper + VibeVoice models into
`backend\WhisperSTT\model` and `backend\VibeVoiceTTS\models` via
`ModelDownload.py`, `npm install`s the frontend, then opens two terminal
windows — one running the backend, one running the frontend.

## Expected folder layout

Copy your existing agent packages next to `server.py`, `Main.py`, and
`ModelDownload.py` (already included), so it looks like:

```
backend/
  server.py
  requirements.txt
  Main.py
  ModelDownload.py
  WhisperSTT/
    STT.py
    model/              <- created by ModelDownload.py
  LLM/
    LLM.py
  VibeVoiceTTS/
    TTS.py
    models/              <- created by ModelDownload.py
```

`server.py` imports `VoiceAssistant` straight from `Main.py`, so it needs those
three packages to be importable exactly like they are in Main.py's own imports.

## Setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux

pip install -r requirements.txt

# Make sure Ollama is installed & running, and the model is pulled:
ollama pull llama3.2
```

## Run

```bash
python server.py
```

Server starts on `http://localhost:8000`. First startup will be slow — it's
loading the Whisper and VibeVoice models and connecting to Ollama.

## API

- `GET /api/health` → `{ "status": "ok" }`
- `POST /api/chat` → body `{ "message": "your text" }` → `{ "reply": "..." }`

## Why no `/api/voice` endpoint?

The frontend already does speech-to-text in the browser via the Web Speech
API (`src/hooks/useSpeechRecognition.js`) — the mic button just fills the
text box, which then goes through the normal `/api/chat` flow. So the
server only needs the LLM half of `Main.py`'s pipeline per request; it
doesn't record from a mic or play TTS audio out loud on the server machine
for each web request (`speak_replies=False`).

If you'd rather have the server speak replies out loud on its own machine
(e.g. for a kiosk-style deployment), set `speak_replies=True` when
constructing `VoiceAssistant` in `server.py`.
