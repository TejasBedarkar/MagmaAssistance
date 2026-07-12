# MagmaAssistance

**Magma Assistant** is an AI-powered voice/text assistant integrated with **ERPNext** to help users work more efficiently. It provides instant support for navigating ERPNext, answering queries, and retrieving business information — through a chat widget you can talk to or type into.

---

## Overview

MagmaAssistance is a full-stack voice assistant with two parts:

- **Frontend** — a React (Vite) chat widget with in-browser speech recognition (mic input) and word-by-word streamed replies.
- **Backend** — a FastAPI application that runs the agent pipeline: speech/text understanding via **LangChain + Ollama (LLM)**, and spoken replies via **Kokoro (TTS)**, with **Whisper** available for server-side speech-to-text.

```
Browser mic/text
       │
       ▼
 Web Speech API (STT, in-browser)
       │  text
       ▼
 React chat UI  ──POST /api/chat──▶  FastAPI server
       ▲                                 │
       │ reply text + audio (WAV)        ▼
       │                          LangChain prompt
       │                                 │
       │                                 ▼
       │                      ChatOllama (local LLM)
       │                                 │
       │                                 ▼
       └──────────────────────  Kokoro (TTS synthesis)
```

---

## Features

- Floating chat widget with suggestion chips and conversation history
- Voice input via the browser's Web Speech API
- Spoken replies synthesized with Kokoro and played back in the browser
- Word-by-word "typing" reply animation
- Optional local folder sync to save chat transcripts as JSON
- Local LLM inference via Ollama — no data leaves your machine
- One-command Windows setup/launch script

---

## Tech Stack

| Layer      | Technology |
|------------|------------|
| Frontend   | React 19, Vite, vanilla CSS |
| Backend    | FastAPI, Uvicorn |
| LLM        | LangChain + Ollama (`llama3.2`) |
| STT        | OpenAI Whisper |
| TTS        | hexgrad Kokoro (82M) |

---

## Hardware Requirements

These models run locally by default, so plan for enough disk space and (ideally) a GPU before installing:

- **Disk space**: reserve at least **3–4 GB free** for the downloaded models — Kokoro-82M is roughly **82M parameters**, and Whisper adds more on top depending on the size you pick.
- **GPU**: a CUDA-capable GPU is recommended for all three model stages (LLM via Ollama, Whisper STT, and Kokoro TTS). Inference will fall back to CPU without one, but replies — especially TTS synthesis — will be noticeably slower.
- **This is a local/offline-first setup.** Once the app is deployed on an online server (with more VRAM/compute available), the LLM, STT, and TTS models can each be swapped for larger, higher-quality versions — see the config options below.

## Prerequisites

- [Python 3.10+](https://www.python.org/downloads/)
- [Node.js 18+](https://nodejs.org/) and npm
- [Ollama](https://ollama.com/) installed and running, with a model pulled:
  ```bash
  ollama pull llama3.2
  ```
- **espeak-ng** installed on your system (required by Kokoro TTS's phonemizer):
  * **Windows**: `choco install espeak-ng` or download the installer from [espeak-ng releases](https://github.com/espeak-ng/espeak-ng/releases)
  * **Linux**: `sudo apt-get install espeak-ng`
  * **macOS**: `brew install espeak-ng`

---

## Quick Start (Windows)

Run `setup_and_run.bat` from the project root. It will:

1. Ask whether requirements are already installed — if yes, it skips straight to launching.
2. Create a Python virtual environment (choose the interpreter to use).
3. Install `backend/requirements.txt`.
4. Install `espeak-ng` automatically if it is not present on your path.
5. Download the Whisper and Kokoro models via `ModelDownload.py` into `backend/WhisperSTT/model` and `backend/KokoroTTS/models`.
6. Run `npm install` for the frontend.
7. Launch the backend (`python server.py`) and frontend (`npm run dev`) together in separate windows.

---

## Manual Setup

### 1. Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate

pip install -r requirements.txt
python ModelDownload.py --whisper-dir backend\WhisperSTT\model --kokoro-dir backend\KokoroTTS\models\kokoro-82m --tool-rag-dir backend\ERP\models\all-MiniLM-L6-v2

python server.py
```

The API serves on `http://localhost:8001`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

The app serves on `http://localhost:5174`.

---

## Configuration

| Location | Variable | Default | Description |
|---|---|---|---|
| `frontend/.env` | `VITE_API_URL` | `http://localhost:8001` | Backend API base URL |
| `backend` (env var) | `FRONTEND_ORIGIN` | `http://localhost:5173` | Allowed CORS origin(s) |
| `backend` (env var) | `WHISPER_MODEL` | `base` | Whisper model size |
| `backend` (env var) | `LLM_MODEL` | `llama3.2` | Ollama model name |
| `backend` (env var) | `TTS_VOICE` | `af_heart` | Kokoro voice pack preset |

---

## API Reference

### `GET /api/health`
Returns `{ "status": "ok" }` — used to check the backend is up.

### `POST /api/chat`
**Request**
```json
{ "message": "What are the pending purchase orders?" }
```

**Response**
```json
{
  "reply": "You have 4 pending purchase orders...",
  "audio": "<base64-encoded WAV, or null>"
}
```

---

## ERPNext / Frappe Integration

This project is fully integrated with **ERPNext** on port `8000`. The connection logic handles REST authentication using API Access Keys generated per user.

### Configuration (`backend/.env`)
Create a `.env` file inside the `backend/` directory with the following variables to authorize requests to Frappe:
```env
ERP_URL=http://mysite.local:8000
ERP_API_KEY=83d4d375d449844
ERP_API_SECRET=aecf1c8658dde7e
LLM_MODEL=llama3.2
```

### Connection and Data Reading Flow
1. **REST Client (`backend/ERP/erp_client.py`):** Authorizes session requests using token-based request headers:
   ```python
   self.session.headers.update({"Authorization": f"token {api_key}:{api_secret}"})
   ```
   All list and document queries are performed dynamically through Frappe’s `/api/resource/` REST route.
2. **Business Tools (`backend/ERP/tools/sales_tools.py`):** Includes 15 tools matching natural-language business requests (e.g., `get_sales_summary()`, `get_top_customers()`, `get_top_selling_items()`) that call the `erp_client` methods.
3. **Memory Optimization:** Modified `backend/Main.py` to initialize `KokoroTTS` lazily on demand. This reduces startup RAM requirements significantly, enabling direct execution on standard CPU hardware.
