import React from "react";
import { Link } from "react-router-dom";
import Modal from "../../../common/components/Modal.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import { memberTaskDisplayStatus } from "../lib/teamTaskStats.js";
import { formatDateOnly, formatDateTime } from "../utils/formatDateTime.js";

export default function TeamMemberCompletedModal({ member, tasks, onClose }) {
	const memberLabel = member?.user_label || member?.user || "Member";
	const list = tasks || [];

	return (
		<Modal wide title={`Completed tasks — ${memberLabel}`} onClose={onClose}>
			{list.length === 0 ? (
				<p className="pm-team-completed-modal__empty">No completed tasks yet.</p>
			) : (
				<div className="pm-table-wrap pm-table-wrap--flush">
					<table className="pm-table pm-team-completed-modal__table">
						<thead>
							<tr>
								<th className="col-task">Task</th>
								<th className="col-started">Started</th>
								<th className="col-status">Status</th>
								<th className="col-completed">Completed</th>
							</tr>
						</thead>
						<tbody>
							{list.map((task) => (
								<tr key={task.name}>
									<td className="col-task">
										<Link to={`/tasks/${task.name}`} className="pm-team-completed-modal__task-link">
											{task.task_title || task.name}
										</Link>
									</td>
									<td className="col-started">{formatDateOnly(task.created_on)}</td>
									<td className="col-status">
										<StatusPill>{memberTaskDisplayStatus(task, member?.member_role)}</StatusPill>
									</td>
									<td className="col-completed">
										{formatDateTime(task.completed_on || task.modified)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</Modal>
	);
}
