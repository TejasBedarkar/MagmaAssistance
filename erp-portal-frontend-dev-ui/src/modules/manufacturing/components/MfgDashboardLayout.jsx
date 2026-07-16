import { Link } from "react-router-dom";
import { HiOutlineArrowPath } from "react-icons/hi2";
import { PortalInlineLoader } from "../../../common/components/PortalSpinner.jsx";
import { CHART_THEME } from "../utils/themeTokens.js";

export { CHART_THEME };

/**
 * ERP-style dashboard chrome — matches PM manager dashboard patterns.
 */
export function DashboardHero({
  title,
  subtitle,
  roleLabel,
  updated,
  loading,
  onRefresh,
  action,
}) {
  return (
    <header className="mfg-dash-hero">
      <div className="mfg-dash-hero__text">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
        <div className="mfg-dash-hero__meta">
          {roleLabel ? <span className="mfg-dash-role-pill">{roleLabel}</span> : null}
          {updated ? <span className="mfg-dash-updated">Updated {updated}</span> : null}
        </div>
      </div>
      <div className="mfg-dash-toolbar">
        {onRefresh ? (
          <button
            type="button"
            className="pm-btn"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh dashboard"
          >
            {loading ? (
              <PortalInlineLoader size="xs" className="portal-spinner--in-btn" />
            ) : (
              <HiOutlineArrowPath size={16} aria-hidden />
            )}
            Refresh
          </button>
        ) : null}
        {action}
      </div>
    </header>
  );
}

export function QuickActionBar({ links = [] }) {
  if (!links.length) return null;
  return (
    <nav className="mfg-quick-links" aria-label="Quick actions">
      {links.map((item) => (
        <Link key={item.to} to={item.to} className="mfg-quick-link">
          {item.icon ? <item.icon size={16} /> : null}
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function KpiStrip({ children }) {
  return (
    <section className="pm-kpi-section mfg-kpi-strip">
      <div className="pm-kpi-grid pm-kpi-grid--primary pm-mgr-kpi-grid">{children}</div>
    </section>
  );
}

export function MfgPanel({
  title,
  subtitle,
  headAction,
  children,
  flush = false,
  className = "",
}) {
  return (
    <section className={`mfg-panel ${className}`.trim()}>
      {(title || subtitle || headAction) && (
        <div className="mfg-panel__head">
          <div>
            {title ? <h3>{title}</h3> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {headAction}
        </div>
      )}
      <div className={flush ? "mfg-panel__body mfg-panel__body--flush" : "mfg-panel__body"}>
        {children}
      </div>
    </section>
  );
}

export function ChartLegend({ items = [] }) {
  if (!items.length) return null;
  return (
    <div className="mfg-chart-legend">
      {items.map((item) => (
        <span key={item.name} className="mfg-chart-legend__item">
          <span
            className="mfg-chart-legend__dot"
            style={{ "--mfg-legend-dot": item.fill }}
          />
          {item.name} ({item.value})
        </span>
      ))}
    </div>
  );
}

export function ActivityFeed({ items = [] }) {
  if (!items.length) {
    return <p className="mfg-activity-empty">No recent activity</p>;
  }
  return (
    <div className="mfg-activity-list">
      {items.map((a, i) => (
        <article key={`${a.docname}-${i}`} className="mfg-activity-item">
          <span className="mfg-activity-item__dot" aria-hidden />
          <div>
            <p className="mfg-activity-item__title">
              <strong>{a.user}</strong> {a.action}{" "}
              <span className="mfg-activity-item__docname">{a.docname}</span>
            </p>
            {(a.old_value || a.new_value) && (
              <p className="mfg-activity-item__meta">
                {a.old_value ? `${a.old_value} → ` : ""}
                {a.new_value}
              </p>
            )}
            <p className="mfg-activity-item__time">{a.creation}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

export function DarkChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="mfg-chart-tooltip">
      {label ? <div className="mfg-chart-tooltip__label">{label}</div> : null}
      {payload.map((entry) => (
        <div
          key={entry.name}
          className="mfg-chart-tooltip__row"
          style={entry.color ? { "--mfg-tooltip-row-color": entry.color } : undefined}
        >
          {entry.name}: <strong>{entry.value}</strong>
        </div>
      ))}
    </div>
  );
}
