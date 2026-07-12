import { useEffect, useRef } from "react";
import ListPagination from "../../../common/components/ListPagination.jsx";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import ProjectEmptyState from "./ProjectEmptyState.jsx";
import ProjectPageLoader from "./ProjectPageLoader.jsx";

export const PROJECT_LIST_PAGE_SIZE = 25;

function alignClass(align) {
	if (align === "right") return "project-cell-align-right";
	if (align === "center") return "project-cell-align-center";
	return undefined;
}

function joinClasses(...parts) {
	return parts.filter(Boolean).join(" ") || undefined;
}

/**
 * Data table wrapper — pm-table with loading / empty states.
 * columns: { key, label, align?, headerClassName?, cellClassName?, render?(row) }
 */
export default function ProjectDataTable({
	columns,
	rows = [],
	loading = false,
	loadingMessage = "Loading…",
	emptyMessage = "No records found.",
	getRowKey = (row, index) => row?.name || row?.id || index,
	onRowClick,
	footer,
	className = "",
	tableClassName = "",
	pageSize = 0,
	paginationResetKey,
	serverPagination = null,
}) {
	const colSpan = columns.length;
	const paginate = pageSize > 0;
	const clientPaged = usePagedRows(
		rows,
		paginate && !serverPagination ? pageSize : Math.max(rows.length, 1)
	);
	const displayRows = paginate && !serverPagination ? clientPaged.pageRows : rows;
	const page = serverPagination?.page ?? clientPaged.page;
	const totalPages = serverPagination?.totalPages ?? clientPaged.totalPages;
	const total = serverPagination?.total ?? clientPaged.total;
	const onPageChange = serverPagination?.onPageChange ?? clientPaged.setPage;
	const activePageSize = serverPagination?.pageSize ?? pageSize;

	const resetPageRef = useRef(clientPaged.resetPage);
	resetPageRef.current = clientPaged.resetPage;
	useEffect(() => {
		if (paginate && !serverPagination) resetPageRef.current();
	}, [paginationResetKey, paginate, serverPagination]);

	return (
		<>
			<div className={joinClasses("pm-card", "project-data-table", className)}>
				<div className="pm-table-wrap project-data-table__wrap">
					<table className={joinClasses("pm-table", tableClassName)}>
						<thead>
							<tr>
								{columns.map((col) => (
									<th
										key={col.key}
										className={joinClasses(col.headerClassName, alignClass(col.align))}
									>
										{col.label}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{loading ? (
								<tr>
									<td colSpan={colSpan}>
										<ProjectPageLoader message={loadingMessage} />
									</td>
								</tr>
							) : displayRows.length === 0 ? (
								<tr>
									<td colSpan={colSpan}>
										<ProjectEmptyState message={emptyMessage} />
									</td>
								</tr>
							) : (
								displayRows.map((row, index) => (
									<tr
										key={getRowKey(row, index)}
										onClick={onRowClick ? () => onRowClick(row, index) : undefined}
										className={onRowClick ? "project-row-clickable" : undefined}
									>
										{columns.map((col) => {
											const content = col.render ? col.render(row, index) : row[col.key];
											return (
												<td
													key={col.key}
													className={joinClasses(alignClass(col.align), col.cellClassName)}
												>
													{content ?? "—"}
												</td>
											);
										})}
									</tr>
								))
							)}
							{!loading && displayRows.length > 0 && footer ? <tr>{footer}</tr> : null}
						</tbody>
					</table>
				</div>
			</div>
			{paginate && !loading ? (
				<ListPagination
					page={page}
					totalPages={totalPages}
					total={total}
					pageSize={activePageSize}
					onPageChange={onPageChange}
				/>
			) : null}
		</>
	);
}
