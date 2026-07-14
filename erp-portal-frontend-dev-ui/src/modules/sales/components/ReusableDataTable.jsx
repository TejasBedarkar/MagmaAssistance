import StatusBadge from "./StatusBadge";
import SalesEmptyState from "./SalesEmptyState.jsx";

export default function ReusableDataTable({
  columns = [],
  rows = [],
  rowKey = "id",
  emptyText = "No records found.",
  emptyIcon,
  actions,
}) {
  if (!rows.length) {
    return (
      <SalesEmptyState
        icon={emptyIcon}
        title={emptyText}
        className="sales-table-empty"
      />
    );
  }

  return (
    <div className="pm-table-wrap sales-reusable-table">
      <table className="pm-table sales-reusable-table__table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.label}</th>
            ))}
            {actions ? <th>Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row[rowKey] || idx}>
              {columns.map((col) => {
                const value = typeof col.render === "function" ? col.render(row) : row[col.key];
                if (col.type === "status") {
                  return (
                    <td key={col.key}>
                      <StatusBadge status={value} />
                    </td>
                  );
                }
                return <td key={col.key}>{value ?? "—"}</td>;
              })}
              {actions ? <td>{actions(row)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
