import React from "react";
import { Link, useParams } from "react-router-dom";
import ProjectPageLoader from "../components/ProjectPageLoader.jsx";
import ProjectForm from "../components/project-editor/ProjectForm.jsx";
import ProjectDeliveryPanel from "../components/project-editor/ProjectDeliveryPanel.jsx";
import useProjectEditor from "../hooks/useProjectEditor.js";

export default function ProjectEditor() {
	const { id } = useParams();
	const editor = useProjectEditor(id);
	const {
		isNew,
		isManager,
		isProgramManager,
		teamViewOnly,
		form,
		currentStatus,
		loading,
		err,
		deliveryRefresh,
		isProgramManagerOnly,
		isAdministrator,
		needsDeliveryTeam,
		canEditDeliveryTeam,
		teamSaving,
		saveDeliveryTeam,
	} = editor;

	if (loading) {
		return (
			<div className="pm-page pm-form-page">
				<ProjectPageLoader message="Loading project…" />
			</div>
		);
	}

	if (isNew && !isManager) {
		return (
			<div className="pm-page pm-form-page">
				<div className="pm-form-page__head">
					<Link to="/projects" className="pm-back-link">
						← Programs & Projects
					</Link>
				</div>
				<div className="pm-error-banner">{err || "You do not have permission to create projects."}</div>
			</div>
		);
	}

	return (
		<div className="pm-page pm-form-page">
			<div className="pm-form-page__head">
				<Link to="/projects" className="pm-back-link">
					← Programs & Projects
				</Link>
				<h1 className="pm-form-page__title">{isNew ? "New program / project" : form.project_name || id}</h1>
				<p className="pm-page-desc" style={{ marginBottom: 0 }}>
					{isNew
						? isProgramManagerOnly
							? "Register a new program. It will be submitted for administrator approval when you create it."
							: isAdministrator
								? "Register a new initiative. Choose Draft for planning or Active to start delivery immediately."
								: "Register a new initiative in the portfolio."
						: isManager
							? "Update program details and save."
							: "View-only — budget and costs are for program managers only."}
				</p>
			</div>

			{err ? <div className="pm-error-banner">{err}</div> : null}

			{!isNew && currentStatus === "On Hold" ? (
				<div className="pm-error-banner" role="status">
					This program is <strong>on hold</strong>
					{form.hold_reason ? ` — ${form.hold_reason}` : ""}. New tasks and milestones are frozen until
					the program manager resumes delivery.
				</div>
			) : null}

			{teamViewOnly ? (
				<p className="pm-form-hint pm-form-grid__full" style={{ margin: "0 0 12px" }}>
					View-only program details.
				</p>
			) : null}

			<ProjectForm {...editor} />

			{!isNew ? (
				<ProjectDeliveryPanel
					projectId={id}
					rows={form.delivery_team || []}
					readOnly={teamViewOnly}
					canEdit={canEditDeliveryTeam}
					currentStatus={currentStatus}
					onSaveTeam={saveDeliveryTeam}
					teamSaving={teamSaving}
					isManager={isProgramManager || isManager}
					refreshKey={deliveryRefresh}
				/>
			) : null}
		</div>
	);
}
