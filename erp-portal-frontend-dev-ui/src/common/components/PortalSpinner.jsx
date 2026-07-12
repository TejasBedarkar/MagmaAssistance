const SIZES = {
  xs: { box: 14, stroke: 2 },
  sm: { box: 18, stroke: 2.5 },
  md: { box: 24, stroke: 3 },
  lg: { box: 32, stroke: 3.5 },
};

function spinnerClassName(size, className) {
  return ["portal-spinner", `portal-spinner--${size}`, className].filter(Boolean).join(" ");
}

/** Single rounded-arc spinner — shared across all portal modules. */
export function PortalSpinner({ size = "md", className = "", label }) {
  const { box, stroke } = SIZES[size] || SIZES.md;
  const r = (box - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const arc = circumference * 0.72;

  return (
    <span
      className={spinnerClassName(size, className)}
      role="status"
      aria-label={label || "Loading"}
      aria-live="polite"
    >
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden="true">
        <circle
          className="portal-spinner__arc"
          cx={box / 2}
          cy={box / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${circumference}`}
        />
      </svg>
    </span>
  );
}

/** Centered page/panel loading — spinner + optional message. */
export function PortalPageLoader({ message = "Loading…", className = "", minHeight }) {
  const style = minHeight != null ? { minHeight } : undefined;

  return (
    <div
      className={["portal-page-loader", "pm-empty", className].filter(Boolean).join(" ")}
      style={style}
      role="status"
      aria-live="polite"
    >
      <PortalSpinner size="md" />
      {message ? <p className="portal-page-loader__message">{message}</p> : null}
    </div>
  );
}

/** Compact spinner for buttons and inline areas. */
export function PortalInlineLoader({ size = "sm", className = "" }) {
  return <PortalSpinner size={size} className={className} />;
}

/** Spinner + label inside pm-btn while an action is in progress. */
export function PortalBusyButtonContent({ busy, busyLabel, idleLabel, spinnerSize = "sm" }) {
  if (!busy) return idleLabel;
  return (
    <>
      <PortalInlineLoader size={spinnerSize} className="portal-spinner--in-btn" />
      {busyLabel}
    </>
  );
}
