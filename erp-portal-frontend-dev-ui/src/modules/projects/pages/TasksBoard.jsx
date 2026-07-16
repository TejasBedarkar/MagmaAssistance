import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Modal from "../../../common/components/Modal.jsx";
import { PortalBusyButtonContent } from "../../../common/components/PortalSpinner.jsx";
import { tasks as tasksApi } from "../api/index.js";
import { useAuth } from "../../../common/context/AuthContext.jsx";
import ListFilters from "../../../common/components/ListFilters.jsx";
import { PortalInlineLoader } from "../../../common/components/PortalSpinner.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import useProjectOptions from "../hooks/useProjectOptions.js";
import useTasksData from "../hooks/useTasksData.js";
import useUserLabelMap from "../../../common/hooks/useUserLabelMap.js";
import ProjectPageLoader from "../components/ProjectPageLoader.jsx";
import { getWorkflowRole, usesQaWorkflowTask } from "../lib/taskWorkflowUtils.js";
import { isTaskReopened } from "../lib/taskReopenUtils.js";
import TaskReopenedBadge from "../components/TaskReopenedBadge.jsx";

/** Manager/admin board: QA phases visible for tracking, but read-only for drag/drop. */
const MANAGER_COLUMNS = [
  { id: "Open", tone: "default" },
  { id: "In Progress", tone: "default" },
  { id: "Overdue", tone: "danger", readOnly: true },
  { id: "Blocked", tone: "danger" },
  { id: "QA Testing", tone: "warn", readOnly: true },
  { id: "Rework", tone: "warn", readOnly: true },
  { id: "QA Approved", tone: "success", readOnly: true },
  { id: "Completed", tone: "success", readOnly: true },
];

/** Developer board: default columns (rework appears only when present). */
const DEVELOPER_BASE_COLUMNS = [
  { id: "Open", tone: "default", includesStatuses: ["Open", "Overdue"] },
  { id: "In Progress", tone: "default" },
  { id: "Dev Done", tone: "warn", handoverTarget: true, includesStatuses: ["Dev Done", "QA Testing", "QA Approved"] },
  { id: "Blocked", tone: "danger", readOnly: true },
];
const DEVELOPER_REWORK_COLUMN = { id: "Rework", tone: "warn" };

const DEVELOPER_VISIBLE_STATUSES = new Set([
  "Open",
  "Overdue",
  "In Progress",
  "Rework",
  "Dev Done",
  "QA Testing",
  "QA Approved",
  "Blocked",
]);

/** Tester board: show only QA workflow states; status changes happen via task actions. */
const TESTER_COLUMNS = [
  { id: "QA Testing", tone: "warn", readOnly: true },
  { id: "Rework", tone: "warn", readOnly: true },
  { id: "QA Approved", tone: "success", readOnly: true },
];
const TESTER_VISIBLE_STATUSES = new Set(["QA Testing", "Rework", "QA Approved"]);

const TEAM_DRAG_STATUSES = new Set(["Open", "In Progress", "Rework"]);
const MANAGER_DRAG_STATUSES = new Set(["Open", "In Progress", "Blocked"]);

function developerColumns(hasDeveloperRework) {
  if (!hasDeveloperRework) return DEVELOPER_BASE_COLUMNS;
  return [
    DEVELOPER_BASE_COLUMNS[0],
    DEVELOPER_BASE_COLUMNS[1],
    DEVELOPER_REWORK_COLUMN,
    DEVELOPER_BASE_COLUMNS[2],
    DEVELOPER_BASE_COLUMNS[3],
  ];
}

function columnsForRole(isManager, isDeveloper, isTester, hasDeveloperRework) {
  if (isManager) return MANAGER_COLUMNS;
  if (isTester && !isDeveloper) return TESTER_COLUMNS;
  if (isDeveloper) return developerColumns(hasDeveloperRework);
  return TESTER_COLUMNS;
}

function columnForStatus(status, columns) {
  const normalized = status || "Open";
  if (columns.some((c) => c.id === normalized)) return normalized;
  const bucket = columns.find((c) => c.includesStatuses?.includes(normalized));
  return bucket?.id || columns[0]?.id || "Open";
}

function isColumnDropTarget(col, isManager) {
  if (col.readOnly && !col.handoverTarget) return false;
  return true;
}

function isCardDraggable(task, isManager, isDeveloper, isTester, currentUser, busyId) {
  if (busyId) return false;
  if (isManager) return MANAGER_DRAG_STATUSES.has(task.status || "Open");
  if (isTester && !isDeveloper) return false;
  if (usesQaWorkflowTask(task) && getWorkflowRole(task, currentUser) !== "developer") return false;
  return TEAM_DRAG_STATUSES.has(task.status);
}

function priorityClass(p) {
  const s = (p || "").toLowerCase();
  if (s === "critical") return "pm-kanban-card--critical";
  if (s === "high") return "pm-kanban-card--high";
  return "";
}

function tasksByColumn(taskList, columns) {
  const map = Object.fromEntries(columns.map((c) => [c.id, []]));
  for (const t of taskList) {
    const colId = columnForStatus(t.status, columns);
    if (map[colId]) map[colId].push(t);
  }
  return map;
}

export default function TasksBoard() {
  const { isManager, isDeveloper, isTester, user } = useAuth();
  const { labelFor } = useUserLabelMap();
  const { options: projectOptions } = useProjectOptions();
  const { tasks: taskRows, loading, err, reload, setErr } = useTasksData();
  const [projectFilter, setProjectFilter] = useState("");
  const [search, setSearch] = useState("");
  const [draggingId, setDraggingId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [blockModal, setBlockModal] = useState(null);
  const [blockReason, setBlockReason] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return taskRows.filter((t) => {
      if (!isManager && isDeveloper && !DEVELOPER_VISIBLE_STATUSES.has(t.status || "Open")) {
        return false;
      }
      if (!isManager && isTester && !isDeveloper && !TESTER_VISIBLE_STATUSES.has(t.status || "Open")) {
        return false;
      }
      if (projectFilter && t.project !== projectFilter) return false;
      if (q) {
        const hay = `${t.task_title || ""} ${t.project_name || ""} ${t.assigned_to || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [taskRows, projectFilter, search, isManager, isDeveloper, isTester]);
  const hasDeveloperRework = useMemo(
    () => filtered.some((t) => (t.status || "Open") === "Rework"),
    [filtered],
  );
  const columns = useMemo(
    () => columnsForRole(isManager, isDeveloper, isTester, hasDeveloperRework),
    [isManager, isDeveloper, isTester, hasDeveloperRework],
  );

  const byColumn = useMemo(() => tasksByColumn(filtered, columns), [filtered, columns]);

  async function applyStatusChange(taskName, columnId, blockedReason) {
    setBusyId(taskName);
    setErr("");
    try {
      await tasksApi.updateStatus(
        taskName,
        columnId,
        columnId === "Blocked" ? blockedReason : undefined,
      );
      await reload();
    } catch (e) {
      setErr(e.message || "Could not update status");
    } finally {
      setBusyId("");
    }
  }

  async function onDrop(columnId, taskName) {
    setDropTarget(null);
    setDraggingId(null);
    const task = taskRows.find((t) => t.name === taskName);
    if (!task || task.status === columnId) return;

    const col = columns.find((c) => c.id === columnId);
    if (!isColumnDropTarget(col || { id: columnId }, isManager)) {
      setErr("Use the task page for QA pass, rework, and manager closure.");
      return;
    }

    if (!isManager && (columnId === "Overdue" || columnId === "Blocked")) {
      setErr(
        columnId === "Blocked"
          ? "Only program managers can block tasks. Contact your manager if you are blocked."
          : "Only program managers can set Overdue status."
      );
      return;
    }

    if (!isManager && task.status === "Blocked") {
      setErr("This task is blocked by your program manager. You cannot move it until they unblock it.");
      return;
    }
    if (!isManager && isDeveloper && task.status === "In Progress" && columnId === "Open") {
      setErr("Task already started. Move it to Dev Done when development is complete.");
      return;
    }

    if (isManager && columnId === "Blocked") {
      const taskTitle = task.task_title || taskName;
      setBlockReason("");
      setBlockModal({ taskName, taskTitle });
      return;
    }

    await applyStatusChange(taskName, columnId);
  }

  async function onConfirmBlock() {
    if (!blockModal) return;
    const reason = blockReason.trim();
    if (!reason) {
      setErr("Blocked reason is required.");
      return;
    }
    const { taskName } = blockModal;
    setBlockModal(null);
    setBlockReason("");
    await applyStatusChange(taskName, "Blocked", reason);
  }

  return (
    <div className="pm-kanban-page">
      {err ? <div className="pm-error-banner">{err}</div> : null}
      <div className="pm-card pm-card--kanban">
        <ListFilters
          projectValue={projectFilter}
          projectOptions={projectOptions}
          onProjectChange={setProjectFilter}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search tasks…"
        />
        {!isManager ? (
          <p className="pm-page-desc pm-kanban-hint">
            {isTester && !isDeveloper
              ? "Tester view shows QA tasks only. Use the task page actions for QA checklist, pass, and rework."
              : isDeveloper
              ? "Drag Open, In Progress, or Rework tasks. Drop on Dev Done to hand over to QA. QA-phase tasks stay visible under Dev Done for tracking."
              : "Drag Open, In Progress, or Rework tasks. Drop on Dev Done to hand over to QA."}
          </p>
        ) : (
          <p className="pm-page-desc pm-kanban-hint">
            Drag only delivery control stages (Open, In Progress, Blocked). Overdue, QA Testing, Rework,
            QA Approved, and Completed are tracking-only; use workflow actions from task page.
          </p>
        )}
        {loading ? (
          <ProjectPageLoader message="Loading board…" />
        ) : (
          <div className="pm-kanban-board">
            <div className="pm-kanban-scroll" aria-label="Kanban board">
              <div className="pm-kanban">
                {columns.map((col) => {
                  const dropEnabled = isColumnDropTarget(col, isManager);
                  return (
                    <div
                      key={col.id}
                      className={`pm-kanban__column${dropTarget === col.id ? " pm-kanban__column--drop" : ""}${!dropEnabled ? " pm-kanban__column--readonly" : ""}`}
                      onDragOver={(e) => {
                        if (!dropEnabled) return;
                        e.preventDefault();
                        setDropTarget(col.id);
                      }}
                      onDragLeave={() => setDropTarget((prev) => (prev === col.id ? null : prev))}
                      onDrop={(e) => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData("text/task-id");
                        if (id) onDrop(col.id, id);
                      }}
                    >
                      <div className="pm-kanban__column-head">
                        <span className="pm-kanban__column-title">{col.id}</span>
                        <span className="pm-kanban__count" title={`${byColumn[col.id]?.length || 0} tasks`}>
                          {byColumn[col.id]?.length || 0}
                        </span>
                      </div>
                      <div className="pm-kanban__cards">
                        {(byColumn[col.id] || []).length === 0 ? (
                          <div className="pm-kanban__empty" aria-hidden="true">
                            {dropEnabled ? "Drop tasks here" : "—"}
                          </div>
                        ) : null}
                        {(byColumn[col.id] || []).map((t) => (
                          <div
                            key={t.name}
                            className={`pm-kanban-card ${priorityClass(t.priority)}${draggingId === t.name ? " pm-kanban-card--dragging" : ""}${busyId === t.name ? " pm-kanban-card--busy" : ""}`}
                            draggable={isCardDraggable(t, isManager, isDeveloper, isTester, user, busyId)}
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/task-id", t.name);
                              e.dataTransfer.effectAllowed = "move";
                              setDraggingId(t.name);
                            }}
                            onDragEnd={() => setDraggingId(null)}
                          >
                            {busyId === t.name ? (
                              <span className="pm-kanban-card__spinner" aria-hidden>
                                <PortalInlineLoader size="xs" />
                              </span>
                            ) : null}
                            <Link
                              to={`/tasks/${t.name}`}
                              className="pm-kanban-card__title"
                              draggable={false}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {t.task_title || t.name}
                            </Link>
                            <div className="pm-kanban-card__meta" title={t.project}>
                              {t.project_name || t.project}
                            </div>
                            <div className="pm-kanban-card__foot">
                              <span className="pm-kanban-card__user" title={t.assigned_to}>
                                {labelFor(t.assigned_to)}
                              </span>
                              {t.due_date ? <span className="pm-kanban-card__due">{t.due_date}</span> : null}
                              {isTaskReopened(t) ? <TaskReopenedBadge /> : null}
                            </div>
                            {t.priority && t.priority !== "Medium" ? (
                              <StatusPill tone={col.tone}>{t.priority}</StatusPill>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {blockModal ? (
        <Modal
          title="Block task"
          onClose={() => !busyId && setBlockModal(null)}
          footer={
            <>
              <button
                type="button"
                className="pm-btn pm-btn-ghost"
                disabled={Boolean(busyId)}
                onClick={() => setBlockModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pm-btn pm-btn-primary"
                disabled={Boolean(busyId) || !blockReason.trim()}
                onClick={onConfirmBlock}
                aria-busy={Boolean(busyId)}
              >
                <PortalBusyButtonContent busy={Boolean(busyId)} busyLabel="Blocking…" idleLabel="Block task" />
              </button>
            </>
          }
        >
          <p className="pm-modal-context">Task: {blockModal.taskTitle}</p>
          <div className="pm-field">
            <label className="pm-label">Blocked reason (required)</label>
            <textarea
              className="pm-textarea"
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              rows={3}
              placeholder="Why is this task blocked?"
            />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
