function normalizeStatus(task) {
	return String(task?.status || "Open").trim().toLowerCase();
}

function normalizeRole(memberRole) {
	return String(memberRole || "").trim().toLowerCase();
}

/** Role-specific done: tester after QA pass; developer after manager closure. */
export function memberTaskIsDoneForRole(task, memberRole = "") {
	const status = normalizeStatus(task);
	const role = normalizeRole(memberRole);
	if (role === "tester") return status === "qa approved" || status === "completed";
	if (role === "developer") return status === "completed";
	return status === "completed";
}

/** Label for this member's contribution — not the global workflow status. */
export function memberTaskDisplayStatus(task, memberRole = "") {
	const status = normalizeStatus(task);
	if (status === "completed") return "Completed";

	const role = normalizeRole(memberRole);
	if (role === "developer") {
		if (["qa testing", "qa approved", "completed", "dev done"].includes(status)) return "Dev complete";
		return task?.status || "Open";
	}
	if (role === "tester") {
		if (status === "qa approved" || status === "completed") return "QA approved";
		if (status === "qa testing") return "QA testing";
		return task?.status || "Open";
	}
	return task?.status || "Open";
}

/** Task completion counts for team roster rows (role-aware). */
export function memberTaskStats(tasks, memberRole = "") {
	const list = Array.isArray(tasks) ? tasks : [];
	const total = list.length;
	const done = list.filter((t) => memberTaskIsDoneForRole(t, memberRole)).length;
	const pct = total ? Math.round((done / total) * 100) : 0;
	return { total, done, pct };
}

/** Active hands-on work for this roster member (Team & Assignments "Working on" column). */
export function memberCurrentTasks(tasks, memberRole = "") {
	const list = Array.isArray(tasks) ? tasks : [];
	const role = normalizeRole(memberRole);
	return list.filter((t) => {
		if (memberTaskIsDoneForRole(t, memberRole)) return false;
		const status = normalizeStatus(t);
		if (role === "tester") return status === "qa testing";
		if (role === "developer") {
			return ["in progress", "rework", "blocked"].includes(status);
		}
		return status === "in progress";
	});
}

function completedTimestamp(task) {
	const value = task?.completed_on || task?.modified;
	if (!value) return 0;
	const time = new Date(value).getTime();
	return Number.isNaN(time) ? 0 : time;
}

/** Finished work for this member (tester: QA approved+; developer: manager completed). */
export function memberCompletedTasks(tasks, memberRole = "") {
	return (Array.isArray(tasks) ? tasks : [])
		.filter((t) => memberTaskIsDoneForRole(t, memberRole))
		.sort((a, b) => completedTimestamp(b) - completedTimestamp(a));
}
