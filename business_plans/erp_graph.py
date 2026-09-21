"""Read-only exploration of ERPNext document relationships and state.

The explorer dynamically follows metadata-declared Link, Dynamic Link, and
child Table fields on explicitly selected or active records. It inspects
live stock (Bin) and default BOMs without hardcoding module sequences.
"""

from collections.abc import Iterable
from typing import Any, Optional


def _reference(doctype: str, name: str, company: str | None = None) -> dict[str, str | None]:
    return {"doctype": doctype, "name": name, "company": company}


def _iter_link_values(value: Any) -> Iterable[str]:
    if isinstance(value, str) and value.strip():
        yield value.strip()
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, str) and item.strip():
                yield item.strip()


class ERPRelationshipExplorer:
    """Build a grounded evidence graph from live, permission-checked ERP records."""

    def __init__(self, client, *, max_entities: int = 50, max_edges: int = 120):
        self.client = client
        self.max_entities = max_entities
        self.max_edges = max_edges
        self._meta_cache: dict[str, dict[str, Any]] = {}

    def _get_meta(self, doctype: str) -> dict[str, Any]:
        if doctype not in self._meta_cache:
            try:
                self._meta_cache[doctype] = self.client.get_meta(doctype) or {}
            except Exception:
                self._meta_cache[doctype] = {}
        return self._meta_cache[doctype]

    def explore(self, roots: list[dict[str, Any]]) -> dict[str, Any]:
        """Return nodes, metadata-derived edges (including child tables), and read warnings."""
        nodes: dict[tuple[str, str], dict[str, Any]] = {}
        edges: list[dict[str, Any]] = []
        warnings: list[str] = []

        for root in roots[: self.max_entities]:
            doctype, name = str(root.get("doctype", "")).strip(), str(root.get("name", "")).strip()
            if not doctype or not name:
                warnings.append("Skipped an entity without an exact DocType and name.")
                continue
            self._add_root(nodes, doctype, name, root.get("company"), warnings)

        for (doctype, name), node in list(nodes.items()):
            if len(edges) >= self.max_edges or node.get("read_error"):
                continue
            self._collect_links(nodes, edges, node, warnings)

        return {
            "nodes": list(nodes.values()),
            "edges": edges[: self.max_edges],
            "warnings": warnings,
            "limits": {"max_entities": self.max_entities, "max_edges": self.max_edges, "depth": 1},
        }

    def _add_root(self, nodes: dict, doctype: str, name: str, company: str | None, warnings: list[str]) -> None:
        key = (doctype, name)
        if key in nodes:
            return
        node = _reference(doctype, name, company)
        try:
            node["document"] = self.client.get_doc(doctype, name)
            node["metadata"] = self._get_meta(doctype)
        except Exception as exc:
            node["read_error"] = str(exc)
            warnings.append(f"Could not read {doctype} '{name}': {exc}")
        nodes[key] = node

    def _collect_links(self, nodes: dict, edges: list, node: dict[str, Any], warnings: list[str]) -> None:
        document = node.get("document") or {}
        metadata = node.get("metadata") or {}
        if not isinstance(document, dict):
            return

        for field in metadata.get("fields", []) or []:
            if len(edges) >= self.max_edges:
                return
            fieldname = field.get("fieldname")
            fieldtype = field.get("fieldtype")
            if not fieldname:
                continue

            # 1. Direct Link / Dynamic Link fields on parent document
            if fieldtype in {"Link", "Dynamic Link"}:
                target_doctype = field.get("options")
                if fieldtype == "Dynamic Link":
                    target_doctype = document.get(target_doctype) if target_doctype else None
                if not isinstance(target_doctype, str) or not target_doctype.strip():
                    continue
                for target_name in _iter_link_values(document.get(fieldname)):
                    edge = {
                        "from": _reference(node["doctype"], node["name"], node.get("company")),
                        "to": _reference(target_doctype, target_name),
                        "fieldname": fieldname,
                        "relationship": "erp_link",
                    }
                    edges.append(edge)
                    nodes.setdefault((target_doctype, target_name), _reference(target_doctype, target_name))

            # 2. Child Table Link fields (e.g. items on Sales Order, BOM, Production Plan)
            elif fieldtype == "Table":
                child_doctype = field.get("options")
                child_rows = document.get(fieldname)
                if not child_doctype or not isinstance(child_rows, list):
                    continue
                child_meta = self._get_meta(child_doctype)
                child_link_fields = [
                    f for f in (child_meta.get("fields") or [])
                    if f.get("fieldtype") in {"Link", "Dynamic Link"} and f.get("fieldname")
                ]

                for row in child_rows:
                    if not isinstance(row, dict) or len(edges) >= self.max_edges:
                        break
                    for c_field in child_link_fields:
                        c_fname = c_field["fieldname"]
                        c_target_doctype = c_field.get("options")
                        if c_field.get("fieldtype") == "Dynamic Link":
                            c_target_doctype = row.get(c_target_doctype) if c_target_doctype else None
                        if not isinstance(c_target_doctype, str) or not c_target_doctype.strip():
                            continue
                        for target_name in _iter_link_values(row.get(c_fname)):
                            edge = {
                                "from": _reference(node["doctype"], node["name"], node.get("company")),
                                "to": _reference(c_target_doctype, target_name),
                                "fieldname": f"{fieldname}.{c_fname}",
                                "relationship": "child_table_link",
                                "child_row": {
                                    "qty": row.get("qty"),
                                    "stock_uom": row.get("stock_uom") or row.get("uom"),
                                    "rate": row.get("rate"),
                                    "warehouse": row.get("warehouse"),
                                }
                            }
                            edges.append(edge)
                            nodes.setdefault((c_target_doctype, target_name), _reference(c_target_doctype, target_name))

    def get_item_stock_overview(self, item_code: str) -> dict[str, Any]:
        """Fetch real-time stock balances across warehouses from Bin records."""
        try:
            bins = self.client.get_list(
                "Bin",
                filters={"item_code": item_code},
                fields=["warehouse", "actual_qty", "reserved_qty", "projected_qty"]
            )
            actual_total = sum(float(b.get("actual_qty") or 0) for b in bins)
            reserved_total = sum(float(b.get("reserved_qty") or 0) for b in bins)
            projected_total = sum(float(b.get("projected_qty") or 0) for b in bins)
            return {
                "item_code": item_code,
                "actual_qty": actual_total,
                "reserved_qty": reserved_total,
                "projected_qty": projected_total,
                "warehouses": bins,
            }
        except Exception as exc:
            return {
                "item_code": item_code,
                "actual_qty": 0.0,
                "reserved_qty": 0.0,
                "projected_qty": 0.0,
                "warehouses": [],
                "error": str(exc),
            }

    def get_item_default_bom(self, item_code: str) -> Optional[dict[str, Any]]:
        """Find the active default BOM and its required raw materials for an item."""
        try:
            boms = self.client.get_list(
                "BOM",
                filters={"item": item_code, "is_default": 1, "is_active": 1, "docstatus": 1},
                fields=["name", "item", "quantity", "company"]
            )
            if not boms:
                # Fallback: check any active BOM for the item
                boms = self.client.get_list(
                    "BOM",
                    filters={"item": item_code, "is_active": 1, "docstatus": 1},
                    fields=["name", "item", "quantity", "company"]
                )
            if not boms:
                return None

            bom_name = boms[0]["name"]
            bom_doc = self.client.get_doc("BOM", bom_name)
            raw_materials = []
            for item in bom_doc.get("items", []):
                raw_materials.append({
                    "item_code": item.get("item_code"),
                    "item_name": item.get("item_name"),
                    "qty": float(item.get("qty") or 0),
                    "stock_uom": item.get("stock_uom") or item.get("uom"),
                    "rate": float(item.get("rate") or 0),
                })
            return {
                "bom_name": bom_name,
                "output_item": item_code,
                "base_quantity": float(bom_doc.get("quantity") or 1.0),
                "raw_materials": raw_materials,
            }
        except Exception:
            return None
