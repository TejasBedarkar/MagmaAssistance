#!/usr/bin/env python3
"""
magma_voice_debug.py

Terminal diagnostic tool for the seamless (Live Voice Mode) <-> text chat
context-sharing pipeline used by MagnaCLI / AssistantPortal.jsx.

Usage:
    python magma_voice_debug.py                         # full report, session_id=debug
    python magma_voice_debug.py --session-id my-chat-1
    python magma_voice_debug.py --url http://localhost:8050
    python magma_voice_debug.py check-env
    python magma_voice_debug.py check-backend
    python magma_voice_debug.py check-history --session-id my-chat-1
    python magma_voice_debug.py check-ws-voice --session-id my-chat-1
    python magma_voice_debug.py check-webrtc-voice --session-id my-chat-1
    python magma_voice_debug.py watch-history --session-id my-chat-1

Requires: pip install requests websockets
"""

import argparse
import asyncio
import json
import os
import sqlite3
import sys
import time
from typing import Optional

try:
    import requests
except ImportError:
    print("Missing dependency: pip install requests")
    sys.exit(1)


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

DEFAULT_URL = os.environ.get("MAGMA_API_URL", "http://localhost:8050")
DEFAULT_SESSION = os.environ.get("MAGMA_SESSION_ID", "debug")
HISTORY_DB = os.environ.get("MAGMA_STREAM_HISTORY_DB", "stream_history.sqlite")

PASS = "[PASS]"
FAIL = "[FAIL]"
WARN = "[WARN]"
INFO = "[INFO]"


def _ok(msg: str) -> None:
    print(f"{PASS} {msg}")


def _bad(msg: str) -> None:
    print(f"{FAIL} {msg}")


def _warn(msg: str) -> None:
    print(f"{WARN} {msg}")


def _info(msg: str) -> None:
    print(f"{INFO} {msg}")


def check_env() -> bool:
    print("\n== Environment ==")
    ok = True
    required = ["OPENAI_API_KEY"]
    optional_groups = [
        ["LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_URL"],
    ]
    for key in required:
        if os.environ.get(key):
            _ok(f"{key} is set")
        else:
            _bad(f"{key} is missing — seamless WebRTC voice sessions will fail to start")
            ok = False
    for group in optional_groups:
        present = [k for k in group if os.environ.get(k)]
        missing = [k for k in group if not os.environ.get(k)]
        if not missing:
            _ok(f"LiveKit vars set ({', '.join(group)})")
        elif present:
            _warn(f"LiveKit partially configured — missing {', '.join(missing)}")
        else:
            _info(f"LiveKit not configured ({', '.join(group)}) — only relevant if using the LiveKit voice path")
    _info(f"MAGMA_API_URL = {DEFAULT_URL}")
    _info(f"MAGMA_SESSION_ID = {DEFAULT_SESSION}")
    _info(f"stream history db = {os.path.abspath(HISTORY_DB)}")
    return ok


def check_backend(base_url: str) -> bool:
    print("\n== Backend reachability ==")
    try:
        r = requests.get(f"{base_url}/api/health", timeout=5)
        if r.status_code == 200:
            _ok(f"{base_url}/api/health -> 200")
            return True
        _bad(f"{base_url}/api/health -> {r.status_code}")
        return False
    except requests.RequestException as exc:
        _bad(f"Could not reach {base_url}: {exc}")
        return False


def _read_history_row(session_id: str) -> Optional[list]:
    if not os.path.exists(HISTORY_DB):
        return None
    conn = sqlite3.connect(HISTORY_DB)
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS stream_history (session_id TEXT PRIMARY KEY, history TEXT)"
        )
        cur = conn.execute(
            "SELECT history FROM stream_history WHERE session_id = ?", (session_id,)
        )
        row = cur.fetchone()
        if not row:
            return None
        try:
            return json.loads(row[0])
        except Exception:
            return None
    finally:
        conn.close()


def check_history(session_id: str) -> bool:
    print(f"\n== stream_history.sqlite for session_id={session_id!r} ==")
    if not os.path.exists(HISTORY_DB):
        _warn(f"{HISTORY_DB} does not exist yet — no turns recorded for any session.")
        return False
    rows = _read_history_row(session_id)
    if rows is None:
        _warn(f"No history row for session_id={session_id!r} yet. Send a chat message or start "
              f"a voice turn with this exact session_id first.")
        return False
    _ok(f"Found {len(rows)} stored message(s) for session_id={session_id!r}")
    for i, msg in enumerate(rows[-10:]):
        data = msg.get("data", {}) if isinstance(msg, dict) else {}
        msg_type = msg.get("type", "?") if isinstance(msg, dict) else "?"
        content = data.get("content", "")
        preview = (content[:100] + "...") if len(content) > 100 else content
        print(f"    [{i}] {msg_type:12s} {preview}")
    return True


def list_all_sessions() -> None:
    print("\n== All sessions currently in stream_history.sqlite ==")
    if not os.path.exists(HISTORY_DB):
        _warn(f"{HISTORY_DB} does not exist yet.")
        return
    conn = sqlite3.connect(HISTORY_DB)
    try:
        cur = conn.execute("SELECT session_id, length(history) FROM stream_history")
        rows = cur.fetchall()
        if not rows:
            _info("No sessions recorded yet.")
            return
        for session_id, size in rows:
            print(f"    {session_id!r:30s} ({size} bytes)")
    finally:
        conn.close()


def watch_history(session_id: str, interval: float = 1.0) -> None:
    print(f"\n== Watching stream_history for session_id={session_id!r} (Ctrl+C to stop) ==")
    last_len = -1
    try:
        while True:
            rows = _read_history_row(session_id) or []
            if len(rows) != last_len:
                last_len = len(rows)
                ts = time.strftime("%H:%M:%S")
                if rows:
                    last_msg = rows[-1]
                    data = last_msg.get("data", {}) if isinstance(last_msg, dict) else {}
                    msg_type = last_msg.get("type", "?") if isinstance(last_msg, dict) else "?"
                    preview = (data.get("content", "") or "")[:100]
                    print(f"[{ts}] history length={len(rows)}  last={msg_type} {preview!r}")
                else:
                    print(f"[{ts}] history length=0")
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\nstopped.")


def check_ws_voice(base_url: str, session_id: str) -> bool:
    print(f"\n== /ws/voice round trip (session_id={session_id!r}) ==")
    try:
        import websockets
    except ImportError:
        _bad("Missing dependency: pip install websockets")
        return False

    ws_url = base_url.replace("http://", "ws://").replace("https://", "wss://")
    ws_url = f"{ws_url}/ws/voice?session_id={session_id}"

    async def _run():
        before = _read_history_row(session_id) or []
        try:
            async with websockets.connect(ws_url, open_timeout=10) as ws:
                _ok(f"Connected to {ws_url}")
                probe_text = f"debug ping {int(time.time())}"
                await ws.send(json.dumps({"type": "user_speech", "text": probe_text}))
                _info(f"Sent user_speech: {probe_text!r}")
                saw_done = False
                deadline = time.time() + 30
                while time.time() < deadline:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=5)
                    except asyncio.TimeoutError:
                        continue
                    if isinstance(raw, (bytes, bytearray)):
                        # Binary frame = synthesized TTS PCM audio, not a
                        # JSON event. Just note its size and keep listening.
                        _info(f"event: audio_pcm ({len(raw)} bytes)")
                        continue
                    event = json.loads(raw)
                    etype = event.get("type")
                    if etype == "token":
                        continue
                    _info(f"event: {etype}")
                    if etype == "done":
                        saw_done = True
                        break
                    if etype == "error":
                        _bad(f"server reported error: {event.get('message')}")
                        break
                if saw_done:
                    _ok("Got a full turn (done) back from /ws/voice")
                else:
                    _warn("Did not see a 'done' event within 30s")
        except Exception as exc:
            _bad(f"WebSocket round trip failed: {exc}")
            return False

        await asyncio.sleep(0.5)
        after = _read_history_row(session_id) or []
        if len(after) > len(before):
            _ok(f"stream_history grew from {len(before)} to {len(after)} messages for "
                f"session_id={session_id!r} — chat and seamless voice are sharing context.")
            return True
        _bad(f"stream_history did NOT grow for session_id={session_id!r} "
             f"(before={len(before)}, after={len(after)}). Chat and voice are writing "
             f"to different session_ids — context is not being shared.")
        return False

    return asyncio.run(_run())


def check_webrtc_voice(base_url: str, session_id: str) -> bool:
    print(f"\n== WebRTC seamless voice endpoints (session_id={session_id!r}) ==")
    ok = True

    try:
        r = requests.post(
            f"{base_url}/api/voice/session/start",
            json={"session_id": session_id, "voice": "alloy"},
            timeout=15,
        )
    except requests.RequestException as exc:
        _bad(f"POST /api/voice/session/start failed: {exc}")
        return False

    if r.status_code != 200:
        _bad(f"POST /api/voice/session/start -> {r.status_code} {r.text[:200]}")
        return False
    _ok("POST /api/voice/session/start -> 200 (ephemeral token minted)")

    try:
        r = requests.get(f"{base_url}/api/voice/session/{session_id}/config", timeout=10)
        if r.status_code == 200:
            body = r.json()
            hist = body.get("conversation_history", [])
            _ok(f"GET .../config -> 200, {len(hist)} prior turn(s) preloaded from stream_history")
        else:
            _bad(f"GET .../config -> {r.status_code} {r.text[:200]}")
            ok = False
    except requests.RequestException as exc:
        _bad(f"GET .../config failed: {exc}")
        ok = False

    try:
        r = requests.post(
            f"{base_url}/api/voice/session/{session_id}/turn",
            json={"role": "user", "text": f"debug webrtc turn {int(time.time())}"},
            timeout=10,
        )
        if r.status_code == 200:
            _ok(f"POST .../turn -> 200 {r.json()}")
        else:
            _bad(f"POST .../turn -> {r.status_code} {r.text[:200]} "
                 f"(this endpoint needs the /turn + save_stream_history_fn patch)")
            ok = False
    except requests.RequestException as exc:
        _bad(f"POST .../turn failed: {exc}")
        ok = False

    try:
        r = requests.delete(f"{base_url}/api/voice/session/{session_id}", timeout=10)
        if r.status_code == 200:
            _ok("DELETE session -> 200 (torn down cleanly)")
        else:
            _warn(f"DELETE session -> {r.status_code}")
    except requests.RequestException as exc:
        _warn(f"DELETE session failed: {exc}")

    return ok


def full_report(base_url: str, session_id: str) -> None:
    print(f"Magma seamless-voice diagnostic — url={base_url} session_id={session_id!r}")
    env_ok = check_env()
    backend_ok = check_backend(base_url)
    if not backend_ok:
        _bad("Backend is not reachable — skipping remaining checks. Start server.py first.")
        return
    check_history(session_id)
    ws_ok = check_ws_voice(base_url, session_id)
    check_webrtc_voice(base_url, session_id)
    check_history(session_id)

    print("\n== Summary ==")
    _ok("environment") if env_ok else _bad("environment")
    _ok("backend reachable") if backend_ok else _bad("backend reachable")
    _ok("chat <-> seamless (ws) context sharing") if ws_ok else _bad("chat <-> seamless (ws) context sharing")
    print(f"\nRun 'python magma_voice_debug.py watch-history --session-id {session_id}' "
          f"in a second terminal while you use the app to watch turns land in real time.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Seamless voice / chat context-sharing debugger")
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--session-id", default=DEFAULT_SESSION)
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("check-env")
    sub.add_parser("check-backend")
    sub.add_parser("check-history")
    sub.add_parser("list-sessions")
    sub.add_parser("check-ws-voice")
    sub.add_parser("check-webrtc-voice")
    sub.add_parser("watch-history")
    sub.add_parser("report")

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    if args.command in (None, "report"):
        full_report(args.url, args.session_id)
    elif args.command == "check-env":
        check_env()
    elif args.command == "check-backend":
        check_backend(args.url)
    elif args.command == "check-history":
        check_history(args.session_id)
    elif args.command == "list-sessions":
        list_all_sessions()
    elif args.command == "check-ws-voice":
        check_ws_voice(args.url, args.session_id)
    elif args.command == "check-webrtc-voice":
        check_webrtc_voice(args.url, args.session_id)
    elif args.command == "watch-history":
        watch_history(args.session_id)


if __name__ == "__main__":
    main()
