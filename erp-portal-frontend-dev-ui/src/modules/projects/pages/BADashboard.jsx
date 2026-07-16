import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import KpiCard from "../../../common/components/KpiCard.jsx";
import ListPagination from "../../../common/components/ListPagination.jsx";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import { PROJECT_LIST_PAGE_SIZE } from "../components/ProjectDataTable.jsx";
import TaskStatusWithReopen from "../components/TaskStatusWithReopen.jsx";
import useProjectAuth from "../hooks/useProjectAuth.js";

function pillTone(status) {
  if (!status) return "default";
  const s = String(status).toLowerCase();
  if (s === "completed") return "success";
  if (s === "overdue" || s === "escalated") return "danger";
  if (s === "blocked" || s === "at risk") return "warn";
  if (s === "in progress") return "info";
  return "default";
}

/**
 * Business analyst home — program visibility and assigned analysis tasks (no My Day / timesheets).
 */
export default function BADashboard({ data, err }) {
  const navigate = useNavigate();
  const { designation, department } = useProjectAuth();
  const d = data || {};
  const assignedTasks = useMemo(
    () => (d.recent_tasks || []).filter((t) => t.status !== "Completed"),
    [d.recent_tasks]
  );
  const tasksPaged = usePagedRows(assignedTasks, PROJECT_LIST_PAGE_SIZE);
  const programsPaged = usePagedRows(d.projects || [], PROJECT_LIST_PAGE_SIZE);

  return (
    <div className="pm-page pm-ba-dashboard">
      {err ? <div className="pm-error-banner">{err}</div> : null}

      <header className="pm-ba-dashboard__intro">
        <h1 className="pm-ba-dashboard__title">Analysis workspace</h1>
        <p className="pm-ba-dashboard__sub">
          {designation ? `${designation}` : "Business Analyst"}
          {department ? ` · ${department}` : ""}
          — review programs, milestones, and tasks assigned to you.
        </p>
      </header>

      <section className="pm-kpi-section">
        <div className="pm-kpi-grid pm-kpi-grid--team">
          <button type="button" className="pm-kpi-card pm-kpi-card--clickable" onClick={() => navigate("/projects")}>
            <h4 className="pm-kpi-card__title">Programs</h4>
            <p className="pm-kpi-card__value">{d.total_projects ?? (d.projects || []).length}</p>
            <p className="pm-kpi-card__sub">In your scope</p>
          </button>
          <button type="button" className="pm-kpi-card pm-kpi-card--clickable" onClick={() => navigate("/tasks")}>
            <h4 className="pm-kpi-card__title">Open tasks</h4>
            <p className="pm-kpi-card__value">{assignedTasks.length}</p>
            <p className="pm-kpi-card__sub">Assigned to you</p>
          </button>
          <KpiCard title="Overdue" value={d.overdue_tasks ?? 0} sub="Needs follow-up" tone="danger" />
          <KpiCard title="Completion" value={`${d.progress ?? 0}%`} sub="Your assigned tasks" />
        </div>
      </section>

      <div className="pm-team-dashboard__split-row">
        <article className="pm-panel">
          <div className="pm-panel__head">
            <h2 className="pm-panel__title">Programs</h2>
            <button type="button" className="pm-link-btn" onClick={() => navigate("/projects")}>
              View all
            </button>
          </div>
          <div className="pm-table-wrap">
            <table className="pm-table pm-table--compact">
              <thead>
                <tr>
                  <th>Program</th>
                  <th>Status</th>
                  <th>Progress</th>
                </tr>
              </thead>
              <tbody>
                {programsPaged.rows.length ? (
                  programsPaged.rows.map((p) => (
                    <tr key={p.name}>
                      <td>
                        <button type="button" className="pm-link-btn" onClick={() => navigate(`/projects/${p.name}`)}>
                          {p.project_name || p.name}
                        </button>
                      </td>
                      <td>
                        <StatusPill tone={pillTone(p.status)}>{p.status || "—"}</StatusPill>
                      </td>
                      <td>{p.progress ?? 0}%</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="pm-empty">
                      No programs in your scope yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {programsPaged.total > PROJECT_LIST_PAGE_SIZE ? (
            <ListPagination
              page={programsPaged.page}
              totalPages={programsPaged.totalPages}
              total={programsPaged.total}
              pageSize={programsPaged.pageSize}
              onPageChange={programsPaged.setPage}
            />
          ) : null}
        </article>

        <article className="pm-panel">
          <div className="pm-panel__head">
            <h2 className="pm-panel__title">Your tasks</h2>
            <button type="button" className="pm-link-btn" onClick={() => navigate("/tasks")}>
              Task list
            </button>
          </div>
          <div className="pm-table-wrap">
            <table className="pm-table pm-table--compact">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Due</th>
                </tr>
              </thead>
              <tbody>
                {tasksPaged.rows.length ? (
                  tasksPaged.rows.map((t) => (
                    <tr key={t.name}>
                      <td>
                        <button type="button" className="pm-link-btn" onClick={() => navigate(`/tasks/${t.name}`)}>
                          {t.task_title || t.name}
                        </button>
                      </td>
                      <td>
                        <TaskStatusWithReopen task={t} tone={pillTone(t.status)} />
                      </td>
                      <td>{t.due_date || "—"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="pm-empty">
                      No tasks assigned yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {tasksPaged.total > PROJECT_LIST_PAGE_SIZE ? (
            <ListPagination
              page={tasksPaged.page}
              totalPages={tasksPaged.totalPages}
              total={tasksPaged.total}
              pageSize={tasksPaged.pageSize}
              onPageChange={tasksPaged.setPage}
            />
          ) : null}
        </article>
      </div>
    </div>
  );
}
