"""SQLite persistence for business plans.

This intentionally uses a separate database from the chat audit log.  A plan is
operational state (with revisions, dependencies and approval decisions), while
the audit log is an immutable transcript.  Keeping the API small makes this
store replaceable with PostgreSQL before multi-worker/proactive production use.
"""

import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

from config import BUSINESS_PLAN_DB_PATH


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class BusinessPlanStore:
    """Owns durable plan, entity, action, approval and event records."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        self.init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    @contextmanager
    def _transaction(self):
        with self._lock, self._connect() as conn:
            yield conn

    def init_db(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._transaction() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS business_plans (
                    id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    owner_user_id TEXT NOT NULL,
                    session_id TEXT,
                    objective TEXT NOT NULL,
                    status TEXT NOT NULL,
                    source TEXT NOT NULL,
                    assumptions TEXT NOT NULL,
                    evidence TEXT NOT NULL,
                    revision INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_business_plans_owner
                    ON business_plans(owner_user_id, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_business_plans_tenant
                    ON business_plans(tenant_id, updated_at DESC);

                CREATE TABLE IF NOT EXISTS business_plan_entities (
                    id TEXT PRIMARY KEY,
                    plan_id TEXT NOT NULL REFERENCES business_plans(id) ON DELETE CASCADE,
                    doctype TEXT NOT NULL,
                    name TEXT NOT NULL,
                    company TEXT,
                    relationship TEXT NOT NULL,
                    source TEXT NOT NULL,
                    confidence REAL,
                    metadata TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(plan_id, doctype, name, relationship)
                );
                CREATE INDEX IF NOT EXISTS idx_plan_entities_plan
                    ON business_plan_entities(plan_id);

                CREATE TABLE IF NOT EXISTS business_plan_actions (
                    id TEXT PRIMARY KEY,
                    plan_id TEXT NOT NULL REFERENCES business_plans(id) ON DELETE CASCADE,
                    sequence INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    action_type TEXT NOT NULL,
                    target_ref TEXT NOT NULL,
                    source_refs TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    preconditions TEXT NOT NULL,
                    postconditions TEXT NOT NULL,
                    dependencies TEXT NOT NULL,
                    required_permission TEXT,
                    risk TEXT NOT NULL,
                    status TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    approved_by TEXT,
                    approved_at TEXT,
                    decision_note TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(plan_id, sequence),
                    UNIQUE(idempotency_key)
                );
                CREATE INDEX IF NOT EXISTS idx_plan_actions_plan
                    ON business_plan_actions(plan_id, sequence);

                CREATE TABLE IF NOT EXISTS business_plan_events (
                    id TEXT PRIMARY KEY,
                    external_event_id TEXT NOT NULL UNIQUE,
                    tenant_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    doctype TEXT NOT NULL,
                    document_name TEXT NOT NULL,
                    document_version TEXT,
                    actor_user_id TEXT,
                    payload TEXT NOT NULL,
                    received_at TEXT NOT NULL
                );
                """
            )

    @staticmethod
    def _decode(row: sqlite3.Row) -> dict[str, Any]:
        data = dict(row)
        for field in ("assumptions", "evidence", "metadata", "target_ref", "source_refs", "payload",
                      "preconditions", "postconditions", "dependencies"):
            if field in data and isinstance(data[field], str):
                data[field] = json.loads(data[field])
        return data

    def create_plan(
        self,
        *,
        tenant_id: str,
        owner_user_id: str,
        session_id: Optional[str],
        objective: str,
        source: str,
        assumptions: Optional[list[str]] = None,
        evidence: Optional[list[dict[str, Any]]] = None,
    ) -> dict[str, Any]:
        plan_id, now = str(uuid.uuid4()), _utcnow()
        with self._transaction() as conn:
            conn.execute(
                """INSERT INTO business_plans
                   (id, tenant_id, owner_user_id, session_id, objective, status, source,
                    assumptions, evidence, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)""",
                (plan_id, tenant_id, owner_user_id, session_id, objective.strip(), source,
                 json.dumps(assumptions or []), json.dumps(evidence or []), now, now),
            )
        return self.get_plan(plan_id)  # type: ignore[return-value]

    def add_entity(
        self,
        plan_id: str,
        *,
        doctype: str,
        name: str,
        relationship: str,
        company: Optional[str] = None,
        source: str = "user",
        confidence: Optional[float] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        entity_id, now = str(uuid.uuid4()), _utcnow()
        with self._transaction() as conn:
            if not conn.execute("SELECT 1 FROM business_plans WHERE id = ?", (plan_id,)).fetchone():
                raise KeyError(plan_id)
            conn.execute(
                """INSERT INTO business_plan_entities
                   (id, plan_id, doctype, name, company, relationship, source, confidence, metadata, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(plan_id, doctype, name, relationship) DO UPDATE SET
                       company=excluded.company, source=excluded.source, confidence=excluded.confidence,
                       metadata=excluded.metadata""",
                (entity_id, plan_id, doctype.strip(), name.strip(), company, relationship.strip(), source,
                 confidence, json.dumps(metadata or {}), now),
            )
            self._touch(conn, plan_id)
        return self.get_plan(plan_id)  # type: ignore[return-value]

    def add_action(
        self,
        plan_id: str,
        *,
        title: str,
        action_type: str,
        target_ref: dict[str, Any],
        source_refs: Optional[list[dict[str, Any]]] = None,
        payload: Optional[dict[str, Any]] = None,
        preconditions: Optional[list[str]] = None,
        postconditions: Optional[list[str]] = None,
        dependencies: Optional[list[str]] = None,
        required_permission: Optional[str] = None,
        risk: str = "medium",
        idempotency_key: Optional[str] = None,
    ) -> dict[str, Any]:
        now, action_id = _utcnow(), str(uuid.uuid4())
        key = idempotency_key or f"plan:{plan_id}:action:{action_id}"
        with self._transaction() as conn:
            row = conn.execute("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM business_plan_actions WHERE plan_id = ?", (plan_id,)).fetchone()
            if not row or not conn.execute("SELECT 1 FROM business_plans WHERE id = ?", (plan_id,)).fetchone():
                raise KeyError(plan_id)
            conn.execute(
                """INSERT INTO business_plan_actions
                   (id, plan_id, sequence, title, action_type, target_ref, source_refs, payload,
                    preconditions, postconditions, dependencies, required_permission, risk, status,
                    idempotency_key, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?)""",
                (action_id, plan_id, row["next_sequence"], title.strip(), action_type.strip(),
                 json.dumps(target_ref), json.dumps(source_refs or []), json.dumps(payload or {}),
                 json.dumps(preconditions or []), json.dumps(postconditions or []), json.dumps(dependencies or []),
                 required_permission, risk, key, now, now),
            )
            conn.execute("UPDATE business_plans SET status = 'awaiting_approval' WHERE id = ? AND status = 'draft'", (plan_id,))
            self._touch(conn, plan_id)
        return self.get_plan(plan_id)  # type: ignore[return-value]

    def decide_actions(
        self, plan_id: str, action_ids: Iterable[str], *, decision: str, decided_by: str, note: Optional[str] = None
    ) -> dict[str, Any]:
        if decision not in {"approve", "reject"}:
            raise ValueError("decision must be 'approve' or 'reject'")
        action_ids = list(dict.fromkeys(action_ids))
        if not action_ids:
            raise ValueError("at least one action is required")
        status, now = ("approved", _utcnow()) if decision == "approve" else ("rejected", _utcnow())
        with self._transaction() as conn:
            placeholders = ", ".join("?" for _ in action_ids)
            rows = conn.execute(
                f"SELECT id FROM business_plan_actions WHERE plan_id = ? AND id IN ({placeholders})", [plan_id, *action_ids]
            ).fetchall()
            if len(rows) != len(action_ids):
                raise KeyError("one or more actions do not belong to this plan")
            conn.execute(
                f"""UPDATE business_plan_actions SET status=?, approved_by=?, approved_at=?, decision_note=?, updated_at=?
                    WHERE plan_id=? AND id IN ({placeholders}) AND status='pending_approval'""",
                [status, decided_by, now, note, now, plan_id, *action_ids],
            )
            remaining = conn.execute(
                "SELECT COUNT(*) AS count FROM business_plan_actions WHERE plan_id=? AND status='pending_approval'", (plan_id,)
            ).fetchone()["count"]
            conn.execute("UPDATE business_plans SET status=? WHERE id=?", ("approved" if not remaining else "awaiting_approval", plan_id))
            self._touch(conn, plan_id)
        return self.get_plan(plan_id)  # type: ignore[return-value]

    def record_event(
        self, *, external_event_id: str, tenant_id: str, event_type: str, doctype: str,
        document_name: str, document_version: Optional[str], actor_user_id: Optional[str], payload: dict[str, Any]
    ) -> tuple[dict[str, Any], bool]:
        event_id, now = str(uuid.uuid4()), _utcnow()
        with self._transaction() as conn:
            existing = conn.execute("SELECT * FROM business_plan_events WHERE external_event_id = ?", (external_event_id,)).fetchone()
            if existing:
                return self._decode(existing), False
            conn.execute(
                """INSERT INTO business_plan_events
                   (id, external_event_id, tenant_id, event_type, doctype, document_name,
                    document_version, actor_user_id, payload, received_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (event_id, external_event_id, tenant_id, event_type, doctype, document_name,
                 document_version, actor_user_id, json.dumps(payload), now),
            )
        return self.get_event(event_id), True  # type: ignore[return-value]

    def get_event(self, event_id: str) -> Optional[dict[str, Any]]:
        with self._transaction() as conn:
            row = conn.execute("SELECT * FROM business_plan_events WHERE id = ?", (event_id,)).fetchone()
        return self._decode(row) if row else None

    def get_plan(self, plan_id: str) -> Optional[dict[str, Any]]:
        with self._transaction() as conn:
            row = conn.execute("SELECT * FROM business_plans WHERE id = ?", (plan_id,)).fetchone()
            if not row:
                return None
            plan = self._decode(row)
            entities = conn.execute("SELECT * FROM business_plan_entities WHERE plan_id=? ORDER BY created_at", (plan_id,)).fetchall()
            actions = conn.execute("SELECT * FROM business_plan_actions WHERE plan_id=? ORDER BY sequence", (plan_id,)).fetchall()
        plan["entities"] = [self._decode(entity) for entity in entities]
        plan["actions"] = [self._decode(action) for action in actions]
        return plan

    def list_plans(self, *, tenant_id: Optional[str] = None, owner_user_id: Optional[str] = None, limit: int = 50) -> list[dict[str, Any]]:
        clauses, values = [], []
        if tenant_id:
            clauses.append("tenant_id = ?")
            values.append(tenant_id)
        if owner_user_id:
            clauses.append("owner_user_id = ?")
            values.append(owner_user_id)
        query = "SELECT * FROM business_plans"
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY updated_at DESC LIMIT ?"
        values.append(max(1, min(limit, 100)))
        with self._transaction() as conn:
            rows = conn.execute(query, values).fetchall()
        return [self._decode(row) for row in rows]

    @staticmethod
    def _touch(conn: sqlite3.Connection, plan_id: str) -> None:
        conn.execute(
            "UPDATE business_plans SET revision=revision+1, updated_at=? WHERE id=?", (_utcnow(), plan_id)
        )


business_plan_store = BusinessPlanStore(BUSINESS_PLAN_DB_PATH)
