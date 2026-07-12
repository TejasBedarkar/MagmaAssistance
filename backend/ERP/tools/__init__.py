"""
ERP/tools/__init__.py

Central place that collects every domain's tools into one list, which
ToolRAG indexes. Add a new domain by creating a file here (e.g.
sales_tools.py, inventory_tools.py, hr_tools.py) that exports a list of
@tool-decorated functions, then add it below.

Example, once you've written ERP/tools/sales_tools.py:

    from .sales_tools import SALES_TOOLS
    ALL_TOOLS = [*SALES_TOOLS]

And later, to extend beyond sales:

    from .sales_tools import SALES_TOOLS
    from .inventory_tools import INVENTORY_TOOLS
    ALL_TOOLS = [*SALES_TOOLS, *INVENTORY_TOOLS]

Nothing else in the project (ToolRAG, the agent loop) needs to change when
you add a domain — they just consume whatever ALL_TOOLS ends up being.
"""

from .sales_tools import SALES_TOOLS

ALL_TOOLS = [*SALES_TOOLS]

# Add more domains as you build them, e.g.:
# from .inventory_tools import INVENTORY_TOOLS
# ALL_TOOLS = [*SALES_TOOLS, *INVENTORY_TOOLS]
