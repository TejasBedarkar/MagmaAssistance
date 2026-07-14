export default function ScmKpiCard({ label, value, sub, tone = "default", icon, hint }) {
  const valueClass =
    tone === "default"
      ? "scm-kpi-card__value"
      : `scm-kpi-card__value scm-kpi-card__value--${tone}`;

  return (
    <div className="scm-kpi-card" title={hint || undefined}>
      <div className="scm-kpi-card__head">
        <span className="scm-kpi-card__label">{label}</span>
        {icon ? <span className="scm-kpi-card__icon">{icon}</span> : null}
      </div>
      <p className={valueClass}>{value}</p>
      {sub ? <p className="scm-kpi-card__sub">{sub}</p> : null}
    </div>
  );
}
