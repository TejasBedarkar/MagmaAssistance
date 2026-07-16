import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  HiOutlinePlus,
  HiOutlineArrowPath,
  HiOutlineChevronDown,
  HiOutlineChevronRight,
} from "react-icons/hi2";
import { projects } from "../api/index.js";
import { useAuth } from "../../../common/context/AuthContext.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import TaskStatusWithReopen from "./TaskStatusWithReopen.jsx";
import { getTaskDisplayStatus } from "../lib/taskReopenUtils.js";
import useUserLabelMap from "../../../common/hooks/useUserLabelMap.js";
import ProjectDeliveryStepper from "./ProjectDeliveryStepper.jsx";
import { PortalBusyButtonContent, PortalInlineLoader } from "../../../common/components/PortalSpinner.jsx";
import ProjectPageLoader from "./ProjectPageLoader.jsx";

function milestoneTone(status) {
  const s = String(status || "").toLowerCase();
  if (s === "completed") return "success";
  if (s === "at risk") return "danger";
  if (s === "in progress") return "info";
  return "default";
}

function taskTone(status) {
  const s = String(status || "").toLowerCase();
  if (s === "completed") return "success";
  if (s === "blocked" || s === "overdue") return "danger";
  if (s === "in progress" || s === "dev done" || s === "qa testing" || s === "rework") return "warn";
  return "default";
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
}

export default function ProjectDeliveryHub({
  projectId,
  projectStatus,
  canSubmitForApproval,
  onSubmitForApproval,
  submitBusy,
  refreshKey = 0,
  layout = "embedded",
  showSubmitCta = true,
}) {
  const isPageLayout = layout === "page";
  const navigate = useNavigate();
  const { isManager, isAdministrator } = useAuth();
  const { labelFor } = useUserLabelMap();
  const [hub, setHub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState({});

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setErr("");
    try {
      const data = await projects.getDeliveryHub(projectId);
      setHub(data);
      const ms = data?.milestones || [];
      setExpanded((prev) => {
        const next = { ...prev };
        ms.forEach((m) => {
          if (next[m.name] === undefined) next[m.name] = true;
        });
        return next;
      });
    } catch (e) {
      setHub(null);
      setErr(e.message || "Could not load delivery plan");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load, refreshKey, projectStatus]);

  const status = hub?.status || projectStatus || "Draft";
  const allowsDelivery = Boolean(hub?.allows_delivery);
  const hasDeliveryTeam = Boolean(hub?.has_delivery_team);
  const milestones = hub?.milestones || [];
  const tasksByMilestone = hub?.tasks_by_milestone || {};
  const ungrouped = hub?.ungrouped_tasks || [];
  const milestoneCount = hub?.milestone_count ?? milestones.length;
  const taskCount = hub?.task_count ?? 0;

  const canManageDelivery = isManager && allowsDelivery && hasDeliveryTeam;
  const canAddMilestone = canManageDelivery;
  const canAddTask = canManageDelivery && milestoneCount > 0;

  const deliveryMessage = useMemo(() => {
    if (!isManager) {
      if (taskCount === 0 && milestoneCount === 0) {
        return "No milestones or tasks assigned to you on this program yet.";
      }
      return "Your assigned milestones and tasks on this program.";
    }
    if (status === "Pending Approval") {
      return "This program is awaiting administrator approval. Milestones and tasks unlock after activation.";
    }
    if (status === "Rejected") {
      return "Program was rejected. Update details, submit for approval again, then continue with milestones and tasks.";
    }
    if (status === "Draft") {
      return "Save the program and submit for approval. Delivery planning (milestones & tasks) starts once the program is Active.";
    }
    if (!allowsDelivery) {
      return `Delivery work is available only for Active programs. Current status: ${status}.`;
    }
    if (!hasDeliveryTeam) {
      return "Create the delivery team on the program page before adding milestones or tasks.";
    }
    if (milestoneCount === 0) {
      return "Add at least one milestone before creating tasks on this program.";
    }
    return "Plan delivery: milestones group your work; tasks are assigned to the team under each milestone.";
  }, [isManager, status, allowsDelivery, hasDeliveryTeam, milestoneCount, taskCount]);

  function toggleMilestone(name) {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  const milestoneNewUrl = `/milestones/new?project=${encodeURIComponent(projectId)}`;
  const taskNewUrl = `/tasks/new?project=${encodeURIComponent(projectId)}`;

  return (
    <section
      className={`pm-card pm-delivery-hub${isPageLayout ? " pm-delivery-hub--page" : ""}`}
      aria-labelledby={isPageLayout ? undefined : "pm-delivery-hub-title"}
    >
      <header className="pm-delivery-hub__head">
        <div>
          {!isPageLayout ? (
            <h2 id="pm-delivery-hub-title" className="pm-delivery-hub__title">
              Delivery plan
            </h2>
          ) : null}
          <p className="pm-delivery-hub__subtitle">{deliveryMessage}</p>
        </div>
        <div className="pm-delivery-hub__head-actions">
          <button type="button" className="pm-btn pm-btn-sm" onClick={load} disabled={loading} title="Refresh" aria-busy={loading}>
            {loading ? (
              <PortalInlineLoader size="xs" className="portal-spinner--in-btn" />
            ) : (
              <HiOutlineArrowPath size={16} aria-hidden />
            )}
            <span>Refresh</span>
          </button>
          {canAddMilestone ? (
            <Link to={milestoneNewUrl} className="pm-btn pm-btn-sm pm-btn-primary pm-delivery-hub__action-link">
              <HiOutlinePlus size={16} aria-hidden />
              Add milestone
            </Link>
          ) : isManager ? (
            <button type="button" className="pm-btn pm-btn-sm pm-btn-primary" disabled title={deliveryMessage}>
              <HiOutlinePlus size={16} aria-hidden />
              Add milestone
            </button>
          ) : null}
          {canAddTask ? (
            <Link to={taskNewUrl} className="pm-btn pm-btn-sm pm-delivery-hub__action-link">
              <HiOutlinePlus size={16} aria-hidden />
              Add task
            </Link>
          ) : isManager ? (
            <button
              type="button"
              className="pm-btn pm-btn-sm"
              disabled
              title={milestoneCount === 0 ? "Add a milestone first" : deliveryMessage}
            >
              <HiOutlinePlus size={16} aria-hidden />
              Add task
            </button>
          ) : null}
        </div>
      </header>

      <ProjectDeliveryStepper
        status={status}
        milestoneCount={milestoneCount}
        taskCount={taskCount}
        isNew={false}
      />

      {showSubmitCta && canSubmitForApproval && onSubmitForApproval ? (
        <div className="pm-delivery-hub__cta">
          <p>Program details are ready. Submit for administrator approval to unlock delivery.</p>
          <button type="button" className="pm-btn pm-btn-primary" disabled={submitBusy} onClick={onSubmitForApproval} aria-busy={submitBusy}>
            <PortalBusyButtonContent
              busy={submitBusy}
              busyLabel="Submitting…"
              idleLabel="Submit for approval"
            />
          </button>
        </div>
      ) : null}

      {err ? <div className="pm-delivery-hub__error">{err}</div> : null}

      <div className="pm-delivery-hub__body">
        {loading ? (
          <ProjectPageLoader message="Loading milestones and tasks…" minHeight={160} />
        ) : milestones.length === 0 && taskCount === 0 ? (
          <div className="pm-delivery-hub__empty-state">
            <p className="pm-delivery-hub__empty-title">No milestones or tasks yet</p>
            <p className="pm-delivery-hub__empty-desc">
              {!isManager
                ? "Your assigned work will appear here once tasks are created on this program."
                : allowsDelivery && !hasDeliveryTeam
                  ? "Create the delivery team on the program page first."
                  : allowsDelivery
                    ? "Start with milestones, then add tasks under each milestone."
                    : "Complete approval first, then build your delivery plan here."}
            </p>
          </div>
        ) : (
          <ul className="pm-delivery-tree">
            {milestones.map((m) => {
              const tasks = tasksByMilestone[m.name] || [];
              const open = expanded[m.name] !== false;
              return (
                <li key={m.name} className="pm-delivery-tree__milestone">
                  <div className="pm-delivery-tree__milestone-head">
                    <button
                      type="button"
                      className="pm-delivery-tree__toggle"
                      onClick={() => toggleMilestone(m.name)}
                      aria-expanded={open}
                    >
                      {open ? <HiOutlineChevronDown size={18} /> : <HiOutlineChevronRight size={18} />}
                    </button>
                    <Link to={`/milestones/${m.name}`} className="pm-delivery-tree__milestone-link">
                      <span className="pm-delivery-tree__milestone-name">{m.milestone_name || m.name}</span>
                      <span className="pm-delivery-tree__milestone-meta">
                        Planned {formatDate(m.planned_date)} · {tasks.length} task{tasks.length === 1 ? "" : "s"}
                      </span>
                    </Link>
                    <StatusPill tone={milestoneTone(m.status)}>{m.status || "Planned"}</StatusPill>
                    {canManageDelivery ? (
                      <Link
                        to={`/tasks/new?project=${encodeURIComponent(projectId)}&milestone=${encodeURIComponent(m.name)}`}
                        className="pm-delivery-tree__quick-add"
                      >
                        + Task
                      </Link>
                    ) : null}
                  </div>
                  {open && tasks.length > 0 ? (
                    <ul className="pm-delivery-tree__tasks">
                      {tasks.map((t) => (
                        <li key={t.name}>
                          <button
                            type="button"
                            className="pm-delivery-tree__task-row"
                            onClick={() => navigate(`/tasks/${t.name}`)}
                          >
                            <span className="pm-delivery-tree__task-title">{t.task_title || t.name}</span>
                            <span className="pm-delivery-tree__task-meta">
                              {labelFor(t.assigned_to) || t.assigned_to || "Unassigned"}
                              {t.due_date ? ` · Due ${formatDate(t.due_date)}` : ""}
                            </span>
                            <TaskStatusWithReopen task={t} tone={taskTone(getTaskDisplayStatus(t))} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : open ? (
                    <p className="pm-delivery-tree__no-tasks">No tasks on this milestone yet.</p>
                  ) : null}
                </li>
              );
            })}
            {ungrouped.length > 0 ? (
              <li className="pm-delivery-tree__milestone pm-delivery-tree__milestone--ungrouped">
                <div className="pm-delivery-tree__milestone-head">
                  <span className="pm-delivery-tree__ungrouped-label">Tasks without milestone</span>
                </div>
                <ul className="pm-delivery-tree__tasks">
                  {ungrouped.map((t) => (
                    <li key={t.name}>
                      <button
                        type="button"
                        className="pm-delivery-tree__task-row"
                        onClick={() => navigate(`/tasks/${t.name}`)}
                      >
                        <span className="pm-delivery-tree__task-title">{t.task_title || t.name}</span>
                        <span className="pm-delivery-tree__task-meta">{labelFor(t.assigned_to) || "—"}</span>
                        <TaskStatusWithReopen task={t} tone={taskTone(getTaskDisplayStatus(t))} />
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ) : null}
          </ul>
        )}
      </div>

      <footer className="pm-delivery-hub__foot">
        <Link to={`/milestones?project=${encodeURIComponent(projectId)}`}>All milestones</Link>
        <span aria-hidden>·</span>
        <Link to="/tasks">All tasks</Link>
        {(isManager || isAdministrator) && !allowsDelivery && status === "Pending Approval" ? (
          <>
            <span aria-hidden>·</span>
            <span className="pm-delivery-hub__foot-hint">Admin can approve from the header clipboard icon</span>
          </>
        ) : null}
      </footer>
    </section>
  );
}
