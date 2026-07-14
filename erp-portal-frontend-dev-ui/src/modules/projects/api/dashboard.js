import { pmCallGet, pmMethodGetUrl } from "./pmCall.js";
import { tasks } from "./tasks.js";

export const dashboard = {
	getData: () => pmCallGet(pmMethodGetUrl("get_dashboard_data")),
	getMyDayTasks: () => pmCallGet(pmMethodGetUrl("get_my_day_tasks")),
	extendTaskDeadline: tasks.extendDeadline,
	reassignTaskToManager: tasks.reassignToManager,
	completeTask: tasks.complete,
};
