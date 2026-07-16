import React, { useEffect, useMemo, useState } from "react";
import { PortalInlineLoader } from "../../../../common/components/PortalSpinner.jsx";
import { useAuth } from "../../../../common/context/AuthContext.jsx";
import { formatDateTime } from "../../utils/formatDateTime.js";
import { activityActionClassName, activityTone } from "../../lib/taskEditorConstants.js";

const MAX_LEN = 4000;

const FILTERS = [
	{ id: "all", label: "All" },
	{ id: "comment", label: "Comments" },
	{ id: "system", label: "System" },
	{ id: "changes", label: "Changes" },
];

function initials(label) {
	const parts = (label || "?").trim().split(/\s+/).filter(Boolean);
	if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
	return (parts[0] || "?").slice(0, 2).toUpperCase();
}

function matchesFilter(item, filterId) {
	if (filterId === "all") return true;
	if (filterId === "comment") return item.kind === "comment";
	if (filterId === "changes") return item.type === "change";
	if (filterId === "system") return item.kind === "activity" && item.type !== "change";
	return true;
}

export default function TaskTimelinePanel({
	timeline,
	onPosted,
	disabled,
	postComment,
	showChangesFilter = true,
	ariaLabel = "Task activity timeline",
}) {
	const { user } = useAuth();
	const [filter, setFilter] = useState("all");
	const [draft, setDraft] = useState("");
	const [posting, setPosting] = useState(false);
	const [localErr, setLocalErr] = useState("");

	useEffect(() => {
		if (!showChangesFilter && filter === "changes") setFilter("all");
	}, [showChangesFilter, filter]);

	const trimmed = draft.trim();
	const overLimit = trimmed.length > MAX_LEN;

	const filterOptions = useMemo(
		() => (showChangesFilter ? FILTERS : FILTERS.filter((f) => f.id !== "changes")),
		[showChangesFilter],
	);

	const visibleItems = useMemo(
		() => (timeline || []).filter((item) => matchesFilter(item, filter)),
		[timeline, filter],
	);

	function onComposerKeyDown(e) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			if (!trimmed || posting || disabled || overLimit || !postComment) return;
			e.currentTarget.form?.requestSubmit();
		}
	}

	async function onPost(e) {
		e.preventDefault();
		if (!trimmed || posting || disabled || !postComment) return;
		setLocalErr("");
		setPosting(true);
		try {
			await postComment(trimmed);
			setDraft("");
			await onPosted?.();
		} catch (err) {
			setLocalErr(err.message || "Could not post comment");
		} finally {
			setPosting(false);
		}
	}

	return (
		<section className="pm-card pm-task-timeline">
			<div className="pm-task-timeline__head">
				<div>
					<h2 className="pm-panel__title pm-task-timeline__title">Activity</h2>
				</div>
				<div className="pm-task-timeline__filters" role="tablist" aria-label="Timeline filters">
					{filterOptions.map((f) => (
						<button
							key={f.id}
							type="button"
							role="tab"
							aria-selected={filter === f.id}
							className={`pm-task-timeline__filter${filter === f.id ? " pm-task-timeline__filter--active" : ""}`}
							onClick={() => setFilter(f.id)}
						>
							{f.label}
						</button>
					))}
				</div>
			</div>

			{localErr ? <div className="pm-error-banner">{localErr}</div> : null}

			{visibleItems.length === 0 ? (
				<p className="pm-form-field-hint pm-form-field-hint--flush">
					{filter === "all" ? "No activity recorded yet." : "Nothing in this filter yet."}
				</p>
			) : (
				<div
					className={`pm-task-timeline__scroll${visibleItems.length > 4 ? " pm-task-timeline__scroll--limited" : ""}`}
					role="region"
					aria-label={ariaLabel}
					tabIndex={visibleItems.length > 4 ? 0 : undefined}
				>
					<ul className="pm-task-timeline__list">
						{visibleItems.map((item) => {
							if (item.kind === "comment") {
								const isOwn = item.author === user;
								return (
									<li key={item.name} className="pm-task-timeline__entry pm-task-timeline__entry--comment">
										<div
											className={`pm-task-discussion__message${isOwn ? " pm-task-discussion__message--own" : ""}`}
										>
											<div className="pm-task-discussion__avatar" aria-hidden>
												{initials(item.author_label)}
											</div>
											<div className="pm-task-discussion__bubble">
												<div className="pm-task-discussion__meta">
													<span className="pm-task-discussion__author">{item.author_label}</span>
													{isOwn ? <span className="pm-task-discussion__you">You</span> : null}
													{item.creation ? (
														<time className="pm-task-discussion__time" dateTime={item.creation}>
															{formatDateTime(item.creation)}
														</time>
													) : null}
												</div>
												<div className="pm-task-discussion__body">{item.body}</div>
											</div>
										</div>
									</li>
								);
							}

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

			{!disabled ? (
				<form className="pm-task-discussion__composer pm-task-timeline__composer" onSubmit={onPost}>
					<div className="pm-task-discussion__composer-row">
						<textarea
							id="pm-task-comment"
							className="pm-textarea pm-task-discussion__input"
							rows={1}
							aria-label="Add a comment"
							placeholder="Add a comment…"
							value={draft}
							disabled={posting}
							onChange={(e) => setDraft(e.target.value)}
							onKeyDown={onComposerKeyDown}
						/>
						<button
							type="submit"
							className="pm-btn pm-btn-primary pm-task-discussion__send"
							disabled={posting || !trimmed || overLimit}
							aria-label="Send comment"
							aria-busy={posting}
						>
							{posting ? <PortalInlineLoader size="xs" className="portal-spinner--in-btn" /> : "Send"}
						</button>
					</div>
					{(trimmed.length > 0 || overLimit) && (
						<span
							className={`pm-task-discussion__counter${overLimit ? " pm-task-discussion__counter--over" : ""}`}
						>
							{trimmed.length} / {MAX_LEN}
						</span>
					)}
				</form>
			) : (
				<p className="pm-page-desc pm-task-timeline__readonly">Comments are read-only in this view.</p>
			)}
		</section>
	);
}
