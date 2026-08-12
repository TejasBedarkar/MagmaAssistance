import aiosqlite, asyncio
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

async def main():
    try:
        conn = await aiosqlite.connect('checkpoints.sqlite')
        saver = AsyncSqliteSaver(conn)
        await saver.setup()
        print("Success")
    except Exception as e:
        print("Error:", e)
    finally:
        await conn.close()

asyncio.run(main())
