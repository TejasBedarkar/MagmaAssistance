/**
 * KPI stat card with left icon — matches portal Users page (pm-users-stat) layout.
 */
export default function MfgKpiStat({ label, value, tone = 'default', icon: Icon }) {
  return (
    <div className={`mfg-kpi-stat mfg-kpi-stat--${tone}`}>
      <span className={`mfg-kpi-stat__icon mfg-kpi-stat__icon--${tone}`} aria-hidden>
        {Icon ? <Icon size={22} /> : null}
      </span>
      <div className="mfg-kpi-stat__content">
        <p className="mfg-kpi-stat__label">{label}</p>
        <p className="mfg-kpi-stat__value">{value ?? 0}</p>
      </div>
    </div>
  );
}
