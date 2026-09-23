"""
skills_engine

The skill *engine* -- the code that loads, indexes, and retrieves
skills. It knows nothing about ERP, projects, or leads; it just turns a
folder of SKILL.md files into a set of instruction blocks it can hand
back for whichever ones are relevant to the current message.

The skills themselves (the actual domain content) live in the separate
top-level `skills/` folder -- see skills/README.md to author new ones.
"""

from skills_engine.skill import Skill, parse_skill_file
from skills_engine.loader import discover_skills
from skills_engine.skill_rag import SkillManager

__all__ = ["Skill", "parse_skill_file", "discover_skills", "SkillManager"]