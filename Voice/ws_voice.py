import asyncio
import json
import re
import time
from fastapi import WebSocket, WebSocketDisconnect

_SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[.!?\u0964])\s+")

def register_voice_ws(app, stream_agent_turn, tts, logger, load_stream_history, save_stream_history):
    @app.websocket("/ws/voice")
    async def ws_voice(ws: WebSocket, session_id: str = "voice-default", user_id: str = None):
        await ws.accept()
        logger.info("[WS/voice] Connection ACCEPTED  session=%s user=%s", session_id, user_id)

        class ConnectionClosed(Exception):
            """Raised when a background task tries to use a closed websocket."""

        connected = True
        state = {"turn_task": None, "speaking": False}

        async def send(message):
            nonlocal connected
            if not connected:
                raise ConnectionClosed
            try:
                await ws.send(message)
            except (WebSocketDisconnect, RuntimeError, OSError) as exc:
                connected = False
                raise ConnectionClosed from exc

        async def send_json(payload):
            await send({"type": "websocket.send", "text": json.dumps(payload)})

        history = await load_stream_history(session_id)

        async def cancel_turn():
            task = state["turn_task"]
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                except Exception:
                    logger.exception("Voice turn task raised on cancel")
            state["turn_task"] = None
            state["speaking"] = False

        async def speak_chunk(text_chunk: str):
            if not text_chunk.strip():
                return
            try:
                from Voice import openai_tts
                t0 = time.monotonic()
                audio_bytes = await openai_tts.synthesize(text_chunk)
                elapsed = (time.monotonic() - t0) * 1000
                logger.debug(
                    "[WS/voice] TTS  %.0fms  %d bytes  text=%r",
                    elapsed, len(audio_bytes), text_chunk[:60]
                )
                await send({"type": "websocket.send", "bytes": audio_bytes})
            except Exception as e:
                logger.error("[WS/voice] TTS ERROR: %s", e)

        class TTSFilter:
            def __init__(self):
                self.buffer = ""
                self.accumulated_sentences = []
                
            def _clean(self, text):
                text = re.sub(r'\[Action:.*?\]', '', text)
                text = re.sub(r'```.*?```', '', text, flags=re.DOTALL)
                
                lines = text.split('\n')
                cleaned_lines = []
                for line in lines:
                    stripped = line.strip()
                    if stripped.startswith('|') and stripped.endswith('|'):
                        continue
                    cleaned_lines.append(line)
                
                text = '\n'.join(cleaned_lines)
                text = text.replace('*', '').replace('#', '')
                return text.strip()

            def process_token(self, text):
                results = []
                self.buffer += text
                
                if '[' in self.buffer and ']' not in self.buffer[self.buffer.rfind('['):]:
                    return results
                    
                if '```' in self.buffer and self.buffer.count('```') % 2 != 0:
                    return results

                parts = re.split(r'(?<=[.!?\u0964])\s+', self.buffer)
                
                if len(parts) > 1:
                    for i in range(len(parts) - 1):
                        cleaned = self._clean(parts[i])
                        if cleaned:
                            while len(cleaned) > 450:
                                split_idx = cleaned.rfind(' ', 0, 450)
                                if split_idx == -1: split_idx = 450
                                self.accumulated_sentences.append(cleaned[:split_idx])
                                cleaned = cleaned[split_idx:].strip()
                            if cleaned:
                                self.accumulated_sentences.append(cleaned)
                            
                    self.buffer = parts[-1]
                    
                    combined = " ".join(self.accumulated_sentences)
                    if len(self.accumulated_sentences) >= 2 or len(combined) > 250:
                        if len(combined) > 450:
                            for s in self.accumulated_sentences:
                                results.append(s)
                        else:
                            results.append(combined)
                        self.accumulated_sentences = []
                        
                return results

            def flush(self):
                results = []
                cleaned = self._clean(self.buffer)
                if cleaned:
                    while len(cleaned) > 450:
                        split_idx = cleaned.rfind(' ', 0, 450)
                        if split_idx == -1: split_idx = 450
                        self.accumulated_sentences.append(cleaned[:split_idx])
                        cleaned = cleaned[split_idx:].strip()
                    if cleaned:
                        self.accumulated_sentences.append(cleaned)
                    
                if self.accumulated_sentences:
                    combined = " ".join(self.accumulated_sentences)
                    if len(combined) > 450:
                        for s in self.accumulated_sentences:
                            results.append(s)
                    else:
                        results.append(combined)
                    
                self.buffer = ""
                self.accumulated_sentences = []
                return results

        async def run_turn(text: str):
            logger.info("[WS/voice] turn START  session=%s  text=%r", session_id, text[:120])
            t_turn = time.monotonic()
            state["speaking"] = True
            
            tts_queue = asyncio.Queue()
            
            async def tts_worker():
                while True:
                    chunk = await tts_queue.get()
                    if chunk is None:
                        break
                    await speak_chunk(chunk)
                    tts_queue.task_done()
                    
            worker_task = asyncio.create_task(tts_worker())
            tts_filter = TTSFilter()
            
            try:
                async for event in stream_agent_turn(text, session_id=session_id, user_id=user_id, history=history):
                    etype = event["type"]
                    if etype == "token":
                        await send_json({"type": "token", "text": event["text"]})
                        for chunk in tts_filter.process_token(event["text"]):
                            await tts_queue.put(chunk)
                    elif etype == "tool_call":
                        logger.info("[WS/voice] tool_call  name=%s  args=%s", event["name"], str(event.get("args", {}))[:200])
                        await send_json({"type": "tool_call", "name": event["name"], "args": event["args"]})
                    elif etype == "tool_result":
                        logger.info("[WS/voice] tool_result  name=%s  result=%s", event["name"], str(event.get("result", ""))[:200])
                        await send_json({"type": "tool_result", "name": event["name"], "result": str(event["result"])})
                    elif etype == "done":
                        final_chunks = tts_filter.flush()
                        for chunk in final_chunks:
                            await tts_queue.put(chunk)
                        await tts_queue.put(None)
                        await worker_task
                        elapsed = (time.monotonic() - t_turn) * 1000
                        logger.info("[WS/voice] turn DONE  %.0fms  session=%s", elapsed, session_id)
                        await send_json({"type": "done"})
                
                await save_stream_history(session_id, history)
            except asyncio.CancelledError:
                if not worker_task.done():
                    worker_task.cancel()
                raise
            except ConnectionClosed:
                pass
            except Exception as e:
                logger.exception("Voice turn failed")
                try:
                    await send_json({"type": "error", "message": str(e)})
                except ConnectionClosed:
                    pass
            finally:
                state["speaking"] = False

        try:
            while True:
                message = await ws.receive()
                if message.get("type") == "websocket.disconnect":
                    connected = False
                    break
                
                text_msg = message.get("text")
                if not text_msg:
                    continue
                try:
                    control = json.loads(text_msg)
                except Exception:
                    continue
                
                msg_type = control.get("type")
                
                if msg_type == "interrupt":
                    if state["speaking"] or state["turn_task"]:
                        await cancel_turn()
                        await send_json({"type": "interrupted"})
                elif msg_type == "audio":
                    await cancel_turn()
                    audio_b64 = control.get("data", "")
                    if audio_b64:
                        import base64
                        from Voice import openai_stt
                        try:
                            audio_bytes = base64.b64decode(audio_b64)
                            logger.info("[WS/voice] STT request  %d bytes audio  session=%s", len(audio_bytes), session_id)
                            t0 = time.monotonic()
                            stt_result = await openai_stt.transcribe(audio_bytes)
                            elapsed = (time.monotonic() - t0) * 1000
                            transcript = stt_result["transcript"].strip()
                            logger.info("[WS/voice] STT result  %.0fms  %r", elapsed, transcript[:120])
                            if transcript:
                                await send_json({"type": "final_transcript", "text": transcript})
                                state["turn_task"] = asyncio.create_task(run_turn(transcript))
                            else:
                                logger.warning("[WS/voice] STT returned empty transcript")
                        except Exception as e:
                            logger.error("[WS/voice] STT ERROR: %s", e)
                            await send_json({"type": "error", "message": f"STT failed: {e}"})
                elif msg_type == "user_speech":
                    await cancel_turn()
                    state["turn_task"] = asyncio.create_task(run_turn(control.get("text", "")))
                elif msg_type == "end":
                    break
        except (WebSocketDisconnect, ConnectionClosed):
            connected = False
        finally:
            connected = False
            await cancel_turn()
