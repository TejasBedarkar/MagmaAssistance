"""
ERP/tools/__init__.py

Exports active ERP tools maintained under ERP/tools/.
"""

from .DashboardUI_tools import DASHBOARD_UI_TOOLS
from .ocr_po_tool import process_ocr_po_and_create_order
from .project_onboarding_tools import PROJECT_ONBOARDING_TOOLS
from .task_assignment_tools import TASK_ASSIGNMENT_TOOLS

ALL_TOOLS = [
    *DASHBOARD_UI_TOOLS,
    *PROJECT_ONBOARDING_TOOLS,
    *TASK_ASSIGNMENT_TOOLS,
]

__all__ = [
    "ALL_TOOLS",
    "DASHBOARD_UI_TOOLS",
    "PROJECT_ONBOARDING_TOOLS",
    "TASK_ASSIGNMENT_TOOLS",
    "process_ocr_po_and_create_order",
]