import React from "react";
import ProjectEmptyState from "../components/ProjectEmptyState.jsx";
import ProjectPageLoader from "../components/ProjectPageLoader.jsx";
import useDashboard from "../hooks/useDashboard.js";
import AdministratorDashboard from "./AdministratorDashboard.jsx";
import ManagerDashboard from "./ManagerDashboard.jsx";
import TeamDashboard from "./TeamDashboard.jsx";
import BADashboard from "./BADashboard.jsx";

export default function Dashboard() {
	const dash = useDashboard();
	const {
		isManager,
		isAdministrator,
		isBusinessAnalyst,
		isDeliveryMember,
		data,
		loading,
		err,
		updated,
		load,
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
		onExtend,
		onReassign,
		onComplete,
	} = dash;

	if (loading && !data) {
		return (
			<div className="pm-page pm-dashboard-loading">
				<ProjectPageLoader message="Loading dashboard…" />
			</div>
		);
	}

	if (err && !data) {
		return (
			<div className="pm-page">
				<ProjectEmptyState error={err} onRetry={load} />
			</div>
		);
	}

	if (isManager) {
		const managerProps = {
			data,
			loading,
			updated,
			err,
			onRefresh: load,
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
		};

		if (isAdministrator) {
			return <AdministratorDashboard {...managerProps} />;
		}

		return <ManagerDashboard {...managerProps} />;
	}

	if (isBusinessAnalyst) {
		return <BADashboard data={data} err={err} />;
	}

  if (isDeliveryMember) {
		return (
			<TeamDashboard
				data={data}
				err={err}
				onRefresh={load}
			/>
		);
  }

  return (
		<TeamDashboard
			data={data}
			err={err}
			onRefresh={load}
		/>
  );
}
