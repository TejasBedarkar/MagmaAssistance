import React, { useState } from "react";
import { Link } from "react-router-dom";
import { HiOutlineEye } from "react-icons/hi2";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import { roleTone } from "../lib/deliveryTeamUtils.js";
import { memberCompletedTasks, memberCurrentTasks, memberTaskDisplayStatus, memberTaskStats } from "../lib/teamTaskStats.js";
import TeamMemberCompletedModal from "./TeamMemberCompletedModal.jsx";

function initialsFor(label, user) {
	const source = (label || user || "?").trim();
	const parts = source.split(/\s+/).filter(Boolean);
	if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
	return source.slice(0, 2).toUpperCase();
}

/**
 * Delivery team roster for program cards and team page.
 * layout: compact (team page) | blocks | roster (table)
 */
export default function ProjectTeamPanel({
	projectName,
	members,
	compact = false,
	memberFilter = "",
	layout = "blocks",
}) {
	const [completedModal, setCompletedModal] = useState(null);
	let list = members || [];
	if (memberFilter) {
		list = list.filter((m) => m.user === memberFilter);
	}

	if (list.length === 0) {
		return (
			<p className="pm-team-panel__empty">
				{memberFilter ? "No matching member." : "No team members yet."}
			</p>
		);
	}

	const useCompact = compact || layout === "compact";

	if (useCompact) {
		return (
			<ul className="pm-team-panel pm-team-panel--compact">
				{list.map((m) => {
					const { total, done } = memberTaskStats(m.tasks, m.member_role);
					const visibleTasks = [...memberCurrentTasks(m.tasks, m.member_role), ...memberCompletedTasks(m.tasks, m.member_role)];
					return (
						<li key={m.user || m.user_label} className="pm-team-panel__member-row">
							<span className="pm-team-panel__avatar" aria-hidden="true">
								{initialsFor(m.user_label, m.user)}
							</span>
							<div className="pm-team-panel__member-main">
								<div className="pm-team-panel__member-line">
									<span className="pm-team-panel__name">{m.user_label}</span>
									{m.member_role ? (
										<span
											className={`pm-team-panel__role pm-team-panel__role--${roleTone(m.member_role)}`}
										>
											{m.member_role}
										</span>
									) : null}
									<span className="pm-team-panel__meta">
										{total > 0 ? `${done}/${total}` : "—"}
									</span>
								</div>
								{visibleTasks.length > 0 ? (
									<ul className="pm-team-panel__tasks pm-team-panel__tasks--compact">
										{visibleTasks.map((t) => (
											<li key={t.name}>
												<Link to={`/tasks/${t.name}`} className="pm-team-panel__task-link">
													{t.task_title || t.name}
												</Link>
												<StatusPill>{memberTaskDisplayStatus(t, m.member_role)}</StatusPill>
											</li>
										))}
									</ul>
								) : (
									<p className="pm-team-panel__no-tasks">
										{m.planned ? "No tasks yet" : "No tasks"}
									</p>
								)}
							</div>
						</li>
					);
				})}
			</ul>
		);
	}

	if (layout === "roster") {
		return (
			<div className="pm-team-roster">
				{projectName ? <p className="pm-team-panel__project-title">{projectName}</p> : null}
				<div className="pm-table-wrap pm-table-wrap--flush">
					<table className="pm-table pm-team-roster-table">
						<thead>
							<tr>
								<th className="col-member">Member</th>
								<th className="col-role">Role</th>
								<th className="col-progress">Progress</th>
								<th className="col-tasks">Working on</th>
								<th className="col-completed">Completed</th>
							</tr>
						</thead>
						<tbody>
							{list.map((m) => {
								const { total, done, pct } = memberTaskStats(m.tasks, m.member_role);
								const currentTasks = memberCurrentTasks(m.tasks, m.member_role);
								const completedTasks = memberCompletedTasks(m.tasks, m.member_role);
								return (
									<tr key={m.user || m.user_label}>
										<td className="col-member">
											<span className="pm-team-roster__name">{m.user_label}</span>
										</td>
										<td className="col-role">{m.member_role || "—"}</td>
										<td className="col-progress">
											{total > 0 ? `${done}/${total} · ${pct}%` : "—"}
										</td>
										<td className="col-tasks">
											{currentTasks.length === 0 ? (
												<span className="pm-team-roster__idle">—</span>
											) : (
												currentTasks.map((t) => (
													<span key={t.name} className="pm-team-roster__task">
														<Link to={`/tasks/${t.name}`}>{t.task_title || t.name}</Link>
														<StatusPill>{memberTaskDisplayStatus(t, m.member_role)}</StatusPill>
													</span>
												))
											)}
										</td>
										<td className="col-completed">
											{completedTasks.length === 0 ? (
												<span className="pm-team-roster__idle">—</span>
											) : (
												<button
													type="button"
													className="pm-team-roster__view-completed-btn"
													onClick={() => setCompletedModal({ member: m, tasks: completedTasks })}
													aria-label={`View ${completedTasks.length} completed task${
														completedTasks.length === 1 ? "" : "s"
													} for ${m.user_label}`}
												>
													<HiOutlineEye size={14} aria-hidden="true" />
													View {completedTasks.length} completed
												</button>
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
				{completedModal ? (
					<TeamMemberCompletedModal
						member={completedModal.member}
						tasks={completedModal.tasks}
						onClose={() => setCompletedModal(null)}
					/>
				) : null}
			</div>
		);
	}

	return (
		<div className="pm-team-panel">
			{projectName ? <p className="pm-team-panel__project-title">{projectName}</p> : null}
			{list.map((m) => {
				const { total, done } = memberTaskStats(m.tasks, m.member_role);
				const visibleTasks = [...memberCurrentTasks(m.tasks, m.member_role), ...memberCompletedTasks(m.tasks, m.member_role)];
				return (
					<div key={m.user || m.user_label} className="pm-team-panel__member-block">
						<div className="pm-team-panel__member-head">
							<span className="pm-team-panel__name">{m.user_label}</span>
							{m.member_role ? (
								<span className="pm-team-panel__role">{m.member_role}</span>
							) : null}
							{total > 0 ? (
								<span className="pm-team-panel__stats">{done}/{total} done</span>
							) : null}
						</div>
						{visibleTasks.length === 0 ? (
							<p className="pm-team-panel__no-tasks">{m.planned ? "No tasks yet" : "No tasks"}</p>
						) : (
							<ul className="pm-team-panel__tasks">
								{visibleTasks.map((t) => (
									<li key={t.name}>
										<Link to={`/tasks/${t.name}`} className="pm-team-panel__task-link">
											{t.task_title || t.name}
										</Link>
										<StatusPill>{memberTaskDisplayStatus(t, m.member_role)}</StatusPill>
									</li>
								))}
							</ul>
						)}
					</div>
				);
			})}
		</div>
	);
}
