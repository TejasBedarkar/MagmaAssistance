export const MEMBER_ROLES = [
	{ value: "Developer", purpose: "developer", label: "Developer", tone: "dev" },
	{ value: "Tester", purpose: "tester", label: "Tester", tone: "test" },
	{ value: "Business Analyst", purpose: "business_analyst", label: "Business Analyst", tone: "ba" },
];

export function purposeForRole(memberRole) {
	return MEMBER_ROLES.find((r) => r.value === memberRole)?.purpose || "developer";
}

export function roleTone(memberRole) {
	return MEMBER_ROLES.find((r) => r.value === memberRole)?.tone || "dev";
}

export function emptyDeliveryTeamRow(memberRole = "Developer") {
	return { user: "", member_role: memberRole, full_name: "" };
}

export function defaultDeliveryTeamDraft() {
	return [emptyDeliveryTeamRow("Developer"), emptyDeliveryTeamRow("Tester")];
}

export function projectHasDeliveryTeam(rows) {
	return (Array.isArray(rows) ? rows : []).some((row) => (row?.user || "").trim());
}

export function normalizeDeliveryTeamRows(rows) {
	return (Array.isArray(rows) ? rows : [])
		.filter((row) => row?.user)
		.map((row) => ({
			user: row.user,
			member_role: row.member_role || "Developer",
			full_name: row.full_name || "",
		}));
}

export function getProjectTeamTester(rows) {
	const testers = (Array.isArray(rows) ? rows : []).filter(
		(row) => (row?.member_role || "").trim() === "Tester" && (row?.user || "").trim()
	);
	return testers.length === 1 ? testers[0].user.trim() : "";
}

export function validateDeliveryTeamDraft(rows) {
	const list = Array.isArray(rows) ? rows : [];
	const filled = list.filter((row) => (row.user || "").trim());
	const seen = new Set();
	for (const row of filled) {
		const user = row.user.trim();
		if (seen.has(user)) {
			return `User ${user} is listed more than once.`;
		}
		seen.add(user);
	}
	for (const row of list) {
		if ((row.member_role || "").trim() && !(row.user || "").trim() && list.length > 1) {
			return "Each row needs a user, or remove empty rows.";
		}
	}
	if (filled.length > 0) {
		const testerCount = filled.filter((row) => (row.member_role || "").trim() === "Tester").length;
		if (testerCount !== 1) {
			return "Delivery team must include exactly one Tester.";
		}
	}
	return "";
}
