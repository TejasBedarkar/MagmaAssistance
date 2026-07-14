import { Link } from "react-router-dom";
import { PortalBusyButtonContent } from "../../../../common/components/PortalSpinner.jsx";
import { StatusPill } from "../../../../common/components/StatusPill.jsx";
import UserSelect from "../../../../common/components/UserSelect.jsx";
import useUserLabelMap from "../../../../common/hooks/useUserLabelMap.js";
import { formatDateTime } from "../../utils/formatDateTime.js";
import {
	isQaWorkflowManagerStatusReadOnly,
	managerStatusOptions,
	PRIORITIES,
	TEAM_EDITABLE_STATUSES,
	TEAM_STATUSES,
	todayIso,
} from "../../lib/taskEditorConstants.js";
import { usesQaWorkflowTask } from "../../lib/taskWorkflowUtils.js";
import { canManagerCancelTask } from "../../lib/taskCancelUtils.js";
import TaskReopenButton from "./TaskReopenActions.jsx";
import TaskCancelButton from "./TaskCancelActions.jsx";

export default function TaskForm({
	isNew,
	isManager,
	isAdministrator,
	authLoading,
	form,
	setField,
	projects,
	milestones,
	savedStatus,
	isTeamCompletedView,
	isManagerCompletedView,
	isCancelledView,
	saving,
	actionBusy,
	projectNotActive,
	needsDeliveryTeam,
	needsMilestoneFirst,
	selectedProject,
	linkedProject,
	onSave,
	onDelete,
	onReopen,
	onCancel,
	onOpenExtend,
}) {
	const { labelFor } = useUserLabelMap();
	const taskFieldsDisabled = isNew && needsDeliveryTeam;
	const qaWorkflow = usesQaWorkflowTask(form);
	const showQaFields = isManager || qaWorkflow;
	const isCompletedView = isTeamCompletedView || isManagerCompletedView;
	const canCancel = isManager && !isNew && !isCancelledView && canManagerCancelTask(form);
	const status = savedStatus || form.status || "Open";
	const managerStatusReadOnly =
		isManager && !isNew && qaWorkflow && isQaWorkflowManagerStatusReadOnly(qaWorkflow, status);
	const managerStatuses = managerStatusOptions({ qaWorkflow, currentStatus: status });

	return (
		<form className="pm-card pm-form-card" onSubmit={onSave}>
			<div className="pm-form-grid">
				<div className="pm-field">
					<label className="pm-label">Project *</label>
					{isNew && linkedProject && selectedProject ? (
						<div className="pm-program-context">
							<span className="pm-program-context__name">
								{selectedProject.project_name || form.project || "—"}
							</span>
						</div>
					) : (
						<select
							className="pm-select"
							required
							disabled={(!isManager && !isNew) || taskFieldsDisabled}
							value={form.project || ""}
							onChange={(e) => setField("project", e.target.value)}
						>
							<option value="">Select…</option>
							{projects.map((p) => (
								<option key={p.name} value={p.name}>
									{p.project_name || p.name}
								</option>
							))}
						</select>
					)}
				</div>
				<div className="pm-field">
					<label className="pm-label">Milestone</label>
					<select
						className="pm-select"
						disabled={(!isManager && !isNew) || taskFieldsDisabled}
						value={form.milestone || ""}
						onChange={(e) => setField("milestone", e.target.value)}
					>
						<option value="">None</option>
						{milestones.map((m) => (
							<option key={m.name} value={m.name}>
								{m.milestone_name || m.name}
							</option>
						))}
					</select>
				</div>
				{showQaFields ? (
					<>
						<div className="pm-field">
							<label className="pm-label">Developer assigned *</label>
							{isManager ? (
								<UserSelect
									purpose="developer"
									project={form.project || ""}
									required
									disabled={taskFieldsDisabled}
									value={form.developer_assigned_to || form.assigned_to || ""}
									onChange={(v) => setField("developer_assigned_to", v)}
									placeholder="Select developer…"
								/>
							) : (
								<input
									className="pm-input"
									readOnly
									value={labelFor(form.developer_assigned_to || form.assigned_to)}
								/>
							)}
						</div>
					</>
				) : (
					<div className="pm-field">
						<label className="pm-label">Assigned to *</label>
						<input className="pm-input" readOnly value={labelFor(form.assigned_to)} />
					</div>
				)}
				<div className="pm-field">
					<label className="pm-label">Task title *</label>
					<input
						className="pm-input"
						required
						readOnly={!isManager || taskFieldsDisabled}
						disabled={taskFieldsDisabled}
						value={form.task_title || ""}
						onChange={(e) => setField("task_title", e.target.value)}
					/>
				</div>
				<div className="pm-field pm-form-grid__full">
					<label className="pm-label">Description</label>
					<textarea
						className="pm-textarea"
						readOnly={isTeamCompletedView || taskFieldsDisabled}
						disabled={taskFieldsDisabled}
						value={form.description || ""}
						onChange={(e) => setField("description", e.target.value)}
					/>
				</div>
				<div className="pm-field">
					<label className="pm-label">Created date</label>
					<input
						className="pm-input"
						type="date"
						readOnly={!isManager}
						min={isNew ? todayIso() : undefined}
						value={form.created_on || ""}
						onChange={(e) => setField("created_on", e.target.value)}
					/>
				</div>
				<div className="pm-field">
					<label className="pm-label">Due date{qaWorkflow ? " *" : ""}</label>
					<input
						className="pm-input"
						type="date"
						readOnly={!isManager}
						min={form.created_on || (isNew ? todayIso() : undefined)}
						value={form.due_date || ""}
						onChange={(e) => setField("due_date", e.target.value)}
					/>
				</div>
				<div className="pm-field">
					<label className="pm-label">
						{isManager ? `Estimated hours${qaWorkflow ? " *" : ""}` : "Estimated hours (approved time)"}
					</label>
					<input
						className="pm-input"
						type="number"
						step="0.25"
						readOnly={!isManager}
						value={form.estimated_hours}
						onChange={(e) => setField("estimated_hours", e.target.value)}
					/>
					{!isManager ? (
						<p className="pm-form-field-hint">
							Updates to total approved timesheet hours when your manager approves logged time.
						</p>
					) : null}
				</div>
				<div className="pm-field">
					<label className="pm-label">Priority</label>
					<select
						className="pm-select"
						disabled={!isManager}
						value={form.priority || "Medium"}
						onChange={(e) => setField("priority", e.target.value)}
					>
						{PRIORITIES.map((p) => (
							<option key={p} value={p}>
								{p}
							</option>
						))}
					</select>
				</div>
				<div className="pm-field">
					<label className="pm-label">Status</label>
					{isManager && (isManagerCompletedView || isCancelledView || managerStatusReadOnly) ? (
						<input className="pm-input" readOnly value={status} />
					) : isManager ? (
						<select
							className="pm-select"
							value={form.status || "Open"}
							onChange={(e) => setField("status", e.target.value)}
						>
							{managerStatuses.map((s) => (
								<option key={s} value={s}>
									{s}
								</option>
							))}
						</select>
					) : form.status === "Blocked" ||
					  savedStatus === "Completed" ||
					  form.status === "Completed" ||
					  savedStatus === "Cancelled" ||
					  form.status === "Cancelled" ||
					  qaWorkflow ||
					  !TEAM_EDITABLE_STATUSES.has(form.status || "") ? (
						<input className="pm-input" readOnly value={savedStatus || form.status || "—"} />
					) : (
						<select
							className="pm-select"
							value={form.status || "Open"}
							onChange={(e) => setField("status", e.target.value)}
						>
							{TEAM_STATUSES.map((s) => (
								<option key={s} value={s}>
									{s}
								</option>
							))}
						</select>
					)}
					{isManager && managerStatusReadOnly ? (
						<p className="pm-form-field-hint">
							Status changes here are read-only. Use the workflow buttons below (Dev Done, QA
							pass, complete, etc.).
						</p>
					) : null}
				</div>
				{isManager && form.status === "Blocked" ? (
					<div className="pm-field pm-form-grid__full">
						<label className="pm-label">Blocked reason</label>
						<textarea
							className="pm-textarea"
							rows={2}
							value={form.blocked_reason || ""}
							onChange={(e) => setField("blocked_reason", e.target.value)}
							placeholder="Why is this task blocked?"
						/>
					</div>
				) : null}
				{form.rework_reason ? (
					<div className="pm-field pm-form-grid__full">
						<label className="pm-label">Rework reason</label>
						<input className="pm-input" readOnly value={form.rework_reason} />
					</div>
				) : null}
				{form.bug_description ? (
					<div className="pm-field pm-form-grid__full">
						<label className="pm-label">Bug description</label>
						<textarea className="pm-textarea" readOnly rows={2} value={form.bug_description} />
					</div>
				) : null}
				{form.qa_notes ? (
					<div className="pm-field pm-form-grid__full">
						<label className="pm-label">QA notes</label>
						<textarea className="pm-textarea" readOnly rows={2} value={form.qa_notes} />
					</div>
				) : null}
				{(savedStatus === "Completed" || form.status === "Completed") && form.completed_on ? (
					<div className="pm-field pm-form-grid__full">
						<label className="pm-label">Completed on</label>
						<input className="pm-input" readOnly value={formatDateTime(form.completed_on)} />
					</div>
				) : null}
				{form.reopen_reason ? (
					<div className="pm-field pm-form-grid__full">
						<label className="pm-label">Last reopen reason</label>
						<textarea className="pm-textarea" readOnly rows={2} value={form.reopen_reason} />
					</div>
				) : null}
				{form.cancelled_reason ? (
					<div className="pm-field pm-form-grid__full">
						<label className="pm-label">Cancel reason</label>
						<textarea className="pm-textarea" readOnly rows={2} value={form.cancelled_reason} />
					</div>
				) : null}
				{form.cancelled_on ? (
					<div className="pm-field pm-form-grid__full">
						<label className="pm-label">Cancelled on</label>
						<input className="pm-input" readOnly value={formatDateTime(form.cancelled_on)} />
					</div>
				) : null}
			</div>
			<div className="pm-form-actions">
				{!isCompletedView && !isCancelledView ? (
					<button
						type="button"
						className="pm-btn pm-btn-primary"
						disabled={saving || actionBusy || authLoading || projectNotActive || needsDeliveryTeam || needsMilestoneFirst}
						onClick={onSave}
						aria-busy={saving}
					>
						{authLoading && !saving ? (
							"Loading session…"
						) : (
							<PortalBusyButtonContent
								busy={saving}
								busyLabel={isNew ? "Creating…" : "Saving…"}
								idleLabel={isNew ? "Create task" : "Save"}
							/>
						)}
					</button>
				) : isManagerCompletedView ? (
					<TaskReopenButton
						form={form}
						savedStatus={savedStatus}
						actionBusy={actionBusy}
						onReopen={onReopen}
					/>
				) : isCancelledView ? (
					<Link to="/tasks" className="pm-btn">
						Back to tasks
					</Link>
				) : (
					<Link to="/" className="pm-btn">
						Back to dashboard
					</Link>
				)}
				{!isNew && isManager && !isCancelledView ? (
					<button type="button" className="pm-btn" disabled={saving || actionBusy} onClick={onDelete}>
						Delete
					</button>
				) : null}
				{isManager && !isNew && !isCompletedView && !isCancelledView && form.due_date && onOpenExtend ? (
					<button
						type="button"
						className="pm-btn pm-btn-ghost"
						disabled={saving || actionBusy}
						onClick={onOpenExtend}
					>
						Extend deadline
					</button>
				) : null}
				{canCancel ? (
					<TaskCancelButton actionBusy={actionBusy} onCancel={onCancel} />
				) : null}
			</div>
		</form>
	);
}
