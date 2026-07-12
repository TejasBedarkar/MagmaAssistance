/** Client helpers for Dev → QA task workflow (Phase 3). */

export function usesQaWorkflowTask(task) {
	const dev = String(task?.developer_assigned_to || "").trim();
	const qa = String(task?.qa_assigned_to || "").trim();
	return Boolean(dev && qa);
}

export function getWorkflowRole(task, user) {
	const email = String(user || "").trim();
	if (!email || !task) return null;
	const dev = String(task.developer_assigned_to || "").trim();
	const qa = String(task.qa_assigned_to || "").trim();
	const assigned = String(task.assigned_to || "").trim();
	const status = String(task.status || "Open").trim();
	if (dev && email === dev) return "developer";
	if (qa && email === qa) return "qa";
	if (assigned && email === assigned) {
		if (status === "QA Testing") return "qa";
		if (["Open", "Overdue", "In Progress", "Rework", "Blocked", "Dev Done"].includes(status)) return "developer";
	}
	return null;
}

export function workflowStatusLabel(status) {
	const labels = {
		"QA Testing": "In QA",
		Rework: "Rework",
		"QA Approved": "QA approved",
		"Dev Done": "Dev complete",
	};
	return labels[status] || status || "Open";
}

/** Statuses where QA is actively on the task (after dev handover). */
const QA_ASSIGNEE_VISIBLE_STATUSES = new Set(["QA Testing", "QA Approved", "Completed"]);

/** Tasks list: dev only until handover; then "Dev · QA: Tester" (names from API labels). */
export function formatTaskAssigneeDisplay(row) {
	const dev = (row?.developer_assigned_to_label || "").trim();
	const qa = (row?.qa_assigned_to_label || "").trim();
	const status = String(row?.status || "").trim();
	const assigned = (row?.assigned_to_label || "").trim();

	if (usesQaWorkflowTask(row) && dev && qa && QA_ASSIGNEE_VISIBLE_STATUSES.has(status)) {
		return `${dev} · QA: ${qa}`;
	}
	if (dev) {
		return dev;
	}
	return assigned || qa || "—";
}
