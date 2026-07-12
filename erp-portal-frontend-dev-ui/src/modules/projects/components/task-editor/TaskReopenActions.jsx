import React, { useEffect, useState } from "react";
import { PortalBusyButtonContent } from "../../../../common/components/PortalSpinner.jsx";

const REOPEN_REASON_MIN_LENGTH = 10;

function ReopenModal({ open, busy, targetStatus, onClose, onSubmit }) {
	const [reason, setReason] = useState("");
	useEffect(() => {
		if (!open) setReason("");
	}, [open]);
	if (!open) return null;
	const canSubmit = reason.trim().length >= REOPEN_REASON_MIN_LENGTH;
	return (
		<div className="pm-modal-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
			<div
				className="pm-modal pm-modal--md"
				role="dialog"
				aria-modal="true"
				aria-labelledby="task-reopen-title"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 id="task-reopen-title" className="pm-modal__title">
					Reopen task
				</h3>
				<p className="pm-page-desc pm-page-desc--tight">
					Provide a reason for reopening. Status will move to <strong>{targetStatus}</strong>. The assignee
					uses <strong>Start</strong> on My Day when they begin work.
				</p>
				<div className="pm-field">
					<label className="pm-label" htmlFor="task-reopen-reason">
						Reopen reason *
					</label>
					<textarea
						id="task-reopen-reason"
						className="pm-textarea"
						rows={4}
						value={reason}
						onChange={(e) => setReason(e.target.value)}
						placeholder="Why is this task being reopened?"
					/>
				</div>
				<div className="pm-form-actions">
					<button type="button" className="pm-btn" disabled={busy} onClick={onClose}>
						Cancel
					</button>
					<button
						type="button"
						className="pm-btn pm-btn-primary"
						disabled={busy || !canSubmit}
						onClick={() => onSubmit(reason.trim())}
						aria-busy={busy}
					>
						<PortalBusyButtonContent busy={busy} busyLabel="Reopening…" idleLabel="Reopen" spinnerSize="xs" />
					</button>
				</div>
			</div>
		</div>
	);
}

export default function TaskReopenButton({ form, savedStatus, actionBusy, onReopen, className = "pm-btn pm-btn-primary" }) {
	const [open, setOpen] = useState(false);
	const status = savedStatus || form.status || "Open";
	const targetStatus = "Open";

	return (
		<>
			<button type="button" className={className} disabled={actionBusy} onClick={() => setOpen(true)}>
				<PortalBusyButtonContent busy={actionBusy} busyLabel="Reopening…" idleLabel="Reopen task" spinnerSize="xs" />
			</button>
			<ReopenModal
				open={open}
				busy={actionBusy}
				targetStatus={targetStatus}
				onClose={() => !actionBusy && setOpen(false)}
				onSubmit={async (reason) => {
					await onReopen(reason);
					setOpen(false);
				}}
			/>
		</>
	);
}
