import { PortalBusyButtonContent } from "../../../../common/components/PortalSpinner.jsx";

export default function TimesheetForm({
	isNew,
	user,
	isManager,
	form,
	setField,
	projects,
	tasks,
	ctxLoading,
	saving,
	statusOptions,
	isApproved,
	isRejected,
	readOnly,
	canReview,
	onSave,
	onSubmit,
	onReview,
	onDelete,
}) {
	return (
		<form
			className="pm-card pm-form-card"
			onSubmit={(e) => {
				e.preventDefault();
				onSave(e);
			}}
		>
			<div className="pm-form-grid">
				<div className="pm-field">
					<label className="pm-label">Project *</label>
					<select
						className="pm-select"
						required
						disabled={readOnly || ctxLoading}
						value={form.project || ""}
						onChange={(e) => setField("project", e.target.value)}
					>
						<option value="">{ctxLoading ? "Loading…" : "Select project…"}</option>
						{projects.map((p) => (
							<option key={p.name} value={p.name}>
								{p.project_name || p.name}
							</option>
						))}
					</select>
				</div>
				<div className="pm-field">
					<label className="pm-label">Task * (your assigned work)</label>
					<select
						className="pm-select"
						required
						disabled={readOnly || !form.project || ctxLoading}
						value={form.task || ""}
						onChange={(e) => setField("task", e.target.value)}
					>
						<option value="">
							{!form.project
								? "Select project first"
								: tasks.length === 0
									? "No assigned tasks"
									: "Select task…"}
						</option>
						{tasks.map((t) => (
							<option key={t.name} value={t.name}>
								{t.label || t.task_title || t.name}
							</option>
						))}
					</select>
					{!isManager && form.project && tasks.length === 0 ? (
						<p className="pm-form-field-hint">No tasks assigned to you on this project.</p>
					) : null}
				</div>
				<div className="pm-field">
					<label className="pm-label">Date *</label>
					<input
						className="pm-input"
						type="date"
						required
						disabled={readOnly}
						value={form.date || ""}
						onChange={(e) => setField("date", e.target.value)}
					/>
				</div>
				<div className="pm-field">
					<label className="pm-label">Hours *</label>
					<input
						className="pm-input"
						type="number"
						step="0.25"
						min="0.25"
						required
						disabled={readOnly}
						value={form.hours}
						onChange={(e) => setField("hours", e.target.value)}
					/>
				</div>
				<div className="pm-field">
					<label className="pm-label">Status</label>
					{!isManager && (isApproved || isRejected) ? (
						<input className="pm-input" readOnly value={form.status || ""} />
					) : (
						<select
							className="pm-select"
							disabled={readOnly || !isManager || isApproved}
							value={form.status || "Draft"}
							onChange={(e) => setField("status", e.target.value)}
						>
							{statusOptions.map((s) => (
								<option key={s} value={s}>
									{s}
								</option>
							))}
						</select>
					)}
					{!isManager ? (
						<p className="pm-form-field-hint">
							{isApproved
								? "Approved by your program manager. The linked task moves to In Progress automatically."
								: isRejected
									? "Resubmit when ready for manager review."
									: "Save as Draft, or use Submit for manager approval."}
						</p>
					) : null}
				</div>
				{isManager ? (
					<div className="pm-field">
						<label className="pm-label">Cost rate</label>
						<input
							className="pm-input"
							type="number"
							step="0.01"
							disabled={readOnly}
							value={form.cost_rate}
							onChange={(e) => setField("cost_rate", e.target.value)}
						/>
					</div>
				) : null}
				<div className="pm-field pm-form-grid__full">
					<label className="pm-label">Activity description</label>
					<textarea
						className="pm-textarea"
						disabled={readOnly}
						value={form.description || ""}
						onChange={(e) => setField("description", e.target.value)}
						placeholder="What did you work on?"
					/>
				</div>
				{!isManager && user ? (
					<div className="pm-field pm-form-grid__full">
						<p className="pm-form-field-hint pm-form-field-hint--flush">Logged by: {user}</p>
					</div>
				) : null}
			</div>

			{!readOnly ? (
				<div className="pm-form-actions">
					{!isManager && isRejected ? (
						<button type="button" className="pm-btn pm-btn-primary" disabled={saving} onClick={onSubmit} aria-busy={saving}>
							<PortalBusyButtonContent busy={saving} busyLabel="Submitting…" idleLabel="Resubmit for approval" />
						</button>
					) : (
						<>
							<button type="submit" className="pm-btn pm-btn-primary" disabled={saving} aria-busy={saving}>
								<PortalBusyButtonContent busy={saving} busyLabel="Saving…" idleLabel="Save draft" />
							</button>
							{!isManager ? (
								<button type="button" className="pm-btn pm-btn-primary" disabled={saving} onClick={onSubmit} aria-busy={saving}>
									<PortalBusyButtonContent busy={saving} busyLabel="Submitting…" idleLabel="Submit for approval" />
								</button>
							) : canReview ? (
								<>
									<button
										type="button"
										className="pm-btn pm-btn-primary"
										disabled={saving}
										onClick={() => onReview("Approved")}
										aria-busy={saving}
									>
										<PortalBusyButtonContent busy={saving} busyLabel="Approving…" idleLabel="Approve" />
									</button>
									<button
										type="button"
										className="pm-btn pm-btn-danger"
										disabled={saving}
										onClick={() => onReview("Rejected")}
										aria-busy={saving}
									>
										<PortalBusyButtonContent busy={saving} busyLabel="Rejecting…" idleLabel="Reject" />
									</button>
								</>
							) : null}
						</>
					)}
					{!isNew && isManager ? (
						<button type="button" className="pm-btn" disabled={saving} onClick={onDelete}>
							Delete
						</button>
					) : null}
				</div>
			) : null}
		</form>
	);
}
