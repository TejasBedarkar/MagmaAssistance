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


ALL_REQUIRED_FIELDS works the same way for slot-filling metadata: each
domain's tools module can export its own REQUIRED_FIELDS dict (see
sales_write_tools.py for the format), and it just gets merged in below.
ERP/server.py reads ALL_REQUIRED_FIELDS to decide when to interactively
ask the user for missing fields instead of guessing or failing, and
ALL_FIELD_PARSERS for the handful of fields (like a quotation's `items`)
whose slot-filling answer needs parsing into something other than a
plain string before being passed to the tool.
"""

from .sales_tools import SALES_TOOLS
from .sales_write_tools import (
    SALES_WRITE_TOOLS,
    REQUIRED_FIELDS as SALES_WRITE_REQUIRED_FIELDS,
    FIELD_PARSERS as SALES_WRITE_FIELD_PARSERS,
)
from .lead_tools import LEAD_TOOLS

ALL_TOOLS = [*SALES_TOOLS, *SALES_WRITE_TOOLS, *LEAD_TOOLS]

ALL_REQUIRED_FIELDS = {
    **SALES_WRITE_REQUIRED_FIELDS,
}

ALL_FIELD_PARSERS = {
    **SALES_WRITE_FIELD_PARSERS,
}

# Add more domains as you build them, e.g.:
# from .inventory_tools import (
#     INVENTORY_TOOLS,
#     REQUIRED_FIELDS as INVENTORY_REQUIRED_FIELDS,
#     FIELD_PARSERS as INVENTORY_FIELD_PARSERS,
# )
# ALL_TOOLS = [*SALES_TOOLS, *SALES_WRITE_TOOLS, *INVENTORY_TOOLS]
# ALL_REQUIRED_FIELDS = {**SALES_WRITE_REQUIRED_FIELDS, **INVENTORY_REQUIRED_FIELDS}
# ALL_FIELD_PARSERS = {**SALES_WRITE_FIELD_PARSERS, **INVENTORY_FIELD_PARSERS}

