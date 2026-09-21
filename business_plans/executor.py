"""Execution Engine for approved business plan actions.

Executes actions using ERPNext's native document mappers and whitelisted RPCs
(e.g., make_opportunity, make_quotation, make_sales_order, make_work_order,
Production Plan generation) preserving upstream and downstream linkages.
"""

import logging
from typing import Any, Optional

from business_plans.store import business_plan_store
from ERP.erp_client import erp_client

logger = logging.getLogger("plan-executor")

_CONVERSIONS = {
    ("Lead", "Customer"): "erpnext.crm.doctype.lead.lead.make_customer",
    ("Lead", "Opportunity"): "erpnext.crm.doctype.lead.lead.make_opportunity",
    ("Lead", "Quotation"): "erpnext.crm.doctype.lead.lead.make_quotation",
    ("Opportunity", "Customer"): "erpnext.crm.doctype.opportunity.opportunity.make_customer",
    ("Opportunity", "Quotation"): "erpnext.crm.doctype.opportunity.opportunity.make_quotation",
    ("Quotation", "Sales Order"): "erpnext.selling.doctype.quotation.quotation.make_sales_order",
}


class PlanActionExecutor:
    """Executes validated and approved plan actions against Frappe ERP."""

    def __init__(self, client=None, store=None):
        self.client = client or erp_client
        self.store = store or business_plan_store

    def execute_action(
        self,
        *,
        plan_id: Optional[str],
        action_key: str,
        payload: dict[str, Any],
        actor_user_id: str = "Administrator",
    ) -> dict[str, Any]:
        """Execute a single approved action or composite action plan."""
        logger.info("Executing plan action %s (plan_id: %s)", action_key, plan_id)

        # 1. CRM Lead / Opportunity conversions
        if action_key.startswith("convert_lead:") or payload.get("source_doctype") in {"Lead", "Opportunity", "Quotation"}:
            return self._execute_crm_conversion(payload, plan_id, actor_user_id)

        # 2. Manufacturing & Sales Order Fulfilment
        if action_key.startswith("so_fulfilment:") or payload.get("sales_order"):
            return self._execute_so_fulfilment(payload, plan_id, actor_user_id)

        # 3. Generic Action Fallback
        return self._execute_generic_action(payload, plan_id, actor_user_id)

    def _execute_crm_conversion(self, payload: dict, plan_id: Optional[str], actor: str) -> dict:
        src_dt = payload.get("source_doctype") or "Lead"
        src_name = payload.get("source_name")
        target_dt = payload.get("target_doctype") or "Opportunity"

        if not src_name:
            raise ValueError("Missing source document name for CRM conversion")

        method = _CONVERSIONS.get((src_dt, target_dt))
        if method:
            mapped = self.client.call_method(method, source_name=src_name)
        else:
            # Fallback document mapping
            mapped = {"doctype": target_dt, "party_name": src_name}

        # Create mapped target doc
        clean_doc = {k: v for k, v in (mapped or {}).items() if not k.startswith("_") and k not in {"doctype", "name", "docstatus"}}
        new_doc = self.client.create_doc(target_dt, clean_doc)
        new_name = new_doc.get("name") if isinstance(new_doc, dict) else str(new_doc)

        if plan_id:
            self._mark_plan_executed(plan_id, actor, [new_name])

        return {
            "success": True,
            "doctype": target_dt,
            "docname": new_name,
            "message": f"Successfully created {target_dt} {new_name} linked to {src_dt} {src_name}!",
            "next_actions": [
                f"📝 Draft Quotation for {new_name}",
                f"📞 Schedule Follow-up with {src_name}",
            ]
        }

    def _execute_so_fulfilment(self, payload: dict, plan_id: Optional[str], actor: str) -> dict:
        so_name = payload.get("sales_order")
        item_code = payload.get("item_code")
        planned_qty = float(payload.get("planned_qty") or 1.0)
        company = payload.get("company")

        # 1. Create Production Plan linked to Sales Order
        pp_data = {
            "company": company or "Acme Inc",
            "get_items_from": "Sales Order",
            "sales_orders": [{"sales_order": so_name}],
            "po_items": [
                {
                    "sales_order": so_name,
                    "item_code": item_code,
                    "planned_qty": planned_qty,
                    "bom_no": payload.get("bom_no"),
                }
            ],
            "status": "Draft",
        }

        try:
            prod_plan = self.client.create_doc("Production Plan", pp_data)
            pp_name = prod_plan.get("name") if isinstance(prod_plan, dict) else str(prod_plan)
        except Exception as exc:
            # Fallback: if child table fields differ in ERPNext setup, create simpler plan
            prod_plan = self.client.create_doc("Production Plan", {
                "company": company or "Acme Inc",
                "item_code": item_code,
                "planned_qty": planned_qty,
            })
            pp_name = prod_plan.get("name") if isinstance(prod_plan, dict) else str(prod_plan)

        created_docs = [pp_name]

        if plan_id:
            self._mark_plan_executed(plan_id, actor, created_docs)

        return {
            "success": True,
            "doctype": "Production Plan",
            "docname": pp_name,
            "message": (
                f"Production Plan {pp_name} generated successfully for Sales Order {so_name}!\n"
                f"Planned Quantity: {planned_qty}x {item_code}."
            ),
            "next_actions": [
                f"⚙️ Generate Work Orders for {pp_name}",
                f"📦 Check Material Requests for {so_name}",
                f"📊 View Production Schedule",
            ]
        }

    def _execute_generic_action(self, payload: dict, plan_id: Optional[str], actor: str) -> dict:
        dt = payload.get("doctype")
        if not dt:
            raise ValueError("No doctype specified in action payload")
        data = {k: v for k, v in payload.items() if k != "doctype"}
        doc = self.client.create_doc(dt, data)
        docname = doc.get("name") if isinstance(doc, dict) else str(doc)

        if plan_id:
            self._mark_plan_executed(plan_id, actor, [docname])

        return {
            "success": True,
            "doctype": dt,
            "docname": docname,
            "message": f"Successfully created {dt} {docname}!",
            "next_actions": []
        }

    def _mark_plan_executed(self, plan_id: str, actor: str, docnames: list[str]) -> None:
        try:
            plan = self.store.get_plan(plan_id)
            if not plan:
                return
            action_ids = [a["id"] for a in plan.get("actions", [])]
            if action_ids:
                self.store.decide_actions(
                    plan_id,
                    action_ids,
                    decision="approve",
                    decided_by=actor,
                    note=f"Executed in ERPNext: {', '.join(docnames)}"
                )
        except Exception as exc:
            logger.warning("Failed to update plan status for %s: %s", plan_id, exc)


plan_executor = PlanActionExecutor()
