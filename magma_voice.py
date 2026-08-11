#!/usr/bin/env python3
"""
magma_voice.py

Full-duplex realtime voice client for the MagmaAssistance /ws/voice
endpoint. Continuous mic capture (sounddevice callback stream) and
streamed speaker playback (separate callback stream fed by a queue) run
concurrently with the WebSocket send/receive loops -- no
record -> send -> wait -> play sequencing like the old MagnaCLI.py /voice
mode, which still exists unchanged for fixed-duration use.

Usage:
    python magma_voice.py
    python magma_voice.py --url ws://localhost:8050/ws/voice --session mysession

Requires: pip install sounddevice websockets
"""

import argparse
import asyncio
import json
import os
import queue
import sys
import threading

import websockets

SAMPLE_RATE = 24000
CHANNELS = 1
DTYPE = "int16"
FRAME_MS = 40
FRAME_SAMPLES = int(SAMPLE_RATE * FRAME_MS / 1000)


def _load_dotenv(path: str = ".env") -> None:
    if not os.path.exists(path):
        return
    try:
        with open(path, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
    except OSError:
        pass


_load_dotenv()

DEFAULT_WS_URL = os.environ.get("MAGMA_WS_URL", "ws://localhost:8005/ws/voice")
DEFAULT_SESSION = os.environ.get("MAGMA_SESSION_ID", "voice-cli")


class VoiceSession:
    def __init__(self, ws_url: str = DEFAULT_WS_URL, session_id: str = DEFAULT_SESSION):
        self.ws_url = f"{ws_url}?session_id={session_id}"
        self.mic_queue = queue.Queue()
        self.playback_queue = queue.Queue()
        self._playback_buf = bytearray()
        self._playback_lock = threading.Lock()
        self.stop_flag = threading.Event()
        self._line_open = False

    def _mic_callback(self, indata, frames, time_info, status):
        self.mic_queue.put(bytes(indata))

    def _playback_callback(self, outdata, frames, time_info, status):
        needed = frames * 2
        with self._playback_lock:
            if len(self._playback_buf) < needed:
                while True:
                    try:
                        self._playback_buf.extend(self.playback_queue.get_nowait())
                    except queue.Empty:
                        break
                    if len(self._playback_buf) >= needed:
                        break
            chunk = bytes(self._playback_buf[:needed])
            del self._playback_buf[:needed]
        if len(chunk) < needed:
            chunk = chunk + b"\x00" * (needed - len(chunk))
        outdata[:] = chunk

    def clear_playback(self):
        with self._playback_lock:
            self._playback_buf.clear()
        while True:
            try:
                self.playback_queue.get_nowait()
            except queue.Empty:
                break

    def _print_line(self, text: str):
        if self._line_open:
            print()
            self._line_open = False
        print(text)

    async def run(self):
        import sounddevice as sd

        self.stop_flag.clear()
        print(f"Connecting to {self.ws_url} ...")
        async with websockets.connect(self.ws_url, max_size=None) as ws:
            print("Connected. Listening -- speak naturally, Ctrl+C to quit.\n")
            input_stream = sd.RawInputStream(samplerate=SAMPLE_RATE, channels=CHANNELS, dtype=DTYPE, blocksize=FRAME_SAMPLES, callback=self._mic_callback)
            output_stream = sd.RawOutputStream(samplerate=SAMPLE_RATE, channels=CHANNELS, dtype=DTYPE, blocksize=FRAME_SAMPLES, callback=self._playback_callback)
            with input_stream, output_stream:
                sender = asyncio.create_task(self._mic_sender(ws))
                receiver = asyncio.create_task(self._ws_receiver(ws))
                done, pending = await asyncio.wait([sender, receiver], return_when=asyncio.FIRST_COMPLETED)
                self.stop_flag.set()
                for task in pending:
                    task.cancel()
                # Always retrieve task results.  Otherwise a normal WebSocket
                # close (notably Uvicorn's 1012 "service restart") is reported
                # later as "Task exception was never retrieved".
                await asyncio.gather(sender, receiver, return_exceptions=True)

    async def _mic_sender(self, ws):
        loop = asyncio.get_event_loop()
        while not self.stop_flag.is_set():
            chunk = await loop.run_in_executor(None, self.mic_queue.get)
            if chunk is None:
                break
            try:
                await ws.send(chunk)
            except websockets.exceptions.ConnectionClosed:
                break

    async def _ws_receiver(self, ws):
        try:
            async for message in ws:
                if isinstance(message, (bytes, bytearray)):
                    self.playback_queue.put(bytes(message))
                    continue
                try:
                    event = json.loads(message)
                except Exception:
                    continue
                etype = event.get("type")
                if etype == "token":
                    sys.stdout.write(event.get("text", ""))
                    sys.stdout.flush()
                    self._line_open = True
                elif etype == "tool_call":
                    self._print_line(f"[calling {event.get('name')}({event.get('args')})]")
                elif etype == "tool_result":
                    self._print_line(f"[{event.get('name')} -> {event.get('result')}]")
                elif etype == "partial_transcript":
                    sys.stdout.write(f"\r...{event.get('text', '')}" + " " * 10)
                    sys.stdout.flush()
                    self._line_open = True
                elif etype == "final_transcript":
                    self._print_line(f"You: {event.get('text')}")
                elif etype == "interrupted":
                    self.clear_playback()
                    self._print_line("[interrupted]")
                elif etype == "done":
                    self._print_line("")
                elif etype == "error":
                    self._print_line(f"[error] {event.get('message')}")
        except websockets.exceptions.ConnectionClosed as exc:
            if exc.code == 1012:
                self._print_line("[disconnected] Voice service restarted; run the client again.")
            elif exc.code not in (1000, 1001):
                self._print_line(f"[disconnected] WebSocket closed ({exc.code}): {exc.reason or 'no reason'}")


def main():
    parser = argparse.ArgumentParser(description="Realtime full-duplex voice client for MagmaAssistance.")
    parser.add_argument("--url", default=DEFAULT_WS_URL)
    parser.add_argument("--session", default=DEFAULT_SESSION)
    args = parser.parse_args()

    try:
        import sounddevice  # noqa: F401
    except ImportError:
        print("Voice mode needs: pip install sounddevice websockets")
        sys.exit(1)

    session = VoiceSession(ws_url=args.url, session_id=args.session)
    try:
        asyncio.run(session.run())
    except KeyboardInterrupt:
        print("\nBye.")


if __name__ == "__main__":
    main()
