import React from "react";
import { Link, Outlet } from "react-router-dom";
import useProjectAuth from "../hooks/useProjectAuth.js";
import TaskViewNav from "../components/TaskViewNav.jsx";

export default function TasksLayout() {
  const { isManager } = useProjectAuth();

  return (
    <div className="pm-tasks-layout">
      <div className="pm-page-actions pm-page-actions--split">
        <TaskViewNav />
        {isManager ? (
          <Link to="/tasks/new" className="pm-btn pm-btn-primary" style={{ textDecoration: "none" }}>
            New task
          </Link>
        ) : null}
      </div>
      <Outlet />
    </div>
  );
}
