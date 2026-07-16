import { useEffect, useState } from "react";
import Modal from "../../../../common/components/Modal.jsx";
import { PortalBusyButtonContent } from "../../../../common/components/PortalSpinner.jsx";
import DeliveryTeamEditor from "./DeliveryTeamEditor.jsx";
import {
	emptyDeliveryTeamRow,
	defaultDeliveryTeamDraft,
	normalizeDeliveryTeamRows,
	validateDeliveryTeamDraft,
} from "../../lib/deliveryTeamUtils.js";

export default function DeliveryTeamModal({
	open,
	onClose,
	initialRows,
	onSave,
	saving,
	projectStatus,
}) {
	const [draft, setDraft] = useState([]);
	const [err, setErr] = useState("");
	const [editorKey, setEditorKey] = useState(0);

	useEffect(() => {
		if (!open) return;
		const rows = normalizeDeliveryTeamRows(initialRows);
		setDraft(rows.length ? rows : defaultDeliveryTeamDraft());
		setErr("");
		setEditorKey((key) => key + 1);
	}, [open, initialRows]);

	if (!open) return null;

	async function handleSave() {
		setErr("");
		const validationErr = validateDeliveryTeamDraft(draft);
		if (validationErr) {
			setErr(validationErr);
			return;
		}
		const payload = normalizeDeliveryTeamRows(draft);
		if (payload.length === 0) {
			setErr("Add at least one team member.");
			return;
		}
		const ok = await onSave(payload);
		if (ok) onClose();
	}

	const subtitle =
		projectStatus === "Active"
			? "Add your delivery team (one Developer and one Tester minimum) before milestones and tasks."
			: "Plan delivery resources — include exactly one Tester for QA workflow tasks.";

	return (
		<Modal
			wide
			title="Delivery team"
			onClose={onClose}
			footer={
				<>
					<button type="button" className="pm-btn" disabled={saving} onClick={onClose}>
						Cancel
					</button>
					<button type="button" className="pm-btn pm-btn-primary" disabled={saving} onClick={handleSave}>
						<PortalBusyButtonContent busy={saving} busyLabel="Saving…" idleLabel="Save team" />
					</button>
				</>
			}
		>
			<p className="pm-modal__lead">{subtitle}</p>
			{err ? <div className="pm-error-banner pm-delivery-team-modal__error">{err}</div> : null}
			<DeliveryTeamEditor resetKey={editorKey} rows={draft} onChange={setDraft} />
		</Modal>
	);
}
