export const FINANCE_ROLE = {
  CFO: "CFO",
  FINANCE_MANAGER: "Finance Manager",
  TREASURY_MANAGER: "Treasury Manager",
  AR_EXEC: "Account Receivable Executive",
  AP_EXEC: "Account Payable Executive",
  AUDITOR: "Auditor",
};

/** ERPNext roles treated as Finance Manager for portal access. */
const ERP_FINANCE_MANAGER_ALIASES = new Set(["Accounts Manager"]);

/** Frappe role names that map to portal finance roles. */
const FINANCE_ROLE_ALIASES = {
  "Accounts Receivable Executive": FINANCE_ROLE.AR_EXEC,
  "Accounts Payable Executive": FINANCE_ROLE.AP_EXEC,
};

const ADMIN_ROLES = new Set(["Administrator", "System Manager"]);

const ROLE_PRIORITY = [
  FINANCE_ROLE.CFO,
  FINANCE_ROLE.FINANCE_MANAGER,
  FINANCE_ROLE.TREASURY_MANAGER,
  FINANCE_ROLE.AR_EXEC,
  FINANCE_ROLE.AP_EXEC,
  FINANCE_ROLE.AUDITOR,
];

const FULL_ACCESS_ROLES = new Set([FINANCE_ROLE.CFO, FINANCE_ROLE.FINANCE_MANAGER]);

/** P&L, Balance Sheet, Cash Flow, GST/TDS — read-focused reporting roles. */
export const FINANCE_REPORT_ROLES = [
  FINANCE_ROLE.CFO,
  FINANCE_ROLE.FINANCE_MANAGER,
  FINANCE_ROLE.AUDITOR,
  FINANCE_ROLE.TREASURY_MANAGER,
];

export function normalizeFinanceRole(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw === "Accounts Manager") return FINANCE_ROLE.FINANCE_MANAGER;
  if (FINANCE_ROLE_ALIASES[raw]) return FINANCE_ROLE_ALIASES[raw];
  const hit = Object.values(FINANCE_ROLE).find((label) => label.toLowerCase() === raw.toLowerCase());
  return hit || null;
}

/**
 * Resolve primary finance role from Frappe role list.
 * @param {string[]} roles
 * @param {string | null} [user] — Frappe session user (Administrator → Finance Manager)
 * @returns {string | null}
 */
export function resolveFinanceRole(roles = [], user = null) {
  if (user === "Administrator") {
    return FINANCE_ROLE.FINANCE_MANAGER;
  }
  const set = new Set((roles || []).map((r) => String(r || "").trim()).filter(Boolean));
  if (set.has("System Manager") || set.has("Administrator")) {
    return FINANCE_ROLE.FINANCE_MANAGER;
  }
  for (const role of ROLE_PRIORITY) {
    if (set.has(role)) return role;
  }
  for (const alias of ERP_FINANCE_MANAGER_ALIASES) {
    if (set.has(alias)) return FINANCE_ROLE.FINANCE_MANAGER;
  }
  for (const [alias, mapped] of Object.entries(FINANCE_ROLE_ALIASES)) {
    if (set.has(alias)) return mapped;
  }
  return null;
}

/** Payment entry form: sales = customer receive, purchase = vendor pay. */
export function paymentEntryTypesForRole(financeRole) {
  if (financeRole === FINANCE_ROLE.AR_EXEC) return ["sales"];
  if (financeRole === FINANCE_ROLE.AP_EXEC) return ["purchase"];
  return ["sales", "purchase"];
}

const FULL_DASHBOARD_CONFIG = {
  kpiKeys: [
    "total_income",
    "total_expense",
    "net_profit",
    "total_receivable",
    "total_payable",
    "overdue_receivable",
  ],
  kpiLabels: {},
  revenueChartTitle: "Revenue vs Expense (6 months)",
  showRevenueOnChart: true,
  showExpenseOnChart: true,
  showInvoiceStatus: true,
  invoiceStatusTitle: "Invoice Status",
  statusDistributionKey: "status_distribution",
  showTopCustomers: true,
  showTopSuppliers: true,
};

const AR_DASHBOARD_CONFIG = {
  kpiKeys: ["total_receivable", "overdue_receivable", "total_income"],
  kpiLabels: { total_income: "Customer Billing" },
  revenueChartTitle: "Customer Revenue (6 months)",
  showRevenueOnChart: true,
  showExpenseOnChart: false,
  showInvoiceStatus: true,
  invoiceStatusTitle: "Sales Invoice Status",
  statusDistributionKey: "status_distribution",
  showTopCustomers: true,
  showTopSuppliers: false,
};

const AP_DASHBOARD_CONFIG = {
  kpiKeys: ["total_payable", "overdue_payable", "total_expense"],
  kpiLabels: { total_expense: "Vendor Billing", overdue_payable: "Overdue Payable" },
  revenueChartTitle: "Vendor Bills (6 months)",
  showRevenueOnChart: false,
  showExpenseOnChart: true,
  showInvoiceStatus: true,
  invoiceStatusTitle: "Supplier Invoice Status",
  statusDistributionKey: "purchase_status_distribution",
  showTopCustomers: false,
  showTopSuppliers: true,
};

/** Read-only oversight: full P&L, AR/AP exposure, both invoice mixes, GL activity. */
const AUDITOR_DASHBOARD_CONFIG = {
  kpiKeys: [
    "total_income",
    "total_expense",
    "net_profit",
    "total_receivable",
    "total_payable",
    "overdue_receivable",
    "overdue_payable",
  ],
  kpiLabels: {
    overdue_receivable: "Overdue Receivable",
    overdue_payable: "Overdue Payable",
  },
  revenueChartTitle: "Revenue vs Expense (6 months)",
  showRevenueOnChart: true,
  showExpenseOnChart: true,
  showInvoiceStatus: true,
  invoiceStatusTitle: "Sales Invoice Status",
  statusDistributionKey: "status_distribution",
  showSecondaryInvoiceStatus: true,
  secondaryInvoiceStatusTitle: "Supplier Invoice Status",
  secondaryStatusDistributionKey: "purchase_status_distribution",
  showTopCustomers: true,
  showTopSuppliers: true,
  showRecentEntries: true,
  recentEntriesTitle: "Recent GL Activity",
  kpiRows: [4, 3],
  chartLayout: "triple",
};

/** Cash, liquidity, and payment focus for treasury operations. */
const TREASURY_DASHBOARD_CONFIG = {
  kpiKeys: [
    "cash_balance",
    "total_receivable",
    "total_payable",
    "overdue_receivable",
    "overdue_payable",
    "unreconciled_bank_count",
  ],
  kpiLabels: {
    cash_balance: "Cash & Bank Balance",
    overdue_receivable: "Overdue Receivable",
    overdue_payable: "Overdue Payable",
    unreconciled_bank_count: "Unreconciled Bank Lines",
  },
  revenueChartTitle: "Cash Inflow vs Outflow (6 months)",
  chartRevenueName: "Inflows",
  chartExpenseName: "Outflows",
  showRevenueOnChart: true,
  showExpenseOnChart: true,
  showInvoiceStatus: false,
  showTopCustomers: true,
  showTopSuppliers: true,
  showRecentEntries: true,
  recentEntriesTitle: "Recent Bank & Cash Activity",
  recentEntriesKey: "recent_bank_entries",
  kpiRows: [3, 3],
  chartLayout: "single",
};

/** Dashboard widgets visible per finance role. */
export function dashboardConfigForRole(financeRole) {
  if (financeRole === FINANCE_ROLE.AR_EXEC) {
    return AR_DASHBOARD_CONFIG;
  }
  if (financeRole === FINANCE_ROLE.AP_EXEC) {
    return AP_DASHBOARD_CONFIG;
  }
  if (financeRole === FINANCE_ROLE.AUDITOR) {
    return AUDITOR_DASHBOARD_CONFIG;
  }
  if (financeRole === FINANCE_ROLE.TREASURY_MANAGER) {
    return TREASURY_DASHBOARD_CONFIG;
  }
  return FULL_DASHBOARD_CONFIG;
}

/** List filter options for payment entries by role. */
export function paymentFilterOptionsForRole(financeRole) {
  if (financeRole === FINANCE_ROLE.AR_EXEC) {
    return [
      { value: "", label: "All" },
      { value: "Receive", label: "Receive" },
    ];
  }
  if (financeRole === FINANCE_ROLE.AP_EXEC) {
    return [
      { value: "", label: "All" },
      { value: "Pay", label: "Pay" },
    ];
  }
  return [
    { value: "", label: "All Types" },
    { value: "Receive", label: "Receive" },
    { value: "Pay", label: "Pay" },
  ];
}

export function hasFinancePortalAccess(roles = [], user = null) {
  return resolveFinanceRole(roles, user) != null;
}

export function isFullFinanceAccessRole(role) {
  return FULL_ACCESS_ROLES.has(role);
}

export function roleInFinance(role, allowedRoles = []) {
  const normalized = resolveFinanceRole([role]) || normalizeFinanceRole(role);
  if (!normalized) return false;
  return allowedRoles.includes(normalized);
}

/**
 * FM approval ceilings in INR. CFO has no limit.
 * Mirrors finance_app.api.permissions.APPROVAL_LIMITS_INR.
 */
export const APPROVAL_LIMITS_INR = {
  "Payment Entry": 500000,
  "Purchase Invoice": 1000000,
  "Sales Invoice": 1000000,
  "Journal Entry": 200000,
};

/** Approval ceiling for role + doctype (Infinity = no limit for CFO). */
export function approvalLimitForRole(financeRole, doctype) {
  if (financeRole === FINANCE_ROLE.CFO) return Infinity;
  if (financeRole === FINANCE_ROLE.AUDITOR) return 0;
  const limit = APPROVAL_LIMITS_INR[doctype];
  return limit == null ? 0 : limit;
}

/** Whether role may approve/submit this amount (inclusive at limit). */
export function canApproveAmount(financeRole, doctype, amount) {
  const amt = Number(amount) || 0;
  if (financeRole === FINANCE_ROLE.CFO) return true;
  if (financeRole === FINANCE_ROLE.AUDITOR) return false;
  const limit = APPROVAL_LIMITS_INR[doctype];
  if (limit == null || limit <= 0) return false;
  return amt <= limit;
}

/** True when amount is above FM limit and CFO must approve (Part 2+). */
export function needsCfoApproval(financeRole, doctype, amount) {
  if (financeRole === FINANCE_ROLE.CFO || financeRole === FINANCE_ROLE.AUDITOR) return false;
  const amt = Number(amount) || 0;
  const limit = APPROVAL_LIMITS_INR[doctype];
  if (limit == null) return amt > 0;
  return amt > limit;
}

const FULL_ACTIONS = {
  canCreate: true,
  canEdit: true,
  canSubmit: true,
  canApprove: true,
  canDelete: true,
  readOnly: false,
  canCreateSalesChain: true,
  canCreatePurchaseChain: true,
  canRecordPayment: true,
};

const READ_ONLY_ACTIONS = {
  canCreate: false,
  canEdit: false,
  canSubmit: false,
  canApprove: false,
  canDelete: false,
  readOnly: true,
  canCreateSalesChain: false,
  canCreatePurchaseChain: false,
  canRecordPayment: false,
};

/** Portal action flags by finance role (expand in later phases). */
export function allowedActionsByRole(role) {
  const normalized = normalizeFinanceRole(role) || role;
  if (FULL_ACCESS_ROLES.has(normalized)) {
    return FULL_ACTIONS;
  }
  if (normalized === FINANCE_ROLE.AUDITOR) {
    return READ_ONLY_ACTIONS;
  }
  if (normalized === FINANCE_ROLE.AR_EXEC) {
    return {
      canCreate: true,
      canEdit: true,
      canSubmit: true,
      canApprove: false,
      canDelete: false,
      readOnly: false,
      canCreateSalesChain: true,
      canCreatePurchaseChain: false,
      canRecordPayment: true,
    };
  }
  if (normalized === FINANCE_ROLE.AP_EXEC) {
    return {
      canCreate: true,
      canEdit: true,
      canSubmit: true,
      canApprove: false,
      canDelete: false,
      readOnly: false,
      canCreateSalesChain: false,
      canCreatePurchaseChain: true,
      canRecordPayment: true,
    };
  }
  if (normalized === FINANCE_ROLE.TREASURY_MANAGER) {
    return {
      canCreate: true,
      canEdit: true,
      canSubmit: true,
      canApprove: false,
      canDelete: false,
      readOnly: false,
      canCreateSalesChain: false,
      canCreatePurchaseChain: false,
      canRecordPayment: true,
    };
  }
  return FULL_ACTIONS;
}
