import React, { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { tasks as tasksApi } from "../api/index.js";
import ListFilters from "../../../common/components/ListFilters.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import useServerPagedList from "../../../common/hooks/useServerPagedList.js";
import useProjectOptions from "../hooks/useProjectOptions.js";
import { formatTaskCompletedOn } from "../utils/formatDateTime.js";
import ProjectDataTable, { PROJECT_LIST_PAGE_SIZE } from "../components/ProjectDataTable.jsx";
import ProjectPageHeader from "../components/ProjectPageHeader.jsx";
import useProjectAuth from "../hooks/useProjectAuth.js";
import TaskAssigneeCell from "../components/TaskAssigneeCell.jsx";
import TaskStatusWithReopen from "../components/TaskStatusWithReopen.jsx";

const STATUS_OPTIONS = [
	{ value: "", label: "All statuses" },
	{ value: "Open", label: "Open" },
	{ value: "In Progress", label: "In Progress" },
	{ value: "Dev Done", label: "Dev Done" },
	{ value: "QA Testing", label: "QA Testing" },
	{ value: "Rework", label: "Rework" },
	{ value: "QA Approved", label: "QA Approved" },
	{ value: "Blocked", label: "Blocked" },
	{ value: "Overdue", label: "Overdue" },
	{ value: "Completed", label: "Completed" },
];

export default function TasksList() {
	const { isManager } = useProjectAuth();
	const { options: projectOptions } = useProjectOptions();
	const [statusFilter, setStatusFilter] = useState("");
	const [projectFilter, setProjectFilter] = useState("");
	const [search, setSearch] = useState("");

	const fetchPage = useCallback(
		(page, pageSize) =>
			tasksApi.listPage({
				page,
				pageSize,
				status: statusFilter,
				project: projectFilter,
				search,
			}),
		[statusFilter, projectFilter, search]
	);

	const { page, setPage, rows, total, totalPages, loading, err } = useServerPagedList({
		fetchPage,
		pageSize: PROJECT_LIST_PAGE_SIZE,
		deps: [statusFilter, projectFilter, search],
	});

	const columns = useMemo(
		() => [
			{
				key: "task_title",
				label: "Title",
				headerClassName: "col-task-title",
				cellClassName: "col-task-title",
				render: (r) => (
					<span className="pm-task-title-inner">
						<Link
							className="pm-cell-ellipsis"
							to={`/tasks/${r.name}`}
							title={r.task_title || r.name}
						>
							{r.task_title || r.name}
						</Link>
						{r.has_new_comment ? (
							<span className="pm-comment-blink" title="New comment" aria-label="New comment" />
						) : null}
					</span>
				),
			},
			{
				key: "project_name",
				label: "Project",
				headerClassName: "col-project",
				cellClassName: "col-project",
				render: (r) => (
					<span className="pm-cell-ellipsis" title={r.project_name || r.project}>
						{r.project_name || r.project}
					</span>
				),
			},
			{
				key: "assigned_to",
				label: "Assignee",
				headerClassName: "col-assignee",
				cellClassName: "col-assignee",
				render: (r) => <TaskAssigneeCell row={r} />,
			},
			{
				key: "status",
				label: "Status",
				headerClassName: "col-status",
				cellClassName: "col-status",
				render: (r) => <TaskStatusWithReopen task={r} />,
			},
			{
				key: "due_date",
				label: "Due",
				headerClassName: "col-due",
				cellClassName: "col-due",
				render: (r) => r.due_date || "—",
			},
			{
				key: "completed_on",
				label: "Completed",
				headerClassName: "col-completed",
				cellClassName: "col-completed",
				render: (r) => formatTaskCompletedOn(r),
			},
		],
		[]
	);

	return (
		<div>
			<ProjectPageHeader>
				<ListFilters
					statusValue={statusFilter}
					statusOptions={STATUS_OPTIONS}
					onStatusChange={setStatusFilter}
					projectValue={projectFilter}
					projectOptions={projectOptions}
					onProjectChange={setProjectFilter}
					searchValue={search}
					onSearchChange={setSearch}
					searchPlaceholder="Search task or project…"
				/>
			</ProjectPageHeader>

			{err ? <div className="pm-error-banner">{err}</div> : null}

			<ProjectDataTable
				columns={columns}
				rows={rows}
				loading={loading}
				loadingMessage="Loading tasks…"
				emptyMessage={isManager ? "No tasks match filters" : "No tasks assigned to you yet."}
				tableClassName="pm-table--tasks pm-table--tasks-list"
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
