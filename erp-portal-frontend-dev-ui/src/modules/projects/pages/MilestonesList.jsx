import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getList } from "../../../common/api/client.js";
import ListFilters from "../../../common/components/ListFilters.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import useProjectOptions from "../hooks/useProjectOptions.js";
import ProjectDataTable, { PROJECT_LIST_PAGE_SIZE } from "../components/ProjectDataTable.jsx";
import ProjectPageHeader from "../components/ProjectPageHeader.jsx";
import useProjectAuth from "../hooks/useProjectAuth.js";

const STATUS_OPTIONS = [
	{ value: "", label: "All statuses" },
	{ value: "Planned", label: "Planned" },
	{ value: "In Progress", label: "In Progress" },
	{ value: "At Risk", label: "At Risk" },
	{ value: "Completed", label: "Completed" },
];

export default function MilestonesList() {
	const { isManager, user } = useProjectAuth();
	const [searchParams] = useSearchParams();
	const urlProject = searchParams.get("project") || "";
	const { options: projectOptions } = useProjectOptions();
	const [rows, setRows] = useState([]);
	const [err, setErr] = useState("");
	const [loading, setLoading] = useState(true);
	const [statusFilter, setStatusFilter] = useState("");
	const [projectFilter, setProjectFilter] = useState(urlProject);
	const [search, setSearch] = useState("");

	useEffect(() => {
		setProjectFilter(urlProject);
	}, [urlProject]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setErr("");
			setLoading(true);
			try {
				let visibleMilestoneIds = null;
				if (!isManager && !user) {
					if (!cancelled) setRows([]);
					return;
				}
				if (!isManager && user) {
					const taskFields = ["milestone"];
					const taskQuery = { fields: taskFields, limit_page_length: 500 };
					const [assignedRows, devRows, qaRows] = await Promise.all([
						getList("PM Task", { ...taskQuery, filters: { assigned_to: user } }),
						getList("PM Task", { ...taskQuery, filters: { developer_assigned_to: user } }),
						getList("PM Task", { ...taskQuery, filters: { qa_assigned_to: user } }),
					]);
					visibleMilestoneIds = Array.from(
						new Set(
							[...assignedRows, ...devRows, ...qaRows]
								.map((row) => row.milestone)
								.filter(Boolean)
						)
					);
					if (visibleMilestoneIds.length === 0) {
						if (!cancelled) setRows([]);
						return;
					}
				}
				const data = await getList("PM Milestone", {
					fields: [
						"name",
						"milestone_name",
						"project",
						"project.project_name",
						"planned_date",
						"status",
						"modified",
					],
					filters:
						visibleMilestoneIds && visibleMilestoneIds.length
							? { name: ["in", visibleMilestoneIds] }
							: undefined,
					order_by: "modified desc",
					limit_page_length: 500,
				});
				if (!cancelled) setRows(data);
			} catch (e) {
				if (!cancelled) setErr(e.message || "Failed to load");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [isManager, user]);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return rows.filter((r) => {
			if (statusFilter && r.status !== statusFilter) return false;
			if (projectFilter && r.project !== projectFilter) return false;
			if (q) {
				const hay = `${r.milestone_name || ""} ${r.project_name || ""}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	}, [rows, statusFilter, projectFilter, search]);

	const filterKey = `${statusFilter}|${projectFilter}|${search}`;

	const columns = useMemo(
		() => [
			{
				key: "milestone_name",
				label: "Name",
				render: (r) => <Link to={`/milestones/${r.name}`}>{r.milestone_name || r.name}</Link>,
			},
			{
				key: "project_name",
				label: "Project",
				render: (r) => r.project_name || r.project,
			},
			{
				key: "planned_date",
				label: "Planned",
				render: (r) => r.planned_date || "—",
			},
			{
				key: "status",
				label: "Status",
				render: (r) => <StatusPill>{r.status}</StatusPill>,
			},
		],
		[]
	);

	const newMilestoneHref = urlProject
		? `/milestones/new?project=${encodeURIComponent(urlProject)}`
		: "/milestones/new";

	return (
		<div>
			<ProjectPageHeader
				actions={
					isManager ? (
						<Link to={newMilestoneHref} className="pm-btn pm-btn-primary" style={{ textDecoration: "none" }}>
							New milestone
						</Link>
					) : null
				}
			>
				<ListFilters
					statusValue={statusFilter}
					statusOptions={STATUS_OPTIONS}
					onStatusChange={setStatusFilter}
					projectValue={projectFilter}
					projectOptions={projectOptions}
					onProjectChange={setProjectFilter}
					searchValue={search}
					onSearchChange={setSearch}
					searchPlaceholder="Search milestone…"
				/>
			</ProjectPageHeader>

			{err ? <div className="pm-error-banner">{err}</div> : null}

			<ProjectDataTable
				columns={columns}
				rows={filtered}
				loading={loading}
				loadingMessage="Loading milestones…"
				emptyMessage="No milestones match filters"
				pageSize={PROJECT_LIST_PAGE_SIZE}
				paginationResetKey={filterKey}
			/>
		</div>
	);
}
