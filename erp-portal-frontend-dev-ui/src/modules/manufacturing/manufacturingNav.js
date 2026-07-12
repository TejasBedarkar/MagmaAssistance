/**
 * Role-filtered manufacturing sidebar — mirrors apps/manufacturing_operations/frontend AppLayout.jsx
 */
import { mfgPath } from "./paths.js";

export const MFG_ROLES = {
  PRODUCTION_HEAD: "Production Head",
  SUPERVISOR: "Production Supervisor",
  OPERATOR: "Machine Operator",
  QC_INSPECTOR: "QC Inspector",
  STORE_KEEPER: "Store Keeper",
  DISPATCH_COORDINATOR: "Dispatch Coordinator",
  MAINTENANCE_TECHNICIAN: "Maintenance Technician",
};

/** Same priority as manufacturing_operations.api.dashboard._get_role */
const ROLE_PRIORITY = [
  MFG_ROLES.PRODUCTION_HEAD,
  MFG_ROLES.SUPERVISOR,
  MFG_ROLES.MAINTENANCE_TECHNICIAN,
  MFG_ROLES.OPERATOR,
  MFG_ROLES.QC_INSPECTOR,
  MFG_ROLES.STORE_KEEPER,
  MFG_ROLES.DISPATCH_COORDINATOR,
];

const SECTION_META = {
  overview: { label: "Overview" },
  planning: { label: "Planning & scheduling" },
  execution: { label: "Shop floor" },
  logistics: { label: "Logistics & closure" },
  reporting: { label: "Reporting" },
  setup: { label: "Setup & master data" },
};

/** Flat nav — paths are portal-prefixed via mfgPath */
const NAV_ITEMS = [
  {
    section: "overview",
    label: "Dashboard",
    pathSuffix: "",
    end: true,
    roles: "all",
  },
  {
    section: "planning",
    label: "Work Orders",
    pathSuffix: "/work-orders",
    roles: [
      MFG_ROLES.PRODUCTION_HEAD,
      MFG_ROLES.SUPERVISOR,
      MFG_ROLES.OPERATOR,
      MFG_ROLES.QC_INSPECTOR,
      MFG_ROLES.DISPATCH_COORDINATOR,
      MFG_ROLES.STORE_KEEPER,
    ],
  },
  {
    section: "planning",
    label: "New Product",
    pathSuffix: "/new-product-requirement",
    roles: [MFG_ROLES.PRODUCTION_HEAD, MFG_ROLES.SUPERVISOR],
  },
  {
    section: "planning",
    label: "Capacity Planning",
    pathSuffix: "/capacity",
    roles: [MFG_ROLES.PRODUCTION_HEAD, MFG_ROLES.SUPERVISOR],
  },
  {
    section: "planning",
    label: "Capacity Commitments",
    pathSuffix: "/capacity-commitments",
    roles: [MFG_ROLES.PRODUCTION_HEAD, MFG_ROLES.SUPERVISOR],
  },
  {
    section: "planning",
    label: "Materials",
    pathSuffix: "/materials",
    roles: [MFG_ROLES.STORE_KEEPER, MFG_ROLES.SUPERVISOR, MFG_ROLES.PRODUCTION_HEAD],
  },
  {
    section: "execution",
    label: "Production",
    pathSuffix: "/production",
    roles: [
      MFG_ROLES.SUPERVISOR,
      MFG_ROLES.OPERATOR,
      MFG_ROLES.PRODUCTION_HEAD,
    ],
  },
  {
    section: "execution",
    label: "Quality",
    pathSuffix: "/quality",
    roles: [MFG_ROLES.QC_INSPECTOR, MFG_ROLES.SUPERVISOR, MFG_ROLES.PRODUCTION_HEAD],
  },
  {
    section: "execution",
    label: "Maintenance",
    pathSuffix: "/maintenance",
    roles: [
      MFG_ROLES.MAINTENANCE_TECHNICIAN,
      MFG_ROLES.SUPERVISOR,
      MFG_ROLES.PRODUCTION_HEAD,
      MFG_ROLES.OPERATOR,
    ],
  },
  {
    section: "logistics",
    label: "Dispatch",
    pathSuffix: "/dispatch",
    roles: [MFG_ROLES.DISPATCH_COORDINATOR, MFG_ROLES.PRODUCTION_HEAD],
  },
  {
    section: "logistics",
    label: "Closure",
    pathSuffix: "/closure",
    roles: [MFG_ROLES.PRODUCTION_HEAD, MFG_ROLES.DISPATCH_COORDINATOR],
  },
  {
    section: "reporting",
    label: "Reports",
    pathSuffix: "/reports",
    roles: [
      MFG_ROLES.PRODUCTION_HEAD,
      MFG_ROLES.SUPERVISOR,
      MFG_ROLES.QC_INSPECTOR,
      MFG_ROLES.DISPATCH_COORDINATOR,
      MFG_ROLES.MAINTENANCE_TECHNICIAN,
    ],
  },
  {
    section: "setup",
    label: "QC Templates",
    pathSuffix: "/qc-templates",
    roles: [MFG_ROLES.QC_INSPECTOR, MFG_ROLES.PRODUCTION_HEAD],
  },
  {
    section: "setup",
    label: "Workstations",
    pathSuffix: "/workstations",
    roles: [MFG_ROLES.PRODUCTION_HEAD, MFG_ROLES.SUPERVISOR],
  },
];

/**
 * Resolve primary manufacturing role from Frappe role list (bench parity).
 * @param {string[]} roles
 * @returns {string | null}
 */
export function resolveManufacturingRole(roles = []) {
  const set = new Set(roles);
  if (set.has("System Manager") || set.has("Administrator")) {
    return MFG_ROLES.PRODUCTION_HEAD;
  }
  for (const r of ROLE_PRIORITY) {
    if (set.has(r)) return r;
  }
  return null;
}

function itemAllowed(item, mfgRole) {
  if (item.roles === "all") return true;
  if (!mfgRole) return false;
  return item.roles.includes(mfgRole);
}

function itemToNav(item) {
  const to = item.pathSuffix ? mfgPath(item.pathSuffix) : mfgPath();
  return {
    to,
    label: item.label,
    short: item.label,
    ...(item.end ? { end: true } : {}),
  };
}

/**
 * Sidebar sections for portal Layout (SidebarProjectNav shape).
 * @param {string | null} mfgRole
 * @returns {import('../../common/constants/moduleNavigation.js').NavSection[]}
 */
export function getManufacturingNavSections(mfgRole) {
  const visible = NAV_ITEMS.filter((item) => itemAllowed(item, mfgRole));
  const bySection = new Map();

  for (const item of visible) {
    if (!bySection.has(item.section)) {
      bySection.set(item.section, []);
    }
    bySection.get(item.section).push(itemToNav(item));
  }

  return Object.keys(SECTION_META)
    .filter((id) => bySection.has(id) && bySection.get(id).length > 0)
    .map((id) => ({
      id,
      label: SECTION_META[id].label,
      items: bySection.get(id),
    }));
}

/** Allowed path prefixes for role-based route guard */
export function getAllowedManufacturingPaths(mfgRole) {
  return NAV_ITEMS.filter((item) => itemAllowed(item, mfgRole)).map((item) =>
    item.pathSuffix ? mfgPath(item.pathSuffix) : mfgPath()
  );
}

/**
 * @param {string} pathname
 * @param {string | null} mfgRole
 */
export function isManufacturingPathAllowed(pathname, mfgRole) {
  const path = pathname || "";
  if (!path.startsWith("/manufacturing")) return true;
  if (!mfgRole) return false;

  const allowed = getAllowedManufacturingPaths(mfgRole);
  const normalized = path.replace(/\/$/, "") || "/manufacturing";

  const pathOk = allowed.some((base) => {
    const b = base.replace(/\/$/, "") || "/manufacturing";
    if (normalized === b) return true;
    if (normalized.startsWith(`${b}/`)) return true;
    return false;
  });
  if (!pathOk) return false;

  return isManufacturingWritePathAllowed(pathname, mfgRole);
}

/** Write-only routes (e.g. create work order) — read roles cannot open. */
export function isManufacturingWritePathAllowed(pathname, mfgRole) {
  const path = (pathname || "").replace(/\/$/, "");
  if (path === "/manufacturing/work-orders/new") {
    return mfgRole === MFG_ROLES.PRODUCTION_HEAD;
  }
  return true;
}

export function hasManufacturingPortalAccess(roles = []) {
  return resolveManufacturingRole(roles) != null;
}
