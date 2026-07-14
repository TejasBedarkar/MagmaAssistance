export default function ScmPageHeader({
  eyebrow = "Supply Chain",
  title,
  subtitle,
  updated,
  loading,
  actions,
}) {
  return (
    <header className="scm-page-header">
      <div className="scm-page-header__main">
        <p className="scm-page-eyebrow">{eyebrow}</p>
        <h1 className="scm-page-title">{title}</h1>
        {subtitle ? <p className="scm-page-subtitle">{subtitle}</p> : null}
        {updated ? (
          <p className="scm-page-updated">
            Updated {updated}
            {loading ? " · Refreshing…" : ""}
          </p>
        ) : null}
      </div>
      {actions ? <div className="scm-page-header__actions">{actions}</div> : null}
    </header>
  );
}
