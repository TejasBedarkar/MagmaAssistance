/** Work-order pipeline chart colors — aligned with portal CSS variables. */

import { readCssVar } from "./themeTokens.js";

const STATUS_CSS_VAR = {
  Received: "--muted",
  "Under Review": "--accent",
  "Material Pending": "--warning",
  Scheduled: "--accent",
  "In Production": "--warning",
  "QC Pending": "--warning",
  "Ready for Dispatch": "--mfg-chart-bar-alt",
  Dispatched: "--mfg-chart-bar-alt",
  Delivered: "--success",
  Closed: "--muted",
  Cancelled: "--danger",
};

const STATUS_FALLBACK = {
  Received: "#94a3b8",
  "Under Review": "#38bdf8",
  "Material Pending": "#fbbf24",
  Scheduled: "#38bdf8",
  "In Production": "#fb923c",
  "QC Pending": "#facc15",
  "Ready for Dispatch": "#818cf8",
  Dispatched: "#818cf8",
  Delivered: "#4ade80",
  Closed: "#64748b",
  Cancelled: "#f87171",
};

const PALETTE_VARS = ["--muted", "--accent", "--warning", "--success", "--danger", "--mfg-chart-bar-alt"];

export function getWorkOrderStatusChartColor(status, index = 0) {
  const cssVar = STATUS_CSS_VAR[status];
  if (cssVar) {
    return readCssVar(cssVar, STATUS_FALLBACK[status]);
  }
  const varName = PALETTE_VARS[index % PALETTE_VARS.length];
  return readCssVar(varName, STATUS_FALLBACK.Received);
}
