import React from "react";
import { Link } from "react-router-dom";
import { PortalBusyButtonContent } from "../../../common/components/PortalSpinner.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import {
  formatDue,
  priorityTone,
  relativeDueLabel,
  statusTone,
} from "../utils/myDayUtils.js";
import { getWorkflowRole, usesQaWorkflowTask } from "../lib/taskWorkflowUtils.js";
import { canDeveloperStartTask, getTaskDisplayStatus, isTaskReopened, taskReopenedAwaitingDevRestart } from "../lib/taskReopenUtils.js";
import TaskReopenedBadge from "./TaskReopenedBadge.jsx";

function taskId(task) {
  const id = task?.name;
  if (!id || id === "null" || id === "undefined") return "";
  return String(id);
}

function timesheetUrl(task) {
  const params = new URLSearchParams();
  if (task.project) params.set("project", task.project);
  const id = taskId(task);
  if (id) params.set("task", id);
  const qs = params.toString();
  return qs ? `/timesheets/new?${qs}` : "/timesheets/new";
}

/**
 * @param {object} props
 * @param {object} props.task
 * @param {string} props.sectionKey
 * @param {string} props.currentUser
 * @param {boolean} props.busy
 * @param {(name: string, status: string) => void} props.onStatus
 * @param {(name: string) => void} props.onMarkDevDone
 */
export default function MyDayTaskCard({
  task,
  sectionKey,
  currentUser,
  busy,
  onStatus,
  onMarkDevDone,
}) {
  const id = taskId(task);
  const status = getTaskDisplayStatus(task);
  const rawStatus = task.status || "Open";
  const isBlocked = rawStatus === "Blocked" || sectionKey === "blocked";
  const qaWorkflow = usesQaWorkflowTask(task);
  const role = getWorkflowRole(task, currentUser);
  const canStart = canDeveloperStartTask(task, currentUser);
  const canDevDone = qaWorkflow && role === "developer" && rawStatus === "In Progress";
  const canQaReview = qaWorkflow && role === "qa" && rawStatus === "QA Testing";

  return (
    <article className={`pm-my-day-card pm-my-day-card--${sectionKey}`}>
      <div className="pm-my-day-card__accent" aria-hidden="true" />
      <div className="pm-my-day-card__body">
        <div className="pm-my-day-card__head">
          <div className="pm-my-day-card__title-row">
            {id ? (
              <Link to={`/tasks/${encodeURIComponent(id)}`} className="pm-my-day-card__title">
                {task.task_title || id}
              </Link>
            ) : (
              <span className="pm-my-day-card__title">{task.task_title || "Task"}</span>
            )}
            {task.priority ? (
              <StatusPill tone={priorityTone(task.priority)}>{task.priority}</StatusPill>
            ) : null}
          </div>
          <div className="pm-my-day-card__chips">
            <StatusPill tone={statusTone(status)}>{status}</StatusPill>
            {isTaskReopened(task) ? <TaskReopenedBadge /> : null}
            <span
              className={`pm-my-day-card__due${
                sectionKey === "overdue" ? " pm-my-day-card__due--late" : ""
              }`}
            >
              {relativeDueLabel(task.due_date, sectionKey)}
              {task.due_date ? ` · ${formatDue(task.due_date)}` : ""}
            </span>
          </div>
        </div>

        <div className="pm-my-day-card__project">
          <span className="pm-my-day-card__project-label">Program</span>
          <Link to={`/projects/${task.project}`} className="pm-my-day-card__project-link" title={task.project}>
            {task.project_name || task.project}
          </Link>
        </div>

        {task.days_overdue > 0 ? (
          <p className="pm-my-day-card__alert">
            {task.days_overdue} business day{task.days_overdue === 1 ? "" : "s"} overdue — update status or log
            progress.
          </p>
        ) : null}

        {isBlocked ? (
          <p className="pm-my-day-card__hint">Blocked tasks need program manager action. Add a note on the task page.</p>
        ) : null}
        {qaWorkflow && rawStatus === "QA Testing" && role === "qa" ? (
          <p className="pm-my-day-card__hint">Run your QA checklist, then pass or send for rework.</p>
        ) : null}
        {taskReopenedAwaitingDevRestart(task) ? (
          <p className="pm-my-day-card__hint">Reopened by your program manager — press Start to resume development.</p>
        ) : null}
      </div>

      <div className="pm-my-day-card__actions">
        {canStart && id ? (
          <button
            type="button"
            className="pm-btn pm-btn-sm pm-btn-primary"
            disabled={busy}
            onClick={() => onStatus(id, "In Progress")}
            aria-busy={busy}
          >
            <PortalBusyButtonContent busy={busy} busyLabel="Starting…" idleLabel="Start" spinnerSize="xs" />
          </button>
        ) : null}
        {canDevDone && id ? (
          <button
            type="button"
            className="pm-btn pm-btn-sm pm-btn-primary"
            disabled={busy}
            onClick={() => onMarkDevDone(id)}
            aria-busy={busy}
          >
            <PortalBusyButtonContent busy={busy} busyLabel="Handing over…" idleLabel="Mark dev done" spinnerSize="xs" />
          </button>
        ) : null}
        {canQaReview && id ? (
          <Link
            to={`/tasks/${encodeURIComponent(id)}`}
            className="pm-btn pm-btn-sm pm-btn-primary"
            style={{ textDecoration: "none" }}
          >
            QA review
          </Link>
        ) : null}
        <Link to={timesheetUrl(task)} className="pm-btn pm-btn-sm pm-btn-ghost" style={{ textDecoration: "none" }}>
          Log time
        </Link>
        {id ? (
          <Link to={`/tasks/${encodeURIComponent(id)}`} className="pm-btn pm-btn-sm pm-btn-ghost" style={{ textDecoration: "none" }}>
            Details
          </Link>
        ) : null}
      </div>
    </article>
  );
}
