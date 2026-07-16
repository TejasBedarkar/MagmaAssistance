import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getDoc, getList, insertDoc, updateDoc, deleteDoc } from "../../../common/api/client.js";
import { useAuth } from "../../../common/context/AuthContext.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import { PortalBusyButtonContent } from "../../../common/components/PortalSpinner.jsx";
import ProjectPageLoader from "../components/ProjectPageLoader.jsx";
import DeliveryTeamModal from "../components/project-editor/DeliveryTeamModal.jsx";
import TaskTimelinePanel from "../components/task-editor/TaskTimelinePanel.jsx";
import { milestones } from "../api/index.js";
import { projectHasDeliveryTeam } from "../lib/deliveryTeamUtils.js";

const STATUSES = ["Planned", "In Progress", "At Risk", "Completed"];

const empty = {
	project: "",
	milestone_name: "",
	planned_date: "",
	actual_date: "",
	status: "Planned",
};

export default function MilestoneEditor() {
	const { id } = useParams();
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const { isManager, isAdministrator } = useAuth();
	const isNew = id === "new";
	const teamViewOnly = !isManager && !isNew;
	const linkedProject = searchParams.get("project") || "";
	const [form, setForm] = useState(() => ({
		...empty,
		project: linkedProject,
	}));
	const [projects, setProjects] = useState([]);
	const [loading, setLoading] = useState(!isNew);
	const [saving, setSaving] = useState(false);
	const [err, setErr] = useState("");
	const [projectStatus, setProjectStatus] = useState("");
	const [holdReason, setHoldReason] = useState("");
	const [projectLoading, setProjectLoading] = useState(
		() => isNew && Boolean(linkedProject),
	);
	const [hasDeliveryTeam, setHasDeliveryTeam] = useState(false);
	const [deliveryTeamRows, setDeliveryTeamRows] = useState([]);
	const [teamCheckDone, setTeamCheckDone] = useState(false);
	const [teamModalOpen, setTeamModalOpen] = useState(false);
	const [teamSaving, setTeamSaving] = useState(false);
	const [timeline, setTimeline] = useState([]);
	const lastTeamPromptProject = useRef("");
	const teamJustSaved = useRef(false);

	const selectableProjects = useMemo(() => {
		if (isAdministrator || !isManager) return projects;
		return projects.filter((p) => (p.status || "") === "Active");
	}, [projects, isAdministrator, isManager]);

	const selectedProject = projects.find((p) => p.name === form.project);
	const effectiveProjectStatus = (projectStatus || selectedProject?.status || "").trim();
	const projectOnHold = effectiveProjectStatus === "On Hold";
	const projectNotActive =
		isNew &&
		isManager &&
		Boolean(form.project) &&
		!projectLoading &&
		Boolean(effectiveProjectStatus) &&
		effectiveProjectStatus !== "Active";
	const needsDeliveryTeam =
		isNew &&
		isManager &&
		Boolean(form.project) &&
		!projectLoading &&
		teamCheckDone &&
		effectiveProjectStatus === "Active" &&
		!hasDeliveryTeam;

	useEffect(() => {
		if (!form.project) {
			setProjectStatus("");
			setHoldReason("");
			setProjectLoading(false);
			setHasDeliveryTeam(false);
			setDeliveryTeamRows([]);
			setTeamCheckDone(false);
			return;
		}
		let cancelled = false;
		setTeamCheckDone(false);
		setProjectLoading(true);
		(async () => {
			try {
				const doc = await getDoc("PM Project", form.project);
				if (!cancelled) {
					setProjectStatus(doc.status || "");
					setHoldReason(doc.hold_reason || "");
					const rows = doc.delivery_team || [];
					setDeliveryTeamRows(rows);
					setHasDeliveryTeam(projectHasDeliveryTeam(rows));
				}
			} catch {
				if (!cancelled) {
					setProjectStatus("");
					setHoldReason("");
					setDeliveryTeamRows([]);
					setHasDeliveryTeam(false);
				}
			} finally {
				if (!cancelled) {
					setTeamCheckDone(true);
					setProjectLoading(false);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [form.project]);

	useEffect(() => {
		if (!isNew || !isManager || projectLoading || !needsDeliveryTeam) return;
		if (lastTeamPromptProject.current === form.project) return;
		lastTeamPromptProject.current = form.project;
		setTeamModalOpen(true);
	}, [isNew, isManager, projectLoading, needsDeliveryTeam, form.project]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const plist = await getList("PM Project", {
					fields: ["name", "project_name", "status"],
					limit_page_length: 300,
				});
				if (!cancelled) setProjects(plist);
			} catch {
				/* ignore */
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (isNew) {
			setTimeline([]);
			setForm((f) => ({ ...f, project: searchParams.get("project") || f.project || "" }));
			if (!isManager) setErr("Only managers can create milestones.");
			else setErr("");
			setLoading(false);
			return;
		}
		let cancelled = false;
		(async () => {
			setErr("");
			setLoading(true);
			try {
				const doc = await getDoc("PM Milestone", id);
				if (!cancelled) {
					setForm({ ...empty, ...doc });
					try {
						const act = await milestones.getActivity(id);
						if (!cancelled) {
							setTimeline(act?.timeline || []);
						}
					} catch {
						if (!cancelled) setTimeline([]);
					}
				}
			} catch (e) {
				if (!cancelled) setErr(e.message || "Load failed");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [id, isNew, isManager, searchParams]);

	async function loadMilestoneActivity(milestoneId) {
		const act = await milestones.getActivity(milestoneId);
		setTimeline(act?.timeline || []);
		return act;
	}

	function setField(key, value) {
		if (key === "project" && value !== form.project) {
			lastTeamPromptProject.current = "";
			const picked = value ? projects.find((p) => p.name === value) : null;
			setProjectLoading(Boolean(value));
			setProjectStatus(picked?.status || "");
			setHoldReason("");
			setTeamModalOpen(false);
		}
		setForm((f) => ({ ...f, [key]: value }));
	}

	function afterSaveNavigate(projectName, milestoneName) {
		if (linkedProject && projectName === linkedProject) {
			navigate(`/projects/${projectName}`, { replace: true });
			return;
		}
		navigate(`/milestones/${milestoneName}`, { replace: true });
	}

	async function saveDeliveryTeam(rows) {
		if (!form.project) return false;
		setTeamSaving(true);
		setErr("");
		try {
			const delivery_team = rows.map((row) => ({
				user: row.user,
				member_role: row.member_role || "Developer",
			}));
			await updateDoc("PM Project", form.project, { name: form.project, delivery_team });
			const doc = await getDoc("PM Project", form.project);
			const savedRows = doc.delivery_team || [];
			setDeliveryTeamRows(savedRows);
			setHasDeliveryTeam(projectHasDeliveryTeam(savedRows));
			lastTeamPromptProject.current = form.project;
			teamJustSaved.current = true;
			return true;
		} catch (e) {
			setErr(e.message || "Could not save delivery team");
			return false;
		} finally {
			setTeamSaving(false);
		}
	}

	function handleTeamModalClose() {
		setTeamModalOpen(false);
		if (teamJustSaved.current) {
			teamJustSaved.current = false;
			return;
		}
		lastTeamPromptProject.current = "";
		setForm((f) => ({ ...f, project: "" }));
		if (linkedProject) {
			navigate("/milestones/new", { replace: true });
		}
	}

	async function onSave(e) {
		e.preventDefault();
		if (!isManager) return;
		if (projectNotActive) {
			setErr(
				projectOnHold
					? "This program is on hold. Resume delivery before adding new milestones."
					: "Milestones can only be added to Active programs. Submit the program for approval first.",
			);
			return;
		}
		if (projectLoading) return;
		if (needsDeliveryTeam) {
			setTeamModalOpen(true);
			return;
		}
		setErr("");
		setSaving(true);
		try {
			const payload = {
				project: form.project,
				milestone_name: form.milestone_name,
				planned_date: form.planned_date || null,
				actual_date: form.actual_date || null,
				status: form.status || "Planned",
			};
			if (isNew) {
				const created = await insertDoc("PM Milestone", payload);
				afterSaveNavigate(created.project || form.project, created.name);
			} else {
				await updateDoc("PM Milestone", id, { ...payload, name: id });
				await loadMilestoneActivity(id).catch(() => {});
				if (form.project) {
					navigate(`/projects/${form.project}`);
				} else {
					navigate("/milestones");
				}
			}
		} catch (e) {
			setErr(e.message || "Save failed");
		} finally {
			setSaving(false);
		}
	}

	async function onDelete() {
		if (!isManager) return;
		if (!window.confirm("Delete this milestone?")) return;
		setSaving(true);
		try {
			const projectName = form.project;
			await deleteDoc("PM Milestone", id);
			if (projectName) navigate(`/projects/${projectName}`);
			else navigate("/milestones");
		} catch (e) {
			setErr(e.message || "Delete failed");
		} finally {
			setSaving(false);
		}
	}

	if (loading) {
		return (
			<div className="pm-page pm-form-page">
				<ProjectPageLoader message="Loading milestone…" />
			</div>
		);
	}

	const backTo = linkedProject ? `/projects/${linkedProject}` : "/milestones";
	const backLabel = linkedProject ? "← Back to program" : "← Milestones";

	if (isNew && form.project && projectLoading && linkedProject) {
		return (
			<div className="pm-page pm-form-page">
				<div className="pm-form-page__head">
					<Link to={backTo} className="pm-back-link">
						{backLabel}
					</Link>
					<h1 className="pm-form-page__title">New milestone</h1>
				</div>
				<ProjectPageLoader message="Checking program status…" minHeight={160} />
			</div>
		);
	}

	const FormTag = teamViewOnly ? "div" : "form";
	const milestoneFieldsDisabled = isNew && (needsDeliveryTeam || projectNotActive);
	const holdNote = (holdReason || "").trim();
	const showHoldReason =
		holdNote && holdNote.toLowerCase() !== "on hold" && holdNote.toLowerCase() !== "hold";

	return (
		<div className="pm-page pm-form-page">
			<div className="pm-form-page__head">
				<Link to={backTo} className="pm-back-link">
					{backLabel}
				</Link>
				<h1 className="pm-form-page__title">{isNew ? "New milestone" : form.milestone_name || id}</h1>
				<p className="pm-page-desc" style={{ marginBottom: 0 }}>
					{isNew
						? "Define a delivery milestone on an Active program."
						: teamViewOnly
							? "View milestone details for a program you are assigned to."
							: "Update milestone details and dates."}
				</p>
			</div>

			{projectNotActive && isManager && isNew ? (
				<div className="pm-error-banner" role="status">
					{projectOnHold ? (
						<>
							This program is <strong>on hold</strong>
							{showHoldReason ? ` — ${holdNote}` : ""}. Resume delivery before creating new
							milestones.
						</>
					) : (
						<>
							This program is <strong>{effectiveProjectStatus}</strong>. New milestones can only be
							added on <strong>Active</strong> programs after administrator approval.
						</>
					)}
				</div>
			) : null}

			{err ? <div className="pm-error-banner">{err}</div> : null}

			<FormTag
					className="pm-card pm-form-card pm-milestone-form"
					{...(teamViewOnly ? {} : { onSubmit: onSave })}
				>
					<div className="pm-form-grid">
						<div className="pm-field pm-form-grid__full">
							<label className="pm-label">Program / project *</label>
							{teamViewOnly || (isNew && linkedProject && selectedProject) ? (
								<div className="pm-program-context">
									<span className="pm-program-context__name">
										{selectedProject?.project_name || form.project || "—"}
									</span>
								</div>
							) : (
								<select
									className="pm-select"
									required
									value={form.project || ""}
									onChange={(e) => setField("project", e.target.value)}
									disabled={!isNew || Boolean(linkedProject) || projectLoading}
								>
									<option value="">Select program…</option>
									{selectableProjects.map((p) => (
										<option key={p.name} value={p.name}>
											{p.project_name || p.name}
										</option>
									))}
								</select>
							)}
						</div>
						<div className="pm-field pm-form-grid__full">
							<label className="pm-label">Milestone name *</label>
							<input
								className="pm-input"
								required={!teamViewOnly && !milestoneFieldsDisabled}
								readOnly={teamViewOnly || milestoneFieldsDisabled}
								disabled={milestoneFieldsDisabled}
								value={form.milestone_name || ""}
								onChange={(e) => setField("milestone_name", e.target.value)}
								placeholder="e.g. Requirements sign-off"
							/>
						</div>
						<div className="pm-field">
							<label className="pm-label">Planned date</label>
							<input
								className="pm-input"
								type="date"
								readOnly={teamViewOnly || milestoneFieldsDisabled}
								disabled={milestoneFieldsDisabled}
								value={form.planned_date || ""}
								onChange={(e) => setField("planned_date", e.target.value)}
							/>
						</div>
						<div className="pm-field">
							<label className="pm-label">Actual date</label>
							<input
								className="pm-input"
								type="date"
								readOnly={teamViewOnly || milestoneFieldsDisabled}
								disabled={milestoneFieldsDisabled}
								value={form.actual_date || ""}
								onChange={(e) => setField("actual_date", e.target.value)}
							/>
						</div>
						<div className="pm-field">
							<label className="pm-label">Status</label>
							{teamViewOnly ? (
								<StatusPill>{form.status || "Planned"}</StatusPill>
							) : (
								<select
									className="pm-select"
									value={form.status || "Planned"}
									onChange={(e) => setField("status", e.target.value)}
									disabled={milestoneFieldsDisabled}
								>
									{STATUSES.map((s) => (
										<option key={s} value={s}>
											{s}
										</option>
									))}
								</select>
							)}
						</div>
					</div>
					{isManager ? (
						<div className="pm-form-actions">
							<button
								type="submit"
								className="pm-btn pm-btn-primary"
								disabled={saving || (isNew && (!form.project || projectLoading || projectNotActive)) || needsDeliveryTeam}
								aria-busy={saving}
							>
								<PortalBusyButtonContent
									busy={saving}
									busyLabel={isNew ? "Creating…" : "Saving…"}
									idleLabel={isNew ? "Create milestone" : "Save milestone"}
								/>
							</button>
							{!isNew ? (
								<button type="button" className="pm-btn" disabled={saving} onClick={onDelete}>
									Delete
								</button>
							) : null}
						</div>
					) : null}
				</FormTag>

			{!isNew ? (
				<div className="pm-task-feed">
					<TaskTimelinePanel
						timeline={timeline}
						showChangesFilter={false}
						ariaLabel="Milestone activity timeline"
						postComment={(content) => milestones.addComment(id, content)}
						onPosted={() => loadMilestoneActivity(id).catch(() => {})}
					/>
				</div>
			) : null}

			<DeliveryTeamModal
				open={teamModalOpen}
				onClose={handleTeamModalClose}
				initialRows={deliveryTeamRows}
				onSave={saveDeliveryTeam}
				saving={teamSaving}
				projectStatus={effectiveProjectStatus || "Active"}
			/>
		</div>
	);
}
