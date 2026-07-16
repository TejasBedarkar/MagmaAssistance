/**
 * Page intro + filter toolbar card for finance reports and list pages.
 */
export default function FinancePageHeader({
  title: _title,
  description,
  actions,
  meta,
  note,
  noteTone = "warning",
  children,
  className = "",
}) {
  const hasToolbar = Boolean(children || actions);
  const hasFooter = Boolean(meta || note);
  const hasVisibleContent = Boolean(description || hasToolbar || hasFooter);

  if (!hasVisibleContent) {
    return null;
  }

  const descClass = [
    "pm-page-desc",
    hasToolbar || hasFooter ? "finance-page-header__desc--spaced" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`pm-card finance-page-header ${className}`.trim()}>
      {description ? <p className={descClass}>{description}</p> : null}

      {hasToolbar ? (
        <div className="finance-page-header__toolbar">
          {children ? <div className="finance-page-header__filters">{children}</div> : null}
          {actions ? <div className="pm-page-actions finance-page-header__actions">{actions}</div> : null}
        </div>
      ) : null}

      {meta ? <p className="pm-field-hint finance-page-header__meta">{meta}</p> : null}

      {note ? (
        <p
          className={`pm-field-hint finance-page-header__note finance-page-header__note--${
            noteTone === "warning" ? "warning" : "muted"
          }`}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}
