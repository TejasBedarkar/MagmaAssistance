import React from "react";
import { NavLink } from "react-router-dom";

const VIEWS = [
  { to: "/tasks", label: "List", end: true },
  { to: "/tasks/board", label: "Board", end: false },
  { to: "/tasks/calendar", label: "Calendar", end: false },
];

export default function TaskViewNav() {
  return (
    <nav className="pm-task-views" aria-label="Task views">
      {VIEWS.map((v) => (
        <NavLink
          key={v.to}
          to={v.to}
          end={v.end}
          className={({ isActive }) => `pm-task-views__tab${isActive ? " pm-task-views__tab--active" : ""}`}
        >
          {v.label}
        </NavLink>
      ))}
    </nav>
  );
}
