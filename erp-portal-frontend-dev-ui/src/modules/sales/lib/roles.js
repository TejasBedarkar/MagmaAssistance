/** Sales portal roles — routes, sidebar, and action permissions (Sales module only). */

export const ROLE = {
  SALES_EXECUTIVE: "Sales Executive",
  SALES_MANAGER: "Sales Manager",
  SYSTEM_MANAGER: "Administrator",
};

/** Frappe role names that map to a sales portal role. */
export const FRAPPE_SALES_ROLE_ALIASES = {
  "Sales User": ROLE.SALES_EXECUTIVE,
  "Sales Executive": ROLE.SALES_EXECUTIVE,
  "Sales Manager": ROLE.SALES_MANAGER,
  Administrator: ROLE.SYSTEM_MANAGER,
  "System Manager": ROLE.SYSTEM_MANAGER,
};

export const SALES_ROLES = [ROLE.SALES_EXECUTIVE, ROLE.SALES_MANAGER, ROLE.SYSTEM_MANAGER];
export const SALES_USER_ROLES = SALES_ROLES;
export const SALES_MANAGER_ROLES = [ROLE.SALES_MANAGER, ROLE.SYSTEM_MANAGER];
/** Deal pipeline board — Sales Manager and Administrator only (not Sales Executive). */
export const SALES_PIPELINE_ROLES = SALES_MANAGER_ROLES;

/** Whether the user may open /sales/pipeline (manager oversight board). */
export function canAccessSalesPipeline(salesRole, portalRoles = []) {
  return hasSalesRoleAccess(portalRoles, salesRole, SALES_PIPELINE_ROLES);
}

/** Sidebar page ids per primary sales role. */
export const SALES_ROLE_SIDEBAR = {
  [ROLE.SALES_EXECUTIVE]: [
    "dashboard",
    "leads",
    "opportunities",
    "customers",
    "quotations",
    "orders",
    "returns",
    "sales_list",
    "audit_logs",
  ],
  [ROLE.SALES_MANAGER]: [
    "dashboard",
    "leads",
    "opportunities",
    "customers",
    "quotations",
    "pending_approvals",
    "orders",
    "returns",
    "sales_list",
    "pipeline",
    "audit_logs",
  ],
  [ROLE.SYSTEM_MANAGER]: [
    "dashboard",
    "leads",
    "opportunities",
    "customers",
    "quotations",
    "orders",
    "returns",
    "pipeline",
    "pending_approvals",
    "sales_list",
    "audit_logs",
  ],
};

/** Frappe roles that should receive sales module session / nav treatment. */
export const SALES_PORTAL_FRAPPE_ROLES = new Set([
  "Sales Executive",
  "Sales Manager",
  "Sales User",
  "Administrator",
  "System Manager",
]);

const PROFILE_KEY = "sales_app_user_profile";

function inferRoleFromUserId(currentUser) {
  const userId = String(currentUser || "").trim().toLowerCase();
  if (!userId) return ROLE.SALES_EXECUTIVE;
  if (userId === "administrator" || userId.endsWith("@administrator")) {
    return ROLE.SYSTEM_MANAGER;
  }

  const localPart = userId.split("@")[0] || userId;
  const compact = localPart.replace(/[^a-z]/g, "");

  if (compact.includes("salesmanager")) return ROLE.SALES_MANAGER;
  if (compact.includes("salesexecutive") || compact.includes("salesuser")) return ROLE.SALES_EXECUTIVE;
  if (compact.includes("sales")) return ROLE.SALES_EXECUTIVE;

  return ROLE.SALES_EXECUTIVE;
}

export function normalizeRole(value) {
  const raw = String(value || "").trim();
  if (!raw) return ROLE.SALES_EXECUTIVE;
  const alias = FRAPPE_SALES_ROLE_ALIASES[raw];
  if (alias) return alias;
  const lower = raw.toLowerCase();
  if (lower === "sales user") return ROLE.SALES_EXECUTIVE;
  if (lower === "system manager" || lower === "administrator") return ROLE.SYSTEM_MANAGER;
  const hit = Object.values(ROLE).find((label) => label.toLowerCase() === lower);
  return hit || ROLE.SALES_EXECUTIVE;
}

/** Pick one sales role from Frappe / portal role list (priority: Admin → Manager → Executive). */
export function derivePrimaryRole(roles) {
  const roleList = Array.isArray(roles) ? roles.map((r) => String(r || "").trim()) : [];
  if (roleList.includes("Administrator")) return ROLE.SYSTEM_MANAGER;
  if (roleList.includes("System Manager")) return ROLE.SYSTEM_MANAGER;
  if (roleList.includes("Sales Manager")) return ROLE.SALES_MANAGER;
  if (roleList.includes("Sales Executive") || roleList.includes("Sales User")) {
    return ROLE.SALES_EXECUTIVE;
  }
  return ROLE.SALES_EXECUTIVE;
}

export function roleIn(role, allowedRoles = []) {
  const normalized = normalizeRole(role);
  return allowedRoles.includes(normalized);
}

export function hasSalesRoleAccess(portalRoles, salesRole, allowedRoles = []) {
  if (!allowedRoles.length) return true;

  const profileRole = normalizeRole(salesRole);
  if (roleIn(profileRole, allowedRoles)) return true;

  if (Array.isArray(portalRoles) && portalRoles.length) {
    const portalPrimary = derivePrimaryRole(portalRoles);
    if (roleIn(portalPrimary, allowedRoles)) return true;

    const hasFrappeSalesRole = portalRoles.some((r) =>
      SALES_PORTAL_FRAPPE_ROLES.has(String(r || "").trim())
    );
    if (hasFrappeSalesRole && allowedRoles.includes(ROLE.SALES_EXECUTIVE)) {
      return true;
    }
  }

  return false;
}

export function resolveRoleFromProfile(currentUser) {
  const fallback = inferRoleFromUserId(currentUser);
  try {
    const store = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
    const currentKey = String(currentUser || "");
    const exact = store?.[currentKey];
    if (exact?.role) return normalizeRole(exact.role);

    const keyHit = Object.keys(store || {}).find(
      (k) => String(k || "").trim().toLowerCase() === currentKey.trim().toLowerCase()
    );
    if (keyHit && store[keyHit]?.role) return normalizeRole(store[keyHit].role);

    return fallback;
  } catch {
    return fallback;
  }
}

export function allowedActionsByRole(role) {
  const normalized = normalizeRole(role);
  if (normalized === ROLE.SYSTEM_MANAGER) {
    return {
      canCreate: true,
      canEdit: true,
      canApprove: true,
      canReject: true,
      canSubmitForApproval: true,
      canViewPendingApprovals: true,
      canDelete: true,
    };
  }
  if (normalized === ROLE.SALES_MANAGER) {
    return {
      canCreate: true,
      canEdit: true,
      canApprove: true,
      canReject: true,
      canSubmitForApproval: true,
      canViewPendingApprovals: true,
      canDelete: true,
    };
  }
  return {
    canCreate: true,
    canEdit: true,
    canApprove: false,
    canReject: false,
    canSubmitForApproval: true,
    canViewPendingApprovals: false,
    canDelete: false,
  };
}
