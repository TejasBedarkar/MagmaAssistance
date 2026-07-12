/** Manufacturing chart/UI tokens — reads portal CSS variables when available. */

export function readCssVar(name, fallback) {
  if (typeof document === "undefined") return fallback;
  const root =
    document.querySelector(".manufacturing-module-root") || document.documentElement;
  const value = getComputedStyle(root).getPropertyValue(name).trim();
  return value || fallback;
}

export function getChartTheme() {
  return {
    grid: readCssVar("--border", "rgba(148, 163, 184, 0.18)"),
    tick: readCssVar("--muted", "#94a3b8"),
    tooltipBg: readCssVar("--surface-2", "#1c2740"),
    tooltipBorder: readCssVar("--border", "rgba(148, 163, 184, 0.18)"),
    text: readCssVar("--text", "#e8edf7"),
    bar: readCssVar("--accent", "#38bdf8"),
    barAlt: readCssVar("--mfg-chart-bar-alt", "#6366f1"),
    success: readCssVar("--success", "#4ade80"),
    warning: readCssVar("--warning", "#fbbf24"),
    danger: readCssVar("--danger", "#f87171"),
    primary: readCssVar("--accent", "#38bdf8"),
    cursorFill: readCssVar(
      "--mfg-chart-cursor-fill",
      "color-mix(in srgb, var(--accent) 8%, transparent)"
    ),
  };
}

/** @deprecated Use getChartTheme — kept for dashboard imports */
export const CHART_THEME = {
  get grid() {
    return getChartTheme().grid;
  },
  get tick() {
    return getChartTheme().tick;
  },
  get tooltipBg() {
    return getChartTheme().tooltipBg;
  },
  get tooltipBorder() {
    return getChartTheme().tooltipBorder;
  },
  get bar() {
    return getChartTheme().bar;
  },
  get barAlt() {
    return getChartTheme().barAlt;
  },
  get cursorFill() {
    return getChartTheme().cursorFill;
  },
};

export function getReportChartColors() {
  const t = getChartTheme();
  return {
    grid: t.grid,
    line: t.primary,
    barFail: t.danger,
    barWarn: t.warning,
    barPrimary: t.primary,
    onTime: t.success,
    late: t.danger,
  };
}
