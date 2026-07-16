export default function ScmPanel({ title, subtitle, badge, action, children, className = "" }) {
  return (
    <section className={`scm-panel ${className}`.trim()}>
      <header className="scm-panel__head">
        <div>
          <div className="scm-panel__title-row">
            <h2 className="scm-panel__title">{title}</h2>
            {badge}
          </div>
          {subtitle ? <p className="scm-panel__subtitle">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      <div className="scm-panel__body">{children}</div>
    </section>
  );
}
