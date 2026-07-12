/**
 * Sales module palette — aligned with ERP Portal / Project Management (global.css :root).
 * Use only inside src/modules/sales. No hex literals — use var(--*) and color-mix.
 */

export const SALES_COLORS = {
  // Portal layout — global.css :root
  bg: "var(--bg)",
  bgElevated: "var(--bg-elevated)",
  surface: "var(--surface)",
  surface2: "var(--surface-2)",
  border: "var(--border)",
  text: "var(--text)",
  sub: "var(--muted)",
  muted: "var(--muted)",
  accent: "var(--accent)",

  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",

  /** Semantic aliases for charts / KPI accents */
  green: "var(--success)",
  blue: "var(--accent)",
  red: "var(--danger)",
  amber: "var(--warning)",
  slate: "var(--muted)",

  /** Extended chart hues — defined on .sales-module-root in salesModule.css */
  indigo: "var(--sales-indigo)",
  purple: "var(--sales-purple)",
  violet: "var(--sales-purple)",
  cyan: "var(--sales-cyan)",
  teal: "var(--sales-teal)",
  emerald: "var(--sales-emerald)",

  /** Dim / tinted surfaces */
  greenDim: "color-mix(in srgb, var(--success) 14%, transparent)",
  greenMid: "color-mix(in srgb, var(--success) 20%, transparent)",
  tealMid: "color-mix(in srgb, var(--sales-teal) 20%, transparent)",
  blueDim: "var(--accent-dim)",
  amberDim: "color-mix(in srgb, var(--warning) 14%, transparent)",
  redDim: "color-mix(in srgb, var(--danger) 14%, transparent)",
  purpleDim: "color-mix(in srgb, var(--sales-purple) 14%, transparent)",
  cyanDim: "color-mix(in srgb, var(--sales-cyan) 14%, transparent)",

  greenLt: "color-mix(in srgb, var(--success) 16%, transparent)",
  blueLt: "color-mix(in srgb, var(--accent) 16%, transparent)",
  indigoLt: "color-mix(in srgb, var(--sales-indigo) 16%, transparent)",
  amberLt: "color-mix(in srgb, var(--warning) 16%, transparent)",
  redLt: "color-mix(in srgb, var(--danger) 16%, transparent)",
  cyanLt: "color-mix(in srgb, var(--sales-cyan) 16%, transparent)",
  tealLt: "color-mix(in srgb, var(--sales-teal) 16%, transparent)",
  emeraldLt: "color-mix(in srgb, var(--sales-emerald) 16%, transparent)",
  purpleLt: "color-mix(in srgb, var(--sales-purple) 16%, transparent)",
  violetLt: "color-mix(in srgb, var(--sales-purple) 16%, transparent)",

  /** Alpha helpers (replaces legacy `${color}NN` suffix patterns in JSX) */
  successAlpha20: "color-mix(in srgb, var(--success) 20%, transparent)",
  accentAlpha40: "color-mix(in srgb, var(--accent) 40%, transparent)",
  accentAlpha13: "color-mix(in srgb, var(--accent) 13%, transparent)",

  chartGrid: "color-mix(in srgb, var(--muted) 22%, transparent)",
  chartAxis: "color-mix(in srgb, var(--muted) 35%, transparent)",
  overlay: "color-mix(in srgb, black 55%, transparent)",
  liveBadgeBg: "color-mix(in srgb, var(--success) 12%, transparent)",
  liveBadgeBorder: "color-mix(in srgb, var(--success) 35%, transparent)",

  /** Text on primary gradient buttons */
  onPrimary: "var(--sales-on-primary, #fff)",
};
