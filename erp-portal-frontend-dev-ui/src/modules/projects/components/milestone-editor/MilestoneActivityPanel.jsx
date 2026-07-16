import { formatDateTime } from "../../utils/formatDateTime.js";
import { activityActionClassName, activityTone } from "../../lib/taskEditorConstants.js";

/** Milestone activity — system log only (no discussion comments; real ERP style). */
export default function MilestoneActivityPanel({ activity }) {
	const items = activity || [];

	return (
		<section className="pm-card pm-task-timeline pm-milestone-activity">
			<div className="pm-task-timeline__head">
				<h2 className="pm-panel__title pm-task-timeline__title">Activity</h2>
			</div>

			{items.length === 0 ? (
				<p className="pm-form-field-hint pm-form-field-hint--flush">No activity recorded yet.</p>
			) : (
				<div
					className={`pm-task-timeline__scroll${items.length > 4 ? " pm-task-timeline__scroll--limited" : ""}`}
					role="region"
					aria-label="Milestone activity log"
					tabIndex={items.length > 4 ? 0 : undefined}
				>
					<ul className="pm-task-timeline__list">
						{items.map((item) => {
							const action = item.action || null;
							const body = item.body || "";
							const tone = activityTone(action, body);
							const actionClass = activityActionClassName(tone);

							return (
								<li key={item.name} className="pm-task-timeline__entry pm-task-timeline__entry--system">
									<div className="pm-activity-item">
										<div className="pm-activity-item__meta">
											{action ? (
												<span className={`pm-activity-item__action ${actionClass}`}>
													[{action}]
												</span>
											) : null}
											{item.author_label}
											{item.creation ? ` · ${formatDateTime(item.creation)}` : ""}
										</div>
										<div className="pm-activity-item__body">{body}</div>
									</div>
								</li>
							);
						})}
					</ul>
				</div>
			)}
		</section>
	);
}
