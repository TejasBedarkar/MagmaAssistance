import { useState } from "react";
import Modal from "../../../../common/components/Modal.jsx";
import { PortalBusyButtonContent } from "../../../../common/components/PortalSpinner.jsx";

export default function ProjectHoldActions({
	canPutOnHold,
	canResume,
	busy,
	onPutOnHold,
	onResume,
}) {
	const [holdOpen, setHoldOpen] = useState(false);
	const [resumeOpen, setResumeOpen] = useState(false);
	const [holdReason, setHoldReason] = useState("");
	const [resumeNote, setResumeNote] = useState("");

	if (!canPutOnHold && !canResume) return null;

	async function submitHold() {
		if (!holdReason.trim()) return;
		const ok = await onPutOnHold(holdReason.trim());
		if (ok) {
			setHoldOpen(false);
			setHoldReason("");
		}
	}

	async function submitResume() {
		const ok = await onResume(resumeNote.trim());
		if (ok) {
			setResumeOpen(false);
			setResumeNote("");
		}
	}

	return (
		<>
			{canPutOnHold ? (
				<button
					type="button"
					className="pm-btn"
					disabled={busy}
					onClick={() => setHoldOpen(true)}
				>
					Put on hold
				</button>
			) : null}
			{canResume ? (
				<button
					type="button"
					className="pm-btn pm-btn-primary"
					disabled={busy}
					onClick={() => setResumeOpen(true)}
				>
					Resume delivery
				</button>
			) : null}

			{holdOpen ? (
				<Modal
					title="Put program on hold"
					onClose={() => !busy && setHoldOpen(false)}
					footer={
						<>
							<button
								type="button"
								className="pm-btn pm-btn-ghost"
								disabled={busy}
								onClick={() => setHoldOpen(false)}
							>
								Cancel
							</button>
							<button
								type="button"
								className="pm-btn pm-btn-primary"
								disabled={busy || !holdReason.trim()}
								onClick={submitHold}
								aria-busy={busy}
							>
								<PortalBusyButtonContent busy={busy} busyLabel="Applying…" idleLabel="Put on hold" />
							</button>
						</>
					}
				>
					<p className="pm-modal-context">
						New tasks and milestones will be frozen until you resume delivery. Existing tasks can still
						be worked on.
					</p>
					<div className="pm-field">
						<label className="pm-label">Reason (required)</label>
						<textarea
							className="pm-textarea"
							value={holdReason}
							onChange={(e) => setHoldReason(e.target.value)}
							placeholder="Why is delivery being paused?"
							rows={4}
						/>
					</div>
				</Modal>
			) : null}

			{resumeOpen ? (
				<Modal
					title="Resume delivery"
					onClose={() => !busy && setResumeOpen(false)}
					footer={
						<>
							<button
								type="button"
								className="pm-btn pm-btn-ghost"
								disabled={busy}
								onClick={() => setResumeOpen(false)}
							>
								Cancel
							</button>
							<button
								type="button"
								className="pm-btn pm-btn-primary"
								disabled={busy}
								onClick={submitResume}
								aria-busy={busy}
							>
								<PortalBusyButtonContent busy={busy} busyLabel="Resuming…" idleLabel="Resume" />
							</button>
						</>
					}
				>
					<p className="pm-modal-context">
						The program will return to Active. Team members can create new tasks and milestones again.
					</p>
					<div className="pm-field">
						<label className="pm-label">Note (optional)</label>
						<textarea
							className="pm-textarea"
							value={resumeNote}
							onChange={(e) => setResumeNote(e.target.value)}
							placeholder="Optional note for the team"
							rows={3}
						/>
					</div>
				</Modal>
			) : null}
		</>
	);
}
