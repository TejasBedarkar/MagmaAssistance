import React from "react";
import { Navigate } from "react-router-dom";
import ProjectPageLoader from "./ProjectPageLoader.jsx";
import useProjectAuth from "../hooks/useProjectAuth.js";

/** Developer / Tester only — managers and business analysts are redirected home. */
export default function TeamOnlyRoute({ children }) {
  const { isDeliveryMember, loading } = useProjectAuth();

  if (loading) return <ProjectPageLoader />;
  if (!isDeliveryMember) return <Navigate to="/" replace />;
  return children;
}
