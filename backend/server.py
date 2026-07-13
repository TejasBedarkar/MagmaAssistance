import base64
import os
import shutil
import logging
import json
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage, AIMessage, BaseMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.outputs import ChatResult, ChatGeneration
from typing import List, Optional, Any, Sequence, Dict, Union, Callable
import requests

from LLM.LLM import LLM

# Helper function to convert messages to dictionary format for OpenRouter API
def convert_message_to_dict(message):
    if isinstance(message, SystemMessage):
        return {"role": "system", "content": message.content}
    elif isinstance(message, HumanMessage):
        return {"role": "user", "content": message.content}
    elif isinstance(message, ToolMessage):
        return {"role": "tool", "tool_call_id": message.tool_call_id, "content": message.content}
    elif isinstance(message, AIMessage):
        d = {"role": "assistant", "content": message.content or ""}
        if message.tool_calls:
            d["tool_calls"] = []
            for tc in message.tool_calls:
                d["tool_calls"].append({
                    "id": tc.get("id"),
                    "type": "function",
                    "function": {
                        "name": tc.get("name"),
                        "arguments": json.dumps(tc.get("args") or {})
                    }
                })
        elif hasattr(message, "additional_kwargs") and "tool_calls" in message.additional_kwargs:
            d["tool_calls"] = message.additional_kwargs["tool_calls"]
        return d
    elif isinstance(message, dict):
        return message
    else:
        role = getattr(message, "type", "user")
        if role == "ai":
            role = "assistant"
        return {"role": role, "content": getattr(message, "content", str(message))}

class OpenRouterChatModel(BaseChatModel):
    model_name: str
    temperature: float
    api_key: str
    base_url: str
    bound_tools: Optional[List[Any]] = None

    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[Any] = None,
        **kwargs: Any,
    ) -> ChatResult:
        api_messages = [convert_message_to_dict(msg) for msg in messages]
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/GoogleCloudPlatform",
            "X-Title": "MagmaAssistance",
        }
        
        # Translate default model name to free OpenRouter model
        model_to_use = self.model_name
        if model_to_use == "llama3.2":
            model_to_use = "nvidia/nemotron-3-ultra-550b-a55b:free"
            
        data = {
            "model": model_to_use,
            "messages": api_messages,
            "temperature": self.temperature,
        }
        
        if self.bound_tools:
            data["tools"] = self.bound_tools
            
        response = requests.post(self.base_url, json=data, headers=headers)
        response.raise_for_status()
        res_json = response.json()
        
        choice = res_json["choices"][0]
        message_data = choice["message"]
        
        content = message_data.get("content") or ""
        tool_calls = []
        if "tool_calls" in message_data:
            for tc in message_data["tool_calls"]:
                try:
                    args = json.loads(tc["function"]["arguments"])
                except Exception:
                    args = {}
                tool_calls.append({
                    "name": tc["function"]["name"],
                    "args": args,
                    "id": tc.get("id"),
                })
        
        ai_message = AIMessage(content=content, tool_calls=tool_calls)
        return ChatResult(generations=[ChatGeneration(message=ai_message)])

    def _llm_type(self) -> str:
        return "openrouter-chat-model"

    def bind_tools(
        self,
        tools: Sequence[Union[Dict[str, Any], type[BaseModel], Callable, Any]],
        **kwargs: Any,
    ) -> "OpenRouterChatModel":
        from langchain_core.utils.function_calling import convert_to_openai_tool
        formatted_tools = [convert_to_openai_tool(t) for t in tools]
        return OpenRouterChatModel(
            model_name=self.model_name,
            temperature=self.temperature,
            api_key=self.api_key,
            base_url=self.base_url,
            bound_tools=formatted_tools,
        )

# Add model property to LLM class before importing Main/VoiceAssistant
@property
def get_model(self):
    return OpenRouterChatModel(
        model_name=self.model_name,
        temperature=self.temperature,
        api_key=self.api_key,
        base_url=self.base_url
    )

LLM.model = get_model

from Main import VoiceAssistant
from ERP.tool_rag import ToolRAG
from ERP.tools import ALL_TOOLS

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

logger.info("Loading VoiceAssistant agent (Whisper=%s, LLM=%s)...", WHISPER_MODEL, LLM_MODEL)
assistant = VoiceAssistant(
    whisper_model=WHISPER_MODEL,
    llm_model=LLM_MODEL,
    tts_voice=TTS_VOICE,
    speak_replies=False,
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
    logger.info("No ERP tools registered yet — running LLM-only.")

def generate_reply(text: str) -> str:
    """Returns the assistant's reply text for a user message."""
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

def _get_tts_audio(text: str):
    """Synthesizes `text` to a WAV file and returns its raw bytes, or None
    if synthesis failed. Mirrors the old Flask backend's TTS step."""
    wav_path = assistant.tts.synthesize_to_file(text)
    try:
        with open(wav_path, "rb") as f:
            return f.read()
    finally:
        try:
            os.remove(wav_path)
        except OSError:
            pass

class ChatRequest(BaseModel):
    message: str

@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Restored old-style JSON contract: { message } in, { reply, audio } out."""
    text = (req.message or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="message is required")

    try:
        reply = generate_reply(text)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Agent failed to process message: %s", text)
        raise HTTPException(status_code=500, detail=str(exc))

    audio_b64 = None
    try:
        wav_bytes = _get_tts_audio(reply)
        if wav_bytes:
            audio_b64 = base64.b64encode(wav_bytes).decode("ascii")
    except Exception:
        logger.exception("TTS step failed; returning text-only reply")

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
