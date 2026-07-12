import React from "react";

/**
 * Toolbar filters for list pages (status, project, search).
 */
export default function ListFilters({
  statusValue,
  statusOptions,
  onStatusChange,
  projectValue,
  projectOptions,
  onProjectChange,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search…",
}) {
  return (
    <div className="pm-list-filters">
      {statusOptions?.length ? (
        <div className="pm-list-filters__field">
          <label className="pm-list-filters__label">Status</label>
          <select
            className="pm-select pm-list-filters__select"
            value={statusValue}
            onChange={(e) => onStatusChange(e.target.value)}
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {projectOptions?.length ? (
        <div className="pm-list-filters__field">
          <label className="pm-list-filters__label">Project</label>
          <select
            className="pm-select pm-list-filters__select"
            value={projectValue}
            onChange={(e) => onProjectChange(e.target.value)}
          >
            {projectOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {onSearchChange ? (
        <div className="pm-list-filters__field pm-list-filters__field--grow">
          <label className="pm-list-filters__label">Search</label>
          <input
            className="pm-input"
            type="search"
            placeholder={searchPlaceholder}
            value={searchValue || ""}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      ) : null}
    </div>
  );
}
