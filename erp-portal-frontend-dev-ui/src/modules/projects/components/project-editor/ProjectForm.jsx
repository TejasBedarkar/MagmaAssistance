import { PortalBusyButtonContent } from "../../../../common/components/PortalSpinner.jsx";
import LinkSelect from "../LinkSelect.jsx";
import UserSelect from "../../../../common/components/UserSelect.jsx";
import { StatusPill } from "../../../../common/components/StatusPill.jsx";
import useUserLabelMap from "../../../../common/hooks/useUserLabelMap.js";
import { statusTone, todayIso } from "../../lib/projectEditorConstants.js";
import ProjectHoldActions from "./ProjectHoldActions.jsx";

export default function ProjectForm({
	isNew,
	isManager,
	isAdministrator,
	user,
	isProgramManagerOnly,
	pmStatusReadOnly,
	teamViewOnly,
	form,
	setField,
	currentStatus,
	canSubmitForApproval,
	statusLocked,
	canPutOnHold,
	canResume,
	statusOptions,
	codeLoading,
	saving,
	canEditBudget,
	canEditStartDate,
	canDeleteProject,
	onSave,
	onSubmitForApproval,
	onPutOnHold,
	onResume,
	onDelete,
}) {
	const { labelFor } = useUserLabelMap();
	const FormTag = teamViewOnly ? "div" : "form";

	return (
		<FormTag className="pm-card pm-form-card" {...(teamViewOnly ? {} : { onSubmit: onSave })}>
			<div className="pm-form-grid">
				<div className="pm-field">
					<label className="pm-label">Project code</label>
					<input
						className="pm-input"
						value={codeLoading && isNew ? "" : form.project_code || ""}
						readOnly
						aria-readonly="true"
						placeholder={isNew && codeLoading ? "Loading…" : undefined}
					/>
				</div>
				<div className="pm-field">
					<label className="pm-label">Project name *</label>
					<input
						className="pm-input"
						required={isManager}
						value={form.project_name || ""}
						onChange={(e) => setField("project_name", e.target.value)}
						readOnly={!isManager}
					/>
				</div>
				<div className="pm-field pm-form-grid__full">
					<label className="pm-label">Description</label>
					<textarea
						className="pm-textarea"
						value={form.description || ""}
						onChange={(e) => setField("description", e.target.value)}
						rows={4}
						readOnly={!isManager}
					/>
				</div>
				<div className="pm-field">
					<label className="pm-label">Customer</label>
					<LinkSelect
						doctype="Customer"
						value={form.customer || ""}
						onChange={(v) => setField("customer", v)}
						readOnly={!isManager}
						allowCreate={isManager}
						createLabel="Create new customer"
						placeholder="Search customer…"
					/>
				</div>
				<div className="pm-field">
					<label className="pm-label">Project manager</label>
					{isAdministrator ? (
						<UserSelect
							purpose="project_manager"
							value={form.project_manager || ""}
							onChange={(v) => setField("project_manager", v)}
							placeholder="Select project manager…"
						/>
					) : (
						<input className="pm-input" value={labelFor(form.project_manager || user)} readOnly />
					)}
				</div>
				<div className="pm-field">
					<label className="pm-label">Start date</label>
					<input
						className="pm-input"
						type="date"
						value={form.start_date || ""}
						min={isNew ? todayIso() : undefined}
						onChange={(e) => setField("start_date", e.target.value)}
						readOnly={!isManager || (!isNew && !canEditStartDate)}
					/>
				</div>
				<div className="pm-field">
					<label className="pm-label">End date</label>
					<input
						className="pm-input"
						type="date"
						value={form.end_date || ""}
						min={form.start_date || (isNew ? todayIso() : undefined)}
						onChange={(e) => setField("end_date", e.target.value)}
						readOnly={!isManager}
					/>
				</div>
				{isManager ? (
					<>
						<div className="pm-field">
							<label className="pm-label">Budget</label>
							<input
								className="pm-input"
								type="number"
								step="0.01"
								value={form.budget}
								onChange={(e) => setField("budget", e.target.value)}
								readOnly={!canEditBudget}
							/>
						</div>
						<div className="pm-field">
							<label className="pm-label">Cost center</label>
							<LinkSelect
								doctype="Cost Center"
								value={form.cost_center || ""}
								onChange={(v) => setField("cost_center", v)}
								placeholder="Search cost center…"
								readOnly={!canEditBudget}
							/>
						</div>
						<div className="pm-field">
							<label className="pm-label">Non-labour cost</label>
							<input
								className="pm-input"
								type="number"
								step="0.01"
								value={form.non_labour_cost}
								onChange={(e) => setField("non_labour_cost", e.target.value)}
								readOnly={!canEditBudget}
							/>
						</div>
						<div className="pm-field">
							<label className="pm-label">Cost alert threshold (%)</label>
							<input
								className="pm-input"
								type="number"
								value={form.cost_alert_threshold}
								onChange={(e) => setField("cost_alert_threshold", e.target.value)}
								readOnly={!canEditBudget}
							/>
						</div>
						{!canEditBudget ? (
							<p className="pm-page-desc pm-form-grid__full" style={{ margin: 0 }}>
								Budget and cost fields are view-only. Contact an administrator to change financial
								settings.
							</p>
						) : null}
					</>
				) : null}
				<div className="pm-field">
					<label className="pm-label">Status</label>
					{pmStatusReadOnly || statusLocked ? (
						<div className="pm-project-status-readonly">
							<StatusPill tone={statusTone(currentStatus)}>{currentStatus}</StatusPill>
							{statusLocked ? (
								<span className="pm-project-status-readonly__hint">Awaiting administrator approval</span>
							) : null}
							{currentStatus === "Rejected" && isProgramManagerOnly ? (
								<span className="pm-project-status-readonly__hint">
									Update details and submit again for approval
								</span>
							) : null}
							{currentStatus === "On Hold" ? (
								<span className="pm-project-status-readonly__hint">
									{form.hold_reason
										? `On hold — ${form.hold_reason}`
										: "Delivery is paused — resume when ready"}
								</span>
							) : null}
						</div>
					) : isAdministrator ? (
						<select
							className="pm-select"
							value={form.status || "Draft"}
							onChange={(e) => setField("status", e.target.value)}
						>
							{statusOptions.map((s) => (
								<option key={s} value={s}>
									{s}
								</option>
							))}
						</select>
					) : (
						<StatusPill tone={statusTone(currentStatus)}>{currentStatus || "—"}</StatusPill>
					)}
				</div>
			</div>
			{isManager ? (
				<div className="pm-form-actions">
					<button type="submit" className="pm-btn pm-btn-primary" disabled={saving} aria-busy={saving}>
						<PortalBusyButtonContent
							busy={saving}
							busyLabel={isNew ? "Creating…" : "Saving…"}
							idleLabel={
								isNew && isProgramManagerOnly
									? "Create & submit for approval"
									: isNew
										? "Create project"
										: "Save"
							}
						/>
					</button>
					{canSubmitForApproval ? (
						<button
							type="button"
							className="pm-btn pm-btn-primary"
							disabled={saving}
							onClick={onSubmitForApproval}
							aria-busy={saving}
						>
							<PortalBusyButtonContent
								busy={saving}
								busyLabel="Submitting…"
								idleLabel="Submit for approval"
							/>
						</button>
					) : null}
					<ProjectHoldActions
						canPutOnHold={canPutOnHold}
						canResume={canResume}
						busy={saving}
						onPutOnHold={onPutOnHold}
						onResume={onResume}
					/>
					{!isNew && canDeleteProject ? (
						<button type="button" className="pm-btn" disabled={saving} onClick={onDelete}>
							Delete
						</button>
					) : null}
				</div>
			) : null}
		</FormTag>
	);
}
