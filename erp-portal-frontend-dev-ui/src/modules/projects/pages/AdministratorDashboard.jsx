import React from "react";
import { useNavigate } from "react-router-dom";
import KpiCard from "../../../common/components/KpiCard.jsx";
import Modal from "../../../common/components/Modal.jsx";
import ListPagination from "../../../common/components/ListPagination.jsx";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import { PortalBusyButtonContent } from "../../../common/components/PortalSpinner.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import { PROJECT_LIST_PAGE_SIZE } from "../components/ProjectDataTable.jsx";
import TaskReopenedBadge from "../components/TaskReopenedBadge.jsx";
import { dashboardAttentionTone } from "../lib/dashboardAttention.js";
import { isTaskReopened, getTaskDisplayStatus } from "../lib/taskReopenUtils.js";

function pillTone(status) {
  if (!status) return "default";
  const s = String(status).toLowerCase();
  if (s === "completed") return "success";
  if (s === "overdue" || s === "escalated") return "danger";
  if (s === "blocked" || s === "at risk") return "warn";
  return "default";
}

export default function AdministratorDashboard({
  data,
  loading,
  updated,
  err,
  onRefresh,
  onExtend,
  onReassign,
  onComplete,
  extendTask,
  setExtendTask,
  extendDate,
  setExtendDate,
  extendNote,
  setExtendNote,
  reassignTask,
  setReassignTask,
  reassignNote,
  setReassignNote,
  actionBusy,
}) {
  const navigate = useNavigate();
  const d = data || {};
  const projectsPaged = usePagedRows(d.projects || [], PROJECT_LIST_PAGE_SIZE);
  const actionPaged = usePagedRows(d.action_center || [], PROJECT_LIST_PAGE_SIZE);

  return (
    <div className="pm-page">
      <header className="pm-page-header pm-page-header--compact">
        <div className="pm-toolbar">
          {updated ? <span className="pm-page-header__meta">Updated {updated}</span> : null}
          <button type="button" className="pm-btn" onClick={onRefresh} disabled={loading} aria-busy={loading}>
            <PortalBusyButtonContent busy={loading} busyLabel="Refreshing…" idleLabel="Refresh" spinnerSize="xs" />
          </button>
          <button type="button" className="pm-btn pm-btn-primary" onClick={() => navigate("/projects/new")}>
            New project
          </button>
          <button type="button" className="pm-btn pm-btn-primary" onClick={() => navigate("/tasks/new")}>
            New task
          </button>
        </div>
      </header>

      {err ? <div className="pm-error-banner">{err}</div> : null}

      <section className="pm-kpi-section">
        <p className="pm-kpi-section__label">Portfolio performance</p>
        <div className="pm-kpi-grid pm-kpi-grid--primary">
          <KpiCard title="Total projects" value={d.total_projects ?? 0} sub="Active portfolio" accent />
          <KpiCard title="Total tasks" value={d.total_tasks ?? 0} sub="Tracked work items" />
          <KpiCard title="Completed" value={d.completed_tasks ?? 0} sub="Delivered" tone="success" />
          <KpiCard title="Hours logged" value={d.total_hours ?? 0} sub="Approved timesheets" />
        </div>
      </section>

      <section className="pm-kpi-section">
        <p className="pm-kpi-section__label">Overdue risk</p>
        <div className="pm-kpi-grid pm-kpi-grid--risk">
          <KpiCard title="Overdue" value={d.overdue_tasks ?? 0} sub="Open breaches" tone="danger" />
          <KpiCard title="Warning" value={d.warning_tasks ?? 0} sub="1–2 business days" tone="warn" />
          <KpiCard title="Critical" value={d.critical_tasks ?? 0} sub="3–5 business days" tone="orange" />
          <KpiCard title="Escalated" value={d.escalated_tasks ?? 0} sub="6+ business days" tone="danger" />
        </div>
      </section>

      {(d.pending_approval_count ?? 0) > 0 ? (
        <section className="pm-kpi-section">
          <p className="pm-kpi-section__label">Pending approval</p>
          <article className="pm-panel pm-admin-pending-line">
            <ul className="pm-admin-pending-line__list">
              {(d.pending_projects || []).map((p) => (
                <li key={p.name} className="pm-admin-pending-line__item">
                  <button
                    type="button"
                    className="pm-link-btn pm-admin-pending-line__name"
                    onClick={() => navigate(`/projects/${p.name}`)}
                    title={p.project_name || p.name}
                  >
                    {p.project_name || p.name}
                  </button>
                  <span className="pm-admin-pending-line__meta" title={`${p.project_manager || "—"}${p.project_code ? ` · ${p.project_code}` : ""}`}>
                    {p.project_manager || "—"}
                    {p.project_code ? ` · ${p.project_code}` : ""}
                    {p.modified ? ` · ${p.modified}` : ""}
                  </span>
                  <button type="button" className="pm-btn pm-btn-sm" onClick={() => navigate(`/projects/${p.name}`)}>
                    Review
                  </button>
                </li>
              ))}
            </ul>
          </article>
        </section>
      ) : null}

      <div className="pm-dashboard-row pm-dashboard-row--3">
        <article className="pm-panel">
          <div className="pm-panel__head">
            <h2 className="pm-panel__title">Overall completion</h2>
            <p className="pm-panel__hint">Visible tasks</p>
          </div>
          <div className="pm-completion">
            <div className="pm-progress">
              <div style={{ width: `${d.progress ?? 0}%` }} />
            </div>
            <span className="pm-completion__pct">{d.progress ?? 0}%</span>
          </div>
        </article>

        <article className="pm-panel">
          <div className="pm-panel__head">
            <h2 className="pm-panel__title">SLA overview</h2>
          </div>
          <div className="pm-stat-row">
            <div>
              <div className="pm-stat-row__val">{d?.sla?.on_time_pct ?? 0}%</div>
              <div className="pm-stat-row__lbl">On-time</div>
            </div>
            <div>
              <div className="pm-stat-row__val">{d?.sla?.overdue_breach_pct ?? 0}%</div>
              <div className="pm-stat-row__lbl">Breach</div>
            </div>
            <div>
              <div className="pm-stat-row__val">{d?.sla?.mttr_days ?? 0}d</div>
              <div className="pm-stat-row__lbl">MTTR</div>
            </div>
          </div>
        </article>

        <article className="pm-panel">
          <div className="pm-panel__head">
            <h2 className="pm-panel__title">Milestone health</h2>
          </div>
          <div className="pm-stat-row">
            <div>
              <div className="pm-stat-row__val">{d?.milestone_health?.on_track ?? 0}</div>
              <div className="pm-stat-row__lbl">On-track</div>
            </div>
            <div>
              <div className="pm-stat-row__val">{d?.milestone_health?.at_risk ?? 0}</div>
              <div className="pm-stat-row__lbl">At risk</div>
            </div>
            <div>
              <div className="pm-stat-row__val">{d?.milestone_health?.delayed ?? 0}</div>
              <div className="pm-stat-row__lbl">Delayed</div>
            </div>
          </div>
        </article>
      </div>

      <section className="pm-section pm-table-card">
        <div className="pm-table-card__head">
          <h3>Project progress</h3>
          <span>
            Risk and delivery ratio
            {" · "}
            <button type="button" className="pm-link-btn" onClick={() => navigate("/team")}>
              View all teams →
            </button>
          </span>
        </div>
        <div className="pm-table-wrap" style={{ border: "none", borderRadius: 0 }}>
          <table className="pm-table">
            <thead>
              <tr>
                <th className="col-project">Project</th>
                <th className="col-status">Status</th>
                <th className="col-risk">Risk</th>
                <th className="col-manager">Manager</th>
                <th className="col-team">Delivery team</th>
                <th className="col-tasks">Tasks</th>
                <th className="col-progress">Progress</th>
                <th className="col-action">Action</th>
              </tr>
            </thead>
            <tbody>
              {projectsPaged.total === 0 ? (
                <tr>
                  <td colSpan={8} className="pm-empty">
                    No projects
                  </td>
                </tr>
              ) : (
                projectsPaged.pageRows.map((p) => (
                  <tr key={p.name}>
                    <td className="col-project">
                      <button type="button" className="pm-link-btn" onClick={() => navigate(`/projects/${p.name}`)}>
                        {p.project_name || p.name}
                      </button>
                    </td>
                    <td className="col-status">
                      <StatusPill tone={pillTone(p.status)}>{p.status || "—"}</StatusPill>
                    </td>
                    <td className="col-risk">
                      <StatusPill tone={pillTone(p.risk_indicator)}>{p.risk_indicator || "—"}</StatusPill>
                    </td>
                    <td className="col-manager">
                      <span className="pm-cell-ellipsis" title={p.project_manager || ""}>
                        {p.project_manager || "—"}
                      </span>
                    </td>
                    <td className="col-team">
                      <span className="pm-cell-ellipsis" title={p.team_summary || ""}>
                        {p.team_summary || "—"}
                      </span>
                      {p.team_count > 0 ? (
                        <span className="pm-team-count">{p.team_count} member{p.team_count === 1 ? "" : "s"}</span>
                      ) : null}
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
                      <button
                        type="button"
                        className="pm-btn pm-btn-sm"
                        onClick={() => navigate(`/tasks/new?project=${encodeURIComponent(p.name)}`)}
                      >
                        Assign
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {projectsPaged.total > PROJECT_LIST_PAGE_SIZE ? (
          <ListPagination
            page={projectsPaged.page}
            totalPages={projectsPaged.totalPages}
            total={projectsPaged.total}
            pageSize={PROJECT_LIST_PAGE_SIZE}
            onPageChange={projectsPaged.setPage}
          />
        ) : null}
      </section>

      <section className="pm-section pm-table-card">
        <div className="pm-table-card__head">
          <h3>Action center</h3>
          <span>Top items needing manager attention</span>
        </div>
        <div className="pm-table-wrap" style={{ border: "none", borderRadius: 0 }}>
          <table className="pm-table pm-table--tasks pm-table--action">
            <thead>
              <tr>
                <th className="col-task-title">Task</th>
                <th className="col-project">Project</th>
                <th className="col-assignee">Assignee</th>
                <th className="col-status">Status</th>
                <th className="col-risk">Severity</th>
                <th className="col-due">Aging</th>
              </tr>
            </thead>
            <tbody>
              {actionPaged.total === 0 ? (
                <tr>
                  <td colSpan={6} className="pm-empty">
                    No manager actions pending
                  </td>
                </tr>
              ) : (
                actionPaged.pageRows.map((r) => (
                  <tr key={r.name}>
                    <td className="col-task-title">
                      <button type="button" className="pm-link-btn" onClick={() => navigate(`/tasks/${r.name}`)}>
                        {r.task_title || r.name}
                      </button>
                    </td>
                    <td className="col-project">
                      <span className="pm-cell-ellipsis" title={r.project_name || r.project}>
                        {r.project_name || r.project}
                      </span>
                    </td>
                    <td className="col-assignee">
                      <span className="pm-cell-ellipsis" title={r.assigned_to}>
                        {r.assigned_to}
                      </span>
                    </td>
                      <td className="col-status">
                        <div className="pm-status-cell">
                          <StatusPill tone={pillTone(getTaskDisplayStatus(r))}>{getTaskDisplayStatus(r)}</StatusPill>
                          {isTaskReopened(r) ? <TaskReopenedBadge /> : null}
                        </div>
                      </td>
                      <td className="col-risk">
                        {r.attention ? (
                          <StatusPill tone={dashboardAttentionTone(r)}>{r.attention}</StatusPill>
                        ) : r.severity ? (
                        <StatusPill tone="danger">{r.severity}</StatusPill>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="col-due">{r.aging_label ?? `${r.days_overdue ?? 0} bd`}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {actionPaged.total > PROJECT_LIST_PAGE_SIZE ? (
          <ListPagination
            page={actionPaged.page}
            totalPages={actionPaged.totalPages}
            total={actionPaged.total}
            pageSize={PROJECT_LIST_PAGE_SIZE}
            onPageChange={actionPaged.setPage}
          />
        ) : null}
      </section>

      {extendTask ? (
        <Modal
          title="Extend deadline"
          onClose={() => !actionBusy && setExtendTask(null)}
          footer={
            <>
              <button type="button" className="pm-btn pm-btn-ghost" disabled={actionBusy} onClick={() => setExtendTask(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="pm-btn pm-btn-primary"
                disabled={actionBusy || !extendDate || !extendNote.trim()}
                onClick={onExtend}
                aria-busy={actionBusy}
              >
                <PortalBusyButtonContent busy={actionBusy} busyLabel="Applying…" idleLabel="Apply" />
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>Task: {extendTask.task_title}</p>
          <div className="pm-field">
            <label className="pm-label">New commitment date</label>
            <input className="pm-input" type="date" value={extendDate} onChange={(e) => setExtendDate(e.target.value)} />
          </div>
          <div className="pm-field">
            <label className="pm-label">Note (required)</label>
            <textarea className="pm-textarea" value={extendNote} onChange={(e) => setExtendNote(e.target.value)} />
          </div>
        </Modal>
      ) : null}

      {reassignTask ? (
        <Modal
          title="Reassign task"
          onClose={() => !actionBusy && setReassignTask(null)}
          footer={
            <>
              <button type="button" className="pm-btn pm-btn-ghost" disabled={actionBusy} onClick={() => setReassignTask(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="pm-btn pm-btn-primary"
                disabled={actionBusy || !reassignNote.trim()}
                onClick={onReassign}
                aria-busy={actionBusy}
              >
                <PortalBusyButtonContent busy={actionBusy} busyLabel="Reassigning…" idleLabel="Reassign" />
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>Task: {reassignTask.task_title}</p>
          <div className="pm-field">
            <label className="pm-label">Reason (required)</label>
            <textarea className="pm-textarea" value={reassignNote} onChange={(e) => setReassignNote(e.target.value)} />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
