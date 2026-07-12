/** PM portal role helpers — mirrors backend project_management.project.core.roles. */

export const PM_ROLES = {
	ADMINISTRATOR: "Administrator",
	SYSTEM_MANAGER: "System Manager",
	PROGRAM_MANAGER: "Project Manager",
	DEVELOPER: "Developer",
	TESTER: "Tester",
	BUSINESS_ANALYST: "Business Analyst",
};

export const PM_DELIVERY_ROLES = new Set([PM_ROLES.DEVELOPER, PM_ROLES.TESTER]);

export const PM_PORTAL_ROLES = new Set([
	PM_ROLES.PROGRAM_MANAGER,
	PM_ROLES.DEVELOPER,
	PM_ROLES.TESTER,
	PM_ROLES.BUSINESS_ANALYST,
]);

const ADMIN_ROLES = new Set([PM_ROLES.ADMINISTRATOR, PM_ROLES.SYSTEM_MANAGER]);

export function isSiteAdminRole(roles = []) {
	return roles.some((r) => ADMIN_ROLES.has(r));
}

export function isProgramManagerRole(roles = []) {
	return roles.includes(PM_ROLES.PROGRAM_MANAGER);
}

export function isDeveloperRole(roles = []) {
	return roles.includes(PM_ROLES.DEVELOPER);
}

export function isTesterRole(roles = []) {
	return roles.includes(PM_ROLES.TESTER);
}

export function isBusinessAnalystRole(roles = []) {
	return roles.includes(PM_ROLES.BUSINESS_ANALYST);
}

export function isDeliveryMemberRole(roles = []) {
	return (roles || []).some((r) => PM_DELIVERY_ROLES.has(r));
}

export function hasPmPortalRole(roles = []) {
	return (roles || []).some((r) => PM_PORTAL_ROLES.has(r));
}
