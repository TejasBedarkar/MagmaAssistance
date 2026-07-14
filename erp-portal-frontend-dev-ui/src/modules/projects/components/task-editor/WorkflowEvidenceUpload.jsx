import React, { useState } from "react";
import { PortalBusyButtonContent } from "../../../../common/components/PortalSpinner.jsx";
import { uploadFile } from "../../api/files.js";

const EVIDENCE_TYPES = ["Screenshot", "Video", "Document", "Other"];

/**
 * @param {{ onFilesChange: (files: Array<{file: string, evidence_type: string, description: string}>) => void, disabled?: boolean }} props
 */
export default function WorkflowEvidenceUpload({ onFilesChange, disabled = false }) {
	const [rows, setRows] = useState([]);
	const [uploading, setUploading] = useState(false);
	const [err, setErr] = useState("");

	async function onPickFile(event) {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file || disabled) return;
		setErr("");
		setUploading(true);
		try {
			const fileUrl = await uploadFile(file);
			const next = [
				...rows,
				{
					file: fileUrl,
					evidence_type: file.type?.startsWith("video/") ? "Video" : "Screenshot",
					description: file.name,
				},
			];
			setRows(next);
			onFilesChange(next);
		} catch (e) {
			setErr(e.message || "Upload failed");
		} finally {
			setUploading(false);
		}
	}

	function removeRow(index) {
		const next = rows.filter((_, i) => i !== index);
		setRows(next);
		onFilesChange(next);
	}

	return (
		<div className="pm-workflow-evidence">
			<label className="pm-label">Evidence (screenshot / file)</label>
			<div className="pm-workflow-evidence__toolbar">
				<label className={`pm-btn pm-btn-sm${disabled || uploading ? " pm-btn--disabled" : ""}`}>
					{uploading ? "Uploading…" : "Attach file"}
					<input
						type="file"
						accept="image/*,video/*,.pdf,.doc,.docx"
						hidden
						disabled={disabled || uploading}
						onChange={onPickFile}
					/>
				</label>
			</div>
			{err ? <p className="pm-form-field-hint" style={{ color: "#b91c1c" }}>{err}</p> : null}
			{rows.length > 0 ? (
				<ul className="pm-workflow-evidence__list">
					{rows.map((row, index) => (
						<li key={`${row.file}-${index}`} className="pm-workflow-evidence__item">
							<select
								className="pm-select pm-select--compact"
								value={row.evidence_type}
								disabled={disabled}
								onChange={(e) => {
									const next = rows.map((r, i) =>
										i === index ? { ...r, evidence_type: e.target.value } : r
									);
									setRows(next);
									onFilesChange(next);
								}}
							>
								{EVIDENCE_TYPES.map((t) => (
									<option key={t} value={t}>
										{t}
									</option>
								))}
							</select>
							<a href={row.file} target="_blank" rel="noreferrer" className="pm-workflow-evidence__link">
								{row.description || "View file"}
							</a>
							<button type="button" className="pm-btn pm-btn-sm" disabled={disabled} onClick={() => removeRow(index)}>
								Remove
							</button>
						</li>
					))}
				</ul>
			) : (
				<p className="pm-form-field-hint">Required for rework. Optional for QA pass.</p>
			)}
		</div>
	);
}
