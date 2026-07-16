/** Empty list / no-data state — portal pm-empty pattern. */
export default function SalesEmptyState({ icon: Icon, title, description, action, className = "" }) {
  return (
    <div className={["pm-empty sales-empty-state sales-page-state", className].filter(Boolean).join(" ")}>
      {Icon ? (
        <span className="sales-empty-state__icon" aria-hidden>
          <Icon size={28} />
        </span>
      ) : null}
      <h3 className="sales-empty-state__title">{title}</h3>
      {description ? <p className="sales-empty-state__desc">{description}</p> : null}
      {action ? <div className="sales-empty-state__action">{action}</div> : null}
    </div>
  );
}
