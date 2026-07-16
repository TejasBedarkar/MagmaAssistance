export const ALL_STATUS_OPTIONS = [
	"Draft",
	"Pending Approval",
	"Active",
	"Rejected",
	"On Hold",
	"Completed",
	"Cancelled",
];

export const ADMIN_CREATE_STATUS_OPTIONS = ["Draft", "Active"];

export const emptyProjectForm = {
	project_code: "",
	project_name: "",
	description: "",
	customer: "",
	start_date: "",
	end_date: "",
	project_manager: "",
	budget: "",
	cost_center: "",
	stakeholders: "",
	cost_alert_threshold: 80,
	status: "Draft",
	non_labour_cost: "",
	delivery_team: [],
};

export function adminCreateStatus(status) {
	const value = status || "Draft";
	return ADMIN_CREATE_STATUS_OPTIONS.includes(value) ? value : "Draft";
}

export function statusTone(status) {
	const s = String(status || "").toLowerCase();
	if (s === "active") return "success";
	if (s === "pending approval") return "warn";
	if (s === "on hold") return "warn";
	if (s === "rejected") return "danger";
	if (s === "completed") return "success";
	if (s === "cancelled") return "danger";
	return "default";
}

export function todayIso() {
	return new Date().toISOString().slice(0, 10);
}
