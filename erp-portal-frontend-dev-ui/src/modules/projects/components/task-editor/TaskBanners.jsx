import { Link } from "react-router-dom";
import { formatDateTime } from "../../utils/formatDateTime.js";

import { usesQaWorkflowTask, getWorkflowRole } from "../../lib/taskWorkflowUtils.js";
import { isTaskReopened } from "../../lib/taskReopenUtils.js";
import { isTaskCancelled } from "../../lib/taskCancelUtils.js";

export default function TaskBanners({
	err,
	savedNotice,
	isManager,
	isNew,
	form,
	savedStatus,
	projectStatus,
	projectNotActive,
	needsMilestoneFirst,
	holdReason,
	isTeamCompletedView,
	isManagerCompletedView,
	isCancelledView,
	usesQaWorkflow,
	currentUser,
}) {
	const qaWorkflow = usesQaWorkflow ?? usesQaWorkflowTask(form);
	const role = getWorkflowRole(form, currentUser);
	const status = savedStatus || form.status || "Open";
	const reopened = isTaskReopened(form);
	const cancelled = isCancelledView || isTaskCancelled(form);
	const onHold = projectStatus === "On Hold";
	const holdNote = (holdReason || "").trim();
	const showHoldReason =
		holdNote && holdNote.toLowerCase() !== "on hold" && holdNote.toLowerCase() !== "hold";
	return (
		<>
			{savedNotice ? <div className="pm-success-banner">{savedNotice}</div> : null}
			{err ? <div className="pm-error-banner">{err}</div> : null}
			{projectNotActive && isManager && isNew ? (
				<div className="pm-error-banner" role="status">
					{onHold ? (
						<>
							This program is <strong>on hold</strong>
							{showHoldReason ? ` — ${holdNote}` : ""}. Resume delivery before creating new tasks.
						</>
					) : (
						<>
							This program is <strong>{projectStatus}</strong>. New tasks can only be added on{" "}
							<strong>Active</strong> programs after administrator approval.
						</>
					)}
				</div>
			) : null}
			{needsMilestoneFirst ? (
				<div className="pm-delivery-hub__error" role="alert">
					Add at least one milestone on this program before creating tasks.{" "}
					<Link to={`/milestones/new?project=${encodeURIComponent(form.project)}`}>
						Add milestone →
					</Link>
				</div>
			) : null}
			{!isManager && !isNew && form.status === "Blocked" ? (
				<div className="pm-error-banner">
					This task was blocked by your program manager. Check notifications for details. You
					cannot change status until your manager updates it.
				</div>
			) : null}
			{!isManager && !isNew && isTeamCompletedView ? (
				<div className="pm-success-banner">
					This task is completed
					{form.completed_on ? ` on ${formatDateTime(form.completed_on)}` : ""}. You can review
					details and activity below, add comments, but cannot edit or change status.
				</div>
			) : null}
			{!isManager && !isNew && cancelled ? (
				<div className="pm-error-banner">
					This task was <strong>cancelled</strong>
					{form.cancelled_reason ? ` — ${form.cancelled_reason}` : ""}. You can review details below
					but cannot edit or change status.
				</div>
			) : null}
			{!isNew && reopened && !cancelled ? (
				<div className="pm-error-banner pm-reopen-banner">
					This task was <strong>reopened</strong>
					{form.reopen_reason ? ` — ${form.reopen_reason}` : ""}.
					{isManager
						? " Review activity and complete when ready."
						: role === "qa"
							? " Resume QA when development is complete again."
							: " Use Start on My Day when you begin work again."}
				</div>
			) : null}
			{isManager && !isNew && isManagerCompletedView ? (
				<div className="pm-success-banner">
					This task is completed
					{form.completed_on ? ` on ${formatDateTime(form.completed_on)}` : ""}.
				</div>
			) : null}
			{isManager && !isNew && cancelled ? (
				<div className="pm-error-banner">
					This task is <strong>cancelled</strong>
					{form.cancelled_on ? ` on ${formatDateTime(form.cancelled_on)}` : ""}
					{form.cancelled_reason ? ` — ${form.cancelled_reason}` : ""}.
				</div>
			) : null}
			{!isManager && !isNew && !isTeamCompletedView && !cancelled && form.status !== "Blocked" ? (
				<p className="pm-page-desc pm-page-desc--tight">
					{qaWorkflow
						? role === "qa"
							? "Use QA pass or send for rework when testing is complete. Status changes are applied through workflow actions."
							: role === "developer"
								? "Update description, move Open → In Progress, then mark dev done to hand over to QA."
								: "This task uses the Dev → QA workflow. Open the task to see available actions."
						: "Update description or choose status (Open, In Progress, Dev Done). Only managers can block tasks. Mark complete after your timesheet is approved."}
				</p>
			) : null}
			{isManager && !isNew && qaWorkflow && !cancelled && status !== "Completed" ? (
				<p className="pm-page-desc pm-page-desc--tight">
					Dev Done hands work to QA automatically. Use workflow buttons for QA pass, rework, and
					complete — not the status dropdown while the task is in QA phases.
				</p>
			) : null}
			{qaWorkflow && status === "QA Approved" && isManager && !reopened ? (
				<div className="pm-success-banner">
					QA approved — review deliverables and timesheets, then mark the task complete.
				</div>
			) : null}
		</>
	);
}
