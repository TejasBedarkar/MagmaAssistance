import CommonKpiCard from "../../../common/components/KpiCard.jsx";
import SalesKpiIcon from "./SalesKpiIcon.jsx";

const TONE_MAP = {
  default: "default",
  blue: "default",
  green: "success",
  red: "danger",
  amber: "warn",
  orange: "orange",
  purple: "default",
  cyan: "default",
  teal: "default",
  emerald: "success",
  indigo: "default",
  success: "success",
  danger: "danger",
  warn: "warn",
};

const COMMON_ICON_KEYS = new Set(["projects", "tasks", "completed", "hours"]);

function resolveCommonTone(tone = "default") {
  return TONE_MAP[tone] || (["success", "danger", "warn", "orange", "default"].includes(tone) ? tone : "default");
}

function valueClassName(tone = "default") {
  const resolved = resolveCommonTone(tone);
  if (resolved === "danger") return "pm-kpi-card__value pm-kpi-card__value--danger";
  if (resolved === "warn") return "pm-kpi-card__value pm-kpi-card__value--warn";
  if (resolved === "orange") return "pm-kpi-card__value pm-kpi-card__value--orange";
  if (resolved === "success") return "pm-kpi-card__value pm-kpi-card__value--success";
  return "pm-kpi-card__value";
}

/**
 * Sales KPI adapter — portal KpiCard with icon inside a single card (sales layout).
 */
export default function SalesKpiCard({
  label,
  title,
  value,
  sub,
  hint,
  meta,
  valueSub,
  tone = "default",
  accent,
  color,
  icon,
  iconElement = null,
  iconSize = 16,
  active = false,
  onClick,
  onSelect,
  disabled = false,
  className = "",
  compact = false,
  "aria-label": ariaLabel,
  "aria-pressed": ariaPressed,
}) {
  const handleClick = onClick || onSelect;
  const resolvedTitle = label ?? title ?? "";
  const resolvedSub = [sub ?? hint, meta].filter(Boolean).join(" · ") || undefined;
  const resolvedAccent = accent ?? color;
  const commonTone = resolveCommonTone(tone);
  const commonIcon = typeof icon === "string" && COMMON_ICON_KEYS.has(icon) ? icon : undefined;
  const hasSalesIcon = Boolean(iconElement) || (icon && !commonIcon);

  const valueContent =
    valueSub != null && valueSub !== "" ? (
      <>
        {value ?? "—"}
        <span className="sales-kpi-card__value-sub">{valueSub}</span>
      </>
    ) : (
      value ?? "—"
    );

  const cardClasses = [
    "pm-kpi-card",
    active ? "pm-kpi-card--accent" : "",
    hasSalesIcon ? "sales-kpi-card--with-icon" : "",
    compact ? "sales-kpi-card--compact" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const salesIconCard = (
    <div className={cardClasses} style={resolvedAccent ? { "--kpi-accent": resolvedAccent } : undefined}>
      <span className="sales-kpi-card__sales-icon sales-kpi-icon-wrap sales-kpi-ico-tint" aria-hidden>
        {iconElement || <SalesKpiIcon name={icon} size={iconSize} color={resolvedAccent} />}
      </span>
      <div className="sales-kpi-card__content">
        <h4 className="pm-kpi-card__title">{resolvedTitle}</h4>
        <p className={valueClassName(tone)}>{valueContent}</p>
        {resolvedSub ? <p className="pm-kpi-card__sub">{resolvedSub}</p> : null}
      </div>
    </div>
  );

  const card = hasSalesIcon ? (
    salesIconCard
  ) : (
    <CommonKpiCard
      title={resolvedTitle}
      value={valueContent}
      sub={resolvedSub}
      tone={commonTone}
      accent={active}
      icon={commonIcon}
    />
  );

  const rootClass = ["sales-kpi-card", active ? "sales-kpi-card--active" : "", className]
    .filter(Boolean)
    .join(" ");

  if (handleClick) {
    if (hasSalesIcon) {
      return (
        <button
          type="button"
          className={`${rootClass} ${cardClasses} sales-kpi-card-btn pm-kpi-card--clickable`}
          style={resolvedAccent ? { "--kpi-accent": resolvedAccent } : undefined}
          onClick={handleClick}
          disabled={disabled}
          aria-pressed={ariaPressed ?? !!active}
          aria-label={
            ariaLabel ||
            `${resolvedTitle}: ${value ?? ""}. ${active ? "Active filter." : "Click to filter."}`
          }
        >
          <span className="sales-kpi-card__sales-icon sales-kpi-icon-wrap sales-kpi-ico-tint" aria-hidden>
            {iconElement || <SalesKpiIcon name={icon} size={iconSize} color={resolvedAccent} />}
          </span>
          <div className="sales-kpi-card__content">
            <h4 className="pm-kpi-card__title">{resolvedTitle}</h4>
            <p className={valueClassName(tone)}>{valueContent}</p>
            {resolvedSub ? <p className="pm-kpi-card__sub">{resolvedSub}</p> : null}
          </div>
        </button>
      );
    }

    return (
      <button
        type="button"
        className={`${rootClass} sales-kpi-card-btn pm-kpi-card--clickable`}
        onClick={handleClick}
        disabled={disabled}
        aria-pressed={ariaPressed ?? !!active}
        aria-label={
          ariaLabel ||
          `${resolvedTitle}: ${value ?? ""}. ${active ? "Active filter." : "Click to filter."}`
        }
      >
        {card}
      </button>
    );
  }

  return <div className={rootClass}>{card}</div>;
}
