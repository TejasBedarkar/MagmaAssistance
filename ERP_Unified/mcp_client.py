import sys
from contextlib import AsyncExitStack

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools

MCP_SERVERS = {
    "erpnext_unified": {
        "command": sys.executable,
        "args": ["-m", "ERP_Unified.mcp_server"],
        "transport": "stdio",
    },
}


class UnifiedMCPToolSource:
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


unified_mcp_tool_source = UnifiedMCPToolSource()
