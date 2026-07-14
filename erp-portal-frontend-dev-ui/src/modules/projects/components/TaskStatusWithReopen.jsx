import { StatusPill } from "../../../common/components/StatusPill.jsx";
import TaskReopenedBadge from "./TaskReopenedBadge.jsx";
import { isTaskReopened, getTaskDisplayStatus } from "../lib/taskReopenUtils.js";

/** Status pill plus optional Reopened badge when task was formally reopened. */
export default function TaskStatusWithReopen({ task, status, tone, children }) {
	const label = children ?? getTaskDisplayStatus(task ?? { status });
	return (
		<div className="pm-status-cell">
			<StatusPill tone={tone}>{label}</StatusPill>
			{isTaskReopened(task) ? <TaskReopenedBadge /> : null}
		</div>
	);
}
