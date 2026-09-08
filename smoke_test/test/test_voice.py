"""
Checks: WS /ws/voice

Connection-level check only (connect, then close) -- it does not drive
an actual voice turn. Requires the optional `websocket-client` package;
skips cleanly (not a FAIL) if it isn't installed.
"""

from smoke.client import Client, TestResult, timed


def _connect(client: Client) -> TestResult:
    try:
        import websocket  # websocket-client
    except ImportError:
        return TestResult(
            "voice.ws_connect", False, skipped=True,
            detail="skipped -- pip install websocket-client",
        )

    ws_url = client.base_url.replace("http://", "ws://").replace("https://", "wss://") + "/ws/voice"
    ws = websocket.create_connection(ws_url, timeout=10)
    ws.close()
    return TestResult("voice.ws_connect", True)


def run(client: Client, ctx: dict) -> list[TestResult]:
    return [timed("voice.ws_connect", _connect, client)]
