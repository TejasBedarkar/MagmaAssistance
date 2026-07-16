import ScmPageLoader from "./ScmPageLoader.jsx";
import ScmEmptyState from "./ScmEmptyState.jsx";
import ScmListPagination from "./ScmListPagination.jsx";

/**
 * @typedef {{ key: string, header: string, render?: (row: object) => React.ReactNode, className?: string }} ScmColumn
 */

export default function ScmDataTable({
  columns,
  rows,
  loading,
  emptyTitle = "No records",
  emptyDescription = "Nothing to show yet.",
  emptyIcon,
  getRowKey = (row) => row.name || row.id,
  activeKey,
  onRowClick,
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
}) {
  return (
    <section className="scm-surface scm-table-card">
      {loading ? (
        <ScmPageLoader />
      ) : rows.length === 0 ? (
        <ScmEmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <div className="scm-table-scroll">
            <table className="scm-table scm-table--wide">
              <thead>
                <tr className="scm-table__row">
                  {columns.map((col) => (
                    <th key={col.key} className={`scm-table__head ${col.className || ""}`.trim()}>
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const key = getRowKey(row);
                  const clickable = Boolean(onRowClick);
                  const active = activeKey != null && activeKey === key;
                  return (
                    <tr
                      key={key}
                      className={[
                        "scm-table__row",
                        clickable ? "scm-table__row--clickable" : "",
                        active ? "scm-table__row--active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={clickable ? () => onRowClick(row) : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onRowClick(row);
                              }
                            }
                          : undefined
                      }
                      tabIndex={clickable ? 0 : undefined}
                      role={clickable ? "button" : undefined}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={`scm-table__cell ${col.className || ""}`.trim()}
                        >
                          {col.render ? col.render(row) : row[col.key]}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {page != null && onPageChange ? (
            <ScmListPagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
