import React, { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import ListPagination from "../../../common/components/ListPagination.jsx";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import {
  HiOutlineArrowUpCircle,
  HiOutlineBolt,
  HiOutlineClock,
  HiOutlineExclamationTriangle,
  HiOutlineShieldExclamation,
} from "react-icons/hi2";
import KpiCard from "../../../common/components/KpiCard.jsx";
import Modal from "../../../common/components/Modal.jsx";
import { PortalBusyButtonContent } from "../../../common/components/PortalSpinner.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import useUserLabelMap from "../../../common/hooks/useUserLabelMap.js";
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

function attentionOrSeverityTone(item) {
  return dashboardAttentionTone(item);
}

function projectLinkId(value) {
  const id = String(value || "").trim();
  return id && id !== "-" ? id : "";
}

export default function ManagerDashboard({
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
  actionBusyId,
}) {
  const navigate = useNavigate();
  const { labelFor } = useUserLabelMap();
  const d = data || {};
  const riskTotal =
    (d.overdue_tasks ?? 0) +
    (d.warning_tasks ?? 0) +
    (d.critical_tasks ?? 0) +
    (d.escalated_tasks ?? 0);

  const attentionItems = useMemo(() => {
    if ((d.action_center || []).length > 0) return d.action_center || [];
    return [...(d.recent_tasks || [])].filter((t) =>
      ["Overdue", "Blocked", "Dev Done", "QA Testing", "Rework", "QA Approved"].includes(t.status)
    );
  }, [d.action_center, d.recent_tasks]);

  const projectsPaged = usePagedRows(d.projects || [], PROJECT_LIST_PAGE_SIZE);
  const attentionPaged = usePagedRows(attentionItems, PROJECT_LIST_PAGE_SIZE);

  const topRisks = (d.critical_tasks ?? 0) + (d.escalated_tasks ?? 0);

  return (
    <div className="pm-page pm-mgr-dashboard">
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

      {(d.my_pending_submissions ?? 0) > 0 ? (
        <div className="pm-mgr-approval-banner" role="status">
          <div>
            <strong>{d.my_pending_submissions}</strong> program{d.my_pending_submissions === 1 ? "" : "s"} awaiting
            administrator approval.
          </div>
          <button type="button" className="pm-btn pm-btn-sm" onClick={() => navigate("/projects")}>
            View programs
          </button>
        </div>
      ) : (d.active_projects_count ?? d.total_projects ?? 0) === 0 ? (
        <div className="pm-mgr-approval-banner pm-mgr-approval-banner--muted" role="status">
          <div>No active programs yet. Create a program, submit for approval, then delivery work will appear on this
          dashboard.</div>
          <button type="button" className="pm-btn pm-btn-sm pm-btn-primary" onClick={() => navigate("/projects/new")}>
            New program
          </button>
        </div>
      ) : null}

      <section className="pm-kpi-section pm-mgr-kpi">
        <div className="pm-kpi-grid pm-kpi-grid--primary pm-mgr-kpi-grid">
          <KpiCard
            title="Total projects"
            value={d.total_projects ?? 0}
            sub="Active portfolio"
            accent
            icon="projects"
          />
          <KpiCard
            title="Open tasks"
            value={Math.max(0, (d.total_tasks ?? 0) - (d.completed_tasks ?? 0))}
            sub={`${d.total_tasks ?? 0} total tasks`}
            icon="tasks"
          />
          <KpiCard title="Completed" value={d.completed_tasks ?? 0} sub="Delivered" tone="success" icon="completed" />
          <KpiCard title="Hours logged" value={d.total_hours ?? 0} sub="Approved timesheets" icon="hours" />
        </div>
      </section>

      <section className="pm-mgr-insights-row" aria-label="SLA and risk overview">
        <section className="pm-mgr-sla-panel" aria-label="Service health summary">
          <div className="pm-mgr-sla-panel__head">
            <h3>SLA performance</h3>
            <span>Service delivery metrics</span>
          </div>
          <div className="pm-mgr-sla-grid">
            <article className="pm-mgr-sla-card">
              <span className="pm-mgr-sla-card__label">On-time delivery</span>
              <strong className="pm-mgr-sla-card__value pm-mgr-sla-card__value--success">
                {d?.sla?.on_time_pct ?? 0}%
              </strong>
            </article>
            <article className="pm-mgr-sla-card">
              <span className="pm-mgr-sla-card__label">Breach rate</span>
              <strong className="pm-mgr-sla-card__value pm-mgr-sla-card__value--danger">
                {d?.sla?.overdue_breach_pct ?? 0}%
              </strong>
            </article>
            <article className="pm-mgr-sla-card pm-mgr-sla-card--wide">
              <span className="pm-mgr-sla-card__label">Mean time to resolve</span>
              <strong className="pm-mgr-sla-card__value">{d?.sla?.mttr_days ?? 0}d</strong>
            </article>
          </div>
        </section>

        <section className="pm-mgr-risk-band">
          <div className="pm-mgr-risk-band__head">
            <div className="pm-mgr-risk-band__title-wrap">
              <span className="pm-mgr-risk-band__title-icon" aria-hidden>
                <HiOutlineShieldExclamation />
              </span>
              <div>
                <h3>Risk watch</h3>
                {topRisks > 0 ? (
                  <p className="pm-mgr-risk-band__sub">{topRisks} high priority</p>
                ) : (
                  <p className="pm-mgr-risk-band__sub">Task escalation monitor</p>
                )}
              </div>
            </div>
            <span className="pm-mgr-risk-band__badge">{riskTotal} flagged</span>
          </div>
          <div className="pm-mgr-risk-band__chips">
            <button type="button" className="pm-mgr-risk-tile pm-mgr-risk-tile--overdue" onClick={() => navigate("/tasks")}>
              <span className="pm-mgr-risk-tile__icon" aria-hidden>
                <HiOutlineClock />
              </span>
              <span className="pm-mgr-risk-tile__body">
                <strong>{d.overdue_tasks ?? 0}</strong>
                <span>Overdue</span>
              </span>
            </button>
            <button type="button" className="pm-mgr-risk-tile pm-mgr-risk-tile--warn" onClick={() => navigate("/tasks")}>
              <span className="pm-mgr-risk-tile__icon" aria-hidden>
                <HiOutlineExclamationTriangle />
              </span>
              <span className="pm-mgr-risk-tile__body">
                <strong>{d.warning_tasks ?? 0}</strong>
                <span>Warning</span>
              </span>
            </button>
            <button type="button" className="pm-mgr-risk-tile pm-mgr-risk-tile--critical" onClick={() => navigate("/tasks")}>
              <span className="pm-mgr-risk-tile__icon" aria-hidden>
                <HiOutlineBolt />
              </span>
              <span className="pm-mgr-risk-tile__body">
                <strong>{d.critical_tasks ?? 0}</strong>
                <span>Critical</span>
              </span>
            </button>
            <button type="button" className="pm-mgr-risk-tile pm-mgr-risk-tile--escalated" onClick={() => navigate("/tasks")}>
              <span className="pm-mgr-risk-tile__icon" aria-hidden>
                <HiOutlineArrowUpCircle />
              </span>
              <span className="pm-mgr-risk-tile__body">
                <strong>{d.escalated_tasks ?? 0}</strong>
                <span>Escalated</span>
              </span>
            </button>
          </div>
        </section>
      </section>

      <div className="pm-mgr-mid-grid">
        <div className="pm-mgr-mid-stack">
          <article className="pm-panel pm-mgr-completion-panel">
            <div className="pm-panel__head">
              <h2 className="pm-panel__title">Overall completion</h2>
              <p className="pm-panel__hint">Visible tasks</p>
            </div>
            <div className="pm-completion">
              <div className="pm-progress">
                <div style={{ "--pm-progress-pct": `${d.progress ?? 0}%` }} />
              </div>
              <span className="pm-completion__pct">{d.progress ?? 0}%</span>
            </div>
          </article>

          <article className="pm-panel pm-mgr-milestone-panel">
            <div className="pm-panel__head">
              <h2 className="pm-panel__title">Milestone health</h2>
              <p className="pm-panel__hint">Portfolio milestones</p>
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
            <div className="pm-mgr-milestone-panel__meta">
              <span>
                <strong>{d.total_projects ?? 0}</strong> programs
              </span>
              <span>
                <strong>{riskTotal}</strong> risk watch
              </span>
              <span>
                <strong>{Math.max(0, (d.total_tasks ?? 0) - (d.completed_tasks ?? 0))}</strong> open tasks
              </span>
            </div>
          </article>
        </div>

        <article className="pm-panel pm-mgr-quick-panel">
          <div className="pm-panel__head">
            <h2 className="pm-panel__title">Quick actions</h2>
            <p className="pm-panel__hint">Daily controls</p>
          </div>
          <div className="pm-mgr-quick-actions">
            <button type="button" className="pm-mgr-quick-link pm-mgr-quick-link--primary" onClick={() => navigate("/tasks/new")}>
              <span className="pm-mgr-quick-link__text">
                <strong>Assign new task</strong>
                <small>Create and assign work instantly</small>
              </span>
              <span className="pm-mgr-quick-link__arrow">→</span>
            </button>
            <button type="button" className="pm-mgr-quick-link" onClick={() => navigate("/projects/new")}>
              <span className="pm-mgr-quick-link__text">
                <strong>Create program</strong>
                <small>Register a new project entry</small>
              </span>
              <span className="pm-mgr-quick-link__arrow">→</span>
            </button>
            <button type="button" className="pm-mgr-quick-link" onClick={() => navigate("/team")}>
              <span className="pm-mgr-quick-link__text">
                <strong>Team assignments</strong>
                <small>Review member workloads</small>
              </span>
              <span className="pm-mgr-quick-link__arrow">→</span>
            </button>
            <button type="button" className="pm-mgr-quick-link" onClick={() => navigate("/timesheets")}>
              <span className="pm-mgr-quick-link__text">
                <strong>Review timesheets</strong>
                <small>Approve or reject submissions</small>
              </span>
              <span className="pm-mgr-quick-link__arrow">→</span>
            </button>
          </div>
        </article>
      </div>

      <section className="pm-section pm-table-card pm-mgr-table-card">
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
        <div className="pm-table-wrap pm-table-wrap--flush">
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
                      <Link
                        to={`/projects/${p.name}`}
                        className="pm-project-cell-link"
                        title={p.project_name || p.name}
                      >
                        {p.project_name || p.name}
                      </Link>
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
                          <div style={{ "--pm-progress-pct": `${p.progress || 0}%` }} />
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

      <section className="pm-section pm-table-card pm-mgr-table-card">
        <div className="pm-table-card__head">
          <h3>Needs attention</h3>
          <span>Blocked, overdue and review items</span>
        </div>
        <div className="pm-table-wrap pm-table-wrap--flush">
          <table className="pm-table pm-table--tasks">
            <thead>
              <tr>
                <th className="col-task-title">Task</th>
                <th className="col-project">Project</th>
                <th className="col-assignee">Assignee</th>
                <th className="col-status">Status</th>
                <th className="col-risk">Severity</th>
                <th className="col-due">Due</th>
                <th className="col-actions-cell">Actions</th>
              </tr>
            </thead>
            <tbody>
              {attentionPaged.total === 0 ? (
                <tr>
                  <td colSpan={7} className="pm-empty">
                    No manager actions pending
                  </td>
                </tr>
              ) : (
                attentionPaged.pageRows.map((t) => (
                    <tr key={t.name} className={t.status === "Overdue" ? "pm-mgr-row--urgent" : ""}>
                      <td className="col-task-title">
                        <button type="button" className="pm-link-btn" onClick={() => navigate(`/tasks/${t.name}`)}>
                          {t.task_title || t.name}
                        </button>
                      </td>
                      <td className="col-project">
                        {projectLinkId(t.project) ? (
                          <Link
                            to={`/projects/${projectLinkId(t.project)}`}
                            className="pm-project-cell-link"
                            title={t.project_name || t.project}
                          >
                            {t.project_name || t.project}
                          </Link>
                        ) : (
                          <span>{t.project_name || t.project || "—"}</span>
                        )}
                      </td>
                      <td className="col-assignee">
                        <span className="pm-cell-ellipsis">
                          {labelFor(t.assigned_to)}
                        </span>
                      </td>
                      <td className="col-status">
                        <div className="pm-status-cell">
                          <StatusPill tone={pillTone(getTaskDisplayStatus(t))}>{getTaskDisplayStatus(t)}</StatusPill>
                          {isTaskReopened(t) ? <TaskReopenedBadge /> : null}
                        </div>
                      </td>
                      <td className="col-risk">
                        {t.attention || t.severity ? (
                          <StatusPill tone={attentionOrSeverityTone(t)}>
                            {t.attention || t.severity}
                          </StatusPill>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="col-due">{t.due_date || "—"}</td>
                      <td className="col-actions-cell">
                        {t.status === "Overdue" ? (
                          <div className="pm-row-actions">
                            <button type="button" className="pm-act-extend" disabled={actionBusy} onClick={() => setExtendTask(t)}>
                              Extend
                            </button>
                            <button type="button" className="pm-act-reassign" disabled={actionBusy} onClick={() => setReassignTask(t)}>
                              Reassign
                            </button>
                            <button
                              type="button"
                              className="pm-act-complete"
                              disabled={actionBusy}
                              onClick={() => onComplete(t.name)}
                              aria-busy={actionBusy && actionBusyId === t.name}
                            >
                              <PortalBusyButtonContent
                                busy={actionBusy && actionBusyId === t.name}
                                busyLabel="Completing…"
                                idleLabel="Complete"
                                spinnerSize="xs"
                              />
                            </button>
                          </div>
                        ) : t.status === "QA Approved" ? (
                          <button
                            type="button"
                            className="pm-btn pm-btn-sm pm-btn-primary"
                            disabled={actionBusy}
                            onClick={() => onComplete(t.name)}
                            aria-busy={actionBusy && actionBusyId === t.name}
                          >
                            <PortalBusyButtonContent
                              busy={actionBusy && actionBusyId === t.name}
                              busyLabel="Completing…"
                              idleLabel="Complete"
                              spinnerSize="xs"
                            />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="pm-btn pm-btn-sm pm-btn-ghost"
                            onClick={() => navigate(`/tasks/${t.name}`)}
                          >
                            Open
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
        {attentionPaged.total > PROJECT_LIST_PAGE_SIZE ? (
          <ListPagination
            page={attentionPaged.page}
            totalPages={attentionPaged.totalPages}
            total={attentionPaged.total}
            pageSize={PROJECT_LIST_PAGE_SIZE}
            onPageChange={attentionPaged.setPage}
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
          <p className="pm-modal-context">Task: {extendTask.task_title}</p>
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
          <p className="pm-modal-context">Task: {reassignTask.task_title}</p>
          <p className="pm-form-field-hint pm-form-field-hint--flush">
            Reassigns to another delivery team member on this program with the lowest open workload.
          </p>
          <div className="pm-field">
            <label className="pm-label">Reason (required)</label>
            <textarea className="pm-textarea" value={reassignNote} onChange={(e) => setReassignNote(e.target.value)} />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
