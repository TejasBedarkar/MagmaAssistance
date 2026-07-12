export const MANAGER_STATUSES = [
	"Open",
	"In Progress",
	"Dev Done",
	"QA Testing",
	"Rework",
	"QA Approved",
	"Blocked",
	"Overdue",
	"Completed",
];
/** Manager may set these on QA workflow tasks via the task form (not workflow actions). */
export const QA_WORKFLOW_MANAGER_FORM_STATUSES = ["Open", "In Progress", "Blocked", "Overdue"];
/** QA workflow statuses that must change only through portal workflow actions. */
export const QA_WORKFLOW_READONLY_STATUSES = new Set([
	"Dev Done",
	"QA Testing",
	"Rework",
	"QA Approved",
	"Completed",
	"Cancelled",
]);

export function managerStatusOptions({ qaWorkflow, currentStatus } = {}) {
	if (!qaWorkflow) {
		return MANAGER_STATUSES;
	}
	const status = (currentStatus || "Open").trim();
	if (QA_WORKFLOW_READONLY_STATUSES.has(status)) {
		return [status];
	}
	const options = [...QA_WORKFLOW_MANAGER_FORM_STATUSES];
	if (status && !options.includes(status)) {
		options.unshift(status);
	}
	return options;
}

export function isQaWorkflowManagerStatusReadOnly(qaWorkflow, status) {
	return Boolean(qaWorkflow && QA_WORKFLOW_READONLY_STATUSES.has((status || "").trim()));
}

export const TEAM_STATUSES = ["Open", "In Progress", "Dev Done"];
export const TEAM_EDITABLE_STATUSES = new Set(TEAM_STATUSES);
export const PRIORITIES = ["Low", "Medium", "High", "Critical"];

export const emptyTaskForm = {
	project: "",
	milestone: "",
	assigned_to: "",
	developer_assigned_to: "",
	qa_assigned_to: "",
	task_title: "",
	description: "",
	created_on: "",
	due_date: "",
	estimated_hours: "",
	priority: "Medium",
	status: "Open",
	blocked_reason: "",
	rework_reason: "",
	bug_description: "",
	qa_notes: "",
};

export function todayIso() {
	return new Date().toISOString().slice(0, 10);
}

export function createdOnFromDoc(doc) {
	if (doc?.created_on) return doc.created_on;
	if (doc?.creation) return new Date(doc.creation).toISOString().slice(0, 10);
	return todayIso();
}

const STATUS_UPDATE_TO_RE =
	/Status changed from .+? to (In Progress|Dev Done|QA Testing|Rework|QA Approved|Completed|Overdue|Blocked|Open|Planned|At Risk)\b/i;

/** Visual tone for timeline activity badges — uses action + body for status context. */
export function activityTone(action, body = "") {
	if (action === "Task Completed" || action === "Milestone Completed") return "success";
	if (action === "Task Cancelled") return "danger";
	if (action === "Hours Updated") return "accent";
	if (action === "Task Created" || action === "Milestone Created") return "created";
	if (action === "Assignment" || action === "Reassign Task") return "assignment";
	if (action === "Extend Deadline" || action === "Effort Variance Alert") return "warning";
	if (action === "Field Updated") return "change";

	if (action === "Status Update") {
		const match = String(body).match(STATUS_UPDATE_TO_RE);
		const newStatus = match?.[1]?.trim();
		switch (newStatus) {
			case "Completed":
				return "success";
			case "Blocked":
			case "Overdue":
			case "At Risk":
				return "danger";
			case "In Progress":
				return "progress";
			case "Dev Done":
			case "QA Testing":
				return "review";
			case "Rework":
				return "warning";
			case "QA Approved":
				return "success";
			case "Open":
			case "Planned":
				return "open";
			default:
				return "default";
		}
	}

	return "muted";
}

const ACTIVITY_TONE_CLASS = {
	success: "pm-activity-item__action--success",
	accent: "pm-activity-item__action--accent",
	created: "pm-activity-item__action--created",
	assignment: "pm-activity-item__action--assignment",
	warning: "pm-activity-item__action--warning",
	danger: "pm-activity-item__action--danger",
	progress: "pm-activity-item__action--progress",
	review: "pm-activity-item__action--review",
	open: "pm-activity-item__action--open",
	change: "pm-activity-item__action--change",
	default: "pm-activity-item__action--default",
	muted: "pm-activity-item__action--muted",
};

export function activityActionClassName(tone) {
	return ACTIVITY_TONE_CLASS[tone] || ACTIVITY_TONE_CLASS.muted;
}
