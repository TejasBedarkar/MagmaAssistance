"""
skills_engine/loader.py

Discovers skills on disk: every immediate subfolder of the skills
directory that contains a SKILL.md is loaded as one Skill. Bad/missing
files are skipped with a log line rather than raising -- adding a skill
should never be able to take the whole assistant down.
"""

import logging
import os
from typing import List

from skills_engine.skill import Skill, parse_skill_file

logger = logging.getLogger("skills-engine")

SKILL_FILENAME = "SKILL.md"


def discover_skills(skills_dir: str) -> List[Skill]:
    """Scans `skills_dir` for `<skill_id>/SKILL.md` folders and returns
    every valid Skill found. Returns an empty list (rather than raising)
    if the directory doesn't exist yet -- a fresh checkout with no
    skills authored should still boot fine."""
    skills: List[Skill] = []

    if not skills_dir or not os.path.isdir(skills_dir):
        logger.info("Skills directory '%s' not found -- no skills loaded.", skills_dir)
        return skills

    for entry in sorted(os.listdir(skills_dir)):
        skill_dir = os.path.join(skills_dir, entry)
        if not os.path.isdir(skill_dir):
            continue
        skill_md = os.path.join(skill_dir, SKILL_FILENAME)
        if not os.path.isfile(skill_md):
            continue

        try:
            skill = parse_skill_file(skill_md, skill_id=entry)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to parse skill at '%s' -- skipping.", skill_md)
            continue

        if skill is None:
            logger.warning(
                "Skipping '%s': missing/invalid front-matter (needs at least "
                "'name' and 'description' between '---' lines).",
                skill_md,
            )
            continue

        skills.append(skill)

    return skills