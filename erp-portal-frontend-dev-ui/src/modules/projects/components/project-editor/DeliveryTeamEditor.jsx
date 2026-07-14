import { useEffect, useState } from "react";
import UserSelect from "../../../../common/components/UserSelect.jsx";
import useUserLabelMap from "../../../../common/hooks/useUserLabelMap.js";
import { MEMBER_ROLES, emptyDeliveryTeamRow, purposeForRole, roleTone } from "../../lib/deliveryTeamUtils.js";

export { MEMBER_ROLES, emptyDeliveryTeamRow, purposeForRole };

function initialActiveIndex(list) {
	const incomplete = list.findIndex((row) => !row.user);
	if (incomplete >= 0) return incomplete;
	return list.length > 0 ? -1 : 0;
}

function CollapsedRowSummary({ row, index, labelFor, isActive, onActivate, onRemove }) {
	const role = row.member_role || "Developer";
	const userLabel = row.user ? labelFor(row.user) : "Select team member…";

	return (
		<div
			className={`pm-delivery-team-editor__row pm-delivery-team-editor__row--collapsed${isActive ? " pm-delivery-team-editor__row--active" : ""}`}
		>
			<button type="button" className="pm-delivery-team-editor__summary" onClick={onActivate}>
				<span className="pm-delivery-team-editor__row-index">{index + 1}</span>
				<span className={`pm-delivery-team-member__role pm-delivery-team-member__role--${roleTone(role)}`}>
					{role}
				</span>
				<span className={`pm-delivery-team-editor__summary-user${row.user ? "" : " pm-delivery-team-editor__summary-user--empty"}`}>
					{userLabel}
				</span>
			</button>
			<button
				type="button"
				className="pm-delivery-team-editor__remove"
				onClick={onRemove}
				aria-label="Remove team member"
				title="Remove"
			>
				×
			</button>
		</div>
	);
}

function ExpandedRowEditor({ row, index, onChange, onRemove, onCollapse }) {
	return (
		<div className="pm-delivery-team-editor__row pm-delivery-team-editor__row--expanded">
			<div className="pm-delivery-team-editor__expanded-head">
				<span className="pm-delivery-team-editor__row-index">{index + 1}</span>
				<div>
					<div className="pm-delivery-team-editor__expanded-title">Team member</div>
					<div className="pm-delivery-team-editor__expanded-sub">Choose role and assign a user</div>
				</div>
				<button
					type="button"
					className="pm-delivery-team-editor__collapse"
					onClick={onCollapse}
					aria-label="Collapse row"
				>
					Done
				</button>
				<button
					type="button"
					className="pm-delivery-team-editor__remove"
					onClick={onRemove}
					aria-label="Remove team member"
					title="Remove"
				>
					×
				</button>
			</div>
			<div className="pm-delivery-team-editor__fields">
				<div className="pm-field">
					<label className="pm-label">Role</label>
					<select
						className="pm-select"
						value={row.member_role || "Developer"}
						onChange={(e) => onChange({ member_role: e.target.value, user: "" })}
					>
						{MEMBER_ROLES.map((r) => (
							<option key={r.value} value={r.value}>
								{r.label}
							</option>
						))}
					</select>
				</div>
				<div className="pm-field">
					<label className="pm-label">User *</label>
					<UserSelect
						purpose={purposeForRole(row.member_role)}
						required
						value={row.user || ""}
						onChange={(v) => onChange({ user: v })}
						placeholder="Select team member…"
					/>
				</div>
			</div>
		</div>
	);
}

export default function DeliveryTeamEditor({ rows, onChange, resetKey = 0 }) {
	const list = Array.isArray(rows) ? rows : [];
	const { labelFor } = useUserLabelMap();
	const [activeIndex, setActiveIndex] = useState(() => initialActiveIndex(list));

	useEffect(() => {
		setActiveIndex(initialActiveIndex(list));
	}, [resetKey, list.length]);

	function setRow(index, patch) {
		onChange(list.map((row, i) => (i === index ? { ...row, ...patch } : row)));
	}

	function addRow() {
		const next = [...list, emptyDeliveryTeamRow()];
		onChange(next);
		setActiveIndex(next.length - 1);
	}

	function removeRow(index) {
		const next = list.filter((_, i) => i !== index);
		onChange(next);
		setActiveIndex((current) => {
			if (next.length === 0) return 0;
			if (index < current) return current - 1;
			if (index === current) return Math.min(current, next.length - 1);
			return current;
		});
	}

	return (
		<div className="pm-delivery-team-editor">
			{list.length === 0 ? (
				<div className="pm-delivery-team-editor__empty">
					<p>No members added yet. Use the button below to add your first team member.</p>
				</div>
			) : (
				<div className="pm-delivery-team-editor__list">
					{list.map((row, index) => {
						const isExpanded = index === activeIndex;
						if (isExpanded && activeIndex >= 0) {
							return (
								<ExpandedRowEditor
									key={index}
									row={row}
									index={index}
									onChange={(patch) => setRow(index, patch)}
									onRemove={() => removeRow(index)}
									onCollapse={() => {
										if (row.user) {
											const nextEmpty = list.findIndex((r, i) => i !== index && !r.user);
											setActiveIndex(nextEmpty >= 0 ? nextEmpty : -1);
										}
									}}
								/>
							);
						}
						return (
							<CollapsedRowSummary
								key={index}
								row={row}
								index={index}
								labelFor={labelFor}
								isActive={false}
								onActivate={() => setActiveIndex(index)}
								onRemove={() => removeRow(index)}
							/>
						);
					})}
				</div>
			)}
			<button type="button" className="pm-btn pm-delivery-team-editor__add" onClick={addRow}>
				+ Add team member
			</button>
		</div>
	);
}
