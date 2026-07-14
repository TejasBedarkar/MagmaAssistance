import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HiOutlineClipboardDocumentCheck } from "react-icons/hi2";
import { approval } from "../api/index.js";
import { useAuth } from "../../../common/context/AuthContext.jsx";
import Modal from "../../../common/components/Modal.jsx";
import { PortalBusyButtonContent } from "../../../common/components/PortalSpinner.jsx";
import useUserLabelMap from "../../../common/hooks/useUserLabelMap.js";
import { refreshPortalNotifications } from "../utils/portalNotifications.js";

function formatWhen(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

export default function ProgramApprovalNotificationBell({ refreshKey }) {
  const navigate = useNavigate();
  const { isAdministrator } = useAuth();
  const { labelFor } = useUserLabelMap();
  const wrapRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyProject, setBusyProject] = useState("");
  const [err, setErr] = useState("");
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    if (!isAdministrator) return;
    setLoading(true);
    setErr("");
    try {
      const data = await approval.getPendingProjects();
      setProjects(data.projects || []);
    } catch (e) {
      setProjects([]);
      setErr(e.message || "Could not load approvals");
    } finally {
      setLoading(false);
    }
  }, [isAdministrator]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!isAdministrator) {
    return null;
  }

  const count = projects.length;

  async function onApprove(projectName, e) {
    e?.stopPropagation?.();
    setBusyProject(projectName);
    setBusy(true);
    setErr("");
    try {
      await approval.approveProject(projectName);
      await load();
      refreshPortalNotifications();
    } catch (ex) {
      setErr(ex.message || "Approve failed");
    } finally {
      setBusy(false);
      setBusyProject("");
    }
  }

  async function onRejectConfirm() {
    if (!rejectTarget) return;
    setBusyProject(rejectTarget.name);
    setBusy(true);
    setErr("");
    try {
      await approval.rejectProject(rejectTarget.name, rejectReason.trim());
      setRejectTarget(null);
      setRejectReason("");
      await load();
      refreshPortalNotifications();
    } catch (ex) {
      setErr(ex.message || "Reject failed");
    } finally {
      setBusy(false);
      setBusyProject("");
    }
  }

  function openProject(projectName) {
    setOpen(false);
    navigate(`/projects/${projectName}`);
  }

  return (
    <>
      <div className="pm-notify-wrap pm-notify-wrap--approval" ref={wrapRef}>
        <button
          type="button"
          className={`pm-notify-btn pm-notify-btn--approval${open ? " pm-notify-btn--active" : ""}${
            count > 0 ? " pm-notify-btn--has-pending" : ""
          }`}
          onClick={() => setOpen((v) => !v)}
          aria-label={count ? `${count} programs pending approval` : "Program approvals"}
          aria-expanded={open}
          title="Programs pending approval"
        >
          <span className="pm-notify-btn__icon">
            <HiOutlineClipboardDocumentCheck size={19} />
          </span>
          {count > 0 ? (
            count === 1 ? (
              <span className="pm-notify-dot pm-notify-dot--approval" aria-hidden="true" />
            ) : (
              <span className="pm-notify-badge pm-notify-badge--approval">{count > 99 ? "99+" : count}</span>
            )
          ) : null}
        </button>

        {open ? (
          <div className="pm-notify-panel pm-notify-panel--approval" role="dialog" aria-label="Program approvals">
            <div className="pm-notify-panel__head pm-notify-panel__head--approval">
              <div>
                <h3 className="pm-notify-panel__title">Program approvals</h3>
                <p className="pm-notify-panel__hint">Review and activate submitted programs</p>
              </div>
              <span className="pm-notify-panel__meta">
                {loading ? "Loading…" : count ? `${count} pending` : "Clear"}
              </span>
            </div>

            {err ? <p className="pm-notify-panel__error">{err}</p> : null}

            <div className="pm-notify-panel__body">
              {!loading && count === 0 ? (
                <p className="pm-notify-empty">No programs are waiting for approval.</p>
              ) : null}
              {projects.map((p) => (
                <div key={p.name} className="pm-notify-approval-item">
                  <button type="button" className="pm-notify-approval-item__main" onClick={() => openProject(p.name)}>
                    <span className="pm-notify-approval-item__title">{p.project_name || p.name}</span>
                    <span className="pm-notify-approval-item__sub">
                      {labelFor(p.project_manager) || p.project_manager || "—"}
                      {p.project_code ? ` · ${p.project_code}` : ""}
                    </span>
                    <span className="pm-notify-item__time">{formatWhen(p.modified)}</span>
                  </button>
                  <div className="pm-notify-approval-item__actions">
                    <button
                      type="button"
                      className="pm-btn pm-btn-sm pm-btn-primary"
                      disabled={busy}
                      onClick={(e) => onApprove(p.name, e)}
                      aria-busy={busy && busyProject === p.name}
                    >
                      <PortalBusyButtonContent
                        busy={busy && busyProject === p.name}
                        busyLabel="Approving…"
                        idleLabel="Approve"
                        spinnerSize="xs"
                      />
                    </button>
                    <button
                      type="button"
                      className="pm-btn pm-btn-sm"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRejectTarget(p);
                        setRejectReason("");
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="pm-notify-panel__foot">
              <button
                type="button"
                className="pm-notify-foot-link"
                onClick={() => {
                  setOpen(false);
                  navigate("/");
                }}
              >
                Open admin dashboard →
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {rejectTarget ? (
        <Modal
          title="Reject program"
          onClose={() => {
            if (!busy) {
              setRejectTarget(null);
              setRejectReason("");
            }
          }}
          footer={
            <>
              <button type="button" className="pm-btn" disabled={busy} onClick={() => setRejectTarget(null)}>
                Cancel
              </button>
              <button type="button" className="pm-btn pm-btn-primary" disabled={busy} onClick={onRejectConfirm} aria-busy={busy}>
                <PortalBusyButtonContent busy={busy} busyLabel="Rejecting…" idleLabel="Reject" />
              </button>
            </>
          }
        >
          <p className="pm-modal__lead">
            Reject <strong>{rejectTarget.project_name || rejectTarget.name}</strong>? The program manager can edit and
            resubmit.
          </p>
          <label className="pm-label" htmlFor="approval-reject-reason">
            Reason (optional)
          </label>
          <textarea
            id="approval-reject-reason"
            className="pm-input"
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Why is this program not approved?"
          />
        </Modal>
      ) : null}
    </>
  );
}
