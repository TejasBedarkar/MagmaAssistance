"""
skills_engine/skill_rag.py

SkillManager: loads every skill from disk once at startup, embeds each
one's retrieval text, and at query time returns only the skill(s)
actually relevant to what the user is doing right now.

Why this exists (the problem it's solving):

  Before this, EVERY piece of workflow guidance lived permanently in
  the one giant static system prompt (LLM/prompts.py's
  GENERAL_ERP_PROMPT) and was sent, in full, on every single turn --
  the lead-enrichment flow, the manufacturing pipeline rules, the task
  assignment rules, all of it, always. Two problems fall out of that:

  1. On a long task, the specific instruction that matters most (e.g.
     "create the Task before you assign it") is just one paragraph
     buried inside a wall of unrelated text, competing for the model's
     attention with everything else in the prompt AND with a growing,
     trimmed conversation history. The more turns go by, the easier it
     is for that one paragraph to get diluted or for the model to drift
     off it -- which is exactly how you get "assign the task" tool
     calls firing before the "create the task" one.

  2. Every domain workflow you add (onboarding, procurement, HR...)
     makes the always-on prompt bigger for EVERY request, even totally
     unrelated ones ("what's the weather" doesn't need the manufacturing
     pipeline rules in context, but it was getting them anyway).

  Skills fix both: each workflow's instructions live in their own
  SKILL.md, get embedded once, and are retrieved and injected into the
  system prompt fresh, from scratch, on the turn they're actually
  relevant -- not carried forward as diluted history, and not sent at
  all when they're not needed. See skills/README.md for how to author
  new ones.

This mirrors ERP/tool_rag.py's ToolRAG on purpose (same embedding
model, same retrieve()/min_score/top_k shape) so anyone already
familiar with tool retrieval in this codebase already knows how skill
retrieval behaves.
"""

import logging
import os
from typing import List, Optional

from skills_engine.loader import discover_skills
from skills_engine.skill import Skill

logger = logging.getLogger("skills-engine")

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
# Reuse the exact model ERP/tool_rag.py already downloads/loads
# (ERP/models/all-MiniLM-L6-v2) instead of shipping/downloading a second
# copy of the same embedding model just for skills.
DEFAULT_MODEL_PATH = os.path.join(
    os.path.dirname(_THIS_DIR), "ERP", "models", "all-MiniLM-L6-v2"
)
DEFAULT_MODEL_NAME = "all-MiniLM-L6-v2"
DEFAULT_TOP_K = 2
DEFAULT_MIN_SCORE = 0.30


class SkillManager:
    """Loads skills from `skills_dir` and retrieves the ones relevant to
    a given query (the user's message, optionally plus the running
    task_context). Degrades gracefully to simple keyword matching if the
    embedding model can't be loaded, so a broken/offline model download
    never takes skills out of service entirely, just makes retrieval
    less precise."""

    def __init__(
        self,
        skills_dir: str,
        model_name: str = DEFAULT_MODEL_PATH,
        top_k: int = DEFAULT_TOP_K,
        min_score: float = DEFAULT_MIN_SCORE,
    ):
        self.skills_dir = skills_dir
        self.top_k = top_k
        self.min_score = min_score
        self.skills: List[Skill] = discover_skills(skills_dir)

        self.model = None
        self.embeddings = None
        if self.skills:
            self._try_load_model(model_name)
            if self.model is not None:
                self._index_skills()

    # -- setup -----------------------------------------------------------
    def _try_load_model(self, model_name: str):
        try:
            # Imported lazily (not at module scope) so that a machine with
            # no sentence-transformers/torch installed can still boot the
            # rest of the assistant -- it just falls back to keyword
            # matching for skill selection instead of failing to start.
            from sentence_transformers import SentenceTransformer
        except Exception:  # noqa: BLE001
            logger.warning(
                "sentence-transformers not available -- skill retrieval will "
                "fall back to plain keyword matching."
            )
            return

        try:
            if os.path.isdir(model_name):
                logger.info("Loading local embedding model for skills from '%s'...", model_name)
                self.model = SentenceTransformer(model_name)
            else:
                logger.warning(
                    "No local model found at '%s' -- falling back to downloading "
                    "'%s' from the Hugging Face Hub. Run ModelDownload.py to cache "
                    "it locally (it's the same model ERP/tool_rag.py uses).",
                    model_name, DEFAULT_MODEL_NAME,
                )
                self.model = SentenceTransformer(DEFAULT_MODEL_NAME)
        except Exception:  # noqa: BLE001
            logger.exception(
                "Failed to load embedding model for skills -- falling back to "
                "plain keyword matching."
            )
            self.model = None

    def _index_skills(self):
        texts = [s.retrieval_text() for s in self.skills]
        self.embeddings = self.model.encode(
            texts, normalize_embeddings=True, show_progress_bar=False,
        )
        logger.info("Indexed %d skill(s) for retrieval.", len(self.skills))

    # -- retrieval ---------------------------------------------------------
    def retrieve(self, query: str, top_k: int = None, min_score: float = None) -> List[Skill]:
        """Returns the skills relevant to `query`, highest match first,
        always including any `always_on: true` skill regardless of
        score. Returns [] if nothing clears the bar and there are no
        always_on skills -- most turns need zero extra skill guidance."""
        top_k = self.top_k if top_k is None else top_k
        min_score = self.min_score if min_score is None else min_score

        always_on = [s for s in self.skills if s.always_on]
        query = (query or "").strip()
        if not query or not self.skills:
            return always_on

        matched = (
            self._retrieve_embedded(query, top_k, min_score)
            if self.model is not None
            else self._retrieve_keyword(query, top_k, min_score)
        )

        # de-dupe while preserving always_on-first, then match order
        seen = set()
        ordered = []
        for s in [*always_on, *matched]:
            if s.id not in seen:
                seen.add(s.id)
                ordered.append(s)
        return ordered

    def _retrieve_embedded(self, query: str, top_k: int, min_score: float) -> List[Skill]:
        import numpy as np

        query_embedding = self.model.encode([query], normalize_embeddings=True)[0]
        scores = self.embeddings @ query_embedding
        ranked_indices = np.argsort(scores)[::-1]

        selected = [self.skills[i] for i in ranked_indices[:top_k] if scores[i] >= min_score]
        logger.debug(
            "Skill query %r -> %s", query,
            [(self.skills[i].id, round(float(scores[i]), 3)) for i in ranked_indices[:top_k]],
        )
        return selected

    def _retrieve_keyword(self, query: str, top_k: int, min_score: float) -> List[Skill]:
        """Dependency-free fallback: fraction of a skill's trigger/name
        words that appear in the query, literally. Cruder than embedding
        similarity but keeps skills usable with zero extra ML deps."""
        q_words = set(query.lower().split())
        scored = []
        for skill in self.skills:
            vocab = set(w.lower() for w in (skill.triggers or []))
            vocab |= set(skill.name.lower().split())
            if not vocab:
                continue
            overlap = len(vocab & q_words) / len(vocab)
            if overlap > 0:
                scored.append((overlap, skill))
        scored.sort(key=lambda pair: pair[0], reverse=True)
        # keyword scores aren't on the same 0..1 cosine scale as
        # min_score was tuned for -- any real overlap counts as a hit.
        return [skill for score, skill in scored[:top_k] if score > 0]

    # -- rendering -----------------------------------------------------
    def render(self, skills: List[Skill]) -> str:
        """Formats selected skills into one system-prompt block. Kept
        separate from retrieve() so callers can log/inspect which
        skills matched before deciding to render them."""
        if not skills:
            return ""

        sections = [
            "SKILL GUIDANCE FOR THIS REQUEST (auto-loaded, high priority):\n"
            "The following workflow-specific instructions were selected because "
            "they match what the user is asking for right now. They encode the "
            "exact, tested procedure for this specific task -- follow them "
            "precisely, and let them take priority over general guidance above "
            "if the two ever conflict."
        ]
        for skill in skills:
            sections.append(f"\n### Skill: {skill.name}\n{skill.body}")
        return "\n".join(sections)

    def retrieve_and_render(self, query: str, top_k: int = None, min_score: float = None) -> str:
        return self.render(self.retrieve(query, top_k=top_k, min_score=min_score))