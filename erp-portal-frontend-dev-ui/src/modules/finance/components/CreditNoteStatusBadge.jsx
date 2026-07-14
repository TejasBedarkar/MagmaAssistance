/** Figma-aligned status pill for credit notes & refunds. */
export function CreditNoteStatusBadge({ label, tone = "muted", className = "" }) {
  const safeTone = tone || "muted";
  return (
    <span
      className={`finance-cn-status-badge finance-cn-status-badge--${safeTone}${className ? ` ${className}` : ""}`}
    >
      {label}
    </span>
  );
}

export default CreditNoteStatusBadge;
