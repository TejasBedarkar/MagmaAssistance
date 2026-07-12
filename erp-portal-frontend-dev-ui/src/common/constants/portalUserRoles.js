/** Portal role groups — mirrors Frappe Desk User → Roles & Permissions (UI only until portal API). */

export const PORTAL_ROLE_GROUPS = [
  {
    id: "pm",
    label: "Project Management",
    roles: ["Project Manager", "Developer", "Tester", "Business Analyst"],
  },
  {
    id: "mfg",
    label: "Manufacturing",
    roles: [
      "Production Head",
      "Production Supervisor",
      "Operator",
      "QC Inspector",
      "Store Keeper",
      "Dispatch Coordinator",
    ],
  },
  {
    id: "sales",
    label: "Sales & Delivery",
    roles: ["Sales Executive", "Sales Manager", "Delivery Executive", "Delivery Manager"],
  },
  {
    id: "finance",
    label: "Finance",
    roles: [
      "CFO",
      "Finance Manager",
      "Treasury Manager",
      "Account Receivable Executive",
      "Account Payable Executive",
      "Auditor",
    ],
  },
  {
    id: "scm",
    label: "Supply Chain",
    roles: [
      "Stock Manager",
      "Stock User",
      "Purchase Manager",
      "Purchase User",
      "SCM Manager",
      "SCM Executive",
    ],
  },
];

export const ALL_PORTAL_ROLES = PORTAL_ROLE_GROUPS.flatMap((g) => g.roles);

export const PM_PORTAL_ROLE_LIST = PORTAL_ROLE_GROUPS.find((g) => g.id === "pm")?.roles ?? [];

/** Map role name → group id for badges and role tiles. */
export const PORTAL_ROLE_GROUP_BY_ROLE = Object.fromEntries(
  PORTAL_ROLE_GROUPS.flatMap((g) => g.roles.map((role) => [role, g.id]))
);

/** Desk-only roles shown in lists (not assignable in portal user editor). */
export const DESK_ONLY_ROLE_LABELS = {
  "System Manager": "Administrator",
};

export function displayPortalRole(role) {
  return DESK_ONLY_ROLE_LABELS[role] || role;
}

export function portalRoleBadgeGroup(role) {
  if (role === "System Manager") return "admin";
  return PORTAL_ROLE_GROUP_BY_ROLE[role];
}

export const USER_EDITOR_TABS = [
  { id: "details", label: "User Details" },
  { id: "roles", label: "Roles & Permissions" },
  { id: "more", label: "More Information" },
  { id: "settings", label: "Settings" },
];

export const TIME_ZONE_DEFAULT = "Asia/Kolkata";
