import { pmCall, pmCallGet, pmMethodGetUrl } from "./pmCall.js";

export const approval = {
	getPendingProjects: () => pmCallGet(pmMethodGetUrl("get_pending_projects")),
	approveProject: (project) => pmCall("approve_project", { project }),
	rejectProject: (project, reason = "") => pmCall("reject_project", { project, reason }),
};
