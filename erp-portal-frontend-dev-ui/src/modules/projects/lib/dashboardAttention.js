/** Map dashboard action-center attention labels to StatusPill tones. */
export function dashboardAttentionTone(item) {
	if (item?.attention) {
		const a = String(item.attention).toLowerCase();
		if (a === "reopened") return "warn";
		if (a === "ready to close") return "success";
		if (a === "rework" || a === "on hold" || a === "program_on_hold") return "warn";
		if (a === "in qa" || a === "awaiting qa") return "info";
		return "default";
	}
	if (item?.severity) {
		const s = String(item.severity).toLowerCase();
		if (s === "warning") return "warn";
		if (s === "critical" || s === "escalated") return "danger";
	}
	return "default";
}
