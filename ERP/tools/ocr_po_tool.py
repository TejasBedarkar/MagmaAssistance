"""
ERP/tools/ocr_po_tool.py

Tool to automatically match OCR extracted Purchase Order data 
with ERPNext database and create a Purchase Order document.
Auto-creates Supplier and Items if they don't exist in ERPNext.
"""

import os
import logging
import datetime
from datetime import datetime as dt
from typing import Dict, Any, List
from langchain_core.tools import tool

# Import client from your actual project structure
from ERP.erp_client import erp_client

logger = logging.getLogger("ocr-po-tool")


def sanitize_date(date_str: str) -> str:
    """
    Converts fuzzy/OCR date formats into strict YYYY-MM-DD format.
    Guarantees schedule_date is NEVER in the past compared to today's date.
    """
    today = datetime.date.today()
    target_date = None

    if date_str and str(date_str).strip():
        clean_str = str(date_str).strip().replace('.', '/').replace('-', '/')
        for fmt in ('%Y/%m/%d', '%d/%m/%Y', '%m/%d/%Y', '%Y-%m-%d', '%d-%m-%Y'):
            try:
                parsed_dt = dt.strptime(clean_str, fmt).date()
                target_date = parsed_dt
                break
            except ValueError:
                pass

    if not target_date:
        target_date = today + datetime.timedelta(days=7)

    if target_date < today:
        logger.warning(f"Parsed schedule date ({target_date}) is in the past. Overriding to today ({today}).")
        target_date = today

    return target_date.strftime('%Y-%m-%d')


@tool
def process_ocr_po_and_create_order(
    vendor_name: str,
    items: List[Dict[str, Any]],
    po_number: str = "",
    delivery_date: str = "",
    remarks: str = ""
) -> str:
    """
    Takes extracted OCR PO details, matches Supplier & Item Codes with ERPNext, 
    and creates a Purchase Order draft in ERPNext. Auto-creates missing Supplier and Items.
    """
    if not erp_client.base_url:
        return "Error: ERPNext integration client is not configured properly in .env."

    try:
        transaction_date = datetime.date.today().strftime('%Y-%m-%d')
        valid_schedule_date = sanitize_date(delivery_date)

        # -------------------------------------------------------------
        # 1. Match or Auto-Create Supplier in ERPNext
        # -------------------------------------------------------------
        suppliers = erp_client.get_list(
            "Supplier", 
            filters=[["supplier_name", "like", f"%{vendor_name}%"]], 
            fields=["name", "supplier_name"]
        )
        
        if suppliers:
            supplier_id = suppliers[0]["name"]
            logger.info(f"Matched existing supplier: {supplier_id}")
        else:
            logger.info(f"Supplier '{vendor_name}' not found. Auto-creating...")
            new_supplier = erp_client.create_doc("Supplier", {
                "supplier_name": vendor_name,
                "supplier_group": "All Supplier Groups"
            })
            supplier_id = new_supplier.get("name", vendor_name)

        # -------------------------------------------------------------
        # 2. Match or Auto-Create Line Items in ERPNext
        # -------------------------------------------------------------
        po_items = []
        for item in items:
            desc = item.get("description") or item.get("item_code") or "Standard Item"
            desc = str(desc).strip()
            
            raw_qty = float(item.get("qty", 1.0))
            rate = float(item.get("rate", 0.0))
            extracted_uom = item.get("uom") or "Nos"

            # Safe Quantities handling for Nos UOM vs Decimal UOMs
            if str(extracted_uom).strip().lower() in ["nos", "nos.", "no", "number", "numbers"]:
                qty = int(round(raw_qty)) if raw_qty > 0 else 1
                default_uom = "Nos"
            else:
                qty = raw_qty
                default_uom = extracted_uom
            
            item_match = erp_client.get_list(
                "Item",
                filters=[["item_name", "like", f"%{desc}%"]],
                fields=["name", "item_code", "item_name", "stock_uom"]
            )
            
            if item_match:
                item_code = item_match[0]["name"]
                item_uom = item_match[0].get("stock_uom") or default_uom
                logger.info(f"Matched existing item: {item_code}")
            else:
                logger.info(f"Item '{desc}' not found. Auto-creating...")
                clean_code = desc.replace(" ", "-").replace("/", "-")[:40]
                new_item = erp_client.create_doc("Item", {
                    "item_code": clean_code,
                    "item_name": desc,
                    "item_group": "All Item Groups",
                    "stock_uom": default_uom
                })
                item_code = new_item.get("name") or clean_code
                item_uom = default_uom

            po_items.append({
                "item_code": item_code,
                "qty": qty,
                "rate": rate,
                "uom": item_uom,
                "stock_uom": item_uom,
                "conversion_factor": 1.0,
                "schedule_date": valid_schedule_date
            })

        # -------------------------------------------------------------
        # 3. Dynamic Company Name Fallback
        # -------------------------------------------------------------
        company_name = getattr(erp_client, "company_name", None) or os.environ.get("ERPNEXT_COMPANY")
        if not company_name:
            comp_list = erp_client.get_list("Company", fields=["name"])
            if comp_list:
                company_name = comp_list[0]["name"]
            else:
                company_name = "Magnadata PVT. LTD."

        # -------------------------------------------------------------
        # 4. Construct Purchase Order Payload
        # -------------------------------------------------------------
        po_doc = {
            "doctype": "Purchase Order",
            "supplier": supplier_id,
            "transaction_date": transaction_date,
            "schedule_date": valid_schedule_date,
            "company": company_name,
            "buying_price_list": "Standard Buying",
            "po_no": po_number,
            "items": po_items,
            "remarks": f"Automatically generated via AI Vision OCR. External PO Ref: {po_number}. {remarks}"
        }

        # -------------------------------------------------------------
        # 5. Create Purchase Order Document
        # -------------------------------------------------------------
        res = erp_client.create_doc("Purchase Order", po_doc)
        created_po_name = res.get("name", "Draft")

        return f"Successfully created Purchase Order '{created_po_name}' in Magnadata for Supplier '{vendor_name}'."

    except Exception as e:
        logger.exception("Failed to create Purchase Order in ERPNext")
        return f"Failed to create Purchase Order in ERPNext: {str(e)}"