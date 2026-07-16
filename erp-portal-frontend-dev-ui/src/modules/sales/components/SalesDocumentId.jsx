/**
 * Unified document ID pill for Sales list tables (quotation, order, opportunity, etc.).
 */
export default function SalesDocumentId({
  id,
  onClick,
  className = "",
  title,
}) {
  const label = String(id || "").trim() || "—";
  const tip = title ?? label;
  const classes = ["sales-doc-id", className].filter(Boolean).join(" ");

  if (onClick) {
    return (
      <button
        type="button"
        className={`${classes} sales-doc-id--btn`}
        title={tip}
        onClick={onClick}
      >
        {label}
      </button>
    );
  }

  return (
    <span className={classes} title={tip}>
      {label}
    </span>
  );
}
