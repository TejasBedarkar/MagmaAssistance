"""
ERP/tools/accounts_write_tools.py

Create/update tools for the Accounts module, on ERPNext's DEFAULT REST
API (POST/PUT /api/resource/<Doctype>) via erp_client.create_doc() /
update_doc() / submit_doc() — same approach as sales_write_tools.py, just
for a different set of doctypes.

Field mapping notes (stock ERPNext v16 fieldnames):

  Sales Invoice   customer, due_date, items (child table: item_code,
                  qty, rate) — submittable (docstatus 0 -> 1)
  Payment Entry   payment_type ("Receive"/"Pay"), party_type ("Customer"/
                  "Supplier"), party, paid_amount, received_amount
                  (defaults to paid_amount for same-currency payments),
                  reference_no, reference_date — submittable
  Journal Entry   voucher_type (e.g. "Journal Entry"), posting_date,
                  accounts (child table: account,
                  debit_in_account_currency, credit_in_account_currency)
                  — submittable

`items` child-table rows for Sales Invoice follow ERPNext's standard
shape: {"item_code": "ITEM-001", "qty": 50, "rate": 1200}.

`accounts` child-table rows for Journal Entry follow ERPNext's standard
shape: {"account": "Cash - CO", "debit_in_account_currency": 5000} or
{"account": "Sales - CO", "credit_in_account_currency": 5000} — total
debits must equal total credits for the entry to submit.

Same conventions as sales_write_tools.py:
  - specific, natural-language docstrings (ToolRAG embeds these, and the
    LLM reads them to decide when to call the tool).
  - never raises — failures are caught and turned into a short string the
    LLM can relay honestly.
  - optional args are typed Optional[...] = None and resolved inside the
    function body so small local models passing explicit `null` don't
    trip Pydantic validation, and _payload() drops None values so an
    update only touches fields the caller actually specified.

Add this list to ERP/tools/__init__.py:
    from .accounts_write_tools import ACCOUNTS_WRITE_TOOLS
    ALL_TOOLS = [*SALES_TOOLS, *SALES_WRITE_TOOLS, *LEAD_TOOLS, *ACCOUNTS_WRITE_TOOLS]
"""

from datetime import date
from typing import Optional

from langchain_core.tools import tool

from ERP.erp_client import erp_client
from ERP.tools.sales_write_tools import _parse_items_answer


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


# ---------------------------------------------------------------------
# Sales Invoice
# ---------------------------------------------------------------------

@tool
def create_sales_invoice(
    customer: str,
    items: list,
    due_date: Optional[str] = None,
    submit: bool = False,
):
    """Create a new Sales Invoice for a customer. `customer` is the
    Customer ID (e.g. 'ABC Industries'). `items` is a list of line
    items, each a dict like {"item_code": "ITEM-001", "qty": 50, "rate":
    1200} — at least one item is required. `due_date` should be
    YYYY-MM-DD. Set `submit` true to submit it immediately rather than
    leave it as a draft — an unsubmitted invoice won't show up as
    outstanding/payable. Use for requests like 'invoice ABC Industries
    for 50 units of ITEM-001 at 1200 each'."""

    def run():
        data = _payload(
            customer=customer,
            posting_date=date.today().isoformat(),
            due_date=due_date,
            items=items,
        )
        result = erp_client.create_doc("Sales Invoice", data)

        if submit:
            invoice_id = result.get("name")
            try:
                result = erp_client.submit_doc("Sales Invoice", invoice_id)
            except Exception as exc:  # noqa: BLE001
                return str(result) + f" (created as draft; submit failed: {exc})"

        return str(result)

    return _safe_call(f"create sales invoice for {customer}", run)


@tool
def update_sales_invoice(
    sales_invoice_id: str,
    items: Optional[list] = None,
    due_date: Optional[str] = None,
):
    """Update an existing DRAFT Sales Invoice identified by its ID (e.g.
    'ACC-SINV-2026-00001'). Only the fields provided are changed —
    passing `items` replaces the existing item set rather than merging
    with it. Only works while the invoice is still a draft (docstatus
    0); a submitted invoice needs a Credit Note, not a plain update."""

    def run():
        data = _payload(items=items, due_date=due_date)
        if not data:
            return "Nothing to update — no fields were provided."
        result = erp_client.update_doc("Sales Invoice", sales_invoice_id, data)
        return str(result)

    return _safe_call(f"update sales invoice {sales_invoice_id}", run)


# ---------------------------------------------------------------------
# Payment Entry
# ---------------------------------------------------------------------

@tool
def create_payment_entry(
    party: str,
    paid_amount: float,
    payment_type: Optional[str] = None,
    party_type: Optional[str] = None,
    reference_no: Optional[str] = None,
    reference_date: Optional[str] = None,
    submit: bool = False,
):
    """Record a new Payment Entry — money received from a customer or
    paid to a supplier. `party` is the Customer/Supplier ID. `payment_type`
    should be 'Receive' (money coming in) or 'Pay' (money going out) —
    defaults to 'Receive'. `party_type` should be 'Customer' or
    'Supplier' — defaults to 'Customer' for 'Receive' and 'Supplier' for
    'Pay'. `reference_no`/`reference_date` are for the cheque/transaction
    reference, if any. Set `submit` true to submit it immediately rather
    than leave it as a draft — this is usually needed for it to actually
    apply against outstanding invoices. Use for requests like 'record a
    payment of 50000 received from ABC Industries'."""

    def run():
        resolved_payment_type = payment_type or "Receive"
        resolved_party_type = party_type or (
            "Customer" if resolved_payment_type == "Receive" else "Supplier"
        )
        data = _payload(
            payment_type=resolved_payment_type,
            party_type=resolved_party_type,
            party=party,
            paid_amount=paid_amount,
            received_amount=paid_amount,
            posting_date=date.today().isoformat(),
            reference_no=reference_no,
            reference_date=reference_date,
        )
        result = erp_client.create_doc("Payment Entry", data)

        if submit:
            payment_id = result.get("name")
            try:
                result = erp_client.submit_doc("Payment Entry", payment_id)
            except Exception as exc:  # noqa: BLE001
                return str(result) + f" (created as draft; submit failed: {exc})"

        return str(result)

    return _safe_call(f"create payment entry for {party}", run)


# ---------------------------------------------------------------------
# Journal Entry
# ---------------------------------------------------------------------

@tool
def create_journal_entry(
    accounts: list,
    voucher_type: Optional[str] = None,
    posting_date: Optional[str] = None,
    user_remark: Optional[str] = None,
    submit: bool = False,
):
    """Create a new Journal Entry — a manual double-entry accounting
    posting. `accounts` is a list of line items, each a dict like
    {"account": "Cash - CO", "debit_in_account_currency": 5000} or
    {"account": "Sales - CO", "credit_in_account_currency": 5000} — at
    least two lines are required, and total debits must equal total
    credits or the entry will fail to submit. `voucher_type` defaults to
    'Journal Entry'. `posting_date` should be YYYY-MM-DD, defaults to
    today. Set `submit` true to submit it immediately rather than leave
    it as a draft. Use for requests like 'post a journal entry debiting
    Cash 5000 and crediting Sales 5000'."""

    def run():
        data = _payload(
            voucher_type=voucher_type or "Journal Entry",
            posting_date=posting_date or date.today().isoformat(),
            accounts=accounts,
            user_remark=user_remark,
        )
        result = erp_client.create_doc("Journal Entry", data)

        if submit:
            entry_id = result.get("name")
            try:
                result = erp_client.submit_doc("Journal Entry", entry_id)
            except Exception as exc:  # noqa: BLE001
                return str(result) + f" (created as draft; submit failed: {exc})"

        return str(result)

    return _safe_call("create journal entry", run)


ACCOUNTS_WRITE_TOOLS = [
    create_sales_invoice,
    update_sales_invoice,
    create_payment_entry,
    create_journal_entry,
]


# ---------------------------------------------------------------------
# Slot-filling metadata (consumed by ERP/server.py)
# ---------------------------------------------------------------------
REQUIRED_FIELDS = {
    "create_sales_invoice": [
        ("customer", "Which customer is this invoice for?"),
        (
            "items",
            "What items should be on the invoice? Give each as "
            "'item code, quantity, rate' — separate multiple items with a "
            "semicolon, e.g. 'ITEM-001, 50, 1200; ITEM-002, 10, 500'.",
        ),
    ],
    "update_sales_invoice": [
        ("sales_invoice_id", "Which sales invoice should I update? (e.g. ACC-SINV-2026-00001)"),
    ],
    "create_payment_entry": [
        ("party", "Which customer or supplier is this payment for/from?"),
        ("paid_amount", "What's the payment amount?"),
    ],
    "create_journal_entry": [
        (
            "accounts",
            "What accounts should be debited/credited? Give each as "
            "'account, debit or credit, amount' — separate multiple lines "
            "with a semicolon, e.g. "
            "'Cash - CO, debit, 5000; Sales - CO, credit, 5000'.",
        ),
    ],
}


def _parse_accounts_answer(text: str) -> list:
    """Parses a free-text answer to an 'accounts' slot-filling question
    into the list-of-dicts shape create_journal_entry expects. Expected
    format per line: 'account, debit or credit, amount', multiple lines
    separated by semicolons, e.g. 'Cash - CO, debit, 5000; Sales - CO,
    credit, 5000'."""
    accounts = []
    for chunk in text.split(";"):
        chunk = chunk.strip()
        if not chunk:
            continue
        parts = [p.strip() for p in chunk.split(",") if p.strip()]
        if len(parts) < 3:
            continue

        account, side, amount = parts[0], parts[1].lower(), parts[2]
        try:
            amount_value = float(amount) if "." in amount else int(amount)
        except ValueError:
            amount_value = amount

        entry = {"account": account}
        if side.startswith("debit"):
            entry["debit_in_account_currency"] = amount_value
        else:
            entry["credit_in_account_currency"] = amount_value
        accounts.append(entry)

    return accounts


FIELD_PARSERS = {
    ("create_sales_invoice", "items"): _parse_items_answer,
    ("create_journal_entry", "accounts"): _parse_accounts_answer,
}
