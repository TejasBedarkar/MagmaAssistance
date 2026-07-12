import React, { useState } from "react";
import { PortalBusyButtonContent } from "../../../../common/components/PortalSpinner.jsx";
import { getWorkflowRole, usesQaWorkflowTask } from "../../lib/taskWorkflowUtils.js";
import { canDeveloperStartTask } from "../../lib/taskReopenUtils.js";
import WorkflowEvidenceUpload from "./WorkflowEvidenceUpload.jsx";

function QaPassModal({ open, busy, onClose, onSubmit }) {
	const [qaNotes, setQaNotes] = useState("");
	const [evidence, setEvidence] = useState([]);
	if (!open) return null;
	return (
		<div className="pm-modal-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
			<div
				className="pm-modal pm-modal--md"
				role="dialog"
				aria-modal="true"
				aria-labelledby="qa-pass-title"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 id="qa-pass-title" className="pm-modal__title">
					QA approval
				</h3>
				<p className="pm-page-desc pm-page-desc--tight">
					Complete the checklist first, then summarize results. Attach optional evidence files.
				</p>
				<div className="pm-field">
					<label className="pm-label" htmlFor="qa-notes">
						QA notes *
					</label>
					<textarea
						id="qa-notes"
						className="pm-textarea"
						rows={4}
						value={qaNotes}
						onChange={(e) => setQaNotes(e.target.value)}
						placeholder="Test coverage, pass/fail summary, risks…"
					/>
				</div>
				<WorkflowEvidenceUpload disabled={busy} onFilesChange={setEvidence} />
				<div className="pm-form-actions">
					<button type="button" className="pm-btn" disabled={busy} onClick={onClose}>
						Cancel
					</button>
					<button
						type="button"
						className="pm-btn pm-btn-primary"
						disabled={busy || !qaNotes.trim()}
						onClick={() => onSubmit(qaNotes.trim(), evidence)}
						aria-busy={busy}
					>
						<PortalBusyButtonContent busy={busy} busyLabel="Submitting…" idleLabel="Approve" spinnerSize="xs" />
					</button>
				</div>
			</div>
		</div>
	);
}

function QaReworkModal({ open, busy, onClose, onSubmit }) {
	const [reworkReason, setReworkReason] = useState("");
	const [bugDescription, setBugDescription] = useState("");
	const [evidence, setEvidence] = useState([]);
	if (!open) return null;
	const canSubmit = reworkReason.trim() && evidence.length > 0;
	return (
		<div className="pm-modal-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
			<div
				className="pm-modal pm-modal--md"
				role="dialog"
				aria-modal="true"
				aria-labelledby="qa-rework-title"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 id="qa-rework-title" className="pm-modal__title">
					Send for rework
				</h3>
				<p className="pm-page-desc pm-page-desc--tight">
					Return the task to the developer with rework details and at least one evidence file.
				</p>
				<div className="pm-field">
					<label className="pm-label" htmlFor="rework-reason">
						Rework reason *
					</label>
					<input
						id="rework-reason"
						className="pm-input"
						value={reworkReason}
						onChange={(e) => setReworkReason(e.target.value)}
						placeholder="e.g. Regression on login flow"
					/>
				</div>
				<div className="pm-field">
					<label className="pm-label" htmlFor="bug-description">
						Bug description
					</label>
					<textarea
						id="bug-description"
						className="pm-textarea"
						rows={3}
						value={bugDescription}
						onChange={(e) => setBugDescription(e.target.value)}
						placeholder="Steps, expected vs actual…"
					/>
				</div>
				<WorkflowEvidenceUpload disabled={busy} onFilesChange={setEvidence} />
				<div className="pm-form-actions">
					<button type="button" className="pm-btn" disabled={busy} onClick={onClose}>
						Cancel
					</button>
					<button
						type="button"
						className="pm-btn pm-btn-primary"
						disabled={busy || !canSubmit}
						onClick={() => onSubmit(reworkReason.trim(), bugDescription.trim(), evidence)}
						aria-busy={busy}
					>
						<PortalBusyButtonContent busy={busy} busyLabel="Sending…" idleLabel="Send rework" spinnerSize="xs" />
					</button>
				</div>
			</div>
		</div>
	);
}

export default function TaskWorkflowActions({
	form,
	savedStatus,
	currentUser,
	isManager,
	actionBusy,
	onMarkDevDone,
	onStart,
	onQaPass,
	onQaRework,
	onComplete,
}) {
	const [passOpen, setPassOpen] = useState(false);
	const [reworkOpen, setReworkOpen] = useState(false);

	const status = savedStatus || form.status || "Open";
	const qaWorkflow = usesQaWorkflowTask(form);
	const role = getWorkflowRole(form, currentUser);
	const isAssignee = String(form.assigned_to || "").trim() === String(currentUser || "").trim();
	const isLegacyComplete =
		!qaWorkflow && !isManager && isAssignee && status !== "Completed" && status !== "Blocked";

	if (!qaWorkflow && !isLegacyComplete && !(isManager && status === "QA Approved")) {
		return null;
	}

	const canStart = canDeveloperStartTask(form, currentUser);
	const canDevDone = qaWorkflow && role === "developer" && status === "In Progress";
	const canQaPass = qaWorkflow && role === "qa" && status === "QA Testing";
	const canQaRework = qaWorkflow && role === "qa" && status === "QA Testing";
	const canManagerComplete = isManager && qaWorkflow && status === "QA Approved";

	return (
		<>
			<div className="pm-workflow-actions">
				{qaWorkflow ? (
					<p className="pm-page-desc pm-page-desc--tight pm-workflow-actions__hint">
						{canStart
							? "Start work, then mark dev done to hand over to QA."
							: "Complete the QA checklist, then use pass or rework. Manager completes after QA approval."}
					</p>
				) : null}
				<div className="pm-form-actions pm-workflow-actions__buttons">
					{canStart ? (
						<button
							type="button"
							className="pm-btn pm-btn-primary"
							disabled={actionBusy}
							onClick={onStart}
							aria-busy={actionBusy}
						>
							<PortalBusyButtonContent busy={actionBusy} busyLabel="Starting…" idleLabel="Start" spinnerSize="xs" />
						</button>
					) : null}
					{canDevDone ? (
						<button
							type="button"
							className="pm-btn pm-btn-primary"
							disabled={actionBusy}
							onClick={onMarkDevDone}
							aria-busy={actionBusy}
						>
							<PortalBusyButtonContent
								busy={actionBusy}
								busyLabel="Handing over…"
								idleLabel="Mark dev done"
							/>
						</button>
					) : null}
					{canQaPass ? (
						<button
							type="button"
							className="pm-btn pm-btn-primary"
							disabled={actionBusy}
							onClick={() => setPassOpen(true)}
						>
							QA pass
						</button>
					) : null}
					{canQaRework ? (
						<button type="button" className="pm-btn" disabled={actionBusy} onClick={() => setReworkOpen(true)}>
							Send rework
						</button>
					) : null}
					{canManagerComplete ? (
						<button
							type="button"
							className="pm-btn pm-btn-primary"
							disabled={actionBusy}
							onClick={onComplete}
							aria-busy={actionBusy}
						>
							<PortalBusyButtonContent
								busy={actionBusy}
								busyLabel="Completing…"
								idleLabel="Mark complete"
							/>
						</button>
					) : null}
					{isLegacyComplete ? (
						<button
							type="button"
							className="pm-btn pm-btn-primary"
							disabled={actionBusy}
							onClick={onComplete}
							aria-busy={actionBusy}
						>
							<PortalBusyButtonContent
								busy={actionBusy}
								busyLabel="Completing…"
								idleLabel="Mark complete"
							/>
						</button>
					) : null}
				</div>
			</div>
			<QaPassModal
				open={passOpen}
				busy={actionBusy}
				onClose={() => setPassOpen(false)}
				onSubmit={async (notes, evidence) => {
					await onQaPass(notes, evidence);
					setPassOpen(false);
				}}
			/>
			<QaReworkModal
				open={reworkOpen}
				busy={actionBusy}
				onClose={() => setReworkOpen(false)}
				onSubmit={async (reason, bug, evidence) => {
					await onQaRework(reason, bug, evidence);
					setReworkOpen(false);
				}}
			/>
		</>
	);
}
