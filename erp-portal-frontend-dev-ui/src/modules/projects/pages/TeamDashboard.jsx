import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { tasks as tasksApi } from "../api/index.js";
import { useAuth } from "../../../common/context/AuthContext.jsx";
import KpiCard from "../../../common/components/KpiCard.jsx";
import ListPagination from "../../../common/components/ListPagination.jsx";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import QuickActionStrip from "../components/dashboard/QuickActionStrip.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import { PROJECT_LIST_PAGE_SIZE } from "../components/ProjectDataTable.jsx";
import TaskStatusWithReopen from "../components/TaskStatusWithReopen.jsx";
import { getWorkflowRole, usesQaWorkflowTask } from "../lib/taskWorkflowUtils.js";
import { canDeveloperStartTask } from "../lib/taskReopenUtils.js";

function pillTone(status) {
  if (!status) return "default";
  const s = String(status).toLowerCase();
  if (s === "completed") return "success";
  if (s === "overdue" || s === "escalated") return "danger";
  if (s === "blocked" || s === "at risk") return "warn";
  if (s === "in progress") return "info";
  return "default";
}

function canQaReview(task, currentUser) {
  const status = task?.status || "Open";
  return usesQaWorkflowTask(task) && getWorkflowRole(task, currentUser) === "qa" && status === "QA Testing";
}

/**
 * Delivery team home — personal metrics, quick actions, My Day / Log time.
 */
export default function TeamDashboard({
  data,
  err,
  onRefresh,
}) {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [actionId, setActionId] = useState("");
  const d = data || {};
  const s = d.team_summary || {};
  const openTasks = s.open_tasks ?? Math.max(0, (d.total_tasks ?? 0) - (d.completed_tasks ?? 0));
  const priorityTasks = useMemo(
    () =>
      d.team_priority_tasks?.length
        ? d.team_priority_tasks
        : (d.recent_tasks || []).filter((t) => t.status !== "Completed"),
    [d.team_priority_tasks, d.recent_tasks]
  );
  const priorityPaged = usePagedRows(priorityTasks, PROJECT_LIST_PAGE_SIZE);
  const programsPaged = usePagedRows(d.projects || [], PROJECT_LIST_PAGE_SIZE);

  async function onStart(taskName) {
    setActionId(taskName);
    try {
      await tasksApi.updateStatus(taskName, "In Progress");
      if (onRefresh) await onRefresh();
    } finally {
      setActionId("");
    }
  }

  return (
    <div className="pm-page pm-team-dashboard">
      {err ? <div className="pm-error-banner">{err}</div> : null}

      {d.has_pm_assignments === false ? (
        <div className="pm-info-banner" role="status">
          No tasks are assigned to you yet. Your program manager will assign work — check back here or open My Day
          once tasks appear.
        </div>
      ) : null}

      <section className="pm-kpi-section">
        <div className="pm-kpi-grid pm-kpi-grid--team">
          <button type="button" className="pm-kpi-card pm-kpi-card--clickable pm-kpi-card--accent" onClick={() => navigate("/my-day")}>
            <h4 className="pm-kpi-card__title">Open tasks</h4>
            <p className="pm-kpi-card__value">{openTasks}</p>
            <p className="pm-kpi-card__sub">Assigned to you</p>
          </button>
          <button type="button" className="pm-kpi-card pm-kpi-card--clickable" onClick={() => navigate("/my-day")}>
            <h4 className="pm-kpi-card__title">Due today</h4>
            <p className="pm-kpi-card__value pm-kpi-card__value--warn">{s.due_today ?? 0}</p>
            <p className="pm-kpi-card__sub">Finish before EOD</p>
          </button>
          <button type="button" className="pm-kpi-card pm-kpi-card--clickable" onClick={() => navigate("/my-day")}>
            <h4 className="pm-kpi-card__title">Overdue</h4>
            <p className="pm-kpi-card__value pm-kpi-card__value--danger">{d.overdue_tasks ?? 0}</p>
            <p className="pm-kpi-card__sub">Needs attention</p>
          </button>
          <KpiCard title="Approved hours" value={d.total_hours ?? 0} sub="Your logged time" />
        </div>
      </section>

      <div className="pm-team-dashboard__split-row">
        <article className="pm-panel pm-team-dashboard__completion-panel">
          <div className="pm-panel__head">
            <h2 className="pm-panel__title">My completion</h2>
            <p className="pm-panel__hint">Across your assigned tasks</p>
          </div>
          <div className="pm-team-dashboard__completion-body">
            <div className="pm-completion pm-team-dashboard__completion-gauge">
              <div className="pm-progress">
                <div style={{ width: `${d.progress ?? 0}%` }} />
              </div>
              <span className="pm-completion__pct">{d.progress ?? 0}%</span>
            </div>
            <div className="pm-team-dashboard__mini-stats">
              <span>
                <strong>{d.completed_tasks ?? 0}</strong> completed
              </span>
              <span>
                <strong>{s.in_progress ?? 0}</strong> in progress
              </span>
              <span>
                <strong>{s.blocked ?? 0}</strong> blocked
              </span>
              <span>
                <strong>{s.my_programs ?? d.total_projects ?? 0}</strong> programs
              </span>
            </div>
          </div>
        </article>

        <article className="pm-panel pm-team-dashboard__quick-panel" aria-label="Quick actions">
          <div className="pm-panel__head pm-team-dashboard__quick-head">
            <h2 className="pm-panel__title">Quick actions</h2>
          </div>
          <QuickActionStrip onNavigate={navigate} />
        </article>
      </div>

      <section className="pm-section pm-table-card">
        <div className="pm-table-card__head">
          <h3>Priority tasks</h3>
          <span>
            Overdue and due today first
            {" · "}
            <button type="button" className="pm-link-btn" onClick={() => navigate("/my-day")}>
              Open My Day →
            </button>
          </span>
        </div>
        <div className="pm-table-wrap" style={{ border: "none", borderRadius: 0 }}>
          <table className="pm-table pm-table--tasks">
            <thead>
              <tr>
                <th className="col-task-title">Task</th>
                <th className="col-project">Program</th>
                <th className="col-status">Status</th>
                <th className="col-due">Due</th>
                <th className="col-actions-cell">Quick actions</th>
              </tr>
            </thead>
            <tbody>
              {priorityPaged.total === 0 ? (
                <tr>
                  <td colSpan={5} className="pm-empty">
                    No open tasks — you&apos;re all caught up
                  </td>
                </tr>
              ) : (
                priorityPaged.pageRows.map((t) => (
                  <tr key={t.name}>
                    <td className="col-task-title">
                      <button type="button" className="pm-link-btn" onClick={() => navigate(`/tasks/${t.name}`)}>
                        {t.task_title || t.name}
                      </button>
                    </td>
                    <td className="col-project">
                      <span className="pm-cell-ellipsis" title={t.project_name || t.project}>
                        {t.project_name || t.project}
                      </span>
                    </td>
                    <td className="col-status">
                      <TaskStatusWithReopen task={t} tone={pillTone(t.status)} />
                    </td>
                    <td className="col-due">{t.due_date || "—"}</td>
                    <td className="col-actions-cell">
                      {t.status !== "Completed" ? (
                        <div className="pm-row-actions">
                          {canDeveloperStartTask(t, currentUser) ? (
                            <button
                              type="button"
                              className="pm-btn pm-btn-sm pm-btn-primary"
                              disabled={actionId === t.name}
                              onClick={() => onStart(t.name)}
                            >
                              {actionId === t.name ? "Starting…" : "Start"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="pm-btn pm-btn-sm pm-btn-ghost"
                              onClick={() => navigate(`/tasks/${t.name}`)}
                            >
                              {canQaReview(t, currentUser) ? "QA review" : "Open"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="pm-btn pm-btn-sm pm-btn-ghost"
                            onClick={() =>
                              navigate(
                                `/timesheets/new?project=${encodeURIComponent(t.project || "")}&task=${encodeURIComponent(t.name || "")}`
                              )
                            }
                          >
                            Log time
                          </button>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {priorityPaged.total > PROJECT_LIST_PAGE_SIZE ? (
          <ListPagination
            page={priorityPaged.page}
            totalPages={priorityPaged.totalPages}
            total={priorityPaged.total}
            pageSize={PROJECT_LIST_PAGE_SIZE}
            onPageChange={priorityPaged.setPage}
          />
        ) : null}
      </section>

      {programsPaged.total > 0 ? (
        <section className="pm-section pm-table-card">
          <div className="pm-table-card__head">
            <h3>My programs</h3>
            <span>Your task progress by program</span>
          </div>
          <div className="pm-table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="pm-table pm-table--team-programs">
              <thead>
                <tr>
                  <th className="col-project">Program</th>
                  <th className="col-tasks">My tasks</th>
                  <th className="col-progress">Progress</th>
                  <th className="col-action">Action</th>
                </tr>
              </thead>
              <tbody>
                {programsPaged.pageRows.map((p) => (
                  <tr key={p.name}>
                    <td className="col-project">
                      <span className="pm-cell-ellipsis" title={p.project_name || p.name}>
                        {p.project_name || p.name}
                      </span>
                    </td>
                    <td className="col-tasks">
                      {p.completed_tasks}/{p.total_tasks}
                    </td>
                    <td className="col-progress">
                      <div className="pm-cell-progress">
                        <div className="pm-progress">
                          <div style={{ width: `${p.progress || 0}%` }} />
                        </div>
                        <span>{p.progress || 0}%</span>
                      </div>
                    </td>
                    <td className="col-action">
                      <button type="button" className="pm-btn pm-btn-sm" onClick={() => navigate("/tasks")}>
                        Tasks
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {programsPaged.total > PROJECT_LIST_PAGE_SIZE ? (
            <ListPagination
              page={programsPaged.page}
              totalPages={programsPaged.totalPages}
              total={programsPaged.total}
              pageSize={PROJECT_LIST_PAGE_SIZE}
              onPageChange={programsPaged.setPage}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
