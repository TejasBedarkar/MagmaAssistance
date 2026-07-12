export default function MfgEmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="pm-empty mfg-empty-state">
      {Icon ? (
        <span className="mfg-empty-state__icon" aria-hidden>
          <Icon size={28} />
        </span>
      ) : null}
      <h3 className="mfg-empty-state__title">{title}</h3>
      {description ? <p className="mfg-empty-state__desc">{description}</p> : null}
      {action ? <div className="mfg-empty-state__action">{action}</div> : null}
    </div>
  );
}

export function EmptyState(props) {
  return <MfgEmptyState {...props} />;
}
