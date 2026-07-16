import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
	HiOutlineArrowRight,
	HiOutlineClipboardDocumentList,
	HiOutlineFlag,
	HiOutlineUserGroup,
} from "react-icons/hi2";
import useUserLabelMap from "../../../../common/hooks/useUserLabelMap.js";
import { StatusPill } from "../../../../common/components/StatusPill.jsx";
import { projects } from "../../api/index.js";
import { roleTone } from "../../lib/deliveryTeamUtils.js";
import DeliveryTeamModal from "./DeliveryTeamModal.jsx";

function statusTone(status) {
	const s = String(status || "").toLowerCase();
	if (s === "active") return "success";
	if (s === "pending approval") return "warn";
	if (s === "rejected") return "danger";
	return "default";
}

function initialsFor(label, user) {
	const source = (label || user || "?").trim();
	const parts = source.split(/\s+/).filter(Boolean);
	if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
	return source.slice(0, 2).toUpperCase();
}

function countCompleted(items, value = "Completed") {
	return (items || []).filter((row) => String(row?.status || "").toLowerCase() === value.toLowerCase())
		.length;
}

export default function ProjectDeliveryPanel({
	projectId,
	rows,
	readOnly,
	canEdit,
	currentStatus,
	onSaveTeam,
	teamSaving,
	isManager,
	refreshKey = 0,
}) {
	const [modalOpen, setModalOpen] = useState(false);
	const [stats, setStats] = useState(null);
	const [statsLoading, setStatsLoading] = useState(true);
	const { labelFor } = useUserLabelMap();

	const members = (Array.isArray(rows) ? rows : []).filter((row) => row.user);
	const hasTeam = members.length > 0;

	const loadStats = useCallback(async () => {
		if (!projectId) return;
		setStatsLoading(true);
		try {
			const data = await projects.getDeliveryHub(projectId);
			setStats(data);
		} catch {
			setStats(null);
		} finally {
			setStatsLoading(false);
		}
	}, [projectId]);

	useEffect(() => {
		loadStats();
	}, [loadStats, refreshKey, currentStatus]);

	const status = stats?.status || currentStatus || "Draft";
	const milestoneCount = stats?.milestone_count ?? 0;
	const taskCount = stats?.task_count ?? 0;
	const allowsDelivery = Boolean(stats?.allows_delivery);

	const completedMilestones = useMemo(
		() => countCompleted(stats?.milestones),
		[stats?.milestones],
	);
	const completedTasks = useMemo(() => countCompleted(stats?.tasks), [stats?.tasks]);

	const planHint = isManager
		? allowsDelivery
			? "Track milestones & tasks"
			: status === "Pending Approval"
				? "After approval"
				: "When Active"
		: "Your assigned work";

	return (
		<section className="pm-delivery-panel">
			<header className="pm-delivery-panel__head">
				<div className="pm-delivery-panel__head-main">
					<h2 className="pm-delivery-panel__title">Delivery</h2>
					<StatusPill tone={statusTone(status)}>{status}</StatusPill>
				</div>
				{canEdit ? (
					<button
						type="button"
						className={`pm-btn pm-btn-sm${hasTeam ? "" : " pm-btn-primary"} pm-delivery-panel__team-btn`}
						onClick={() => setModalOpen(true)}
					>
						{hasTeam ? "Manage team" : "Create team"}
					</button>
				) : null}
			</header>

			{!hasTeam ? (
				<div className="pm-delivery-panel__body pm-delivery-panel__body--empty">
					<div className="pm-delivery-panel__empty-state">
						<div className="pm-delivery-panel__empty-icon" aria-hidden="true">
							<HiOutlineUserGroup />
						</div>
						<p className="pm-delivery-panel__empty-title">No delivery team yet</p>
					</div>
				</div>
			) : (
				<div className={`pm-delivery-panel__body${isManager ? "" : " pm-delivery-panel__body--single"}`}>
					<div className="pm-delivery-panel__col pm-delivery-panel__col--team">
						<div className="pm-delivery-panel__col-head">
							<span className="pm-delivery-panel__col-label">
								<HiOutlineUserGroup aria-hidden />
								Team
							</span>
							<span className="pm-delivery-panel__col-meta">
								{members.length} member{members.length === 1 ? "" : "s"}
							</span>
						</div>

						<ul className="pm-delivery-panel__team-list">
							{members.map((row, index) => {
								const label = row.full_name || labelFor(row.user);
								const role = row.member_role || "Developer";
								return (
									<li key={`${row.user}-${index}`} className="pm-delivery-panel__team-row">
										<span className="pm-delivery-panel__avatar" aria-hidden="true">
											{initialsFor(label, row.user)}
										</span>
										<span className="pm-delivery-panel__member-info">
											<span className="pm-delivery-panel__member-name">{label}</span>
											<span className="pm-delivery-panel__member-email">{row.user}</span>
										</span>
										<span
											className={`pm-delivery-panel__role pm-delivery-panel__role--${roleTone(role)}`}
										>
											{role}
										</span>
									</li>
								);
							})}
						</ul>
					</div>

					<div className="pm-delivery-panel__col pm-delivery-panel__col--plan">
						<div className="pm-delivery-panel__col-head">
							<span className="pm-delivery-panel__col-label">
								<HiOutlineFlag aria-hidden />
								Plan
							</span>
							<span className="pm-delivery-panel__col-meta">{planHint}</span>
						</div>

						<div className="pm-delivery-panel__plan-stack">
							<div className="pm-delivery-panel__stats-box">
								<div className="pm-delivery-panel__stats-row">
									<div className="pm-delivery-panel__stat">
										<span className="pm-delivery-panel__stat-value">
											{statsLoading ? "—" : milestoneCount}
										</span>
										<span className="pm-delivery-panel__stat-label">Milestones</span>
										{!statsLoading && milestoneCount > 0 ? (
											<span className="pm-delivery-panel__stat-sub">
												{completedMilestones} done
											</span>
										) : null}
									</div>
									<div className="pm-delivery-panel__stat-divider" aria-hidden="true" />
									<div className="pm-delivery-panel__stat">
										<span className="pm-delivery-panel__stat-value">
											{statsLoading ? "—" : taskCount}
										</span>
										<span className="pm-delivery-panel__stat-label">Tasks</span>
										{!statsLoading && taskCount > 0 ? (
											<span className="pm-delivery-panel__stat-sub">
												{completedTasks} done
											</span>
										) : null}
									</div>
								</div>
							</div>

							<Link
								to={`/projects/${projectId}/delivery`}
								className={`pm-delivery-panel__plan-link${allowsDelivery ? "" : " pm-delivery-panel__plan-link--muted"}`}
							>
								<HiOutlineClipboardDocumentList aria-hidden />
								<span>Open delivery plan</span>
								<HiOutlineArrowRight aria-hidden />
							</Link>
						</div>
					</div>
				</div>
			)}

			<DeliveryTeamModal
				open={modalOpen}
				onClose={() => setModalOpen(false)}
				initialRows={rows}
				onSave={onSaveTeam}
				saving={teamSaving}
				projectStatus={currentStatus}
			/>
		</section>
	);
}
