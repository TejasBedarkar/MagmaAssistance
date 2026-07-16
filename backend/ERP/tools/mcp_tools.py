"""
ERP/tools/mcp_tools.py

Client-side bridge to ERP/mcp_server.py. Uses MCP's stdio transport,
which means THIS process spawns `python -m ERP.mcp_server` as a
subprocess and talks to it over stdin/stdout the moment `start()` is
called — no separate process to launch manually, no port to configure.
The subprocess is spawned once (see MCPToolSource.start(), called from
server.py's lifespan handler at app startup) and kept alive for the
app's lifetime; it is not re-spawned per tool call.

Tools loaded this way are plain LangChain BaseTool objects — same
`.name` / `.description` / `.args_schema` shape as the existing
@tool-decorated functions in sales_tools.py etc. — so ToolRAG indexes
them identically. The one real difference: MCP tools only implement
`.ainvoke()` (async), not `.invoke()` (sync), which is why server.py's
_execute_tool needs to switch to `await tool.ainvoke(...)` once these
are merged in (that change is the same either way, and works fine for
the existing sync tools too — BaseTool.ainvoke() falls back to running
a sync tool's normal `invoke()` under the hood).
"""

import sys
from contextlib import AsyncExitStack

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools

# sys.executable ensures the subprocess uses the SAME venv/interpreter
# as server.py itself, so it sees the same installed packages.
MCP_SERVERS = {
    "sales_erp": {
        "command": sys.executable,
        "args": ["-m", "ERP.mcp_server"],
        "transport": "stdio",
    },
    # Add more MCP servers here later the same way, e.g.:
    # "inventory": {"command": sys.executable, "args": ["-m", "Inventory.mcp_server"], "transport": "stdio"},
}


class MCPToolSource:
    """Owns one persistent MCP session per configured server for the
    life of the app. Call `await start()` once at startup (returns the
    loaded tool list) and `await stop()` once at shutdown."""

    def __init__(self, servers: dict | None = None):
        self._servers = servers or MCP_SERVERS
        self._client = MultiServerMCPClient(self._servers)
        self._stack = AsyncExitStack()
        self.tools: list = []

    async def start(self) -> list:
        tools = []
        for server_name in self._servers:
            session = await self._stack.enter_async_context(self._client.session(server_name))
            server_tools = await load_mcp_tools(session)
            tools.extend(server_tools)
        self.tools = tools
        return self.tools

    async def stop(self):
        await self._stack.aclose()


mcp_tool_source = MCPToolSource()
