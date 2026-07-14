import CommonKpiCard from "../../../common/components/KpiCard.jsx";
import { accentClassToTone } from "../lib/statusTones.js";

const TONE_MAP = {
  default: "default",
  success: "success",
  danger: "danger",
  warn: "warn",
  warning: "warn",
  info: "default",
};

/**
 * Finance KPI tile — adapter over shared portal KpiCard.
 * Supports optional click (e.g. dashboard drill-down) without duplicating pm-kpi-card markup.
 */
const VALUE_TONE_CLASS = {
  success: "finance-kpi-card__value--success",
  danger: "finance-kpi-card__value--danger",
  warn: "finance-kpi-card__value--warn",
  default: "",
};

const fillMix = (color) => `color-mix(in srgb, ${color} 15%, transparent)`;

export default function FinanceKpiCard({
  label,
  value,
  sub,
  tone,
  accentClass = "",
  accent,
  icon,
  iconAccent,
  onClick,
  className = "",
}) {
  const resolvedTone = TONE_MAP[tone] || accentClassToTone(accentClass) || "default";
  const valueToneClass = VALUE_TONE_CLASS[resolvedTone] || "";

  const card = icon ? (
    <div className="finance-kpi-card">
      <div
        className="finance-kpi-card__icon finance-kpi-card__icon--dynamic"
        style={{ "--kpi-icon-bg": fillMix(iconAccent || "var(--accent)") }}
      >
        {icon}
      </div>
      <div className="finance-kpi-card__content">
        <div className="finance-kpi-card__label">{label}</div>
        <div className={`finance-kpi-card__value ${valueToneClass}`.trim()}>{value ?? "—"}</div>
        {sub ? <div className="finance-kpi-card__sub">{sub}</div> : null}
        {onClick ? <div className="finance-kpi-card__hint">Click for details →</div> : null}
      </div>
    </div>
  ) : (
    <CommonKpiCard
      title={label}
      value={value ?? "—"}
      sub={sub ?? (onClick ? "Click for details →" : undefined)}
      tone={resolvedTone}
      accent={accent ?? resolvedTone === "default"}
    />
  );

  if (!onClick) {
    return <div className={className}>{card}</div>;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={`finance-kpi-card-wrap dashboard-kpi-card ${className}`.trim()}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {card}
    </div>
  );
}
