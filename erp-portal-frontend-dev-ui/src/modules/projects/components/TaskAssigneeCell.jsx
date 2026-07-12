import { formatTaskAssigneeDisplay } from "../lib/taskWorkflowUtils.js";

/** Tasks list assignee — single line, names only (e.g. Pawan Ahire · QA: Pritish). */
export default function TaskAssigneeCell({ row }) {
	return <span className="pm-cell-ellipsis">{formatTaskAssigneeDisplay(row)}</span>;
}
