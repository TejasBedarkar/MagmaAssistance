"""
ERP/tools/DashboardUI_tools.py

Tools for generating interactive UI charts (bar, line, pie) via JSON block specifications
interpreted by the ChatArea.jsx component.
"""

import json
from typing import List, Union

from langchain_core.tools import tool



@tool
def create_bar_chart(
    title: str,
    x_axis_data: List[str],
    series_name: str,
    series_data: List[Union[int, float]],
) -> str:
    """Generate a specification for rendering a bar chart in the chat view.
    `title` is the chart header, `x_axis_data` is a list of categories/names (e.g. order IDs or item codes),
    `series_name` is the label for the data series (e.g. 'Cost' or 'Value'), and `series_data` is the list of numerical values.
    Use for requests like 'create a bar graph for each order w.r.t cost of it'."""
    spec = {
        "type": "bar",
        "title": title,
        "xAxis": x_axis_data,
        "series": [
            {
                "name": series_name,
                "data": series_data,
            }
        ],
    }
    return f"\n```chart\n{json.dumps(spec, indent=2)}\n```\n"


@tool
def create_line_chart(
    title: str,
    x_axis_data: List[str],
    series_name: str,
    series_data: List[Union[int, float]],
) -> str:
    """Generate a specification for rendering a line chart/graph in the chat view.
    `title` is the chart header, `x_axis_data` is a list of categories/names (e.g. dates or orders),
    `series_name` is the series label, and `series_data` is the list of numerical values.
    Use for requests like 'plot a line chart of sales over time'."""
    spec = {
        "type": "line",
        "title": title,
        "xAxis": x_axis_data,
        "series": [
            {
                "name": series_name,
                "data": series_data,
            }
        ],
    }
    return f"\n```chart\n{json.dumps(spec, indent=2)}\n```\n"


@tool
def create_pie_chart(
    title: str,
    labels: List[str],
    values: List[Union[int, float]],
) -> str:
    """Generate a specification for rendering a pie/donut chart in the chat view.
    `title` is the chart header, `labels` is the list of names/categories (e.g. status breakdown names),
    and `values` is the list of numerical values.
    Use for requests like 'show a pie chart of order status breakdown'."""
    spec = {
        "type": "pie",
        "title": title,
        "labels": labels,
        "values": values,
    }
    return f"\n```chart\n{json.dumps(spec, indent=2)}\n```\n"


DASHBOARD_UI_TOOLS = [
    create_bar_chart,
    create_line_chart,
    create_pie_chart,
]

REQUIRED_FIELDS = {}
FIELD_PARSERS = {}