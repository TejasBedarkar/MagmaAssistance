export const CANCEL_REASON_MIN_LENGTH = 10;

export function isTaskCancelled(task) {
	return (task?.status || "").trim() === "Cancelled";
}

/** Program manager may cancel active (non-terminal) tasks via the portal. */
export function canManagerCancelTask(task) {
	if (!task || isTaskCancelled(task)) return false;
	const status = (task.status || "").trim();
	return status !== "Completed";
}
