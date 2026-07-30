"""
ERP/tools/__init__.py

Central place that collects every domain's tools into one list, which
ToolRAG indexes. Add a new domain by creating a file here (e.g.
sales_tools.py, inventory_write_tools.py, hr_write_tools.py) that exports
a list of @tool-decorated functions, then add it below.

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

from .sales_write_tools import (
    SALES_WRITE_TOOLS,
    REQUIRED_FIELDS as SALES_WRITE_REQUIRED_FIELDS,
    FIELD_PARSERS as SALES_WRITE_FIELD_PARSERS,
)
from .inventory_write_tools import (
    INVENTORY_WRITE_TOOLS,
    REQUIRED_FIELDS as INVENTORY_REQUIRED_FIELDS,
    FIELD_PARSERS as INVENTORY_FIELD_PARSERS,
)
from .hr_write_tools import (
    HR_WRITE_TOOLS,
    REQUIRED_FIELDS as HR_REQUIRED_FIELDS,
    FIELD_PARSERS as HR_FIELD_PARSERS,
)
from .accounts_write_tools import (
    ACCOUNTS_WRITE_TOOLS,
    REQUIRED_FIELDS as ACCOUNTS_REQUIRED_FIELDS,
    FIELD_PARSERS as ACCOUNTS_FIELD_PARSERS,
)
from .purchase_write_tools import (
    PURCHASE_WRITE_TOOLS,
    REQUIRED_FIELDS as PURCHASE_REQUIRED_FIELDS,
    FIELD_PARSERS as PURCHASE_FIELD_PARSERS,
)
from .manufacturing_write_tools import (
    MANUFACTURING_WRITE_TOOLS,
    REQUIRED_FIELDS as MANUFACTURING_REQUIRED_FIELDS,
    FIELD_PARSERS as MANUFACTURING_FIELD_PARSERS,
)
from .manufacturing_sub_write_tools import (
    MANUFACTURING_SUB_WRITE_TOOLS,
    REQUIRED_FIELDS as MANUFACTURING_SUB_WRITE_REQUIRED_FIELDS,
    FIELD_PARSERS as MANUFACTURING_SUB_WRITE_FIELD_PARSERS,
)
from .manufacturing_read_tools import (
    MANUFACTURING_READ_TOOLS,
    REQUIRED_FIELDS as MANUFACTURING_READ_REQUIRED_FIELDS,
    FIELD_PARSERS as MANUFACTURING_READ_FIELD_PARSERS,
)
from .manufacturing_sub_read_tools import (
    MANUFACTURING_SUB_READ_TOOLS,
    REQUIRED_FIELDS as MANUFACTURING_SUB_READ_REQUIRED_FIELDS,
    FIELD_PARSERS as MANUFACTURING_SUB_READ_FIELD_PARSERS,
)
from .capabilities_tools import CAPABILITY_TOOLS
ALL_TOOLS = [
    *SALES_WRITE_TOOLS,
    *INVENTORY_WRITE_TOOLS,
    *HR_WRITE_TOOLS,
    *ACCOUNTS_WRITE_TOOLS,
    *PURCHASE_WRITE_TOOLS,
    *MANUFACTURING_WRITE_TOOLS,
    *MANUFACTURING_SUB_WRITE_TOOLS,
    *MANUFACTURING_READ_TOOLS,
    *MANUFACTURING_SUB_READ_TOOLS,
    *CAPABILITY_TOOLS,
]

ALL_REQUIRED_FIELDS = {
    **SALES_WRITE_REQUIRED_FIELDS,
    **INVENTORY_REQUIRED_FIELDS,
    **HR_REQUIRED_FIELDS,
    **ACCOUNTS_REQUIRED_FIELDS,
    **PURCHASE_REQUIRED_FIELDS,
    **MANUFACTURING_REQUIRED_FIELDS,
    **MANUFACTURING_SUB_WRITE_REQUIRED_FIELDS,
    **MANUFACTURING_READ_REQUIRED_FIELDS,
    **MANUFACTURING_SUB_READ_REQUIRED_FIELDS,
}

ALL_FIELD_PARSERS = {
    **SALES_WRITE_FIELD_PARSERS,
    **INVENTORY_FIELD_PARSERS,
    **HR_FIELD_PARSERS,
    **ACCOUNTS_FIELD_PARSERS,
    **PURCHASE_FIELD_PARSERS,
    **MANUFACTURING_FIELD_PARSERS,
    **MANUFACTURING_SUB_WRITE_FIELD_PARSERS,
    **MANUFACTURING_READ_FIELD_PARSERS,
    **MANUFACTURING_SUB_READ_FIELD_PARSERS,
}

# Add more domains as you build them, e.g.:
# from .support_tools import (
#     SUPPORT_TOOLS,
#     REQUIRED_FIELDS as SUPPORT_REQUIRED_FIELDS,
#     FIELD_PARSERS as SUPPORT_FIELD_PARSERS,
# )
# ALL_TOOLS = [*ALL_TOOLS, *SUPPORT_TOOLS]
# ALL_REQUIRED_FIELDS = {**ALL_REQUIRED_FIELDS, **SUPPORT_REQUIRED_FIELDS}
# ALL_FIELD_PARSERS = {**ALL_FIELD_PARSERS, **SUPPORT_FIELD_PARSERS}