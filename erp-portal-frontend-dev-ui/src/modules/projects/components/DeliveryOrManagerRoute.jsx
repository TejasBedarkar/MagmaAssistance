import React from "react";
import { Navigate } from "react-router-dom";
import ProjectPageLoader from "./ProjectPageLoader.jsx";
import useProjectAuth from "../hooks/useProjectAuth.js";

/** Program managers, delivery team, and administrators — blocks business-analyst-only access. */
export default function DeliveryOrManagerRoute({ children }) {
	const { isManager, isDeliveryMember, isAdministrator, loading } = useProjectAuth();

	if (loading) return <ProjectPageLoader />;
	if (!isManager && !isDeliveryMember && !isAdministrator) {
		return <Navigate to="/" replace />;
	}
	return children;
}
