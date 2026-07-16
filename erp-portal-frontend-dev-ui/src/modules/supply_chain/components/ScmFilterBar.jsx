function FilterField({ label, children }) {
  return (
    <label className="scm-filter-field">
      <span className="scm-filter-label">{label}</span>
      {children}
    </label>
  );
}

export default function ScmFilterBar({ filters, options, onChange, onClear, hasActiveFilters }) {
  const warehouses = options?.warehouses || [{ value: "", label: "All warehouses" }];
  const suppliers = options?.suppliers || [{ value: "", label: "All suppliers" }];
  const itemTypes = options?.itemTypes || [
    { value: "", label: "All types" },
    { value: "RM", label: "Raw Material" },
    { value: "FG", label: "Finished Good" },
  ];

  return (
    <section className="scm-surface-muted scm-filter-bar" aria-label="Dashboard filters">
      <div className="scm-filter-row">
        <FilterField label="From">
          <input
            type="date"
            className="scm-input"
            value={filters.date_from}
            onChange={(e) => onChange({ date_from: e.target.value })}
          />
        </FilterField>
        <FilterField label="To">
          <input
            type="date"
            className="scm-input"
            value={filters.date_to}
            onChange={(e) => onChange({ date_to: e.target.value })}
          />
        </FilterField>
        <FilterField label="Warehouse">
          <select
            className="scm-input"
            value={filters.warehouse}
            onChange={(e) => onChange({ warehouse: e.target.value })}
          >
            {warehouses.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Supplier">
          <select
            className="scm-input"
            value={filters.supplier}
            onChange={(e) => onChange({ supplier: e.target.value })}
          >
            {suppliers.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Item type">
          <select
            className="scm-input"
            value={filters.item_type}
            onChange={(e) => onChange({ item_type: e.target.value })}
          >
            {itemTypes.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FilterField>
        {hasActiveFilters ? (
          <button type="button" onClick={onClear} className="scm-btn-ghost">
            Clear filters
          </button>
        ) : null}
      </div>
    </section>
  );
}
