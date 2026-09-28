# Skills

This folder holds the actual **skills** — one subfolder per skill, each
with a `SKILL.md`. The code that loads and retrieves them lives
separately, in `skills_engine/` (see that folder for how retrieval
works). This split is deliberate: `skills_engine/` is generic
infrastructure you shouldn't need to touch when authoring a new skill;
`skills/` is just content.

## Why skills exist

Two recurring problems drove this:

1. **Long tasks losing the plot.** Every instruction used to live
   permanently in one giant static system prompt
   (`LLM/prompts.py:GENERAL_ERP_PROMPT`), sent in full on every turn.
   The deeper a conversation goes, the more that one relevant paragraph
   is competing for attention with everything else in the prompt *and*
   with a growing, trimmed history — which is exactly how the model
   starts drifting and hallucinating steps it never actually took.
2. **Workflow order mistakes** (e.g. trying to assign a Project Task
   before it's been created). The instruction "create it first" existed,
   but buried in a wall of unrelated text is easy to miss under load.

A skill's instructions are only added to the system prompt on the turns
where they're actually relevant — retrieved fresh from disk each turn,
not carried forward as diluted conversation history. That keeps the
default prompt smaller for everyone, and makes the guidance that *does*
apply much harder to miss.

## Adding a new skill

1. Create a new folder here: `skills/<your_skill_id>/`
   (snake_case, no spaces — it's also used as the skill's internal id).
2. Add `skills/<your_skill_id>/SKILL.md` with this shape:

   ```markdown
   ---
   name: Human-readable skill name
   description: One or two sentences on what this is for and when it
     applies. This is the text retrieval matches against the user's
     message, so write it like you're telling a teammate "use this
     when...". Be specific about the trigger situation, not just the
     topic.
   triggers: extra, comma, separated, keywords
   always_on: false
   ---

   Everything below the second `---` is the actual instructions. This
   gets injected into the system prompt VERBATIM when the skill is
   selected, so write it the same way you'd write any other prompt
   instruction — direct, imperative, no filler.
   ```

   Field notes:
   - `name` / `description` — required. `description` is the single
     biggest factor in whether the skill gets picked up for a given
     message, so be concrete: which tools does this cover, which
     situation is it for, what mistake does it prevent.
   - `triggers` — optional. A few extra keywords/phrases you want
     weighted into retrieval even if they don't appear naturally in the
     description. Also used as the fallback signal if the embedding
     model isn't available (see below).
   - `always_on` — optional, defaults to `false`. Set `true` only for
     something that should apply to every single request (rare — this
     defeats the point of keeping the default prompt small, so treat it
     as an escape hatch, not the default choice).

3. Restart the backend (skills are loaded once at process startup, the
   same as tools — see `state.py`). No other wiring is needed; any
   folder here with a valid `SKILL.md` is picked up automatically.

## How a skill gets selected

`skills_engine.SkillManager` embeds every skill's `name: description`
text once at startup (same embedding model `ERP/tool_rag.py` already
uses for tool retrieval). On each user turn, `agent/agent.py` retrieves
the top-matching skill(s) for that turn's message (plus any
`task_context`) and injects their full body into the system prompt,
under a `SKILL GUIDANCE FOR THIS REQUEST` heading. If the embedding
model isn't available for some reason, it falls back to plain keyword
overlap against `triggers`/`name` instead of failing closed.

Keep each skill focused on one workflow. If a skill's `SKILL.md` is
trying to cover several unrelated situations, it's a sign it should be
split into separate skills instead — smaller, single-purpose skills
retrieve more precisely than one broad one.

## What's here as a starting set

- `project_task_creation_order/` — the create-before-assign ordering
  rule for Project Tasks (onboarding, batch task creation).
- `long_task_progress_tracking/` — grounding/anti-hallucination
  guidance for multi-step, multi-turn workflows.

Use these as the template for the next one.