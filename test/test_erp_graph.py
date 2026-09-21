from business_plans.erp_graph import ERPRelationshipExplorer


class FakeERPClient:
    def get_doc(self, doctype, name):
        if (doctype, name) == ("Sales Order", "SO-0001"):
            return {
                "name": name,
                "customer": "CUST-001",
                "project": "PRJ-001",
                "items": [
                    {"item_code": "ITEM-SOLAR-01", "qty": 10, "rate": 500, "warehouse": "Stores - A"},
                    {"item_code": "ITEM-BATTERY-02", "qty": 2, "rate": 1500, "warehouse": "Stores - A"},
                ],
                "ignored": "x"
            }
        if (doctype, name) == ("BOM", "BOM-SOLAR-01"):
            return {
                "name": name,
                "item": "ITEM-SOLAR-01",
                "quantity": 1.0,
                "items": [
                    {"item_code": "RAW-SILICON-CELL", "item_name": "Silicon Cell", "qty": 4, "stock_uom": "Nos", "rate": 20},
                    {"item_code": "RAW-ALU-FRAME", "item_name": "Aluminum Frame", "qty": 1, "stock_uom": "Nos", "rate": 50},
                ]
            }
        raise KeyError(f"Not found: {doctype} {name}")

    def get_meta(self, doctype):
        if doctype == "Sales Order":
            return {
                "fields": [
                    {"fieldname": "customer", "fieldtype": "Link", "options": "Customer"},
                    {"fieldname": "project", "fieldtype": "Link", "options": "Project"},
                    {"fieldname": "items", "fieldtype": "Table", "options": "Sales Order Item"},
                    {"fieldname": "ignored", "fieldtype": "Data"},
                ]
            }
        if doctype == "Sales Order Item":
            return {
                "fields": [
                    {"fieldname": "item_code", "fieldtype": "Link", "options": "Item"},
                    {"fieldname": "warehouse", "fieldtype": "Link", "options": "Warehouse"},
                ]
            }
        return {"fields": []}

    def get_list(self, doctype, filters=None, fields=None):
        if doctype == "Bin":
            item = (filters or {}).get("item_code")
            if item == "ITEM-SOLAR-01":
                return [
                    {"warehouse": "Stores - A", "actual_qty": 4.0, "reserved_qty": 2.0, "projected_qty": 2.0}
                ]
            return []
        if doctype == "BOM":
            item = (filters or {}).get("item")
            if item == "ITEM-SOLAR-01":
                return [{"name": "BOM-SOLAR-01", "item": item, "quantity": 1.0}]
            return []
        return []


def test_explorer_reads_declared_links_and_child_tables():
    graph = ERPRelationshipExplorer(FakeERPClient()).explore(
        [{"doctype": "Sales Order", "name": "SO-0001", "company": "ACME"}]
    )

    doctypes = {edge["to"]["doctype"] for edge in graph["edges"]}
    assert "Customer" in doctypes
    assert "Project" in doctypes
    assert "Item" in doctypes
    assert "Warehouse" in doctypes

    # Find the child table edge linking to ITEM-SOLAR-01
    item_edges = [e for e in graph["edges"] if e["to"]["name"] == "ITEM-SOLAR-01"]
    assert len(item_edges) == 1
    assert item_edges[0]["relationship"] == "child_table_link"
    assert item_edges[0]["child_row"]["qty"] == 10


def test_explorer_fetches_stock_and_bom():
    client = FakeERPClient()
    explorer = ERPRelationshipExplorer(client)

    stock = explorer.get_item_stock_overview("ITEM-SOLAR-01")
    assert stock["actual_qty"] == 4.0
    assert stock["projected_qty"] == 2.0

    bom = explorer.get_item_default_bom("ITEM-SOLAR-01")
    assert bom is not None
    assert bom["bom_name"] == "BOM-SOLAR-01"
    assert len(bom["raw_materials"]) == 2
    assert bom["raw_materials"][0]["item_code"] == "RAW-SILICON-CELL"
