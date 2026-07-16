export default function ScmListFilters({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  selectLabel,
  selectValue,
  selectOptions,
  onSelectChange,
  children,
}) {
  return (
    <section className="scm-surface-muted scm-toolbar" aria-label="List filters">
      <div className="scm-toolbar__search">
        <input
          type="search"
          className="scm-input"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label="Search"
        />
      </div>
      {selectOptions ? (
        <select
          className="scm-input scm-toolbar__select"
          value={selectValue}
          onChange={(e) => onSelectChange(e.target.value)}
          aria-label={selectLabel || "Filter"}
        >
          {selectOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : null}
      {children}
    </section>
  );
}
