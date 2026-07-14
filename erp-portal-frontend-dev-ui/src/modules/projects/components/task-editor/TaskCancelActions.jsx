import React, { useEffect, useState } from "react";
import { PortalBusyButtonContent } from "../../../../common/components/PortalSpinner.jsx";
import { CANCEL_REASON_MIN_LENGTH } from "../../lib/taskCancelUtils.js";

function CancelTaskModal({ open, busy, onClose, onSubmit }) {
	const [reason, setReason] = useState("");
	useEffect(() => {
		if (!open) setReason("");
	}, [open]);
	if (!open) return null;
	const canSubmit = reason.trim().length >= CANCEL_REASON_MIN_LENGTH;
	return (
		<div className="pm-modal-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
			<div
				className="pm-modal pm-modal--md"
				role="dialog"
				aria-modal="true"
				aria-labelledby="task-cancel-title"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 id="task-cancel-title" className="pm-modal__title">
					Cancel task
				</h3>
				<p className="pm-page-desc pm-page-desc--tight">
					Provide a reason for cancelling. Status will move to <strong>Cancelled</strong>. The team will
					be notified and no further work should be logged on this task.
				</p>
				<div className="pm-field">
					<label className="pm-label" htmlFor="task-cancel-reason">
						Cancel reason *
					</label>
					<textarea
						id="task-cancel-reason"
						className="pm-textarea"
						rows={4}
						value={reason}
						onChange={(e) => setReason(e.target.value)}
						placeholder="Why is this task being cancelled?"
					/>
				</div>
				<div className="pm-form-actions">
					<button type="button" className="pm-btn" disabled={busy} onClick={onClose}>
						Keep task
					</button>
					<button
						type="button"
						className="pm-btn pm-btn-primary"
						disabled={busy || !canSubmit}
						onClick={() => onSubmit(reason.trim())}
						aria-busy={busy}
					>
						<PortalBusyButtonContent busy={busy} busyLabel="Cancelling…" idleLabel="Cancel task" spinnerSize="xs" />
					</button>
				</div>
			</div>
		</div>
	);
}

export default function TaskCancelButton({ actionBusy, onCancel, className = "pm-btn" }) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<button type="button" className={className} disabled={actionBusy} onClick={() => setOpen(true)}>
				Cancel task
			</button>
			<CancelTaskModal
				open={open}
				busy={actionBusy}
				onClose={() => !actionBusy && setOpen(false)}
				onSubmit={async (reason) => {
					await onCancel(reason);
					setOpen(false);
				}}
			/>
		</>
	);
}
