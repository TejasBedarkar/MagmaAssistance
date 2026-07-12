import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { deleteDoc, getDoc, getList, insertDoc, updateDoc } from "../../../common/api/client.js";
import { tasks } from "../api/index.js";
import useProjectAuth from "./useProjectAuth.js";
import {
	createdOnFromDoc,
	emptyTaskForm,
	isQaWorkflowManagerStatusReadOnly,
	todayIso,
} from "../lib/taskEditorConstants.js";
import { usesQaWorkflowTask } from "../lib/taskWorkflowUtils.js";
import { isTaskCancelled } from "../lib/taskCancelUtils.js";
import { projectHasDeliveryTeam, getProjectTeamTester } from "../lib/deliveryTeamUtils.js";

export default function useTaskEditor(routeId) {
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const { isManager, isAdministrator, loading: authLoading, user: currentUser } = useProjectAuth();

	const isNew = !routeId || routeId === "new";
	const id = isNew ? null : routeId;

	const [form, setForm] = useState(() => ({
		...emptyTaskForm,
		project: searchParams.get("project") || "",
		milestone: searchParams.get("milestone") || "",
		created_on: todayIso(),
	}));
	const [projects, setProjects] = useState([]);
	const [milestones, setMilestones] = useState([]);
	const [milestonesLoading, setMilestonesLoading] = useState(false);
	const [loading, setLoading] = useState(!isNew);
	const [saving, setSaving] = useState(false);
	const [err, setErr] = useState("");
	const [activity, setActivity] = useState([]);
	const [comments, setComments] = useState([]);
	const [timeline, setTimeline] = useState([]);
	const [actionBusy, setActionBusy] = useState(false);
	const [savedStatus, setSavedStatus] = useState("Open");
	const [projectStatus, setProjectStatus] = useState("");
	const [holdReason, setHoldReason] = useState("");
	const [projectLoading, setProjectLoading] = useState(
		() => isNew && Boolean(searchParams.get("project")),
	);
	const [hasDeliveryTeam, setHasDeliveryTeam] = useState(false);
	const [deliveryTeamRows, setDeliveryTeamRows] = useState([]);
	const [teamModalOpen, setTeamModalOpen] = useState(false);
	const [teamSaving, setTeamSaving] = useState(false);
	const [extendOpen, setExtendOpen] = useState(false);
	const [extendDate, setExtendDate] = useState("");
	const [extendNote, setExtendNote] = useState("");
	const lastTeamPromptProject = useRef("");
	const teamJustSaved = useRef(false);

	const selectableProjects =
		isAdministrator || !isManager
			? projects
			: projects.filter((p) => (p.status || "") === "Active");

	const selectedProject = projects.find((p) => p.name === form.project);
	const linkedProject = searchParams.get("project") || "";
	const effectiveProjectStatus = (projectStatus || selectedProject?.status || "").trim();

	const projectNotActive =
		Boolean(form.project) && Boolean(effectiveProjectStatus) && effectiveProjectStatus !== "Active";
	const needsDeliveryTeam =
		isNew &&
		isManager &&
		Boolean(form.project) &&
		!projectLoading &&
		!projectNotActive &&
		effectiveProjectStatus === "Active" &&
		!hasDeliveryTeam;
	const needsMilestoneFirst =
		isNew &&
		isManager &&
		Boolean(form.project) &&
		!projectLoading &&
		effectiveProjectStatus === "Active" &&
		!needsDeliveryTeam &&
		!milestonesLoading &&
		milestones.length === 0;

	const isTeamCompletedView =
		!isManager && !isNew && (savedStatus === "Completed" || form.status === "Completed");
	const isManagerCompletedView =
		isManager && !isNew && (savedStatus === "Completed" || form.status === "Completed");
	const isCancelledView =
		!isNew && (savedStatus === "Cancelled" || form.status === "Cancelled" || isTaskCancelled(form));

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
		if (!form.project) {
			setProjectStatus("");
			setHoldReason("");
			setProjectLoading(false);
			setHasDeliveryTeam(false);
			setDeliveryTeamRows([]);
			setMilestones([]);
			return;
		}
		let cancelled = false;
		setProjectLoading(true);
		(async () => {
			try {
				const proj = await getDoc("PM Project", form.project);
				if (!cancelled) {
					setProjectStatus(proj.status || "");
					setHoldReason(proj.hold_reason || "");
					const rows = proj.delivery_team || [];
					setDeliveryTeamRows(rows);
					setHasDeliveryTeam(projectHasDeliveryTeam(rows));
					const tester = getProjectTeamTester(rows);
					if (tester) {
						setForm((f) => ({ ...f, qa_assigned_to: tester }));
					}
				}
			} catch {
				if (!cancelled) {
					setProjectStatus("");
					setHoldReason("");
					setHasDeliveryTeam(false);
					setDeliveryTeamRows([]);
				}
			} finally {
				if (!cancelled) setProjectLoading(false);
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
		if (!form.project) {
			setMilestones([]);
			setMilestonesLoading(false);
			return;
		}
		let cancelled = false;
		setMilestonesLoading(true);
		setMilestones([]);
		(async () => {
			try {
				const ms = await getList("PM Milestone", {
					fields: ["name", "milestone_name"],
					filters: [["project", "=", form.project]],
					limit_page_length: 200,
				});
				if (!cancelled) {
					setMilestones(ms);
					if (isNew) {
						const linkedMilestone = searchParams.get("milestone") || "";
						const linkedProject = searchParams.get("project") || "";
						setForm((f) => {
							if (
								linkedMilestone &&
								linkedProject === form.project &&
								ms.some((row) => row.name === linkedMilestone)
							) {
								return { ...f, milestone: linkedMilestone };
							}
							if (ms.length === 1) {
								return { ...f, milestone: ms[0].name };
							}
							if (f.milestone && !ms.some((row) => row.name === f.milestone)) {
								return { ...f, milestone: "" };
							}
							return f;
						});
					}
				}
			} catch {
				if (!cancelled) setMilestones([]);
			} finally {
				if (!cancelled) setMilestonesLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [form.project]);

	async function loadTaskFeed(taskId) {
		const act = await tasks.getActivity(taskId);
		setActivity(act?.activity || []);
		setComments(act?.comments || []);
		setTimeline(act?.timeline || []);
		if (act?.completed_on) {
			setForm((f) => ({ ...f, completed_on: act.completed_on }));
		}
		if (act?.status) {
			setForm((f) => ({ ...f, status: act.status }));
			setSavedStatus(act.status);
		}
		try {
			await tasks.markCommentsSeen(taskId);
		} catch {
			/* non-blocking */
		}
		return act;
	}

	useEffect(() => {
		if (isNew && !isManager) {
			setErr("Only program managers can create tasks.");
		}
	}, [isNew, isManager]);

	useEffect(() => {
		if (!isNew) return;
		setErr("");
		setForm({
			...emptyTaskForm,
			project: searchParams.get("project") || "",
			milestone: searchParams.get("milestone") || "",
			created_on: todayIso(),
		});
		setSavedStatus("Open");
		setLoading(false);
	}, [isNew, searchParams]);

	useEffect(() => {
		if (isNew || !id) return;
		if (id === "null" || id === "undefined") {
			setErr("Invalid task link. Open the task again from My Day or the Tasks list.");
			setLoading(false);
			return;
		}
		let cancelled = false;
		(async () => {
			setErr("");
			setLoading(true);
			try {
				const doc = await getDoc("PM Task", id);
				if (!cancelled) {
					setForm({
						...emptyTaskForm,
						...doc,
						created_on: createdOnFromDoc(doc),
						developer_assigned_to: doc.developer_assigned_to || doc.assigned_to || "",
						qa_assigned_to: doc.qa_assigned_to || "",
					});
					setSavedStatus(doc.status || "Open");
					try {
						if (!cancelled) await loadTaskFeed(id);
					} catch {
						if (!cancelled) {
							setActivity([]);
							setComments([]);
							setTimeline([]);
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
	}, [id, isNew]);

	function setField(key, value) {
		if (key === "project" && value !== form.project) {
			lastTeamPromptProject.current = "";
			const picked = value ? projects.find((p) => p.name === value) : null;
			setProjectLoading(Boolean(value));
			setMilestonesLoading(Boolean(value));
			setMilestones([]);
			setProjectStatus(picked?.status || "");
			setTeamModalOpen(false);
			setForm((f) => ({
				...f,
				project: value,
				milestone: "",
				qa_assigned_to: "",
			}));
			return;
		}
		if (key === "developer_assigned_to") {
			setForm((f) => ({
				...f,
				developer_assigned_to: value,
				assigned_to: value || f.assigned_to,
			}));
			return;
		}
		setForm((f) => ({ ...f, [key]: value }));
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
			const tester = getProjectTeamTester(savedRows);
			if (tester) {
				setForm((f) => ({ ...f, qa_assigned_to: tester }));
			}
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
		setForm((f) => ({ ...f, project: "", milestone: "" }));
		if (linkedProject) {
			navigate("/tasks/new", { replace: true });
		}
	}

	function validateForSave() {
		if (authLoading) {
			return "Session is still loading. Please wait a moment.";
		}
		if (!form.project?.trim()) {
			return "Project is required.";
		}
		if (!form.assigned_to?.trim() && !form.developer_assigned_to?.trim()) {
			return "Developer assignee is required.";
		}
		if (!form.task_title?.trim()) {
			return "Task title is required.";
		}
		const dev = (form.developer_assigned_to || "").trim();
		const tester = getProjectTeamTester(deliveryTeamRows);
		const qa = (tester || form.qa_assigned_to || "").trim();
		if (hasDeliveryTeam && !tester) {
			return "Program delivery team must include exactly one Tester.";
		}
		if (dev || qa) {
			if (!dev || !qa) {
				return "Developer assignee is required. QA tester comes from the program delivery team.";
			}
			if (dev === qa) {
				return "Developer and program tester must be different users.";
			}
			if (!form.due_date) {
				return "Due date is required for QA workflow tasks.";
			}
			if (!form.estimated_hours || Number(form.estimated_hours) <= 0) {
				return "Estimated hours are required for QA workflow tasks.";
			}
		}
		return "";
	}

	async function onSave(e) {
		e?.preventDefault();
		if (saving || actionBusy) return;
		if (isNew && !isManager) {
			setErr("Only program managers can create tasks.");
			return;
		}
		if (needsDeliveryTeam) {
			setTeamModalOpen(true);
			return;
		}
		if (needsMilestoneFirst) {
			setErr("Add at least one milestone on this program before creating tasks.");
			return;
		}
		if (isTeamCompletedView || isCancelledView) {
			return;
		}
		const validationMsg = validateForSave();
		if (validationMsg) {
			setErr(validationMsg);
			return;
		}
		setErr("");
		setSaving(true);
		try {
			const tester = getProjectTeamTester(deliveryTeamRows);
			const qaAssignee = tester || form.qa_assigned_to || "";
			const qaWorkflow = usesQaWorkflowTask(form);
			const managerPayload = {
				name: isNew ? undefined : id,
				project: form.project,
				milestone: form.milestone || "",
				assigned_to: form.developer_assigned_to || form.assigned_to,
				task_title: form.task_title.trim(),
				description: form.description || "",
				due_date: form.due_date || null,
				estimated_hours: form.estimated_hours === "" ? 0 : Number(form.estimated_hours),
				priority: form.priority,
				status:
					qaWorkflow && isQaWorkflowManagerStatusReadOnly(qaWorkflow, savedStatus)
						? savedStatus
						: form.status,
			};
			if (form.developer_assigned_to || qaAssignee) {
				managerPayload.developer_assigned_to = form.developer_assigned_to || "";
				managerPayload.qa_assigned_to = qaAssignee;
				managerPayload.assigned_to = form.developer_assigned_to || form.assigned_to;
			}
			if (form.status === "Blocked" && form.blocked_reason) {
				managerPayload.blocked_reason = form.blocked_reason;
			}
			if (isNew || isAdministrator) {
				managerPayload.created_on = form.created_on || (isNew ? todayIso() : null);
			}
			if (isNew) {
				const created = await insertDoc("PM Task", managerPayload);
				navigate(`/tasks/${created.name}`, {
					replace: true,
					state: { savedNotice: "Task created." },
				});
			} else if (isManager) {
				await updateDoc("PM Task", id, { ...managerPayload, name: id });
				setSavedStatus(form.status || "Open");
				navigate("/tasks");
			} else {
				await updateDoc("PM Task", id, { name: id, description: form.description || "" });
				const nextStatus = form.status || "Open";
				if (nextStatus !== savedStatus && nextStatus !== "Completed" && nextStatus !== "Blocked") {
					await tasks.updateStatus(id, nextStatus);
					setSavedStatus(nextStatus);
				}
				navigate("/tasks");
			}
		} catch (e) {
			setErr(e.message || "Save failed");
		} finally {
			setSaving(false);
		}
	}

	async function reloadTaskDoc() {
		const doc = await getDoc("PM Task", id);
		setForm({
			...emptyTaskForm,
			...doc,
			created_on: createdOnFromDoc(doc),
			developer_assigned_to: doc.developer_assigned_to || doc.assigned_to || "",
			qa_assigned_to: doc.qa_assigned_to || "",
		});
		setSavedStatus(doc.status || "Open");
		await loadTaskFeed(id);
		return doc;
	}

	async function onMarkDevDone() {
		setActionBusy(true);
		setErr("");
		try {
			await tasks.markDevDone(id);
			await reloadTaskDoc();
		} catch (e) {
			setErr(e.message || "Could not mark development complete");
		} finally {
			setActionBusy(false);
		}
	}

	async function onQaPass(qaNotes, evidence = []) {
		setActionBusy(true);
		setErr("");
		try {
			await tasks.qaPass(id, qaNotes, evidence);
			await reloadTaskDoc();
		} catch (e) {
			setErr(e.message || "QA approval failed");
		} finally {
			setActionBusy(false);
		}
	}

	async function onQaRework(reworkReason, bugDescription, evidence = []) {
		setActionBusy(true);
		setErr("");
		try {
			await tasks.qaRework(id, reworkReason, bugDescription || "", evidence);
			await reloadTaskDoc();
		} catch (e) {
			setErr(e.message || "Could not send for rework");
		} finally {
			setActionBusy(false);
		}
	}

	async function onStart() {
		setActionBusy(true);
		setErr("");
		try {
			await tasks.updateStatus(id, "In Progress");
			await reloadTaskDoc();
		} catch (e) {
			setErr(e.message || "Could not start task");
		} finally {
			setActionBusy(false);
		}
	}

	async function onComplete() {
		const qaWorkflow = usesQaWorkflowTask(form);
		const msg = qaWorkflow
			? "Mark this task as completed after QA approval?"
			: "Mark this task as completed?";
		if (!window.confirm(msg)) return;
		setActionBusy(true);
		setErr("");
		try {
			await tasks.complete(id);
			await reloadTaskDoc();
		} catch (e) {
			setErr(e.message || "Complete failed");
		} finally {
			setActionBusy(false);
		}
	}

	async function onReopen(reason) {
		setActionBusy(true);
		setErr("");
		try {
			await tasks.reopen(id, reason);
			await reloadTaskDoc();
		} catch (e) {
			setErr(e.message || "Could not reopen task");
		} finally {
			setActionBusy(false);
		}
	}

	async function onCancel(reason) {
		setActionBusy(true);
		setErr("");
		try {
			await tasks.cancel(id, reason);
			await reloadTaskDoc();
		} catch (e) {
			setErr(e.message || "Could not cancel task");
		} finally {
			setActionBusy(false);
		}
	}

	async function onDelete() {
		if (!isManager) return;
		if (!window.confirm("Delete this task?")) return;
		setSaving(true);
		try {
			await deleteDoc("PM Task", id);
			navigate("/tasks");
		} catch (e) {
			setErr(e.message || "Delete failed");
		} finally {
			setSaving(false);
		}
	}

	function openExtendModal() {
		setExtendDate(form.due_date || todayIso());
		setExtendNote("");
		setExtendOpen(true);
	}

	function closeExtendModal() {
		if (actionBusy) return;
		setExtendOpen(false);
		setExtendDate("");
		setExtendNote("");
	}

	async function onExtendDeadline() {
		if (!extendDate || !extendNote.trim()) {
			setErr("New date and note are required to extend the deadline.");
			return;
		}
		setActionBusy(true);
		setErr("");
		try {
			await tasks.extendDeadline(id, extendDate, extendNote.trim());
			setExtendOpen(false);
			setExtendDate("");
			setExtendNote("");
			await reloadTaskDoc();
		} catch (e) {
			setErr(e.message || "Extend failed");
		} finally {
			setActionBusy(false);
		}
	}

	const taskBackTo = linkedProject ? `/projects/${linkedProject}` : "/tasks";
	const taskBackLabel = linkedProject ? "← Back to program" : "← Tasks";

	return {
		id,
		isNew,
		isManager,
		isAdministrator,
		authLoading,
		form,
		setField,
		projects: selectableProjects,
		milestones,
		loading,
		saving,
		err,
		activity,
		comments,
		timeline,
		setComments,
		actionBusy,
		savedStatus,
		projectStatus: effectiveProjectStatus,
		projectLoading,
		holdReason,
		projectNotActive,
		needsDeliveryTeam,
		needsMilestoneFirst,
		isTeamCompletedView,
		isManagerCompletedView,
		isCancelledView,
		usesQaWorkflow: usesQaWorkflowTask(form),
		currentUser,
		selectedProject,
		linkedProject,
		deliveryTeamRows,
		teamModalOpen,
		handleTeamModalClose,
		teamSaving,
		saveDeliveryTeam,
		loadTaskFeed,
		onSave,
		onStart,
		onMarkDevDone,
		onQaPass,
		onQaRework,
		onComplete,
		onReopen,
		onCancel,
		onDelete,
		extendOpen,
		extendDate,
		setExtendDate,
		extendNote,
		setExtendNote,
		openExtendModal,
		closeExtendModal,
		onExtendDeadline,
		taskBackTo,
		taskBackLabel,
	};
}
