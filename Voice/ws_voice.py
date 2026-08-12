import asyncio
import json
import re
from fastapi import WebSocket, WebSocketDisconnect

from Voice.realtime_stt import RealtimeTranscriber

_SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[.!?\u0964])\s+")


def register_voice_ws(app, stream_agent_turn, tts, logger):
    @app.websocket("/ws/voice")
    async def ws_voice(ws: WebSocket, session_id: str = "voice-default", user_id: str = None):
        await ws.accept()

        class ConnectionClosed(Exception):
            """Raised when a background task tries to use a closed websocket."""

        connected = True

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

        stt = RealtimeTranscriber()
        try:
            await stt.connect()
        except Exception as e:
            try:
                await send_json({"type": "error", "message": f"STT connect failed: {e}"})
                await ws.close()
            except (ConnectionClosed, RuntimeError, OSError):
                pass
            return

        history = []
        state = {"turn_task": None, "speaking": False}

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
            for audio_bytes in tts.synthesize_stream(text_chunk):
                await send({"type": "websocket.send", "bytes": audio_bytes})

        async def run_turn(text: str):
            state["speaking"] = True
            buffer = ""
            try:
                async for event in stream_agent_turn(text, session_id=session_id, user_id=user_id, history=history):
                    etype = event["type"]
                    if etype == "token":
                        await send_json({"type": "token", "text": event["text"]})
                        buffer += event["text"]
                        parts = _SENTENCE_BOUNDARY_RE.split(buffer)
                        if len(parts) > 1:
                            for chunk in parts[:-1]:
                                await speak_chunk(chunk)
                            buffer = parts[-1]
                    elif etype == "tool_call":
                        await send_json({"type": "tool_call", "name": event["name"], "args": event["args"]})
                    elif etype == "tool_result":
                        await send_json({"type": "tool_result", "name": event["name"], "result": str(event["result"])})
                    elif etype == "done":
                        await speak_chunk(buffer)
                        buffer = ""
                        await send_json({"type": "done"})
            except asyncio.CancelledError:
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

        async def stt_loop():
            try:
                async for event in stt.events():
                    etype = event["type"]
                    if etype == "speech_started":
                        if state["speaking"] or state["turn_task"]:
                            await cancel_turn()
                            await send_json({"type": "interrupted"})
                    elif etype == "transcript_delta":
                        await send_json({"type": "partial_transcript", "text": event["text"]})
                    elif etype == "transcript_done":
                        text = (event.get("text") or "").strip()
                        if not text:
                            continue
                        await send_json({"type": "final_transcript", "text": text})
                        await cancel_turn()
                        state["turn_task"] = asyncio.create_task(run_turn(text))
                    elif etype == "error":
                        await send_json({"type": "error", "message": str(event.get("error"))})
            except (asyncio.CancelledError, ConnectionClosed):
                pass
            except Exception:
                logger.exception("Realtime STT event loop failed")

        stt_task = asyncio.create_task(stt_loop())
        try:
            while True:
                message = await ws.receive()
                if message.get("type") == "websocket.disconnect":
                    connected = False
                    break
                audio_bytes = message.get("bytes")
                if audio_bytes is not None:
                    await stt.send_audio(audio_bytes)
                    continue
                text_msg = message.get("text")
                if text_msg is None:
                    continue
                try:
                    control = json.loads(text_msg)
                except Exception:
                    continue
                if control.get("type") == "interrupt":
                    if state["speaking"] or state["turn_task"]:
                        await cancel_turn()
                        await send_json({"type": "interrupted"})
                elif control.get("type") == "end":
                    break
        except (WebSocketDisconnect, ConnectionClosed):
            connected = False
        finally:
            connected = False
            stt_task.cancel()
            try:
                await stt_task
            except asyncio.CancelledError:
                pass
            await cancel_turn()
            await stt.close()
