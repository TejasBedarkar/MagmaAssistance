"""
ERP/doctype_knowledge.py

This file acts as a centralized repository for dynamic business rules, edge cases, 
and mapping instructions for specific ERPNext Doctypes. 

These rules are dynamically injected into the AI's context whenever it calls 
`erp_describe_fields` for a specific doctype, ensuring the AI is always aware of 
highly specific business logic without bloating the core system prompt.
"""

KNOWLEDGE_BASE = {
    "Opportunity": (
        "- `opportunity_from` MUST be either 'Lead' or 'Customer'.\n"
        "- `party_name` MUST be the EXACT Document ID of the Lead/Customer (e.g. CRM-LEAD-0001), NEVER the human name.\n"
        "- `company` is your INTERNAL company (e.g., 'Magna'). DO NOT put the client's company here!"
    ),
    "Lead": (
        "- Ensure you have contact details (email or phone) before creating.\n"
        "- `company_name` is the prospect's company name."
    ),
    "Project": (
        "- `customer` MUST be the exact Document ID of the Customer, not the human name."
    ),
    "Task": (
        "- `project` MUST be the exact Document ID of the associated Project."
    ),
    "Assignment": (
        "- Assignments in ERPNext are generally handled via the `ToDo` doctype or `frappe.desk.form.assign_to`, not a distinct 'Assignment' doctype."
    ),
    "Communication": (
        "- Represents all emails, phone calls, and messages.\n"
        "- To search for incoming/outgoing emails, use `erp_data_tool` with `operation='list'` and `filters=[['communication_medium', '=', 'Email']]`.\n"
        "- The actual email body is in the `content` field. You may want to fetch fields like `subject`, `content`, `sender`, `recipients`, and `communication_date`.\n"
        "- Do NOT use `erp_data_tool` with `operation='create'` to send an email! ALWAYS use the `erp_send_email` tool instead."
    ),
    "BOM": (
        "- BOMs define materials and operations to manufacture an Item.\n"
        "- NEVER modify an existing submitted BOM automatically. Submitted BOMs must be cancelled/duplicated for changes.\n"
        "- When explaining a BOM, clearly state required materials and operations for the requested quantity.\n"
        "- Actively identify missing operations, workstations, or incorrect quantities."
    ),
    "Work Order": (
        "- A Work Order dictates the quantity of an Item to manufacture and generates material requirements from its BOM.\n"
        "- Do not create a Work Order if the materials in Inventory are insufficient. Propose a Material Request first."
    ),
    "Production Plan": (
        "- A Production Plan aggregates demand from Sales Orders or Material Requests and is used to generate subsequent Work Orders."
    ),
    "Material Request": (
        "- Use this to propose procurement of materials when Inventory is short of the BOM requirements."
    )
}
