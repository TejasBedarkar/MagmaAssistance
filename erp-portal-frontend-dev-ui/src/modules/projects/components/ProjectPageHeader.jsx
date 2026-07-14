/**
 * Page intro + filter toolbar card for PM list and dashboard pages.
 * Mirrors finance/components/FinancePageHeader.jsx structure.
 */
export default function ProjectPageHeader({
	title,
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
	const descClass = [
		"pm-page-desc",
		hasToolbar || hasFooter ? "project-page-header__desc--spaced" : "",
	]
		.filter(Boolean)
		.join(" ");

	return (
		<div className={`pm-card project-page-header ${className}`.trim()}>
			{title ? <h1 className="pm-page-title">{title}</h1> : null}
			{description ? <p className={descClass}>{description}</p> : null}

			{hasToolbar ? (
				<div className="project-page-header__toolbar">
					{children ? <div className="project-page-header__filters">{children}</div> : null}
					{actions ? <div className="project-page-header__actions">{actions}</div> : null}
				</div>
			) : null}

			{meta ? <p className="pm-field-hint project-page-header__meta">{meta}</p> : null}

			{note ? (
				<p
					className={`pm-field-hint project-page-header__note project-page-header__note--${
						noteTone === "warning" ? "warning" : "muted"
					}`}
				>
					{note}
				</p>
			) : null}
		</div>
	);
}
