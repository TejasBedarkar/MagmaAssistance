import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { deleteDoc, getDoc, insertDoc, updateDoc } from "../../../common/api/client.js";
import { timesheets } from "../api/index.js";
import useProjectAuth from "./useProjectAuth.js";
import { emptyTimesheetForm, MANAGER_STATUSES, TEAM_STATUSES, todayIso } from "../lib/timesheetEditorConstants.js";

export default function useTimesheetEditor(id) {
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const { user, isManager } = useProjectAuth();
	const isNew = id === "new";

	const [form, setForm] = useState(() => ({ ...emptyTimesheetForm, date: todayIso() }));
	const [ctx, setCtx] = useState(null);
	const [projects, setProjects] = useState([]);
	const [tasks, setTasks] = useState([]);
	const [loading, setLoading] = useState(true);
	const [ctxLoading, setCtxLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [err, setErr] = useState("");

	const statusOptions = isManager ? MANAGER_STATUSES : TEAM_STATUSES;
	const isApproved = !isNew && form.status === "Approved";
	const isSubmitted = !isNew && form.status === "Submitted";
	const isRejected = !isNew && form.status === "Rejected";
	const teamReadOnly = !isManager && !isNew && isApproved;
	const readOnly = teamReadOnly || (isManager && !isNew && isApproved);
	const canReview = isManager && !isNew && isSubmitted;

	const loadContext = useCallback(
		async (project) => {
			setCtxLoading(true);
			try {
				const data = await timesheets.getLogContext(project || undefined);
				setCtx(data);
				setProjects(data.projects || []);
				if (project) {
					setTasks((data.tasks_by_project && data.tasks_by_project[project]) || []);
				} else if (!isManager && data.projects?.length === 1) {
					const only = data.projects[0].name;
					setForm((f) => ({ ...f, project: f.project || only }));
					setTasks((data.tasks_by_project && data.tasks_by_project[only]) || []);
				}
				return data;
			} catch (e) {
				setErr(e.message || "Failed to load timesheet options");
				return null;
			} finally {
				setCtxLoading(false);
			}
		},
		[isManager]
	);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoading(true);
			setErr("");
			try {
				if (isNew) {
					const qp = searchParams.get("project") || "";
					const qt = searchParams.get("task") || "";
					setForm({ ...emptyTimesheetForm, date: todayIso(), project: qp, task: qt });
					const data = await loadContext(qp || undefined);
					if (qp && data?.tasks_by_project?.[qp]) {
						setTasks(data.tasks_by_project[qp]);
					}
					if (!cancelled && data && !isManager && (data.projects || []).length === 0) {
						setErr(
							"No tasks are assigned to you yet. Ask your program manager to assign work before logging time."
						);
					}
				} else {
					const doc = await getDoc("PM Timesheet", id);
					if (!cancelled) {
						setForm({ ...emptyTimesheetForm, ...doc });
						await loadContext(doc.project);
						if (!cancelled) {
							setTasks(
								(await timesheets.getLogContext(doc.project)).tasks_by_project?.[doc.project] || []
							);
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
	}, [id, isNew, loadContext, isManager, searchParams]);

	useEffect(() => {
		if (!form.project) {
			setTasks([]);
			return;
		}
		const byProject = ctx?.tasks_by_project;
		if (byProject && Object.prototype.hasOwnProperty.call(byProject, form.project)) {
			setTasks(byProject[form.project] || []);
			return;
		}
		loadContext(form.project).then((data) => {
			setTasks(data?.tasks_by_project?.[form.project] || []);
		});
	}, [form.project, ctx, loadContext]);

	function setField(key, value) {
		setForm((f) => {
			const next = { ...f, [key]: value };
			if (key === "project") {
				next.task = "";
			}
			return next;
		});
	}

	async function saveTimesheet(status) {
		setErr("");
		setSaving(true);
		try {
			const payload = {
				project: form.project,
				task: form.task,
				date: form.date,
				hours: Number(form.hours),
				description: form.description || "",
				status: status || form.status || "Draft",
				cost_rate: isManager && form.cost_rate !== "" ? Number(form.cost_rate) : 0,
			};
			if (isNew) {
				const created = await insertDoc("PM Timesheet", payload);
				navigate(`/timesheets/${created.name}`, { replace: true });
			} else {
				await updateDoc("PM Timesheet", id, { ...payload, name: id });
				navigate("/timesheets");
			}
		} catch (e) {
			setErr(e.message || "Save failed");
		} finally {
			setSaving(false);
		}
	}

	async function onSave(e) {
		e.preventDefault();
		await saveTimesheet(form.status);
	}

	async function onSubmit() {
		await saveTimesheet("Submitted");
	}

	async function onReview(action) {
		if (!id || id === "new") return;
		setErr("");
		setSaving(true);
		try {
			await timesheets.approve(id, action);
			const doc = await getDoc("PM Timesheet", id);
			setForm({ ...emptyTimesheetForm, ...doc });
			navigate("/timesheets");
		} catch (e) {
			setErr(e.message || `${action} failed`);
		} finally {
			setSaving(false);
		}
	}

	async function onDelete() {
		if (!isManager) return;
		if (!window.confirm("Delete this timesheet?")) return;
		setSaving(true);
		try {
			await deleteDoc("PM Timesheet", id);
			navigate("/timesheets");
		} catch (e) {
			setErr(e.message || "Delete failed");
		} finally {
			setSaving(false);
		}
	}

	return {
		id,
		isNew,
		user,
		isManager,
		form,
		setField,
		ctx,
		projects,
		tasks,
		loading,
		ctxLoading,
		saving,
		err,
		statusOptions,
		isApproved,
		isRejected,
		teamReadOnly,
		readOnly,
		canReview,
		onSave,
		onSubmit,
		onReview,
		onDelete,
	};
}
