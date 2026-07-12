<<<<<<< HEAD
import base64
import os
import shutil
import logging
import json
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
=======
"""
server.py

Backend bridge between the React (Vite) frontend and the VoiceAssistant
agent defined in Main.py:

    Frontend (fetch) -> Flask /api/chat
        -> LangChain prompt -> ChatOllama (LLM)   -> reply text
        -> VibeVoiceTTS.synthesize_to_file()       -> reply audio (WAV, base64)
        -> JSON { reply, audio } -> Frontend (plays audio + types out text)
Setup:
    1. Put this file, Main.py, and Main.py's own dependency folders
       (WhisperSTT/, LLM/, VibeVoiceTTS/) all in this same backend/ folder.
    2. pip install -r requirements.txt
    3. Make sure Ollama is running locally and the model is pulled:
           ollama pull llama3.2
    4. python server.py
       -> serves on http://localhost:8000

The frontend calls this API via src/services/agentApi.js, which defaults
to http://localhost:8000 (override with a VITE_API_URL env var / .env file
in the frontend folder).
"""

import base64
import logging
import os

from flask import Flask, jsonify, request
from flask_cors import CORS
>>>>>>> 02e86db2a04e8c9d90530a261555a3f28a31bf27
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langchain_core.output_parsers import StrOutputParser

from Main import VoiceAssistant
from ERP.tool_rag import ToolRAG
from ERP.tools import ALL_TOOLS

<<<<<<< HEAD
# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("agent-server")

app = FastAPI(title="MagmaAssistance Backend")

# Allow CORS requests from frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")
LLM_MODEL = os.environ.get("LLM_MODEL", "llama3.2")
TTS_VOICE = os.environ.get("TTS_VOICE", "af_heart")
=======
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("agent-server")

app = Flask(__name__)

allowed_origins = os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173").split(",")
CORS(app, resources={r"/api/*": {"origins": allowed_origins}})

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")
LLM_MODEL = os.environ.get("LLM_MODEL", "llama3.2")
TTS_SPEAKER = os.environ.get("TTS_SPEAKER", "Carter")
>>>>>>> 02e86db2a04e8c9d90530a261555a3f28a31bf27

logger.info("Loading VoiceAssistant agent (Whisper=%s, LLM=%s)...", WHISPER_MODEL, LLM_MODEL)
assistant = VoiceAssistant(
    whisper_model=WHISPER_MODEL,
    llm_model=LLM_MODEL,
<<<<<<< HEAD
    tts_voice=TTS_VOICE,
    speak_replies=False,
=======
    tts_speaker=TTS_SPEAKER,
    speak_replies=False,  # we synthesize+read the wav ourselves below
>>>>>>> 02e86db2a04e8c9d90530a261555a3f28a31bf27
)
text_chain = assistant.prompt | assistant.llm.model | StrOutputParser()
TOOL_RAG_TOP_K = int(os.environ.get("TOOL_RAG_TOP_K", "3"))
TOOL_RAG_MIN_SCORE = float(os.environ.get("TOOL_RAG_MIN_SCORE", "0.25"))

tool_rag = None
tool_map = {}
if ALL_TOOLS:
    logger.info("Indexing %d ERP tool(s) for retrieval...", len(ALL_TOOLS))
    tool_rag = ToolRAG(ALL_TOOLS, top_k=TOOL_RAG_TOP_K, min_score=TOOL_RAG_MIN_SCORE)
    tool_map = {tool.name: tool for tool in ALL_TOOLS}
else:
<<<<<<< HEAD
    logger.info("No ERP tools registered yet — running LLM-only.")

def generate_reply(text: str) -> str:
    """Returns the assistant's reply text for a user message."""
=======
    logger.info("No ERP tools registered yet (ERP/tools/ALL_TOOLS is empty) — running LLM-only.")

logger.info("Agent ready.")

def generate_reply(text: str) -> str:
    """Returns the assistant's reply text for a user message.

    If no ERP tools are registered yet, or none of them are relevant to
    this particular message (per ToolRAG), this is just a plain LLM call
    — identical to the old text_chain.invoke() behaviour.

    If ToolRAG finds relevant tools, only those few are bound to the LLM
    for this turn. If the LLM decides to call one, we run it, feed the
    result back, and ask the LLM for a final answer grounded in that data.
    """
>>>>>>> 02e86db2a04e8c9d90530a261555a3f28a31bf27
    if not tool_rag:
        return text_chain.invoke({"input": text})

    candidate_tools = tool_rag.retrieve(text)
    if not candidate_tools:
        return text_chain.invoke({"input": text})

    logger.info("Tools selected for query: %s", [t.name for t in candidate_tools])

    llm_with_tools = assistant.llm.model.bind_tools(candidate_tools)
    messages = [
        SystemMessage(content=assistant.llm.system_prompt),
        HumanMessage(content=text),
    ]

    response = llm_with_tools.invoke(messages)

    if not response.tool_calls:
        return response.content

    messages.append(response)

    for tool_call in response.tool_calls:
        tool = tool_map.get(tool_call["name"])
        if tool is None:
            result = f"Tool '{tool_call['name']}' is not available."
        else:
            try:
                result = tool.invoke(tool_call.get("args") or {})
            except Exception:
                logger.exception("Tool '%s' failed", tool_call["name"])
                result = f"'{tool_call['name']}' failed to fetch ERP data right now."

        messages.append(ToolMessage(content=str(result), tool_call_id=tool_call["id"]))

    final_response = llm_with_tools.invoke(messages)
    return final_response.content

<<<<<<< HEAD
def _get_tts_audio(text: str):
    """Synthesizes `text` to a WAV file and returns its raw bytes, or None
    if synthesis failed. Mirrors the old Flask backend's TTS step."""
=======
def _get_tts_audio(text):
    """Synthesizes `text` to a WAV file (without playing it on the server)
    and returns the file's raw bytes, or None if synthesis failed."""
>>>>>>> 02e86db2a04e8c9d90530a261555a3f28a31bf27
    wav_path = assistant.tts.synthesize_to_file(text)
    try:
        with open(wav_path, "rb") as f:
            return f.read()
    finally:
        try:
            os.remove(wav_path)
        except OSError:
            pass

<<<<<<< HEAD
class ChatRequest(BaseModel):
    message: str

@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Restored old-style JSON contract: { message } in, { reply, audio } out."""
    text = (req.message or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="message is required")
=======
@app.get("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.post("/api/chat")
def chat():
    data = request.get_json(silent=True) or {}
    text = (data.get("message") or "").strip()

    if not text:
        return jsonify({"error": "message is required"}), 400
>>>>>>> 02e86db2a04e8c9d90530a261555a3f28a31bf27

    try:
        reply = generate_reply(text)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Agent failed to process message: %s", text)
<<<<<<< HEAD
        raise HTTPException(status_code=500, detail=str(exc))
=======
        return jsonify({"error": str(exc)}), 500
>>>>>>> 02e86db2a04e8c9d90530a261555a3f28a31bf27

    audio_b64 = None
    try:
        wav_bytes = _get_tts_audio(reply)
        if wav_bytes:
            audio_b64 = base64.b64encode(wav_bytes).decode("ascii")
    except Exception:
        logger.exception("TTS step failed; returning text-only reply")

<<<<<<< HEAD
    return {"reply": reply, "audio": audio_b64}

@app.post("/query")
async def handle_query(
    query: str = Form(None),
    file: UploadFile = File(None)
):
    """Exposes endpoint to query MagmaAssistance using either text or audio files."""
    if not query and not file:
        raise HTTPException(status_code=400, detail="Either 'query' (text) or 'file' (audio) must be provided.")

    query_text = ""

    # 1. Handle Audio input (STT using Whisper)
    if file:
        temp_dir = "temp"
        os.makedirs(temp_dir, exist_ok=True)
        temp_file_path = os.path.join(temp_dir, file.filename)
        try:
            with open(temp_file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            logger.info(f"Saved uploaded audio file to {temp_file_path}")
            
            # Transcribe audio file to text
            query_text = assistant.whisper.transcribe_file(temp_file_path)
            logger.info(f"Transcribed Audio Text: {query_text}")
        except Exception as e:
            logger.error(f"Error handling uploaded file: {e}")
            raise HTTPException(status_code=500, detail=f"Error transcribing audio file: {e}")
        finally:
            # Clean up temp file
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
    else:
        query_text = query

    # 2. Get response from MagmaAssistance agent
    logger.info(f"Processing query: '{query_text}'")
    response_text = generate_reply(query_text)
    
    return {
        "query": query_text,
        "response": response_text
    }

@app.get("/api/health")
def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8050))
    logger.info(f"Starting server on port {port}...")
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
=======
    return jsonify({"reply": reply, "audio": audio_b64})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=False)
>>>>>>> 02e86db2a04e8c9d90530a261555a3f28a31bf27
