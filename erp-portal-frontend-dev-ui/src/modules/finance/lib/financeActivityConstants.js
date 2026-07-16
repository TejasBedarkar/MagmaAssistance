const ACTIVITY_TONE_CLASS = {
  success: "pm-activity-item__action--success",
  accent: "pm-activity-item__action--accent",
  created: "pm-activity-item__action--created",
  warning: "pm-activity-item__action--warning",
  danger: "pm-activity-item__action--danger",
  change: "pm-activity-item__action--change",
  muted: "pm-activity-item__action--muted",
};

/** Visual tone for finance audit action badges. */
export function financeActivityTone(action) {
  const label = (action || "").toLowerCase();

  if (label === "create") return "created";
  if (label.includes("approve")) return "success";
  if (label.includes("reject") || label.includes("send back")) return "danger";
  if (label.includes("submit") || label.includes("resubmit")) return "accent";
  if (label.includes("reconcil") || label.includes("match")) return "success";
  if (label.includes("refund")) return "warning";
  if (label.includes("e-way") || label.includes("eway")) return "accent";
  if (label.includes("import") || label.includes("default company")) return "change";
  if (label.includes("created") || label.includes("verified")) return "created";

  return "muted";
}

export function financeActivityActionClassName(tone) {
  return ACTIVITY_TONE_CLASS[tone] || ACTIVITY_TONE_CLASS.muted;
}
