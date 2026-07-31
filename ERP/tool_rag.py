"""
ERP/tool_rag.py

Generic tool-retrieval layer: instead of binding every ERP tool to the LLM
on every turn (which confuses smaller local models like llama3.2 once you
have more than a handful of tools), this embeds each tool's name +
description once at startup, and at query time retrieves only the top-k
most semantically relevant tools to bind for that turn.

This is domain-agnostic — it doesn't know or care whether the tools are
about sales, inventory, HR, etc. Feed it any list of LangChain @tool
objects and it works the same way. As you add more domains (inventory,
HR, accounts...), you don't touch this file at all — just pass a bigger
tool list in.

Usage:
    from ERP.tool_rag import ToolRAG
    from ERP.tools import ALL_TOOLS   # you'll build this list later

    tool_rag = ToolRAG(ALL_TOOLS)

    candidate_tools = tool_rag.retrieve("what are our pending sales orders?")
    llm_with_tools = llm.bind_tools(candidate_tools) if candidate_tools else llm
"""

import logging
import os

# sentence-transformers pulls in transformers, which auto-detects and tries
# to load a TensorFlow backend if TF is installed. On machines with
# TensorFlow + Keras 3 installed, that TF backend import crashes (Keras 3
# isn't supported by transformers' TF integration yet). We only ever need
# the PyTorch backend here, so force transformers to skip TF entirely -
# this must be set before sentence_transformers/transformers are imported.
os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("USE_FLAX", "0")

import numpy as np
from sentence_transformers import SentenceTransformer

logger = logging.getLogger("tool-rag")

# Downloaded ahead of time by ModelDownload.py into ERP/models/<name>, so
# this loads from disk instead of hitting the Hugging Face Hub on every
# fresh machine/run. Matches the WhisperSTT/model and VibeVoiceTTS/models
# layout used elsewhere in this project.
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL_NAME = "all-MiniLM-L6-v2"
DEFAULT_MODEL_PATH = os.path.join(_THIS_DIR, "models", DEFAULT_MODEL_NAME)
DEFAULT_TOP_K = 3
DEFAULT_MIN_SCORE = 0.25


class ToolRAG:
    """Retrieves the most relevant tools for a query via embedding
    similarity, instead of binding the entire tool list every time."""

    def __init__(
        self,
        tools,
        model_name: str = DEFAULT_MODEL_PATH,
        top_k: int = DEFAULT_TOP_K,
        min_score: float = DEFAULT_MIN_SCORE,
    ):
        """
        Args:
            tools: list of LangChain @tool-decorated callables. Each must
                have `.name` and `.description` attributes (this is true
                for anything created with @tool).
            model_name: path to a locally downloaded sentence-transformers
                model (see ModelDownload.py), or a model name to fetch from
                the Hugging Face Hub if you'd rather not pre-download it.
                Defaults to the local path this project downloads models
                into (ERP/models/all-MiniLM-L6-v2).
            top_k: max number of tools to return per query.
            min_score: minimum cosine similarity a tool must hit to be
                considered relevant at all. Tools scoring below this are
                dropped — this is what lets plain chit-chat ("hi", "thanks")
                retrieve zero tools instead of being forced into one.
        """
        if not tools:
            raise ValueError("ToolRAG needs at least one tool to index.")

        self.tools = list(tools)
        self.top_k = top_k
        self.min_score = min_score

        if os.path.isdir(model_name):
            logger.info("Loading local embedding model from '%s'...", model_name)
            self.model = SentenceTransformer(model_name)
        else:
            logger.warning(
                "No local model found at '%s' — falling back to downloading "
                "'%s' from the Hugging Face Hub. Run ModelDownload.py to "
                "cache it locally and avoid this on future runs.",
                model_name,
                DEFAULT_MODEL_NAME,
            )
            try:
                self.model = SentenceTransformer(DEFAULT_MODEL_NAME)
            except Exception as exc:
                logger.warning(
                    "Network request to Hugging Face Hub failed (%s); attempting to load from local cache...",
                    exc,
                )
                self.model = SentenceTransformer(DEFAULT_MODEL_NAME, local_files_only=True)

        self._index_tools()

    def _tool_text(self, tool) -> str:
        """Text used to represent a tool for embedding. Combining name +
        description tends to retrieve better than description alone,
        since users often phrase things close to the tool's name."""
        return f"{tool.name}: {tool.description}"

    def _index_tools(self):
        texts = [self._tool_text(tool) for tool in self.tools]
        self.embeddings = self.model.encode(
            texts,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        logger.info("Indexed %d tool(s) for retrieval.", len(self.tools))

    def add_tools(self, new_tools):
        """Adds more tools after construction (e.g. a new domain's tools
        registered later at runtime) and re-embeds just those."""
        if not new_tools:
            return
        new_embeddings = self.model.encode(
            [self._tool_text(tool) for tool in new_tools],
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        self.tools.extend(new_tools)
        self.embeddings = np.vstack([self.embeddings, new_embeddings])
        logger.info("Added %d tool(s); %d total now indexed.", len(new_tools), len(self.tools))

    def retrieve(self, query: str, top_k: int = None, min_score: float = None):
        """Returns the list of tool objects most relevant to `query`,
        ranked highest similarity first. Returns an empty list if nothing
        clears `min_score` (i.e. the query doesn't need any ERP tool)."""
        top_k = self.top_k if top_k is None else top_k
        min_score = self.min_score if min_score is None else min_score

        query_embedding = self.model.encode([query], normalize_embeddings=True)[0]
        scores = self.embeddings @ query_embedding  # cosine sim (both sides normalized)

        ranked_indices = np.argsort(scores)[::-1]

        selected = [
            self.tools[i] for i in ranked_indices[:top_k] if scores[i] >= min_score
        ]

        logger.debug(
            "Query %r -> tools %s",
            query,
            [(self.tools[i].name, round(float(scores[i]), 3)) for i in ranked_indices[:top_k]],
        )

        return selected

    def retrieve_with_scores(self, query: str, top_k: int = None):
        """Same as retrieve(), but returns (tool, score) pairs regardless
        of min_score — useful for debugging/tuning the threshold."""
        top_k = self.top_k if top_k is None else top_k

        query_embedding = self.model.encode([query], normalize_embeddings=True)[0]
        scores = self.embeddings @ query_embedding
        ranked_indices = np.argsort(scores)[::-1][:top_k]

        return [(self.tools[i], float(scores[i])) for i in ranked_indices]


if __name__ == "__main__":
    # Quick manual smoke test. Run directly: python -m ERP.tool_rag
    # (uses dummy tools since real ERP tools aren't wired up yet)
    from langchain_core.tools import tool

    @tool
    def get_sales_orders():
        """Get recent sales orders, their status, and total value."""
        return "dummy"

    @tool
    def get_customers():
        """Get the list of customers and their contact details."""
        return "dummy"

    @tool
    def get_leave_balance():
        """Get an employee's remaining leave/vacation balance."""
        return "dummy"

    logging.basicConfig(level=logging.INFO)
    rag = ToolRAG([get_sales_orders, get_customers, get_leave_balance])

    for question in [
        "what orders came in this week?",
        "how many leave days do I have left?",
        "hey, how's it going?",
    ]:
        results = rag.retrieve_with_scores(question)
        print(f"\nQuery: {question}")
        for t, score in results:
            print(f"  {t.name}: {score:.3f}")
