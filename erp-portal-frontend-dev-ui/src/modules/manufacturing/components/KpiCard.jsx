import CommonKpiCard from "../../../common/components/KpiCard.jsx";

const TONE_MAP = {
  default: "default",
  blue: "default",
  green: "success",
  red: "danger",
  amber: "warn",
  orange: "orange",
  purple: "default",
};

/** Icons supported by common/components/KpiCard.jsx */
const COMMON_ICON_KEYS = new Set(["projects", "tasks", "completed", "hours"]);

/**
 * Manufacturing KPI adapter — maps mfg props (label, hint, tone) to shared portal KpiCard.
 * Do not duplicate pm-kpi-card markup here; extend common KpiCard only.
 */
export default function KpiCard({
  label,
  value,
  hint,
  tone = "default",
  accent,
  icon,
}) {
  const resolvedIcon = typeof icon === "string" && COMMON_ICON_KEYS.has(icon) ? icon : undefined;

  return (
    <CommonKpiCard
      title={label}
      value={value ?? "—"}
      sub={hint}
      tone={TONE_MAP[tone] || "default"}
      accent={accent ?? tone === "blue"}
      icon={resolvedIcon}
    />
  );
}
