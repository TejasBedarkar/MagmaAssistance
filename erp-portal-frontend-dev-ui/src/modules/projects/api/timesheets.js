import { pmCall, pmCallGet, pmMethodGetUrl } from "./pmCall.js";

export const timesheets = {
	getLogContext: (project) =>
		pmCallGet(
			project
				? pmMethodGetUrl("get_timesheet_log_context", { project })
				: pmMethodGetUrl("get_timesheet_log_context"),
		),
	listPage: ({ page = 1, pageSize = 25, statusFilter = "all", project = "" } = {}) =>
		pmCallGet(
			pmMethodGetUrl("get_portal_timesheets_list", {
				page,
				page_size: pageSize,
				status_filter: statusFilter,
				project,
			}),
		),
	approve: (timesheet_name, action = "Approved") =>
		pmCall("approve_timesheet", { timesheet_name, action }),
	approveBulk: (timesheet_names, action = "Approved") =>
		pmCall("approve_timesheets_bulk", { timesheet_names, action }),
};
