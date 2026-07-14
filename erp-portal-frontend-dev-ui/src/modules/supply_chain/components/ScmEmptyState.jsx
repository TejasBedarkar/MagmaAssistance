export default function ScmEmptyState({ icon: Icon, title, description }) {
  return (
    <div className="scm-table-empty">
      {Icon ? (
        <span className="scm-table-empty__icon" aria-hidden="true">
          <Icon size={32} strokeWidth={1.5} />
        </span>
      ) : null}
      <p className="scm-table-empty__title">{title}</p>
      {description ? <p className="scm-table-empty__desc">{description}</p> : null}
    </div>
  );
}
