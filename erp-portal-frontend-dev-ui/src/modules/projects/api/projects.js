import { pmCall, pmCallGet, pmMethodGetUrl } from "./pmCall.js";

export const projects = {
	getNextProjectCode: () => pmCallGet(pmMethodGetUrl("get_next_project_code")),
	getTeamDetail: (project, options) =>
		pmCallGet(pmMethodGetUrl("get_project_team_detail", { project }), options),
	getDeliveryHub: (project) => pmCallGet(pmMethodGetUrl("get_project_delivery_hub", { project })),
	getTeamOverview: (options) => pmCallGet(pmMethodGetUrl("get_projects_team_overview"), options),
	listPage: ({ page = 1, pageSize = 25, status = "", search = "" } = {}) =>
		pmCallGet(
			pmMethodGetUrl("get_portal_projects_list", {
				page,
				page_size: pageSize,
				status,
				search,
			}),
		),
	submitForApproval: (project) => pmCall("submit_project_for_approval", { project }),
	putOnHold: (project, reason) => pmCall("put_project_on_hold", { project, reason }),
	resume: (project, note = "") => pmCall("resume_project", { project, note }),
};
