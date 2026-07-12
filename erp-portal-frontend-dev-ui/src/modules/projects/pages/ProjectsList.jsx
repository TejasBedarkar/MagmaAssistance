import React, { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { projects } from "../api/index.js";
import ListFilters from "../../../common/components/ListFilters.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import useServerPagedList from "../../../common/hooks/useServerPagedList.js";
import useUserLabelMap from "../../../common/hooks/useUserLabelMap.js";
import ProjectDataTable, { PROJECT_LIST_PAGE_SIZE } from "../components/ProjectDataTable.jsx";
import ProjectPageHeader from "../components/ProjectPageHeader.jsx";
import useProjectAuth from "../hooks/useProjectAuth.js";

const STATUS_OPTIONS = [
	{ value: "", label: "All statuses" },
	{ value: "Draft", label: "Draft" },
	{ value: "Pending Approval", label: "Pending approval" },
	{ value: "Active", label: "Active" },
	{ value: "Rejected", label: "Rejected" },
	{ value: "On Hold", label: "On Hold" },
	{ value: "Completed", label: "Completed" },
	{ value: "Cancelled", label: "Cancelled" },
];

export default function ProjectsList() {
	const { isManager, isProgramManager, loading: authLoading, user } = useProjectAuth();
	const { labelFor } = useUserLabelMap();
	const [statusFilter, setStatusFilter] = useState("");
	const [search, setSearch] = useState("");

	const fetchPage = useCallback(
		(page, pageSize) =>
			projects.listPage({
				page,
				pageSize,
				status: statusFilter,
				search,
			}),
		[statusFilter, search]
	);

	const { page, setPage, rows, total, totalPages, loading, err } = useServerPagedList({
		fetchPage,
		pageSize: PROJECT_LIST_PAGE_SIZE,
		deps: [statusFilter, search],
		enabled: !authLoading && !!user,
	});

	const columns = useMemo(() => {
		const base = [
			{
				key: "project_code",
				label: "Code",
				headerClassName: "col-code",
				cellClassName: "col-code",
				render: (r) => (
					<span className="pm-cell-ellipsis" title={r.project_code || ""}>
						{r.project_code || "—"}
					</span>
				),
			},
			{
				key: "project_name",
				label: "Name",
				headerClassName: "col-name",
				cellClassName: "col-name",
				render: (r) => (
					<Link
						to={`/projects/${r.name}`}
						className="pm-cell-ellipsis"
						title={r.project_name || r.name}
					>
						{r.project_name || r.name}
					</Link>
				),
			},
			{
				key: "status",
				label: "Status",
				headerClassName: "col-status",
				cellClassName: "col-status",
				render: (r) => <StatusPill>{r.status || "—"}</StatusPill>,
			},
			{
				key: "project_manager",
				label: "Manager",
				headerClassName: "col-manager",
				cellClassName: "col-manager",
				render: (r) => {
					const label = labelFor(r.project_manager);
					return (
						<span className="pm-cell-ellipsis" title={label}>
							{label}
						</span>
					);
				},
			},
			{
				key: "team_summary",
				label: "Delivery team",
				headerClassName: "col-team",
				cellClassName: "col-team",
				render: (r) => (
					<span className="pm-cell-ellipsis" title={r.team_summary || ""}>
						{r.team_summary || "—"}
					</span>
				),
			},
		];
		if (isProgramManager) {
			base.push({
				key: "delivery",
				label: "",
				headerClassName: "pm-table__actions",
				cellClassName: "pm-table__actions",
				render: (r) => (
					<Link
						to={`/projects/${r.name}/delivery`}
						className="pm-delivery-summary__link-sm"
						title="Open delivery plan"
					>
						Delivery
					</Link>
				),
			});
		}
		return base;
	}, [isProgramManager, labelFor]);

	return (
		<div>
			<ProjectPageHeader
				actions={
					isManager ? (
						<Link to="/projects/new" className="pm-btn pm-btn-primary" style={{ textDecoration: "none" }}>
							New program
						</Link>
					) : null
				}
			>
				<ListFilters
					statusValue={statusFilter}
					statusOptions={STATUS_OPTIONS}
					onStatusChange={setStatusFilter}
					searchValue={search}
					onSearchChange={setSearch}
					searchPlaceholder="Search code, name, manager…"
				/>
			</ProjectPageHeader>

			{err ? <div className="pm-error-banner">{err}</div> : null}

			<ProjectDataTable
				columns={columns}
				rows={rows}
				loading={loading}
				loadingMessage="Loading programs…"
				emptyMessage="No projects match filters"
				tableClassName="pm-table--projects-list"
				pageSize={PROJECT_LIST_PAGE_SIZE}
				serverPagination={{
					page,
					totalPages,
					total,
					pageSize: PROJECT_LIST_PAGE_SIZE,
					onPageChange: setPage,
				}}
			/>
		</div>
	);
}
