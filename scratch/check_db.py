import asyncio
import json
from server import agent_graph

async def main():
    import sqlite3
    conn = sqlite3.connect("stream_history.sqlite")
    cursor = conn.cursor()
    cursor.execute("SELECT thread_id FROM checkpoints ORDER BY thread_id DESC LIMIT 1")
    row = cursor.fetchone()
    if not row:
        print("No sessions found.")
        return
    thread_id = row[0]
    print(f"Latest thread_id: {thread_id}")
    
    config = {"configurable": {"thread_id": thread_id}}
    state = await agent_graph.aget_state(config)
    messages = state.values.get("messages", [])
    print(f"Total messages: {len(messages)}")
    for i, m in enumerate(messages):
        print(f"[{i}] {type(m).__name__}: {str(m.content)[:100]}")

asyncio.run(main())
