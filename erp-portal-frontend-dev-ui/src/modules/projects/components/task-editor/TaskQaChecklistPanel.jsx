import React, { useEffect, useState } from "react";
import { PortalBusyButtonContent } from "../../../../common/components/PortalSpinner.jsx";
import { tasks } from "../../api/index.js";
import { getWorkflowRole, usesQaWorkflowTask } from "../../lib/taskWorkflowUtils.js";

const RESULT_OPTIONS = ["Pending", "Pass", "Fail", "N/A"];

export default function TaskQaChecklistPanel({
	taskName,
	form,
	savedStatus,
	currentUser,
	onUpdated,
}) {
	const [items, setItems] = useState([]);
	const [evidence, setEvidence] = useState([]);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [err, setErr] = useState("");

	const status = savedStatus || form?.status || "Open";
	const qaWorkflow = usesQaWorkflowTask(form);
	const role = getWorkflowRole(form, currentUser);
	const canEdit = qaWorkflow && role === "qa" && status === "QA Testing";

	useEffect(() => {
		if (!taskName || !qaWorkflow) return;
		let cancelled = false;
		(async () => {
			setLoading(true);
			setErr("");
			try {
				const data = await tasks.getQaWorkflow(taskName);
				if (!cancelled) {
					setItems(data?.qa_checklist || []);
					setEvidence(data?.workflow_evidence || []);
				}
			} catch (e) {
				if (!cancelled) setErr(e.message || "Could not load QA checklist");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [taskName, qaWorkflow, status]);

	if (!qaWorkflow) return null;
	if (status !== "QA Testing" && status !== "QA Approved" && status !== "Completed") return null;

	const completed = items.filter((i) => i.result === "Pass" || i.result === "N/A").length;
	const failed = items.filter((i) => i.result === "Fail").length;

	async function onSave() {
		if (!canEdit) return;
		setSaving(true);
		setErr("");
		try {
			const data = await tasks.saveQaChecklist(
				taskName,
				items.map((row) => ({
					name: row.name,
					result: row.result,
					notes: row.notes || "",
				}))
			);
			setItems(data?.qa_checklist || []);
			onUpdated?.(data);
		} catch (e) {
			setErr(e.message || "Could not save checklist");
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="pm-card pm-qa-checklist">
			<div className="pm-qa-checklist__head">
				<h3 className="pm-card__title">QA checklist</h3>
				<span className="pm-qa-checklist__meta">
					{completed}/{items.length} done
					{failed > 0 ? ` · ${failed} failed` : ""}
				</span>
			</div>
			{err ? <div className="pm-error-banner">{err}</div> : null}
			{loading ? (
				<p className="pm-page-desc">Loading checklist…</p>
			) : (
				<div className="pm-qa-checklist__table-wrap">
					<table className="pm-table pm-qa-checklist__table">
						<thead>
							<tr>
								<th>Check</th>
								<th>Result</th>
								<th>Notes</th>
							</tr>
						</thead>
						<tbody>
							{items.map((row) => (
								<tr key={row.name || row.check_name}>
									<td>{row.check_name}</td>
									<td>
										{canEdit ? (
											<select
												className="pm-select pm-select--compact"
												value={row.result || "Pending"}
												onChange={(e) =>
													setItems((prev) =>
														prev.map((r) =>
															r.name === row.name ? { ...r, result: e.target.value } : r
														)
													)
												}
											>
												{RESULT_OPTIONS.map((opt) => (
													<option key={opt} value={opt}>
														{opt}
													</option>
												))}
											</select>
										) : (
											row.result || "Pending"
										)}
									</td>
									<td>
										{canEdit ? (
											<input
												className="pm-input pm-input--compact"
												value={row.notes || ""}
												placeholder="Optional notes"
												onChange={(e) =>
													setItems((prev) =>
														prev.map((r) =>
															r.name === row.name ? { ...r, notes: e.target.value } : r
														)
													)
												}
											/>
										) : (
											row.notes || "—"
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{canEdit ? (
				<div className="pm-form-actions">
					<button type="button" className="pm-btn pm-btn-primary" disabled={saving || loading} onClick={onSave}>
						<PortalBusyButtonContent busy={saving} busyLabel="Saving…" idleLabel="Save checklist" />
					</button>
				</div>
			) : null}
			{evidence.length > 0 ? (
				<div className="pm-qa-checklist__evidence">
					<h4 className="pm-qa-checklist__subtitle">Evidence</h4>
					<ul className="pm-workflow-evidence__list">
						{evidence.map((row) => (
							<li key={row.name || row.file} className="pm-workflow-evidence__item">
								<span className="pm-qa-checklist__evidence-tag">{row.workflow_action}</span>
								<a href={row.file} target="_blank" rel="noreferrer" className="pm-workflow-evidence__link">
									{row.description || row.evidence_type || "File"}
								</a>
							</li>
						))}
					</ul>
				</div>
			) : null}
		</div>
	);
}
