"""
skills_engine/skill.py

Defines the `Skill` data model and the parser for `SKILL.md` files.

A skill is a folder under the skills directory (see config.SKILLS_DIR,
default "skills/") containing one `SKILL.md`:

    skills/
        my_skill_name/
            SKILL.md

`SKILL.md` is a small YAML-*like* front-matter block followed by a
Markdown body:

    ---
    name: Human-readable skill name
    description: One or two sentences describing what this skill is for
      and when it applies. This is the text used to decide whether the
      skill is relevant to the user's current message -- write it the
      way you'd explain "use this when..." to a new teammate.
    triggers: comma, separated, extra, keywords
    always_on: false
    ---

    The rest of the file is the actual instructions. This is injected
    verbatim into the system prompt when the skill is selected as
    relevant for the current turn.

We deliberately do NOT depend on PyYAML here -- the front-matter format
above is a strict subset (flat `key: value` lines) that a few lines of
string parsing handle fine, and it keeps this module dependency-free.
"""

import os
from dataclasses import dataclass, field
from typing import List, Optional

_FRONT_MATTER_DELIM = "---"


@dataclass
class Skill:
    """One loaded skill."""

    id: str                     # folder name, e.g. "project_task_creation_order"
    name: str                   # display name from front-matter
    description: str            # retrieval text from front-matter
    body: str                   # the instructions markdown, injected verbatim when active
    path: str                   # absolute path to the SKILL.md file
    triggers: List[str] = field(default_factory=list)
    always_on: bool = False     # if True, always injected regardless of retrieval score

    def retrieval_text(self) -> str:
        """Text embedded/matched against the user's message. Combines
        name + description + triggers, the same "name: description"
        pattern ERP/tool_rag.py uses for tools -- keeping the two
        retrieval subsystems consistent."""
        extra = f" Keywords: {', '.join(self.triggers)}." if self.triggers else ""
        return f"{self.name}: {self.description}{extra}"


def _parse_front_matter(raw_front_matter: str) -> dict:
    meta = {}
    for line in raw_front_matter.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, value = line.partition(":")
        meta[key.strip().lower()] = value.strip()
    return meta


def parse_skill_file(skill_md_path: str, skill_id: Optional[str] = None) -> Optional[Skill]:
    """Parses one SKILL.md file into a Skill, or returns None (with the
    caller expected to log a warning) if it's malformed -- a broken
    skill file should never crash startup, just be skipped."""
    if not os.path.isfile(skill_md_path):
        return None

    with open(skill_md_path, "r", encoding="utf-8") as f:
        raw = f.read()

    skill_id = skill_id or os.path.basename(os.path.dirname(skill_md_path))

    stripped = raw.lstrip()
    if not stripped.startswith(_FRONT_MATTER_DELIM):
        return None

    # Split on the delimiter: "", front_matter, body...
    parts = stripped.split(_FRONT_MATTER_DELIM, 2)
    if len(parts) < 3:
        return None
    _, raw_front_matter, body = parts

    meta = _parse_front_matter(raw_front_matter)
    name = meta.get("name") or skill_id.replace("_", " ").title()
    description = meta.get("description") or ""
    if not description:
        return None  # nothing to retrieve on -- treat as malformed

    triggers_raw = meta.get("triggers") or ""
    triggers = [t.strip() for t in triggers_raw.split(",") if t.strip()]
    always_on = meta.get("always_on", "").strip().lower() in ("true", "yes", "1")

    return Skill(
        id=skill_id,
        name=name,
        description=description,
        body=body.strip(),
        path=os.path.abspath(skill_md_path),
        triggers=triggers,
        always_on=always_on,
    )