import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { HiOutlineFolder, HiOutlineFolderOpen } from "react-icons/hi2";
import { getList } from "../../../common/api/client.js";
import { projects as projectsApi } from "../api/index.js";
import { useAuth } from "../../../common/context/AuthContext.jsx";
import ListPagination from "../../../common/components/ListPagination.jsx";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import ProjectPageLoader from "../components/ProjectPageLoader.jsx";
import ProjectPageHeader from "../components/ProjectPageHeader.jsx";
import ProjectTeamPanel from "../components/ProjectTeamPanel.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import { PROJECT_LIST_PAGE_SIZE } from "../components/ProjectDataTable.jsx";
import { memberTaskStats } from "../lib/teamTaskStats.js";

function buildMemberOptionsForProject(project) {
	const members = (project.team_members || [])
		.filter((member) => member.user && member.planned)
		.sort((a, b) => (a.user_label || a.user).localeCompare(b.user_label || b.user))
		.map((member) => ({
			value: member.user,
			label: member.user_label || member.user,
		}));

	if (members.length <= 1) return [];

	return [{ value: "", label: "All members" }, ...members];
}

function buildProjectOptions(rows) {
	return [
		{ value: "", label: "All programs" },
		...rows.map((p) => ({
			value: p.name,
			label: p.project_name || p.name,
		})),
	];
}

function filterRows(rows, { projectFilter, search }) {
	let list = rows;
	if (projectFilter) list = list.filter((p) => p.name === projectFilter);
	const q = (search || "").trim().toLowerCase();
	if (q) {
		list = list.filter((p) => {
			if ((p.project_name || p.name || "").toLowerCase().includes(q)) return true;
			return (p.team_members || []).some((m) => {
				if ((m.user_label || m.user || "").toLowerCase().includes(q)) return true;
				return (m.tasks || []).some((t) => (t.task_title || t.name || "").toLowerCase().includes(q));
			});
		});
	}
	return list;
}

function programStats(members, memberFilter = "") {
	let list = members || [];
	if (memberFilter) list = list.filter((m) => m.user === memberFilter);
	let total = 0;
	let done = 0;
	for (const member of list) {
		const stats = memberTaskStats(member.tasks, member.member_role);
		total += stats.total;
		done += stats.done;
	}
	return { total, done };
}

function visibleMembers(members, memberFilter = "") {
	let list = (members || []).filter((m) => m.planned);
	if (memberFilter) list = list.filter((m) => m.user === memberFilter);
	return list;
}

function isReadOnlyProgram(status) {
	return (status || "").trim() !== "Active";
}

export default function TeamAssignments() {
	const navigate = useNavigate();
	const { isManager, isDeliveryMember } = useAuth();
	const [allRows, setAllRows] = useState([]);
	const [programScope, setProgramScope] = useState("active");
	const [err, setErr] = useState("");
	const [loading, setLoading] = useState(true);
	const [projectFilter, setProjectFilter] = useState("");
	const [search, setSearch] = useState("");
	const [memberFiltersByProject, setMemberFiltersByProject] = useState({});
	const [expandedProjectId, setExpandedProjectId] = useState(null);

	const rows = useMemo(() => {
		if (programScope === "all") return allRows;
		return allRows.filter((p) => (p.status || "") === "Active");
	}, [allRows, programScope]);

	const filteredRows = useMemo(
		() => filterRows(rows, { projectFilter, search }),
		[rows, projectFilter, search],
	);

	const isSingleActiveProject = filteredRows.length === 1;
	const useAccordion = filteredRows.length > 1;

	useEffect(() => {
		if (expandedProjectId && !filteredRows.some((p) => p.name === expandedProjectId)) {
			setExpandedProjectId(null);
		}
	}, [filteredRows, expandedProjectId]);

	const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(
		filteredRows,
		PROJECT_LIST_PAGE_SIZE,
	);

	const projectOptions = useMemo(() => buildProjectOptions(rows), [rows]);
	const hasActiveFilters = Boolean(projectFilter || search.trim());

	useEffect(() => {
		resetPage();
	}, [projectFilter, search, programScope, resetPage]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setErr("");
			setLoading(true);
			try {
				const overview = await projectsApi.getTeamOverview();
				const byProject = overview?.by_project || {};
				const scopedIds = Object.keys(byProject);

				if (scopedIds.length === 0) {
					if (!cancelled) setAllRows([]);
					return;
				}

				const projectRows = await getList("PM Project", {
					fields: ["name", "project_name", "status"],
					filters: [["name", "in", scopedIds]],
					order_by: "modified desc",
					limit_page_length: scopedIds.length,
				});
				const projectMap = new Map(projectRows.map((p) => [p.name, p]));

				const merged = scopedIds.map((id) => {
					const p = projectMap.get(id) || {};
					const team = byProject[id] || {};
					return {
						name: id,
						project_name: p.project_name || id,
						status: p.status,
						team_members: team.members || [],
						team_count: team.team_count || 0,
					};
				});

				const visible = isManager
					? merged
					: merged.filter((p) => p.team_count > 0 || (p.team_members || []).length > 0);
				if (!cancelled) setAllRows(visible);
			} catch (e) {
				if (!cancelled) {
					setErr(e.message || "Failed to load team assignments");
					setAllRows([]);
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [isManager]);

	function clearFilters() {
		setProjectFilter("");
		setSearch("");
		setMemberFiltersByProject({});
		setExpandedProjectId(null);
	}

	function handleProgramScopeChange(scope) {
		setProgramScope(scope);
		setExpandedProjectId(null);
		resetPage();
	}

	function handleProjectFilterChange(value) {
		setProjectFilter(value);
		if (!value) setExpandedProjectId(null);
	}

	function setProjectMemberFilter(projectId, value) {
		setMemberFiltersByProject((prev) => ({
			...prev,
			[projectId]: value,
		}));
	}

	function toggleProjectExpand(projectId) {
		setExpandedProjectId((prev) => (prev === projectId ? null : projectId));
	}

	return (
		<div className="pm-page pm-team-assignments-page">
			<ProjectPageHeader
				className="pm-team-assignments-header"
				meta={
					filteredRows.length > 0
						? `${filteredRows.length} program${filteredRows.length === 1 ? "" : "s"}${
								hasActiveFilters ? ` · filtered from ${rows.length}` : ""
							}`
						: null
				}
				actions={
					hasActiveFilters ? (
						<button type="button" className="pm-btn pm-btn-sm" onClick={clearFilters}>
							Clear filters
						</button>
					) : null
				}
			>
				<div className="pm-team-assignments-scope" role="tablist" aria-label="Program scope">
					<button
						type="button"
						role="tab"
						aria-selected={programScope === "active"}
						className={`pm-task-timeline__filter${programScope === "active" ? " pm-task-timeline__filter--active" : ""}`}
						onClick={() => handleProgramScopeChange("active")}
					>
						Active
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={programScope === "all"}
						className={`pm-task-timeline__filter${programScope === "all" ? " pm-task-timeline__filter--active" : ""}`}
						onClick={() => handleProgramScopeChange("all")}
					>
						All
					</button>
				</div>
				<div className="pm-list-filters pm-team-assignments-filters">
					<div className="pm-list-filters__field">
						<label className="pm-list-filters__label" htmlFor="team-filter-program">
							Program
						</label>
						<select
							id="team-filter-program"
							className="pm-select pm-list-filters__select"
							value={projectFilter}
							onChange={(e) => handleProjectFilterChange(e.target.value)}
						>
							{projectOptions.map((opt) => (
								<option key={opt.value || "all"} value={opt.value}>
									{opt.label}
								</option>
							))}
						</select>
					</div>
					<div className="pm-list-filters__field pm-list-filters__field--grow">
						<label className="pm-list-filters__label" htmlFor="team-filter-search">
							Search
						</label>
						<input
							id="team-filter-search"
							className="pm-input"
							type="search"
							placeholder="Program, member, or task…"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
					</div>
				</div>
			</ProjectPageHeader>

			{err ? <div className="pm-error-banner">{err}</div> : null}

			{loading ? (
				<ProjectPageLoader message="Loading team assignments…" />
			) : allRows.length === 0 ? (
				<div className="pm-card pm-empty">No programs yet.</div>
			) : rows.length === 0 ? (
				<div className="pm-card pm-empty">No active programs. Switch to All to view other programs.</div>
			) : filteredRows.length === 0 ? (
				<div className="pm-card pm-empty">
					No results.{" "}
					<button type="button" className="pm-link-btn" onClick={clearFilters}>
						Clear filters
					</button>
				</div>
			) : (
				<>
					{pageRows.map((p) => {
						const readOnly = isReadOnlyProgram(p.status);
						const memberOptions = buildMemberOptionsForProject(p);
						const memberFilter = memberFiltersByProject[p.name] ?? "";
						const stats = programStats(p.team_members, memberFilter);
						const allStats = programStats(p.team_members);
						const allMembers = visibleMembers(p.team_members);
						const isExpanded =
							filteredRows.length === 1
								? p.name === filteredRows[0].name
								: expandedProjectId === p.name;
						return (
							<section
								key={p.name}
								className={`pm-section pm-table-card pm-team-program-section${
									isExpanded ? " pm-team-program-section--expanded" : " pm-team-program-section--collapsed"
								}${isSingleActiveProject ? " pm-team-program-section--solo" : ""}`}
							>
								<div className="pm-table-card__head pm-team-program-section__head">
									{useAccordion ? (
										<button
											type="button"
											className="pm-team-program-section__head-toggle"
											onClick={() => toggleProjectExpand(p.name)}
											aria-expanded={isExpanded}
											aria-label={
												isExpanded
													? `Collapse ${p.project_name || p.name}`
													: `Expand ${p.project_name || p.name}`
											}
										>
											<span className="pm-team-program-section__toggle-icon" aria-hidden="true">
												{isExpanded ? (
													<HiOutlineFolderOpen size={18} />
												) : (
													<HiOutlineFolder size={18} />
												)}
											</span>
											<div className="pm-team-program-section__title-wrap">
												<h3 className="pm-team-program-section__title">
													{p.project_name || p.name}
												</h3>
												<span className="pm-team-program-section__sub">
													{isExpanded && memberFilter ? (
														<>
															Showing{" "}
															<strong>
																{memberOptions.find((opt) => opt.value === memberFilter)
																	?.label || "member"}
															</strong>
															{stats.total > 0
																? ` · ${stats.done}/${stats.total} tasks done`
																: ""}
														</>
													) : (
														<>
															{allMembers.length} member{allMembers.length === 1 ? "" : "s"}
															{allStats.total > 0
																? ` · ${allStats.done}/${allStats.total} tasks done`
																: ""}
														</>
													)}
												</span>
											</div>
										</button>
									) : (
										<div className="pm-team-program-section__title-wrap">
											<h3>
												<button
													type="button"
													className="pm-link-btn pm-team-program-section__title"
													onClick={() => navigate(`/projects/${p.name}`)}
												>
													{p.project_name || p.name}
												</button>
											</h3>
											<span className="pm-team-program-section__sub">
												{memberFilter ? (
													<>
														Showing{" "}
														<strong>
															{memberOptions.find((opt) => opt.value === memberFilter)?.label ||
																"member"}
														</strong>
														{stats.total > 0 ? ` · ${stats.done}/${stats.total} tasks done` : ""}
													</>
												) : (
													<>
														{allMembers.length} member{allMembers.length === 1 ? "" : "s"}
														{allStats.total > 0
															? ` · ${allStats.done}/${allStats.total} tasks done`
															: ""}
													</>
												)}
											</span>
										</div>
									)}
									<div className="pm-team-program-section__actions">
										{isExpanded && memberOptions.length > 1 ? (
											<div className="pm-team-program-section__member-filter">
												<label
													className="pm-team-program-section__member-filter-label"
													htmlFor={`team-member-filter-${p.name}`}
												>
													Member
												</label>
												<select
													id={`team-member-filter-${p.name}`}
													className="pm-team-program-section__member-select"
													value={memberFilter}
													onChange={(e) => setProjectMemberFilter(p.name, e.target.value)}
													aria-label={`Filter team table by member for ${p.project_name || p.name}`}
												>
													{memberOptions.map((opt) => (
														<option key={opt.value || "all"} value={opt.value}>
															{opt.label}
														</option>
													))}
												</select>
											</div>
										) : null}
										<StatusPill>{p.status || "—"}</StatusPill>
										{readOnly ? (
											<span className="pm-form-field-hint pm-team-program-section__readonly">View only</span>
										) : null}
										{!readOnly && (isManager || isDeliveryMember) ? (
											<Link
												to={`/projects/${p.name}/delivery`}
												className="pm-delivery-summary__link-sm"
											>
												Delivery
											</Link>
										) : null}
									</div>
								</div>
								{isExpanded ? (
									<div className="pm-team-program-section__body">
										{readOnly ? (
											<p className="pm-form-field-hint pm-team-program-section__readonly-note">
												This program is not active — team roster is read-only.
											</p>
										) : null}
										<ProjectTeamPanel
											members={p.team_members}
											memberFilter={memberFilter}
											layout="roster"
										/>
									</div>
								) : null}
							</section>
						);
					})}
					<ListPagination
						page={page}
						totalPages={totalPages}
						total={total}
						pageSize={PROJECT_LIST_PAGE_SIZE}
						onPageChange={setPage}
					/>
				</>
			)}
		</div>
	);
}
