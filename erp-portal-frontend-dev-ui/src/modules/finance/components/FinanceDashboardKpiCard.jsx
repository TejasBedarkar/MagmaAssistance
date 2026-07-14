import { tokens } from "../theme/tokens.js";

const fillMix = (color) => `color-mix(in srgb, ${color} 15%, transparent)`;

/**
 * Dashboard KPI tile with leading icon — preserves original finance dashboard layout.
 * Other finance pages use FinanceKpiCard (common KpiCard adapter).
 */
export default function FinanceDashboardKpiCard({ label, value, icon, accent = tokens.accent, onClick }) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="dashboard-kpi-card finance-kpi-card"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <div
        className="finance-kpi-card__icon finance-kpi-card__icon--dynamic"
        style={{ "--kpi-icon-bg": fillMix(accent) }}
      >
        {icon}
      </div>
      <div className="finance-kpi-card__content">
        <div className="finance-kpi-card__label">{label}</div>
        <div className="finance-kpi-card__value">{value}</div>
        <div className="finance-kpi-card__hint">Click for details →</div>
      </div>
    </div>
  );
}
