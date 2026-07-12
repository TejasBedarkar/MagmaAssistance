/** Empty-state message for PM lists and tables. */
export default function ProjectEmptyState({ message = "No records found.", children, error, onRetry }) {
	return (
		<div className="pm-empty">
			{error ? <div className="pm-error-banner">{error}</div> : message}
			{onRetry ? (
				<button type="button" className="pm-btn pm-btn-primary" onClick={onRetry}>
					Retry
				</button>
			) : null}
			{children}
		</div>
	);
}
