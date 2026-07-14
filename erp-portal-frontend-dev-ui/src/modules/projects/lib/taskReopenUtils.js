import { getWorkflowRole, usesQaWorkflowTask } from "./taskWorkflowUtils.js";

/** True when task was formally reopened and is not completed again. */
export function isTaskReopened(task) {
	if (!task?.is_reopened && !task?.reopened_on) return false;
	const status = String(task?.status || "").trim();
	return status !== "Completed";
}

/** Reopened task where developer must Start again (not post-QA approval). */
export function taskReopenedAwaitingDevRestart(task) {
	if (!isTaskReopened(task)) return false;
	const status = String(task?.status || "").trim();
	if (status === "Open" || status === "Overdue" || status === "Rework") return true;
	if (status !== "QA Approved" && status !== "Dev Done") return false;
	const dev = String(task?.developer_assigned_to || "").trim();
	const assigned = String(task?.assigned_to || "").trim();
	return Boolean(dev && assigned === dev);
}

/** Portal display status — reopened tasks awaiting dev restart show as Open. */
export function getTaskDisplayStatus(task) {
	if (taskReopenedAwaitingDevRestart(task)) return "Open";
	return String(task?.status || "Open").trim() || "Open";
}

/** Developer may press Start (Open / Overdue / Rework, or stale post-reopen status). */
export function canDeveloperStartTask(task, currentUser) {
	const status = String(task?.status || "Open").trim();
	const email = String(currentUser || "").trim();
	if (!email) return false;

	if (!usesQaWorkflowTask(task)) {
		if (status !== "Open" && status !== "Overdue" && status !== "Rework") return false;
		const assigned = String(task?.assigned_to || "").trim();
		return assigned === email;
	}

	const role = getWorkflowRole(task, currentUser);
	if (role !== "developer") return false;
	if (status === "Open" || status === "Overdue" || status === "Rework") return true;
	return taskReopenedAwaitingDevRestart(task);
}
