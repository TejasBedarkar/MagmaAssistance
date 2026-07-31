"""
ERP/tools/manufacturing_bom_write_tools.py

Create/update tools for BOM-adjacent manufacturing setup data — Item,
BOM, Workstation Type, Workstation, Operation, Routing — on ERPNext's
DEFAULT REST API (POST/PUT /api/resource/<Doctype>) via
erp_client.create_doc() / update_doc() / submit_doc(). Same shape as
manufacturing_write_tools.py (Work Order/Production Plan/Job Card/Stock
Entry) and manufacturing_read_tools.py — kept in a separate file since
these are shop-floor/BOM *setup* data rather than production
*transactions*.

Confidence level per doctype (all six are real, long-standing stock
ERPNext doctypes, unlike the custom Item Lead Time / Master Production
Schedule / Sales Forecast doctypes in manufacturing_write_tools.py — so
field names here should be much more reliable, but Workstation Type and
the exact "job capacity" fieldname on Workstation are newer additions
I'm less certain about than Item/BOM/Operation/Routing):

  Item              item_code, item_name, item_group all standard,
                     high-confidence fieldnames. `stock_uom` is
                     typically ALSO mandatory on a stock ERPNext Item
                     even though it wasn't in your required-fields list
                     — included as optional here; if creation throws
                     MandatoryError: stock_uom, that confirms it and you
                     can either always supply it or set a default UOM
                     at the ERPNext level.

  BOM               Required: company, item (the item being
                     manufactured — NOT `item_code`; BOM's own fieldname
                     for this is literally `item`), items (component
                     list child table). The public tool param is named
                     `item_code` for a friendlier/consistent API and
                     rekeyed to `item` right before the API call, same
                     trick used for Production Plan's `po_items` and
                     Sales Forecast's `selected_items` elsewhere in this
                     project. Component rows: {"item_code": "...",
                     "qty": 10, "uom": "Nos", "rate": 100} — item_code
                     and qty required per row, uom/rate optional per row
                     (ERPNext fetches item defaults if omitted).
                     `quantity` (the BOM's own output quantity) defaults
                     to 1 if not given, matching ERPNext's own default.

  Workstation Type   BEST GUESS, lower confidence: `workstation_type`
                     (Data field, also the autoname/document title).
                     Verify the same way we fixed Item Lead Time earlier
                     — `frappe.get_meta("Workstation Type")` in bench
                     console — if creation errors.

  Workstation        workstation_name (Data, autoname) is high
                     confidence. "job capacity" is mapped to
                     `production_capacity` (Int) — ERPNext's actual
                     label for this field is "Production Capacity", so
                     this is a reasonable but not 100% certain mapping;
                     same bench-console check applies if it silently
                     doesn't save (like Item Lead Time's issue).

  Operation          operation_name (Data, autoname) — high confidence.

  Routing            routing_name (Data, autoname) — high confidence.
                     `operations` (child table of Routing's steps) is
                     NOT required per your spec, so left out of the
                     minimal create tool; can be added as an optional
                     `operations` list param later if needed.

Same conventions as manufacturing_write_tools.py:
  - specific, natural-language docstrings (ToolRAG embeds these).
  - never raises — failures are caught and turned into a short string.
  - optional args are Optional[...] = None, dropped by _payload() so
    updates only touch fields actually specified.
  - every create_* docstring tells the LLM not to ask for an ID, since
    ERPNext auto-generates document names on creation (same fix applied
    across manufacturing_write_tools.py after Sales Forecast asked for
    one unnecessarily).

Add this list to ERP/tools/__init__.py:
    from .manufacturing_bom_write_tools import MANUFACTURING_BOM_WRITE_TOOLS
    ALL_TOOLS = [..., *MANUFACTURING_BOM_WRITE_TOOLS]
"""

from typing import Optional

from langchain_core.tools import tool

from ERP.erp_client import erp_client


def _safe_call(label, fn):
    """Runs `fn`, returning a clean error string instead of raising if the
    ERP call fails for any reason (network, auth, validation, etc.)."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return f"Could not {label} in ERPNext right now ({exc})."


def _payload(**kwargs):
    """Drops keys whose value is None, so update_* tools only send the
    fields the caller actually specified instead of nulling out every
    field the user didn't mention."""
    return {k: v for k, v in kwargs.items() if v is not None}


def _num(value):
    value = str(value).strip()
    try:
        return float(value) if "." in value else int(value)
    except ValueError:
        return value


def _parse_bom_items_answer(text: str) -> list:
    """Parses a free-text answer to a BOM 'component list' slot-filling
    question into the list-of-dicts BOM's `items` child table expects.

    Expected format per component: 'item code, quantity, uom, rate'
    (uom and rate optional), multiple components separated by
    semicolons, e.g. 'RAW-001, 4, Nos, 50; RAW-002, 2, Kg, 120'. Falls
    back to leaving a value as a plain string if it isn't numeric,
    rather than dropping it, so a malformed number doesn't silently
    disappear.
    """
    rows = []
    for chunk in text.split(";"):
        chunk = chunk.strip()
        if not chunk:
            continue
        parts = [p.strip() for p in chunk.split(",") if p.strip()]
        if not parts:
            continue

        row = {"item_code": parts[0]}
        if len(parts) >= 2:
            row["qty"] = _num(parts[1])
        if len(parts) >= 3:
            row["uom"] = parts[2]
        if len(parts) >= 4:
            row["rate"] = _num(parts[3])
        rows.append(row)

    return rows


# ---------------------------------------------------------------------
# Item
# ---------------------------------------------------------------------

@tool
def create_item(
    item_code: str,
    item_name: str,
    item_group: str,
    stock_uom: Optional[str] = None,
):
    """Create a new Item master. `item_code`, `item_name`, and
    `item_group` are required. `stock_uom` (e.g. 'Nos', 'Kg') is
    optional here but is commonly mandatory on ERPNext's Item doctype —
    include it if the user mentions a unit of measure, or if creation
    fails with a stock_uom mandatory error. Use for requests like
    'create an item ITEM-FG-001 named Steel Bracket in the Finished
    Goods item group'. Do not ask the user for an ID — the item_code
    they give you IS the ID; ERPNext doesn't auto-generate it."""

    def run():
        data = _payload(
            item_code=item_code,
            item_name=item_name,
            item_group=item_group,
            stock_uom=stock_uom,
        )
        result = erp_client.create_doc("Item", data)
        return str(result)

    return _safe_call(f"create item {item_code}", run)


@tool
def update_item(
    item_code: str,
    item_name: Optional[str] = None,
    item_group: Optional[str] = None,
    stock_uom: Optional[str] = None,
):
    """Update an existing Item identified by its `item_code`. Only the
    fields provided are changed."""

    def run():
        data = _payload(item_name=item_name, item_group=item_group, stock_uom=stock_uom)
        if not data:
            return "Nothing to update — no fields were provided."
        result = erp_client.update_doc("Item", item_code, data)
        return str(result)

    return _safe_call(f"update item {item_code}", run)


# ---------------------------------------------------------------------
# BOM
# ---------------------------------------------------------------------

@tool
def create_bom(
    company: str,
    item_code: str,
    items: list,
    quantity: Optional[float] = None,
    submit: bool = False,
):
    """Create a new Bill of Materials (BOM). `company`, `item_code` (the
    item this BOM manufactures), and `items` (the component list) are
    all required. `items` is a list of components, each a dict like
    {"item_code": "RAW-001", "qty": 4, "uom": "Nos", "rate": 50} — qty
    is required per row, uom/rate are optional (ERPNext fetches the
    item's defaults if omitted). `quantity` is the BOM's own output
    quantity (how many finished units this BOM produces), defaults to 1
    if not given. Set `submit` true to submit it immediately — a BOM
    usually needs to be submitted before it can be selected as an
    item's default/active BOM elsewhere (e.g. by create_work_order's
    auto-fetch) — rather than leave it as a draft. Use for requests like
    'create a BOM for ITEM-FG-001 using 4 units of RAW-001 and 2 units
    of RAW-002'. Do not ask the user for an ID — ERPNext auto-generates
    the document name/ID on creation."""

    def run():
        data = _payload(
            company=company,
            item=item_code,
            quantity=quantity,
            items=items,
        )
        result = erp_client.create_doc("BOM", data)

        if submit:
            bom_id = result.get("name")
            try:
                result = erp_client.submit_doc("BOM", bom_id)
            except Exception as exc:  # noqa: BLE001
                return str(result) + f" (created as draft; submit failed: {exc})"

        return str(result)

    return _safe_call(f"create BOM for {item_code}", run)


@tool
def update_bom(
    bom_id: str,
    items: Optional[list] = None,
    quantity: Optional[float] = None,
):
    """Update an existing DRAFT BOM identified by its ID (e.g.
    'BOM-ITEM-FG-001-001'). Only the fields provided are changed —
    passing `items` replaces the existing component list rather than
    merging with it. Only works while the BOM is still a draft."""

    def run():
        data = _payload(quantity=quantity)
        if items is not None:
            data["items"] = items
        if not data:
            return "Nothing to update — no fields were provided."
        result = erp_client.update_doc("BOM", bom_id, data)
        return str(result)

    return _safe_call(f"update BOM {bom_id}", run)


# ---------------------------------------------------------------------
# Workstation Type
# ---------------------------------------------------------------------

@tool
def create_workstation_type(workstation_type_name: str):
    """Create a new Workstation Type — a category used to group
    workstations that share the same capabilities/rates (e.g.
    'Cutting Machines', 'Assembly Stations'). `workstation_type_name` is
    required. Use for requests like 'create a workstation type called
    Cutting Machines'. Do not ask the user for an ID — the name they
    give you IS the ID; ERPNext doesn't auto-generate it."""

    def run():
        # Also setting `name` explicitly in case Workstation Type turns
        # out to use "prompt" naming like Operation did, rather than
        # deriving it from the workstation_type field automatically.
        data = _payload(name=workstation_type_name, workstation_type=workstation_type_name)
        result = erp_client.create_doc("Workstation Type", data)
        return str(result)

    return _safe_call(f"create workstation type {workstation_type_name}", run)


# ---------------------------------------------------------------------
# Workstation
# ---------------------------------------------------------------------

@tool
def create_workstation(workstation_name: str, job_capacity: int):
    """Create a new Workstation. `workstation_name` and `job_capacity`
    (how many jobs it can run at once) are required. Use for requests
    like 'create a workstation called Assembly Line 1 with capacity for
    2 jobs at once'. Do not ask the user for an ID — the name they give
    you IS the ID; ERPNext doesn't auto-generate it."""

    def run():
        # Also setting `name` explicitly in case Workstation turns out
        # to use "prompt" naming like Operation did, rather than
        # deriving it from workstation_name automatically.
        data = _payload(
            name=workstation_name,
            workstation_name=workstation_name,
            production_capacity=job_capacity,
        )
        result = erp_client.create_doc("Workstation", data)
        return str(result)

    return _safe_call(f"create workstation {workstation_name}", run)


@tool
def update_workstation(workstation_name: str, job_capacity: Optional[int] = None):
    """Update an existing Workstation identified by its name/ID. Only
    the fields provided are changed."""

    def run():
        data = _payload(production_capacity=job_capacity)
        if not data:
            return "Nothing to update — no fields were provided."
        result = erp_client.update_doc("Workstation", workstation_name, data)
        return str(result)

    return _safe_call(f"update workstation {workstation_name}", run)


# ---------------------------------------------------------------------
# Operation
# ---------------------------------------------------------------------

@tool
def create_operation(operation_name: str):
    """Create a new Operation — a reusable shop-floor step (e.g.
    'Cutting', 'Assembly', 'Painting') that gets used in Routings and
    BOMs. `operation_name` is required. Use for requests like 'create an
    operation called Painting'. Do not ask the user for an ID — the name
    they give you IS the ID; ERPNext doesn't auto-generate it."""

    def run():
        # Operation's naming rule is "prompt" (confirmed by a live
        # "Please set the document name" ValidationError) — ERPNext
        # doesn't derive the document name from `operation_name`
        # automatically the way Item/Workstation/Routing do from their
        # own name fields, so `name` has to be set explicitly too.
        data = _payload(name=operation_name, operation_name=operation_name)
        result = erp_client.create_doc("Operation", data)
        return str(result)

    return _safe_call(f"create operation {operation_name}", run)


# ---------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------

@tool
def create_routing(routing_name: str):
    """Create a new Routing — a reusable sequence of operations that can
    be attached to a BOM. `routing_name` is required. Use for requests
    like 'create a routing called Standard Assembly Routing'. Do not ask
    the user for an ID — the name they give you IS the ID; ERPNext
    doesn't auto-generate it."""

    def run():
        # Also setting `name` explicitly in case Routing turns out to
        # use "prompt" naming like Operation did, rather than deriving
        # it from routing_name automatically.
        data = _payload(name=routing_name, routing_name=routing_name)
        result = erp_client.create_doc("Routing", data)
        return str(result)

    return _safe_call(f"create routing {routing_name}", run)


MANUFACTURING_BOM_WRITE_TOOLS = [
    create_item,
    update_item,
    create_bom,
    update_bom,
    create_workstation_type,
    create_workstation,
    update_workstation,
    create_operation,
    create_routing,
]


# ---------------------------------------------------------------------
# Slot-filling metadata (consumed by ERP/server.py)
# ---------------------------------------------------------------------
REQUIRED_FIELDS = {
    "create_item": [
        ("item_code", "What should the item code be?"),
        ("item_name", "What's the item's name?"),
        ("item_group", "Which item group does it belong to?"),
    ],
    "update_item": [
        ("item_code", "Which item should I update? (its item code)"),
    ],
    "create_bom": [
        ("company", "Which company is this BOM for?"),
        ("item_code", "Which item does this BOM manufacture?"),
        (
            "items",
            "What components does it need? Give each as 'item code, "
            "quantity, uom, rate' (uom/rate optional) — separate "
            "multiple components with a semicolon, e.g. "
            "'RAW-001, 4, Nos, 50; RAW-002, 2, Kg, 120'.",
        ),
    ],
    "update_bom": [
        ("bom_id", "Which BOM should I update? (its ID)"),
    ],
    "create_workstation_type": [
        ("workstation_type_name", "What should the workstation type be called?"),
    ],
    "create_workstation": [
        ("workstation_name", "What should the workstation be called?"),
        ("job_capacity", "How many jobs can it run at once (job capacity)?"),
    ],
    "update_workstation": [
        ("workstation_name", "Which workstation should I update? (its name)"),
    ],
    "create_operation": [
        ("operation_name", "What should the operation be called?"),
    ],
    "create_routing": [
        ("routing_name", "What should the routing be called?"),
    ],
}

FIELD_PARSERS = {
    ("create_bom", "items"): _parse_bom_items_answer,
}