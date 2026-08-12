import sqlite3
import json

conn = sqlite3.connect('checkpoints.sqlite')
cursor = conn.cursor()
cursor.execute("SELECT checkpoint FROM checkpoints ORDER BY thread_id DESC, checkpoint_id DESC LIMIT 5;")
rows = cursor.fetchall()
if not rows:
    print("NO CHECKPOINTS FOUND")
else:
    for row in rows:
        cp = json.loads(row[0].decode('utf-8') if isinstance(row[0], bytes) else row[0])
        messages = cp['channel_values'].get('messages', [])
        for m in messages[-5:]:  # print last 5 messages of the checkpoint
            # handle LangChain message serialization format
            if isinstance(m, dict):
                print(m.get('type', 'unknown'), m.get('id', ''))
                kwargs = m.get('kwargs', {})
                if 'content' in kwargs:
                    print(kwargs['content'][:200])
                if 'tool_calls' in kwargs:
                    print(kwargs['tool_calls'])
                print("---")
            else:
                print(str(m)[:200])
        print("==========")
conn.close()
