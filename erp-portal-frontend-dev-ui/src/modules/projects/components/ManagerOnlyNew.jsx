import React from "react";
import { Navigate, useParams } from "react-router-dom";
import ProjectPageLoader from "./ProjectPageLoader.jsx";
import useProjectAuth from "../hooks/useProjectAuth.js";

/**
 * Redirects non-managers away from /:resource/new URLs.
 */
export default function ManagerOnlyNew({ children, redirectTo }) {
  const { id } = useParams();
  const { isManager, loading } = useProjectAuth();
  const isNew = !id || id === "new";

  if (!isNew) return children;
  if (loading) return <ProjectPageLoader />;
  if (!isManager) return <Navigate to={redirectTo} replace />;
  return children;
}
