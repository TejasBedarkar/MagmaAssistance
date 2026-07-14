export const MANAGER_STATUSES = ["Draft", "Submitted", "Approved", "Rejected"];
export const TEAM_STATUSES = ["Draft", "Submitted"];

export const emptyTimesheetForm = {
	project: "",
	task: "",
	date: "",
	hours: "",
	description: "",
	status: "Draft",
	cost_rate: "",
};

export function todayIso() {
	return new Date().toISOString().slice(0, 10);
}
