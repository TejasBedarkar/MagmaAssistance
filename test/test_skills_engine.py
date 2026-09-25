"""
test_skills_engine.py
----------------------
skills_engine loading/parsing/retrieval, and the two demo skills that
ship in skills/. Retrieval is exercised via the keyword fallback path
(no embedding model download required) by forcing SkillManager.model
to None, same mechanism used automatically when sentence-transformers
isn't available at runtime.
"""

import os
import tempfile

from skills_engine.loader import discover_skills
from skills_engine.skill import parse_skill_file
from skills_engine.skill_rag import SkillManager

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILLS_DIR = os.path.join(REPO_ROOT, "skills")


def _write_skill(root, skill_id, name, description, triggers="", body="Do the thing.", always_on=False):
    skill_dir = os.path.join(root, skill_id)
    os.makedirs(skill_dir, exist_ok=True)
    with open(os.path.join(skill_dir, "SKILL.md"), "w", encoding="utf-8") as f:
        f.write(
            f"---\nname: {name}\ndescription: {description}\n"
            f"triggers: {triggers}\nalways_on: {'true' if always_on else 'false'}\n---\n\n{body}\n"
        )


def _manager_without_model(root, **kwargs):
    """A SkillManager that skips the embedding model entirely, so tests
    run fast and don't need the model downloaded -- exercises the same
    keyword-fallback code path used automatically in production when
    sentence-transformers isn't installed."""
    mgr = SkillManager.__new__(SkillManager)
    mgr.skills_dir = root
    mgr.top_k = kwargs.get("top_k", 2)
    mgr.min_score = kwargs.get("min_score", 0.30)
    mgr.skills = discover_skills(root)
    mgr.model = None
    mgr.embeddings = None
    return mgr


# ---------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------
def test_parse_skill_file_reads_front_matter_and_body():
    with tempfile.TemporaryDirectory() as tmp:
        _write_skill(tmp, "demo_skill", "Demo Skill", "Use this when testing.",
                     triggers="foo, bar", body="Step 1. Step 2.")
        skill = parse_skill_file(os.path.join(tmp, "demo_skill", "SKILL.md"))
        assert skill is not None
        assert skill.id == "demo_skill"
        assert skill.name == "Demo Skill"
        assert skill.triggers == ["foo", "bar"]
        assert "Step 1" in skill.body
        assert skill.always_on is False


def test_parse_skill_file_missing_description_is_rejected():
    with tempfile.TemporaryDirectory() as tmp:
        skill_dir = os.path.join(tmp, "broken")
        os.makedirs(skill_dir)
        with open(os.path.join(skill_dir, "SKILL.md"), "w") as f:
            f.write("---\nname: Broken\n---\n\nbody\n")
        assert parse_skill_file(os.path.join(skill_dir, "SKILL.md")) is None


def test_parse_skill_file_without_front_matter_is_rejected():
    with tempfile.TemporaryDirectory() as tmp:
        skill_dir = os.path.join(tmp, "no_front_matter")
        os.makedirs(skill_dir)
        with open(os.path.join(skill_dir, "SKILL.md"), "w") as f:
            f.write("Just some plain markdown, no --- block.\n")
        assert parse_skill_file(os.path.join(skill_dir, "SKILL.md")) is None


# ---------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------
def test_discover_skills_skips_folders_without_skill_md():
    with tempfile.TemporaryDirectory() as tmp:
        _write_skill(tmp, "good", "Good", "A real skill.")
        os.makedirs(os.path.join(tmp, "empty_folder"))  # no SKILL.md inside
        skills = discover_skills(tmp)
        assert [s.id for s in skills] == ["good"]


def test_discover_skills_missing_directory_returns_empty():
    assert discover_skills("/definitely/not/a/real/path") == []


# ---------------------------------------------------------------------
# Retrieval (keyword fallback -- no embedding model needed)
# ---------------------------------------------------------------------
def test_retrieve_matches_relevant_skill_by_keyword():
    with tempfile.TemporaryDirectory() as tmp:
        _write_skill(tmp, "task_order", "Task Order", "Create before assign.",
                      triggers="assign task, create project")
        _write_skill(tmp, "unrelated", "Unrelated", "Nothing to do with tasks.",
                      triggers="weather, holidays")
        mgr = _manager_without_model(tmp)

        matched = mgr.retrieve("please assign task to Priya on the new project")
        assert [s.id for s in matched] == ["task_order"]


def test_retrieve_returns_nothing_for_irrelevant_query():
    with tempfile.TemporaryDirectory() as tmp:
        _write_skill(tmp, "task_order", "Task Order", "Create before assign.",
                      triggers="assign task, create project")
        mgr = _manager_without_model(tmp)
        assert mgr.retrieve("what's the weather like today") == []


def test_always_on_skill_is_always_included():
    with tempfile.TemporaryDirectory() as tmp:
        _write_skill(tmp, "always", "Always On", "Applies to everything.", always_on=True)
        _write_skill(tmp, "specific", "Specific", "Only for X.", triggers="xyz")
        mgr = _manager_without_model(tmp)

        matched = mgr.retrieve("completely unrelated message")
        assert [s.id for s in matched] == ["always"]


def test_render_includes_skill_body_and_heading():
    with tempfile.TemporaryDirectory() as tmp:
        _write_skill(tmp, "demo", "Demo", "desc", body="Exact instruction text.")
        mgr = _manager_without_model(tmp)
        rendered = mgr.render(mgr.skills)
        assert "SKILL GUIDANCE FOR THIS REQUEST" in rendered
        assert "Exact instruction text." in rendered

    with tempfile.TemporaryDirectory() as tmp2:
        mgr2 = _manager_without_model(tmp2)
        assert mgr2.render([]) == ""


# ---------------------------------------------------------------------
# The real demo skills shipped in skills/
# ---------------------------------------------------------------------
def test_shipped_skills_directory_loads_cleanly():
    skills = discover_skills(SKILLS_DIR)
    ids = {s.id for s in skills}
    assert "project_task_creation_order" in ids
    assert "long_task_progress_tracking" in ids
    assert "erpnext_project_management_concepts" in ids
    for s in skills:
        assert s.name and s.description and s.body


def test_project_task_creation_order_matches_task_assignment_request():
    mgr = _manager_without_model(SKILLS_DIR)
    matched = mgr.retrieve("Please create tasks for this project and assign them to the team")
    assert any(s.id == "project_task_creation_order" for s in matched)


def test_long_task_progress_tracking_matches_continuation_request():
    mgr = _manager_without_model(SKILLS_DIR)
    matched = mgr.retrieve("ok what's next for this ongoing task")
    assert any(s.id == "long_task_progress_tracking" for s in matched)


def test_project_management_concepts_matches_cost_and_profitability_requests():
    mgr = _manager_without_model(SKILLS_DIR)

    matched = mgr.retrieve("what's the project cost and profitability so far on PROJ-0004")
    assert any(s.id == "erpnext_project_management_concepts" for s in matched)

    matched2 = mgr.retrieve("has anyone logged a timesheet against this project's tasks")
    assert any(s.id == "erpnext_project_management_concepts" for s in matched2)


def test_project_management_concepts_does_not_fire_on_unrelated_request():
    mgr = _manager_without_model(SKILLS_DIR)
    matched = mgr.retrieve("what's the weather like today")
    assert not any(s.id == "erpnext_project_management_concepts" for s in matched)