import { pmCall, pmCallGet, pmMethodGetUrl } from "./pmCall.js";

export const milestones = {
	getActivity: (milestone_name) =>
		pmCallGet(pmMethodGetUrl("get_milestone_activity", { milestone_name })),
	addComment: (milestone_name, content) =>
		pmCall("add_portal_milestone_comment", { milestone_name, content }),
};
