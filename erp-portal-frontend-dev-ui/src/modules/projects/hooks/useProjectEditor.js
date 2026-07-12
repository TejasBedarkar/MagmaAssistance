import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { deleteDoc, getDoc, insertDoc, updateDoc } from "../../../common/api/client.js";
import { projects } from "../api/index.js";
import { refreshPortalNotifications } from "../utils/portalNotifications.js";
import useProjectAuth from "./useProjectAuth.js";
import {
	adminCreateStatus,
	ALL_STATUS_OPTIONS,
	ADMIN_CREATE_STATUS_OPTIONS,
	emptyProjectForm,
	todayIso,
} from "../lib/projectEditorConstants.js";

function buildCreateSuccessNotice(projectLabel, status, submittedForApproval) {
	const label = (projectLabel || "Program").trim() || "Program";
	if (submittedForApproval) {
		return `Program "${label}" created and submitted for approval.`;
	}
	if (status === "Active") {
		return `Program "${label}" created and is Active. Open it from the list to add delivery team and milestones.`;
	}
	return `Program "${label}" created.`;
}

export default function useProjectEditor(id) {
	const navigate = useNavigate();
	const isNew = id === "new";
	const {
		user,
		isManager,
		isAdministrator,
		isProgramManager,
		canEditBudget,
		canEditStartDate,
		canDeleteProject,
	} = useProjectAuth();

	const isProgramManagerOnly = isManager && !isAdministrator;
	const pmStatusReadOnly = isProgramManagerOnly;
	const teamViewOnly = !isManager && !isNew;

	const [form, setForm] = useState(emptyProjectForm);
	const currentStatus = form.status || "Draft";
	const canSubmitForApproval =
		isProgramManagerOnly && !isNew && ["Draft", "Rejected"].includes(currentStatus);
	const statusLocked = isProgramManagerOnly && currentStatus === "Pending Approval";
	const canPutOnHold =
		!isNew &&
		isManager &&
		currentStatus === "Active" &&
		(isAdministrator || (isProgramManagerOnly && (form.project_manager || user) === user));
	const canResume =
		!isNew &&
		isManager &&
		currentStatus === "On Hold" &&
		(isAdministrator || (isProgramManagerOnly && (form.project_manager || user) === user));
	const statusOptions = isNew && isAdministrator ? ADMIN_CREATE_STATUS_OPTIONS : ALL_STATUS_OPTIONS;
	const canEditDeliveryTeam =
		!isNew &&
		isManager &&
		!statusLocked &&
		currentStatus !== "On Hold" &&
		(isAdministrator || (isProgramManagerOnly && (form.project_manager || user) === user));
	const canEditCustomer =
		isAdministrator || isNew || !(form.customer || "").trim();
	const needsDeliveryTeam =
		!isNew && currentStatus === "Active" && !(form.delivery_team || []).some((row) => row.user);

	const [loading, setLoading] = useState(!isNew);
	const [codeLoading, setCodeLoading] = useState(isNew);
	const [saving, setSaving] = useState(false);
	const [err, setErr] = useState("");
	const [teamDetail, setTeamDetail] = useState(null);
	const [deliveryRefresh, setDeliveryRefresh] = useState(0);
	const [teamSaving, setTeamSaving] = useState(false);

	useEffect(() => {
		if (isNew) {
			if (!isManager) {
				setErr("You do not have permission to create projects.");
				setForm(emptyProjectForm);
				setCodeLoading(false);
				return;
			}
			let cancelled = false;
			(async () => {
				setErr("");
				setCodeLoading(true);
				try {
					const defaults = await projects.getNextProjectCode();
					if (!cancelled) {
						setForm({
							...emptyProjectForm,
							project_code: defaults?.project_code || "",
							start_date: todayIso(),
							project_manager: isProgramManagerOnly ? user || "" : "",
						});
					}
				} catch (e) {
					if (!cancelled) {
						setForm({
							...emptyProjectForm,
							start_date: todayIso(),
							project_manager: isProgramManagerOnly ? user || "" : "",
						});
						setErr(e.message || "Could not load project code");
					}
				} finally {
					if (!cancelled) setCodeLoading(false);
				}
			})();
			return () => {
				cancelled = true;
			};
		}
		let cancelled = false;
		(async () => {
			setErr("");
			setLoading(true);
			try {
				const doc = await getDoc("PM Project", id);
				if (!cancelled) {
					setForm({ ...emptyProjectForm, ...doc });
					try {
						const team = await projects.getTeamDetail(id, { silent: true });
						if (!cancelled) setTeamDetail(team);
					} catch {
						if (!cancelled) {
							try {
								const overview = await projects.getTeamOverview({ silent: true });
								const entry = overview?.by_project?.[id];
								if (entry) {
									setTeamDetail({
										project: id,
										project_name: doc.project_name || id,
										...entry,
									});
								} else {
									setTeamDetail(null);
								}
							} catch {
								setTeamDetail(null);
							}
						}
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
	}, [id, isNew, isManager, isProgramManagerOnly, user]);

	function setField(key, value) {
		setForm((f) => ({ ...f, [key]: value }));
	}

	async function onSave(e, opts = {}) {
		e?.preventDefault?.();
		if (!isManager) {
			setErr("Only program managers can update project details.");
			return;
		}
		setErr("");
		setSaving(true);
		try {
			const payload = {
				project_code: form.project_code || undefined,
				project_name: form.project_name,
				description: form.description || "",
				start_date: form.start_date || (isNew ? todayIso() : null),
				end_date: form.end_date || null,
				status:
					isProgramManagerOnly && isNew
						? "Draft"
						: isNew && isAdministrator
							? adminCreateStatus(form.status)
							: form.status || "Draft",
			};
			if (canEditCustomer) {
				payload.customer = form.customer || "";
			}
			if (isProgramManagerOnly && !isAdministrator && !isNew) {
				delete payload.status;
			}
			if (isNew || isAdministrator) {
				payload.project_manager = isProgramManagerOnly ? user || "" : form.project_manager || "";
			}
			if (canEditBudget) {
				payload.budget = form.budget === "" ? 0 : Number(form.budget);
				payload.cost_center = form.cost_center || "";
				payload.cost_alert_threshold =
					form.cost_alert_threshold === "" ? 0 : Number(form.cost_alert_threshold);
				payload.non_labour_cost = form.non_labour_cost === "" ? 0 : Number(form.non_labour_cost);
			}
			if (isNew) {
				const created = await insertDoc("PM Project", payload);
				const projectName = created.name;
				let submittedForApproval = false;
				if (isProgramManagerOnly) {
					try {
						await projects.submitForApproval(projectName);
						submittedForApproval = true;
					} catch (submitErr) {
						navigate(`/projects/${projectName}`, { replace: true });
						setErr(
							submitErr.message || "Project saved as Draft. Use Submit for approval when ready."
						);
						return;
					}
				}
				refreshPortalNotifications();
				const notice = buildCreateSuccessNotice(
					form.project_name || projectName,
					payload.status,
					submittedForApproval
				);
				toast.success(notice);
				navigate("/projects", { replace: true });
				return;
			} else {
				await updateDoc("PM Project", id, { ...payload, name: id });
				try {
					const team = await projects.getTeamDetail(id, { silent: true });
					setTeamDetail(team);
				} catch {
					/* roster refresh is best-effort */
				}
				if (opts.reloadOnly) {
					const doc = await getDoc("PM Project", id);
					setForm((f) => ({ ...f, ...doc }));
				} else {
					navigate("/projects");
				}
			}
		} catch (e) {
			setErr(e.message || "Save failed");
		} finally {
			setSaving(false);
		}
	}

	async function onSubmitForApproval() {
		if (!canSubmitForApproval) return;
		setErr("");
		setSaving(true);
		try {
			await onSave({ preventDefault: () => {} }, { reloadOnly: true });
			await projects.submitForApproval(id);
			const doc = await getDoc("PM Project", id);
			setForm((f) => ({ ...f, ...doc }));
			setDeliveryRefresh((n) => n + 1);
			refreshPortalNotifications();
		} catch (e) {
			setErr(e.message || "Submit for approval failed");
		} finally {
			setSaving(false);
		}
	}

	async function saveDeliveryTeam(rows) {
		if (!canEditDeliveryTeam || isNew) return false;
		setTeamSaving(true);
		setErr("");
		try {
			const delivery_team = rows.map((row) => ({
				user: row.user,
				member_role: row.member_role || "Developer",
			}));
			await updateDoc("PM Project", id, { name: id, delivery_team });
			const doc = await getDoc("PM Project", id);
			setForm((f) => ({ ...f, ...doc }));
			try {
				const team = await projects.getTeamDetail(id, { silent: true });
				setTeamDetail(team);
			} catch {
				/* roster refresh is best-effort */
			}
			setDeliveryRefresh((n) => n + 1);
			return true;
		} catch (e) {
			setErr(e.message || "Could not save delivery team");
			return false;
		} finally {
			setTeamSaving(false);
		}
	}

	async function onDelete() {
		if (!window.confirm("Delete this project?")) return;
		setSaving(true);
		try {
			await deleteDoc("PM Project", id);
			navigate("/projects");
		} catch (e) {
			setErr(e.message || "Delete failed");
		} finally {
			setSaving(false);
		}
	}

	async function onPutOnHold(reason) {
		if (!canPutOnHold) return false;
		setErr("");
		setSaving(true);
		try {
			await projects.putOnHold(id, reason);
			const doc = await getDoc("PM Project", id);
			setForm((f) => ({ ...f, ...doc }));
			setDeliveryRefresh((n) => n + 1);
			refreshPortalNotifications();
			return true;
		} catch (e) {
			setErr(e.message || "Could not put program on hold");
			return false;
		} finally {
			setSaving(false);
		}
	}

	async function onResume(note) {
		if (!canResume) return false;
		setErr("");
		setSaving(true);
		try {
			await projects.resume(id, note);
			const doc = await getDoc("PM Project", id);
			setForm((f) => ({ ...f, ...doc }));
			setDeliveryRefresh((n) => n + 1);
			refreshPortalNotifications();
			return true;
		} catch (e) {
			setErr(e.message || "Could not resume program");
			return false;
		} finally {
			setSaving(false);
		}
	}

	return {
		id,
		isNew,
		user,
		isManager,
		isAdministrator,
		isProgramManager,
		canEditBudget,
		canEditStartDate,
		canEditCustomer,
		canDeleteProject,
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
		canEditDeliveryTeam,
		needsDeliveryTeam,
		loading,
		codeLoading,
		saving,
		err,
		teamDetail,
		deliveryRefresh,
		teamSaving,
		onSave,
		saveDeliveryTeam,
		onSubmitForApproval,
		onPutOnHold,
		onResume,
		onDelete,
	};
}
