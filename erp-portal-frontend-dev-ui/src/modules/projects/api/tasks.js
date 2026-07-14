import { pmCall, pmCallGet, pmMethodGetUrl } from "./pmCall.js";

export const tasks = {
	list: (project) =>
		pmCallGet(
			project
				? pmMethodGetUrl("get_portal_tasks_list", { project })
				: pmMethodGetUrl("get_portal_tasks_list"),
		),
	listPage: ({ page = 1, pageSize = 25, project = "", status = "", search = "" } = {}) =>
		pmCallGet(
			pmMethodGetUrl("get_portal_tasks_list", {
				page,
				page_size: pageSize,
				project,
				status,
				search,
			}),
		),
	getActivity: (task_name) => pmCallGet(pmMethodGetUrl("get_task_activity", { task_name })),
	markCommentsSeen: (task_name) => pmCall("mark_task_comments_seen", { task_name }),
	addComment: (task_name, content) => pmCall("add_portal_task_comment", { task_name, content }),
	updateStatus: (task_name, status, blocked_reason) =>
		pmCall("update_task_status", { task_name, status, blocked_reason }),
	markDevDone: (task_name) => pmCall("mark_dev_done", { task_name }),
	qaPass: (task_name, qa_notes, evidence) =>
		pmCall("qa_pass", { task_name, qa_notes, evidence: evidence ? JSON.stringify(evidence) : undefined }),
	qaRework: (task_name, rework_reason, bug_description = "", evidence) =>
		pmCall("qa_rework", {
			task_name,
			rework_reason,
			bug_description,
			evidence: evidence ? JSON.stringify(evidence) : undefined,
		}),
	getQaWorkflow: (task_name) => pmCallGet(pmMethodGetUrl("get_task_qa_workflow", { task_name })),
	saveQaChecklist: (task_name, items) =>
		pmCall("save_task_qa_checklist", { task_name, items: JSON.stringify(items) }),
	complete: (task_name) => pmCall("complete_task", { task_name }),
	reopen: (task_name, reason) => pmCall("reopen_task", { task_name, reason }),
	cancel: (task_name, reason) => pmCall("cancel_task", { task_name, reason }),
	extendDeadline: (task_name, new_commitment_date, note) =>
		pmCall("extend_task_deadline", { task_name, new_commitment_date, note }),
	reassignToManager: (task_name, note) => pmCall("reassign_task_to_manager", { task_name, note }),
};
