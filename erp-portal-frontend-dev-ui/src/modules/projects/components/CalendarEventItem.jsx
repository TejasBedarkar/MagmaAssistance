import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { StatusPill } from "../../../common/components/StatusPill.jsx";

const POPOVER_WIDTH = 272;
const VIEWPORT_PAD = 10;
const GAP = 8;

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return String(value);
  }
}

function statusTone(status) {
  const s = (status || "").toLowerCase();
  if (s === "completed") return "success";
  if (s === "overdue" || s === "blocked") return "danger";
  if (s === "dev done" || s === "qa testing" || s === "rework") return "warn";
  if (s === "in progress") return "info";
  if (s === "qa approved") return "success";
  return "default";
}

function statusSlug(status) {
  return (status || "open").replace(/\s+/g, "-").toLowerCase();
}

function priorityTag(priority) {
  const p = (priority || "").toLowerCase();
  if (p === "critical") return "CR";
  if (p === "high") return "HI";
  return "";
}

function CalendarEventPopover({ task, anchorRect, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, placement: "above" });

  useLayoutEffect(() => {
    if (!anchorRect || !ref.current) return;
    const el = ref.current;
    const h = el.offsetHeight;
    const w = POPOVER_WIDTH;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let placement = "above";
    let top = anchorRect.top - h - GAP;
    if (top < VIEWPORT_PAD) {
      placement = "below";
      top = anchorRect.bottom + GAP;
      if (top + h > vh - VIEWPORT_PAD) {
        top = Math.max(VIEWPORT_PAD, anchorRect.top - h - GAP);
        placement = "above";
      }
    }

    let left = anchorRect.left + anchorRect.width / 2 - w / 2;
    left = Math.max(VIEWPORT_PAD, Math.min(left, vw - w - VIEWPORT_PAD));

    setPos({ top, left, placement });
  }, [anchorRect, task?.name]);

  if (!task || !anchorRect) return null;

  const title = task.task_title || task.name;
  const project = task.project_name || task.project || "—";

  return createPortal(
    <div
      ref={ref}
      className={`pm-cal-popover pm-cal-popover--${pos.placement}`}
      style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
      role="tooltip"
      onMouseLeave={onClose}
    >
      <div className="pm-cal-popover__header">
        <p className="pm-cal-popover__title">{title}</p>
        <StatusPill tone={statusTone(task.status)}>{task.status || "Open"}</StatusPill>
      </div>
      {project !== "—" ? (
        <p className="pm-cal-popover__project">{project}</p>
      ) : null}
      <dl className="pm-cal-popover__meta">
        <div className="pm-cal-popover__row">
          <dt>Due</dt>
          <dd>{formatDate(task.due_date)}</dd>
        </div>
        <div className="pm-cal-popover__row">
          <dt>Created</dt>
          <dd>{formatDate(task.created_on)}</dd>
        </div>
      </dl>
      <p className="pm-cal-popover__hint">Click to open task</p>
    </div>,
    document.body
  );
}

export default function CalendarEventItem({ task }) {
  const linkRef = useRef(null);
  const [popover, setPopover] = useState(null);

  const openPopover = useCallback(() => {
    if (!linkRef.current) return;
    setPopover({ rect: linkRef.current.getBoundingClientRect() });
  }, []);

  const closePopover = useCallback(() => {
    setPopover(null);
  }, []);

  const slug = statusSlug(task.status);
  const priority = priorityTag(task.priority);

  return (
    <li
      className="pm-calendar__event-wrap"
      onMouseEnter={openPopover}
      onMouseLeave={closePopover}
      onFocus={openPopover}
      onBlur={closePopover}
    >
      <Link
        ref={linkRef}
        to={`/tasks/${task.name}`}
        className={`pm-calendar__event pm-calendar__event--${slug}`}
      >
        <span className="pm-calendar__event-accent" aria-hidden />
        <span className="pm-calendar__event-label">{task.task_title || task.name}</span>
        {priority ? <span className="pm-calendar__event-priority">{priority}</span> : null}
      </Link>
      {popover ? (
        <CalendarEventPopover task={task} anchorRect={popover.rect} onClose={closePopover} />
      ) : null}
    </li>
  );
}
