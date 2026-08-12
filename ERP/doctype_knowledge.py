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
    )
}
