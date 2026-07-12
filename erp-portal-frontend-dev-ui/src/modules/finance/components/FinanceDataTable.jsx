import { useEffect, useRef } from "react";
import ListPagination from "../../../common/components/ListPagination.jsx";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import FinanceEmptyState from "./FinanceEmptyState.jsx";
import FinancePageLoader from "./FinancePageLoader.jsx";

export const FINANCE_LIST_PAGE_SIZE = 25;

/**
 * Data table wrapper — pm-table-wrap + pm-table with loading / empty states.
 *
 * columns: { key, label, align?, headerClassName?, cellClassName?, render?(row) }
 *
 * Width presets (className): finance-data-table--medium (640px),
 * finance-data-table--aging (720px), finance-data-table--wide (900px)
 *
 * pageSize: client-side pagination via common usePagedRows + ListPagination (0 = show all)
 * paginationResetKey: change when filters change to reset to page 1
 */
function alignClass(align) {
  if (align === "right") return "finance-cell-align-right";
  if (align === "center") return "finance-cell-align-center";
  return undefined;
}

function joinClasses(...parts) {
  return parts.filter(Boolean).join(" ") || undefined;
}

export default function FinanceDataTable({
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
}) {
  const colSpan = columns.length;
  const paginate = pageSize > 0;
  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(
    rows,
    paginate ? pageSize : Math.max(rows.length, 1)
  );
  const displayRows = paginate ? pageRows : rows;

  const resetPageRef = useRef(resetPage);
  resetPageRef.current = resetPage;
  useEffect(() => {
    if (paginate) resetPageRef.current();
  }, [paginationResetKey, paginate]);

  return (
    <>
      <div className={joinClasses("pm-card", "finance-data-table", "finance-card-flush", className)}>
        <div className="pm-table-wrap finance-data-table__wrap">
          <table className={joinClasses("pm-table", tableClassName)}>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={joinClasses(
                      col.headerClassName,
                      alignClass(col.align),
                      col.headerWrap === false ? "finance-th-nowrap" : null
                    )}
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
                    <FinancePageLoader message={loadingMessage} />
                  </td>
                </tr>
              ) : displayRows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan}>
                    <FinanceEmptyState message={emptyMessage} />
                  </td>
                </tr>
              ) : (
                displayRows.map((row, index) => (
                  <tr
                    key={getRowKey(row, index)}
                    onClick={onRowClick ? () => onRowClick(row, index) : undefined}
                    className={onRowClick ? "finance-row-clickable" : undefined}
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
          pageSize={pageSize}
          onPageChange={setPage}
        />
      ) : null}
    </>
  );
}
