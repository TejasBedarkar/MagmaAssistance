"""
LLM.py

A reusable LLM wrapper class around OpenAI's chat completions API.
This module now serves as a backward-compatibility facade re-exporting
symbols from the modular LLM package (prompts, client, vision).
"""

from LLM.prompts import GENERAL_ERP_PROMPT
from LLM.vision import VisionMixin, traceable
from LLM.client import LLM
from scripts.run_llm_cli import run_cli

__all__ = ["LLM", "GENERAL_ERP_PROMPT", "VisionMixin", "traceable", "run_cli"]


if __name__ == "__main__":
    run_cli()