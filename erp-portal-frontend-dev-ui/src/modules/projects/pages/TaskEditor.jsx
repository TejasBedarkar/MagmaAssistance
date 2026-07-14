import React from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import Modal from "../../../common/components/Modal.jsx";
import { PortalBusyButtonContent } from "../../../common/components/PortalSpinner.jsx";
import { tasks } from "../api/index.js";
import ProjectPageLoader from "../components/ProjectPageLoader.jsx";
import TaskTimelinePanel from "../components/task-editor/TaskTimelinePanel.jsx";
import TaskBanners from "../components/task-editor/TaskBanners.jsx";
import TaskForm from "../components/task-editor/TaskForm.jsx";
import TaskWorkflowActions from "../components/task-editor/TaskWorkflowActions.jsx";
import TaskQaChecklistPanel from "../components/task-editor/TaskQaChecklistPanel.jsx";
import DeliveryTeamModal from "../components/project-editor/DeliveryTeamModal.jsx";
import useTaskEditor from "../hooks/useTaskEditor.js";

export default function TaskEditor() {
	const { id: routeId } = useParams();
	const location = useLocation();
	const savedNotice = location.state?.savedNotice;

	const editor = useTaskEditor(routeId);
	const {
		id,
		isNew,
		isManager,
		isAdministrator,
		authLoading,
		form,
		setField,
		projects,
		milestones,
		loading,
		saving,
		err,
		timeline,
		actionBusy,
		savedStatus,
		projectStatus,
		projectLoading,
		holdReason,
		projectNotActive,
		needsDeliveryTeam,
		needsMilestoneFirst,
		isTeamCompletedView,
		isManagerCompletedView,
		isCancelledView,
		usesQaWorkflow,
		currentUser,
		selectedProject,
		linkedProject,
		deliveryTeamRows,
		teamModalOpen,
		handleTeamModalClose,
		teamSaving,
		saveDeliveryTeam,
		loadTaskFeed,
		onSave,
		onStart,
		onMarkDevDone,
		onQaPass,
		onQaRework,
		onComplete,
		onReopen,
		onCancel,
		onDelete,
		extendOpen,
		extendDate,
		setExtendDate,
		extendNote,
		setExtendNote,
		openExtendModal,
		closeExtendModal,
		onExtendDeadline,
		taskBackTo,
		taskBackLabel,
	} = editor;

	if (loading) return <ProjectPageLoader message="Loading task…" />;

	if (isNew && !isManager) {
		return (
			<div className="pm-page pm-form-page">
				<div className="pm-form-page__head">
					<Link to="/tasks" className="pm-back-link">
						← Tasks
					</Link>
				</div>
				<div className="pm-error-banner">{err || "Only program managers can create tasks."}</div>
			</div>
		);
	}

	if (isNew && form.project && projectLoading && linkedProject) {
		return (
			<div className="pm-page pm-form-page">
				<div className="pm-form-page__head">
					<Link to={taskBackTo} className="pm-back-link">
						{taskBackLabel}
					</Link>
					<h1 className="pm-form-page__title">Create task</h1>
				</div>
				<ProjectPageLoader message="Checking program status…" minHeight={160} />
			</div>
		);
	}

	return (
		<div className="pm-page pm-form-page">
			<div className="pm-form-page__head">
				<Link to={taskBackTo} className="pm-back-link">
					{taskBackLabel}
				</Link>
				<h1 className="pm-form-page__title">{isNew ? "Create task" : form.task_title || id}</h1>
				{isNew ? (
					<p className="pm-page-desc" style={{ marginBottom: 0 }}>
						Assign work on an Active program with a delivery team and milestone.
					</p>
				) : null}
			</div>

			<TaskBanners
				err={err}
				savedNotice={savedNotice}
				isManager={isManager}
				isNew={isNew}
				form={form}
				savedStatus={savedStatus}
				projectStatus={projectStatus}
				projectNotActive={projectNotActive}
				holdReason={holdReason}
				needsMilestoneFirst={needsMilestoneFirst}
				isTeamCompletedView={isTeamCompletedView}
				isManagerCompletedView={isManagerCompletedView}
				isCancelledView={isCancelledView}
				usesQaWorkflow={usesQaWorkflow}
				currentUser={currentUser}
			/>

			<TaskForm
				isNew={isNew}
				isManager={isManager}
				isAdministrator={isAdministrator}
				authLoading={authLoading}
				form={form}
				setField={setField}
				projects={projects}
				milestones={milestones}
				savedStatus={savedStatus}
				isTeamCompletedView={isTeamCompletedView}
				isManagerCompletedView={isManagerCompletedView}
				isCancelledView={isCancelledView}
				saving={saving}
				actionBusy={actionBusy}
				projectNotActive={projectNotActive}
				needsDeliveryTeam={needsDeliveryTeam}
				needsMilestoneFirst={needsMilestoneFirst}
				selectedProject={selectedProject}
				linkedProject={linkedProject}
				onSave={onSave}
				onDelete={onDelete}
				onReopen={onReopen}
				onCancel={onCancel}
				onOpenExtend={openExtendModal}
			/>

			{!isNew && !isTeamCompletedView && !isManagerCompletedView && !isCancelledView ? (
				<TaskWorkflowActions
					form={form}
					savedStatus={savedStatus}
					currentUser={currentUser}
					isManager={isManager}
					actionBusy={actionBusy}
					onMarkDevDone={onMarkDevDone}
					onStart={onStart}
					onQaPass={onQaPass}
					onQaRework={onQaRework}
					onComplete={onComplete}
				/>
			) : null}

			{!isNew && usesQaWorkflow && !isCancelledView ? (
				<TaskQaChecklistPanel
					taskName={id}
					form={form}
					savedStatus={savedStatus}
					currentUser={currentUser}
					onUpdated={() => loadTaskFeed(id).catch(() => {})}
				/>
			) : null}

			{!isNew ? (
				<div className="pm-task-feed">
					<TaskTimelinePanel
						timeline={timeline}
						disabled={isCancelledView}
						postComment={(content) => tasks.addComment(id, content)}
						onPosted={() => loadTaskFeed(id).catch(() => {})}
					/>
				</div>
			) : null}

			<DeliveryTeamModal
				open={teamModalOpen}
				onClose={handleTeamModalClose}
				initialRows={deliveryTeamRows}
				onSave={saveDeliveryTeam}
				saving={teamSaving}
				projectStatus={selectedProject?.status || projectStatus || "Active"}
			/>

			{extendOpen ? (
				<Modal
					title="Extend deadline"
					onClose={closeExtendModal}
					footer={
						<>
							<button
								type="button"
								className="pm-btn pm-btn-ghost"
								disabled={actionBusy}
								onClick={closeExtendModal}
							>
								Cancel
							</button>
							<button
								type="button"
								className="pm-btn pm-btn-primary"
								disabled={actionBusy || !extendDate || !extendNote.trim()}
								onClick={onExtendDeadline}
								aria-busy={actionBusy}
							>
								<PortalBusyButtonContent busy={actionBusy} busyLabel="Applying…" idleLabel="Apply" />
							</button>
						</>
					}
				>
					<p className="pm-modal-context">Task: {form.task_title || id}</p>
					<div className="pm-field">
						<label className="pm-label">New commitment date</label>
						<input
							className="pm-input"
							type="date"
							value={extendDate}
							onChange={(e) => setExtendDate(e.target.value)}
						/>
					</div>
					<div className="pm-field">
						<label className="pm-label">Note (required)</label>
						<textarea
							className="pm-textarea"
							value={extendNote}
							onChange={(e) => setExtendNote(e.target.value)}
							rows={3}
						/>
					</div>
				</Modal>
			) : null}
		</div>
	);
}
