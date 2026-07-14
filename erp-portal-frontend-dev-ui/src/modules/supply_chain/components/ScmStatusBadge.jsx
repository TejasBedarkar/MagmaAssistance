const TONE_CLASS = {
  critical: "scm-badge--critical",
  reorder: "scm-badge--reorder",
  low: "scm-badge--low",
  default: "scm-badge--default",
  "Pending SCM": "scm-badge--pending",
  "Date confirmed": "scm-badge--confirmed",
};

export default function ScmStatusBadge({ status, tone }) {
  const key = tone || status || "default";
  const modifier = TONE_CLASS[key] || TONE_CLASS.default;

  return <span className={`scm-badge ${modifier}`}>{status}</span>;
}
