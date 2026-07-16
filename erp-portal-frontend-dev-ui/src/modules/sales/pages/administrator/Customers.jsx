import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { HiOutlineUsers } from "react-icons/hi2";
import api from "../../lib/apiUtils";
import ListFilters from "../../../../common/components/ListFilters.jsx";
import ListPagination from "../../../../common/components/ListPagination.jsx";
import usePagedRows from "../../../../common/hooks/usePagedRows.js";
import { SALES_PAGE_SIZE_OPTIONS } from "../../lib/pagination.js";
import SalesPageLoader from "../../components/SalesPageLoader.jsx";
import SalesEmptyState from "../../components/SalesEmptyState.jsx";
import SalesKpiCard from "../../components/SalesKpiCard.jsx";
import ConfirmDeleteModal from "../../components/ConfirmDeleteModal.jsx";
import SalesDetailModal from "../../components/SalesDetailModal.jsx";
import SalesModalFooter from "../../components/SalesModalFooter.jsx";
import { SALES_COLORS as C } from "../../theme/tokens.js";
import useSalesToast, { SalesToast } from "../../components/useSalesToast.jsx";
import { useSalesAuth } from "../../hooks/useSalesAuth.js";
import { toFriendlyError } from "../../lib/apiUtils";

const tealLt = C.tealLt;
const emeraldLt = C.emeraldLt;
const blueLt = C.blueLt;
const amberLt = C.amberLt;
const redLt = C.redLt;
const purpleLt = C.purpleLt;

const AVATAR_COLORS = [
  [C.tealLt, C.teal], [C.blueLt, C.blue], [C.purpleLt, C.purple],
  [C.amberLt, C.amber], [C.indigoLt, C.indigo], [C.greenLt, C.green],
  [C.redLt, C.red], [C.cyanLt, C.cyan],
];
const getAvatar = (name = "") => AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
const initials  = (name = "") => name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
// In Frappe, customer_name = display name, name = doc ID. Always prefer customer_name.
const dispName  = (c) => c?.customer_name || c?.display_name || c?.name || "";
/** Email on Customer doc or linked Contact (API may use email_id or email). */
const resolveCustomerEmail = (c) => {
  if (!c) return "";
  const raw = c.email_id || c.email || "";
  return String(raw).trim();
};

/** API totals from Sales Orders (count + grand_total sum). */
const normalizeCustomerRow = (c) => ({
  ...c,
  total_orders: Number(c?.total_orders) || 0,
  total_business: Number(c?.total_business) || 0,
});

const TOP_CUSTOMERS_LIMIT = 5;

const fmtK = (n) => {
  n = Number(n || 0);
  if (n >= 1e7) return `₹${(n/1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n/1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${(n/1e3).toFixed(0)}k`;
  return `₹${n}`;
};

const fmt = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN")}`;

const MOBILE_PREFIX = "+91";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const PAN_PATTERN = /^[A-Z]{5}\d{4}[A-Z]$/;
const AADHAR_PATTERN = /^\d{12}$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/i;
const PIN_PATTERN = /^\d{6}$/;

const initForm = {
  customer_name: "",
  customer_type: "Company",
  customer_group: "",
  territory: "",
  lead_id: "",
  ownership: "",
  email_id: "",
  mobile_no: "",
  website: "",
  pan: "",
  aadhar: "",
  bank_name: "",
  bank_account: "",
  bank_ifsc: "",
  payment_terms: "",
  credit_limit: "",
  tax_id: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  pincode: "",
  country: "India",
};

function extractPhoneDigits(value) {
  const raw = String(value || "").replace(/\D/g, "");
  if (!raw) return "";
  if (raw.startsWith("91") && raw.length >= 12) return raw.slice(2, 12);
  return raw.slice(0, 10);
}

function formatPhoneForApi(phoneDigits) {
  const digits = extractPhoneDigits(phoneDigits);
  return digits ? `${MOBILE_PREFIX}${digits}` : "";
}

function maskLastFour(value) {
  const s = String(value || "").replace(/\s/g, "");
  if (!s) return "";
  if (s.length <= 4) return "•".repeat(s.length);
  return `${"•".repeat(Math.min(s.length - 4, 8))}${s.slice(-4)}`;
}

function normalizePan(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

function normalizeAadhar(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 12);
}

function validateCustomerForm(form, { isCreate = false } = {}) {
  const errors = {};
  const requireField = (key, value, message) => {
    if (!value) errors[key] = message;
  };

  const name = String(form.customer_name || "").trim();
  const leadId = String(form.lead_id || "").trim();
  const ownership = String(form.ownership || "").trim();
  const group = String(form.customer_group || "").trim();
  const territory = String(form.territory || "").trim();
  const paymentTerms = String(form.payment_terms || "").trim();
  const pan = normalizePan(form.pan);
  const aadhar = normalizeAadhar(form.aadhar);
  const bankName = String(form.bank_name || "").trim();
  const bankAccount = String(form.bank_account || "").replace(/\D/g, "");
  const ifsc = String(form.bank_ifsc || "").trim().toUpperCase();
  const email = String(form.email_id || "").trim();
  const mobileDigits = extractPhoneDigits(form.mobile_no);
  const street = String(form.address_line1 || "").trim();
  const city = String(form.city || "").trim();
  const state = String(form.state || "").trim();
  const pincode = String(form.pincode || "").replace(/\D/g, "");
  const country = String(form.country || "").trim();

  if (!name) errors.customer_name = "Customer name is required.";

  if (!isCreate) return errors;

  requireField("lead_id", leadId, "Lead ID is required.");
  requireField("ownership", ownership, "Ownership is required.");
  requireField("customer_group", group, "Customer group is required.");
  requireField("territory", territory, "Territory is required.");
  requireField("payment_terms", paymentTerms, "Payment terms are required.");

  if (!pan) {
    errors.pan = "PAN is required.";
  } else if (!PAN_PATTERN.test(pan)) {
    errors.pan = "Enter a valid PAN (e.g. ABCDE1234F).";
  }

  if (!aadhar) {
    errors.aadhar = "Aadhar is required.";
  } else if (!AADHAR_PATTERN.test(aadhar)) {
    errors.aadhar = "Aadhar must be exactly 12 digits.";
  }

  requireField("bank_name", bankName, "Bank name is required.");
  if (!bankAccount) {
    errors.bank_account = "Bank account number is required.";
  }
  if (!ifsc) {
    errors.bank_ifsc = "IFSC code is required.";
  } else if (!IFSC_PATTERN.test(ifsc)) {
    errors.bank_ifsc = "Enter a valid IFSC code (e.g. HDFC0001234).";
  }

  if (!email) {
    errors.email_id = "Email is required.";
  } else if (/^\d+$/.test(email)) {
    errors.email_id = "Enter a valid email address, not numbers only.";
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email_id = "Enter a valid email address (e.g. name@example.com).";
  }

  if (!mobileDigits) {
    errors.mobile_no = "Mobile number is required.";
  } else if (mobileDigits.length !== 10) {
    errors.mobile_no = "Mobile number must be exactly 10 digits after +91.";
  }

  requireField("address_line1", street, "Billing street is required.");
  requireField("city", city, "City is required.");
  requireField("state", state, "State is required.");
  requireField("country", country, "Country is required.");
  if (!pincode) {
    errors.pincode = "Pincode is required.";
  } else if (!PIN_PATTERN.test(pincode)) {
    errors.pincode = "Pincode must be exactly 6 digits.";
  }

  return errors;
}

function firstCustomerFormTabWithErrors(errors) {
  const basic = ["customer_name", "lead_id", "ownership", "customer_group", "territory", "payment_terms", "credit_limit"];
  const tax = ["pan", "aadhar", "bank_name", "bank_account", "bank_ifsc"];
  const contact = ["email_id", "mobile_no"];
  const billing = ["address_line1", "city", "state", "pincode", "country"];
  if (basic.some((k) => errors[k])) return "basic";
  if (tax.some((k) => errors[k])) return "tax";
  if (contact.some((k) => errors[k])) return "contact";
  if (billing.some((k) => errors[k])) return "billing";
  return "basic";
}

function custForEdit(cust) {
  if (!cust) return null;
  return {
    name: cust.name,
    customer_name: cust.customer_name || "",
    customer_type: cust.customer_type || "Company",
    customer_group: cust.customer_group || "",
    territory: cust.territory || "",
    lead_id: cust.lead_id || "",
    ownership: cust.ownership || "",
    email_id: resolveCustomerEmail(cust),
    mobile_no: extractPhoneDigits(cust.mobile_no),
    website: cust.website || "",
    pan: cust.pan || "",
    aadhar: cust.aadhar || "",
    bank_name: cust.bank_name || "",
    bank_account: cust.bank_account || "",
    bank_ifsc: cust.bank_ifsc || "",
    payment_terms: cust.payment_terms || "",
    credit_limit: cust.credit_limit || "",
    tax_id: cust.tax_id || "",
    address_line1: cust.address_line1 || "",
    address_line2: cust.address_line2 || "",
    city: cust.city || "",
    state: cust.state || "",
    pincode: cust.pincode || "",
    country: cust.country || "India",
  };
}

function customerPayload(form) {
  return {
    ...form,
    pan: normalizePan(form.pan),
    aadhar: normalizeAadhar(form.aadhar),
    bank_ifsc: String(form.bank_ifsc || "").trim().toUpperCase(),
    mobile_no: formatPhoneForApi(form.mobile_no),
    pincode: String(form.pincode || "").replace(/\D/g, ""),
  };
}

/** Headers for export / import template (order matches sample CSV). */
const CUSTOMER_CSV_HEADERS = [
  "customer_name",
  "customer_id",
  "customer_type",
  "customer_group",
  "territory",
  "email_id",
  "mobile_no",
  "website",
  "tax_id",
  "payment_terms",
  "credit_limit",
  "address_line1",
  "city",
  "state",
  "pincode",
  "country",
  "total_orders",
  "total_business",
];

function escapeCsvField(val) {
  const s = val == null ? "" : String(val);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function customersToCsv(rows) {
  const head = CUSTOMER_CSV_HEADERS.map(escapeCsvField).join(",");
  const body = rows.map((r) =>
    CUSTOMER_CSV_HEADERS.map((h) => escapeCsvField(r[h] ?? "")).join(",")
  ).join("\r\n");
  return `${head}\r\n${body}\r\n`;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function normalizeCsvHeader(h) {
  return String(h || "")
    .trim()
    .replace(/^\ufeff/, "")
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function parseCustomerCsvRows(text) {
  const raw = String(text || "").split(/\r?\n/).filter((ln) => ln.length > 0);
  if (!raw.length) return [];
  const headers = parseCsvLine(raw[0]).map(normalizeCsvHeader);
  const rows = [];
  for (let i = 1; i < raw.length; i++) {
    const cells = parseCsvLine(raw[i]);
    const o = {};
    headers.forEach((h, j) => {
      o[h] = (cells[j] ?? "").trim();
    });
    rows.push(o);
  }
  return rows;
}

function pickCustomerRowField(row, keys) {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function csvRowToCreatePayload(row) {
  const customer_name = pickCustomerRowField(row, [
    "customer_name",
    "name",
    "customer",
    "company_name",
    "company",
  ]);
  return {
    customer_name,
    customer_type: pickCustomerRowField(row, ["customer_type", "type"]) || "Company",
    customer_group: pickCustomerRowField(row, ["customer_group", "group"]),
    territory: pickCustomerRowField(row, ["territory"]) || "All Territories",
    email_id: pickCustomerRowField(row, ["email_id", "email"]),
    mobile_no: pickCustomerRowField(row, ["mobile_no", "mobile", "phone"]),
    website: pickCustomerRowField(row, ["website"]),
    tax_id: pickCustomerRowField(row, ["tax_id", "gstin", "gst"]),
    payment_terms: pickCustomerRowField(row, ["payment_terms"]),
    credit_limit: pickCustomerRowField(row, ["credit_limit"]),
    address_line1: pickCustomerRowField(row, ["address_line1", "address", "street"]),
    city: pickCustomerRowField(row, ["city"]),
    state: pickCustomerRowField(row, ["state"]),
    pincode: pickCustomerRowField(row, ["pincode", "zip", "postal_code"]),
    country: pickCustomerRowField(row, ["country"]) || "India",
  };
}

function stripHtml(text) {
  if (!text) return "";
  if (typeof document !== "undefined") {
    const el = document.createElement("div");
    el.innerHTML = String(text);
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }
  return String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function frappeErrorMessage(err, fallback = "Request failed") {
  const m = err?.response?.data?.message;
  let raw = "";
  if (typeof m === "string") raw = m;
  else if (Array.isArray(m)) {
    raw = m.map((x) => (typeof x === "string" ? x : x?.message || "")).filter(Boolean).join(" ");
  } else if (m && typeof m === "object" && m.message) {
    raw = String(m.message);
  } else {
    raw = err?.message || fallback;
  }
  return stripHtml(raw) || fallback;
}

function normalizeOwnershipUsers(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const u of list) {
    if (!u || typeof u !== "object") continue;
    const name = String(u.name || "").trim();
    if (!name || name === "Guest" || seen.has(name)) continue;
    seen.add(name);
    const label = String(u.label || u.full_name || u.email || name).trim() || name;
    out.push({ name, label });
  }
  return out;
}

function pickOwnershipUsers(...sources) {
  for (const source of sources) {
    const normalized = normalizeOwnershipUsers(source);
    if (normalized.length) return normalized;
  }
  return [];
}

function parseApiPayload(res) {
  const msg = res?.data?.message;
  if (msg && typeof msg === "object" && msg.status) return msg;
  return { status: "success", message: typeof msg === "string" ? msg : "" };
}

function downloadCsvBlob(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const CUSTOMER_CSV_SAMPLE_ROW = {
  customer_name: "Sample Company Ltd",
  customer_id: "",
  customer_type: "Company",
  customer_group: "Commercial",
  territory: "All Territories",
  email_id: "contact@example.com",
  mobile_no: "9876543210",
  website: "https://example.com",
  tax_id: "",
  payment_terms: "",
  credit_limit: "0",
  address_line1: "123 Business Park",
  city: "Mumbai",
  state: "Maharashtra",
  pincode: "400001",
  country: "India",
  total_orders: "0",
  total_business: "0",
};

function downloadSampleCustomerCsv() {
  downloadCsvBlob("customers_import_sample.csv", customersToCsv([CUSTOMER_CSV_SAMPLE_ROW]));
}

/** KPI drill ids — logic aligned with sales_app.api.customer.dashboard_data (Sales Order totals). */
const KPI_SPECS = [
  { id: "total",   label: "Total Customers",  accent: C.teal,    icon: "users",   sub: "All registered" },
  { id: "active",  label: "Active Customers", accent: C.emerald, icon: "check",   sub: "With sales orders" },
  { id: "revenue", label: "Total Revenue",    accent: C.blue,    icon: "sales",   sub: "Customers with order value" },
  { id: "avg",     label: "Avg. Revenue",     accent: C.amber,   icon: "chart",   sub: "At or above average" },
];

function buildDashFromCustomers(customers) {
  if (!customers?.length) return null;

  const total_revenue = customers.reduce((s, c) => s + (Number(c.total_business) || 0), 0);
  const active_customers = customers.filter((c) => (Number(c.total_business) || 0) > 0).length;

  const top_customers = [...customers]
    .map((c) => ({
      name: c.customer_name || c.name,
      id: c.name,
      revenue: Number(c.total_business) || 0,
      type: c.customer_type || "",
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, TOP_CUSTOMERS_LIMIT);

  return {
    total_customers: customers.length,
    active_customers,
    total_revenue,
    avg_revenue: active_customers ? Math.round(total_revenue / active_customers) : 0,
    top_customers,
    group_data: [],
    recent_customers: [],
  };
}

function kpiDisplayValue(spec, dash) {
  if (!dash) return "—";
  if (spec.id === "total") return dash.total_customers ?? 0;
  if (spec.id === "active") return dash.active_customers ?? 0;
  if (spec.id === "revenue") return fmtK(dash.total_revenue ?? 0);
  if (spec.id === "avg") return fmtK(dash.avg_revenue ?? 0);
  return "—";
}

/* ─── Card ───────────────────────────────────────────────────── */
const Card = ({ title, children, flexClass, action, compact }) => (
  <div className={`cu-card${flexClass ? ` ${flexClass}` : ""}${compact ? " cu-card-compact" : ""}`}>
    {title && (
      <div className="cu-card-hd">
        <span className="cu-card-title">{title}</span>
        {action}
      </div>
    )}
    <div className={compact ? "cu-card-body-sm" : "cu-card-body"}>{children}</div>
  </div>
);

/* ─── Toast ──────────────────────────────────────────────────── */

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════ */
export default function CustomerDashboard() {
  const { user } = useSalesAuth();
  const [dash, setDash]         = useState(null);
  const [customers, setCustomers] = useState([]);
  const [opts, setOpts]         = useState({
    customer_type: [], customer_group: [], territory: [], payment_terms: [], currency: [],
    leads: [], users: [],
  });
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [viewCust, setViewCust] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [editCust, setEditCust] = useState(null);
  const [form, setForm]         = useState(initForm);
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving]     = useState(false);
  const [activeTab, setActiveTab] = useState("basic");
  const [formUserOptions, setFormUserOptions] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteLinkError, setDeleteLinkError] = useState(null);
  const [pageSize, setPageSize] = useState(10);
  const [importing, setImporting] = useState(false);
  const tableRef = useRef(null);
  const csvFileRef = useRef(null);
  const csvMenuRef = useRef(null);

  const closeCsvMenu = () => {
    if (csvMenuRef.current) csvMenuRef.current.open = false;
  };

  const { toast, showToast } = useSalesToast(3200);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dR, cR, oR, oppOptsR, usersR] = await Promise.all([
        api.get("/api/method/sales_app.api.customer.dashboard_data"),
        api.get("/api/method/sales_app.api.customer.get_customers"),
        api.get("/api/method/sales_app.api.customer.get_options"),
        api.get("/api/method/sales_app.api.opportunity.get_options").catch(() => ({ data: {} })),
        api.get("/api/method/sales_app.api.customer.get_ownership_users").catch(() => ({ data: { message: [] } })),
      ]);
      const list = (cR.data.message || []).map(normalizeCustomerRow);
      setCustomers(list);
      const apiDash = dR.data.message;
      if (apiDash?.total_customers > 0) {
        setDash(apiDash);
      } else {
        setDash(buildDashFromCustomers(list) || apiDash);
      }
      const customerOpts = oR.data.message || {};
      const oppOpts = oppOptsR?.data?.message || {};
      const ownershipUsers = pickOwnershipUsers(
        usersR.data?.message,
        customerOpts.users,
        oppOpts.users,
      );
      setOpts({
        customer_type: [],
        customer_group: [],
        territory: [],
        payment_terms: [],
        currency: [],
        ...customerOpts,
        leads: (customerOpts.leads?.length ? customerOpts.leads : oppOpts.leads) || [],
        users: ownershipUsers,
      });
    } catch (err) {
      showToast(frappeErrorMessage(err, "Failed to load customers."), "error");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const post = (url, data) => {
    const p = new URLSearchParams();
    Object.entries(data).forEach(([k, v]) => { if (v !== "" && v != null) p.append(k, v); });
    return api.post(url, p, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  };

  const openNewCustomerModal = async () => {
    let leadOptions = opts.leads || [];
    let userOptions = opts.users || [];
    try {
      const [custRes, oppRes, usersRes] = await Promise.all([
        api.get("/api/method/sales_app.api.customer.get_options"),
        api.get("/api/method/sales_app.api.opportunity.get_options").catch(() => ({ data: {} })),
        api.get("/api/method/sales_app.api.customer.get_ownership_users"),
      ]);
      const custOpts = custRes.data?.message || {};
      const oppOpts = oppRes.data?.message || {};
      if (custOpts.leads?.length || oppOpts.leads?.length) {
        leadOptions = custOpts.leads?.length ? custOpts.leads : (oppOpts.leads || []);
      }
      userOptions = pickOwnershipUsers(
        usersRes.data?.message,
        custOpts.users,
        oppOpts.users,
        userOptions,
      );
      setOpts((prev) => ({
        ...prev,
        leads: leadOptions,
        users: userOptions,
      }));
    } catch (err) {
      showToast(frappeErrorMessage(err, "Could not load customer form options."), "error");
    }
    if (!userOptions.length) {
      showToast("Ownership list is empty. Restart bench (bench restart) and ensure enabled users exist.", "error");
    }
    const defaultGroup = opts.customer_group?.find((g) => g && g !== "All Customer Groups")
      ?? opts.customer_group?.[0]
      ?? "";
    const ownershipDefault = userOptions.some((u) => u.name === user) ? user : "";
    setFormUserOptions(userOptions);
    setFormErrors({});
    setForm({
      ...initForm,
      customer_group: defaultGroup,
      territory: opts.territory?.[0] ?? "",
      payment_terms: opts.payment_terms?.[0] ?? "",
      ownership: ownershipDefault,
    });
    setActiveTab("basic");
    setShowForm(true);
  };

  const handleCreateFieldChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (formErrors[name]) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const saveCust = async () => {
    const errors = validateCustomerForm(form, { isCreate: true });
    setFormErrors(errors);
    if (Object.keys(errors).length) {
      setActiveTab(firstCustomerFormTabWithErrors(errors));
      showToast("Please fill all required fields. Website and credit limit are optional.", "error");
      return;
    }
    setSaving(true);
    try {
      await post("/api/method/sales_app.api.customer.create_customer", customerPayload(form));
      setShowForm(false);
      setForm(initForm);
      setFormErrors({});
      await loadAll();
      showToast("Customer created successfully!");
    } finally { setSaving(false); }
  };

  const updateCust = async () => {
    if (!editCust) return;
    setSaving(true);
    try {
      await post("/api/method/sales_app.api.customer.update_customer", customerPayload(editCust));
      setEditCust(null);
      await loadAll();
      showToast("Customer updated!");
    } finally { setSaving(false); }
  };

  const closeDeleteModal = (force = false) => {
    if (!force && deleteLoading) return;
    setDeleteTarget(null);
    setDeleteLinkError(null);
  };

  const confirmDeleteCustomer = async () => {
    if (!deleteTarget?.id) return;
    setDeleteLoading(true);
    setDeleteLinkError(null);
    try {
      const res = await post("/api/method/sales_app.api.customer.delete_customer", { name: deleteTarget.id });
      const payload = parseApiPayload(res);
      if (payload.status === "linked") {
        setDeleteLinkError(payload.message || "Customer is linked to other documents.");
        return;
      }
      closeDeleteModal(true);
      await loadAll();
      showToast("Customer deleted.", "error");
    } catch (err) {
      const msg = frappeErrorMessage(err, "Unable to delete customer.");
      if (/linked|cannot delete|disable this customer/i.test(msg)) {
        setDeleteLinkError(msg);
      } else {
        showToast(msg, "error");
      }
    } finally {
      setDeleteLoading(false);
    }
  };

  const disableCustomerInstead = async () => {
    if (!deleteTarget?.id) return;
    setDeleteLoading(true);
    try {
      await post("/api/method/sales_app.api.customer.disable_customer", { name: deleteTarget.id });
      closeDeleteModal(true);
      await loadAll();
      showToast("Customer disabled (hidden from new transactions in ERPNext).");
    } catch (err) {
      showToast(frappeErrorMessage(err, "Unable to disable customer."), "error");
    } finally {
      setDeleteLoading(false);
    }
  };

  const openView = async (name) => {
    setViewLoading(true);
    try {
      const res = await api.get("/api/method/sales_app.api.customer.get_customer", { params: { name } });
      const fromList = customers.find((c) => c.name === name);
      setViewCust({
        ...(fromList ? normalizeCustomerRow(fromList) : {}),
        ...res.data.message,
      });
    } finally { setViewLoading(false); }
  };

  const effectiveDash = useMemo(() => {
    if (dash?.total_customers > 0) return dash;
    return buildDashFromCustomers(customers) || dash;
  }, [dash, customers]);

  const filtered = useMemo(() => customers.filter((c) => {
    const ms = [c.customer_name, c.name, c.customer_group, c.territory, resolveCustomerEmail(c), c.mobile_no]
      .join(" ").toLowerCase().includes(search.toLowerCase());
    const mf = !typeFilter || c.customer_type === typeFilter;
    return ms && mf;
  }), [customers, search, typeFilter]);

  const { page, setPage, totalPages, pageRows: pagedCustomers, total, resetPage } =
    usePagedRows(filtered, pageSize);

  const typeFilterOptions = useMemo(
    () => [
      { value: "", label: "All types" },
      ...(opts.customer_type || []).map((t) => ({ value: t, label: t })),
    ],
    [opts.customer_type]
  );

  const clearFilters = useCallback(() => {
    setSearch("");
    setTypeFilter("");
    resetPage();
  }, [resetPage]);

  const filterTableByCustomer = useCallback((customerLabel) => {
    if (!customerLabel) return;
    setTypeFilter("");
    setSearch(customerLabel);
    resetPage();
    requestAnimationFrame(() => {
      tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [resetPage]);

  const onTypeChange = (v) => {
    setTypeFilter(v);
    resetPage();
  };

  const onSearchChange = (v) => {
    setSearch(v);
    resetPage();
  };

  const tableTitle = useMemo(() => {
    const base = "All Customers";
    if (filtered.length !== customers.length) {
      return `${base} — ${filtered.length} shown`;
    }
    return base;
  }, [filtered.length, customers.length]);

  const exportCustomersCsv = useCallback(() => {
    const clean = (v) => {
      if (v == null || v === "—" || v === "-") return "";
      return String(v);
    };
    const rows = filtered.map((c) => ({
      customer_name: clean(dispName(c)),
      customer_id: clean(c.name),
      customer_type: clean(c.customer_type),
      customer_group: clean(c.customer_group),
      territory: clean(c.territory),
      email_id: clean(c.email_id),
      mobile_no: clean(c.mobile_no),
      website: clean(c.website),
      tax_id: clean(c.tax_id),
      payment_terms: clean(c.payment_terms),
      credit_limit: clean(c.credit_limit),
      address_line1: "",
      city: "",
      state: "",
      pincode: "",
      country: "",
      total_orders: clean(c.total_orders ?? 0),
      total_business: clean(c.total_business ?? 0),
    }));
    const date = new Date().toISOString().slice(0, 10);
    downloadCsvBlob(`customers_export_${date}.csv`, customersToCsv(rows));
    showToast(`Downloaded ${rows.length} customer(s) (current filters).`);
  }, [filtered, showToast]);

  const exportAllCustomersCsv = useCallback(() => {
    const clean = (v) => (v == null || v === "—" || v === "-" ? "" : String(v));
    const rows = customers.map((c) => ({
      customer_name: clean(dispName(c)),
      customer_id: clean(c.name),
      customer_type: clean(c.customer_type),
      customer_group: clean(c.customer_group),
      territory: clean(c.territory),
      email_id: clean(c.email_id),
      mobile_no: clean(c.mobile_no),
      website: clean(c.website),
      tax_id: clean(c.tax_id),
      payment_terms: clean(c.payment_terms),
      credit_limit: clean(c.credit_limit),
      address_line1: "",
      city: "",
      state: "",
      pincode: "",
      country: "",
      total_orders: clean(c.total_orders ?? 0),
      total_business: clean(c.total_business ?? 0),
    }));
    const date = new Date().toISOString().slice(0, 10);
    downloadCsvBlob(`customers_all_${date}.csv`, customersToCsv(rows));
    showToast(`Downloaded all ${rows.length} customer(s).`);
  }, [customers, showToast]);

  const onPickCsvImport = useCallback(() => {
    if (importing) return;
    csvFileRef.current?.click();
  }, [importing]);

  const onCsvFileChange = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setImporting(true);
      let text = "";
      try {
        text = await file.text();
      } catch {
        showToast("Could not read CSV file.", "error");
        setImporting(false);
        return;
      }
      const parsed = parseCustomerCsvRows(text);
      let ok = 0;
      let fail = 0;
      let skipped = 0;
      const errSamples = [];
      for (const row of parsed) {
        const p = csvRowToCreatePayload(row);
        if (!p.customer_name) continue;
        try {
          await post("/api/method/sales_app.api.customer.create_customer", p);
          ok++;
        } catch (err) {
          const msg = frappeErrorMessage(err, "failed");
          if (/already exists|duplicate/i.test(msg)) skipped++;
          else {
            fail++;
            if (errSamples.length < 3) {
              errSamples.push(`${p.customer_name}: ${msg.slice(0, 72)}`);
            }
          }
        }
      }
      try {
        await loadAll();
      } catch {
        /* loadAll handles loading state */
      }
      if (ok === 0 && fail === 0 && skipped === 0) {
        showToast("No importable rows (need customer_name values).", "error");
      } else if (fail > 0) {
        const skipPart = skipped ? `, ${skipped} skipped` : "";
        showToast(
          `Imported ${ok}${skipPart}, failed ${fail}.${errSamples.length ? ` ${errSamples.join(" | ")}` : ""}`.slice(0, 280),
          "error"
        );
      } else {
        const skipPart = skipped ? ` (${skipped} row(s) skipped)` : "";
        showToast(`Imported ${ok} customer(s)${skipPart}.`);
      }
      setImporting(false);
    },
    [loadAll, showToast]
  );

  if (loading) return <SalesPageLoader label="Loading customers…" />;

  return (
    <>
      <SalesToast toast={toast} />

      <div className="pm-page cu-page">

        {/* ── KPI STRIP ── */}
        <section className="cu-kpi-section" aria-label="Customer KPIs">
          <div className="cu-kpi-section-row">
            <p className="cu-kpi-section-label">Customer KPIs</p>
            <div className="cu-toolbar-right">
              <input
                ref={csvFileRef}
                type="file"
                accept=".csv,text/csv"
                className="cu-hidden-input"
                onChange={onCsvFileChange}
              />
              <details ref={csvMenuRef} className="cu-menu">
                <summary className="cu-menu-trigger" aria-label="CSV import and export">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  CSV
                  <svg className="cu-menu-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><polyline points="6 9 12 15 18 9"/></svg>
                </summary>
                <div className="cu-menu-panel" role="menu">
                  <p className="cu-menu-hint">Export</p>
                  <button
                    type="button"
                    role="menuitem"
                    className="cu-menu-item"
                    disabled={importing || filtered.length === 0}
                    onClick={() => { exportCustomersCsv(); closeCsvMenu(); }}
                  >
                    Export filtered ({filtered.length})
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="cu-menu-item"
                    disabled={importing || customers.length === 0}
                    onClick={() => { exportAllCustomersCsv(); closeCsvMenu(); }}
                  >
                    Download all ({customers.length})
                  </button>
                  <div className="cu-menu-divider" />
                  <p className="cu-menu-hint">Import</p>
                  <button
                    type="button"
                    role="menuitem"
                    className="cu-menu-item"
                    disabled={importing}
                    onClick={() => { closeCsvMenu(); onPickCsvImport(); }}
                  >
                    {importing ? "Importing…" : "Import from CSV"}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="cu-menu-item"
                    onClick={() => { downloadSampleCustomerCsv(); closeCsvMenu(); }}
                  >
                    Download sample template
                  </button>
                </div>
              </details>
              <button
                type="button"
                className="pm-btn pm-btn-primary cu-btn-primary"
                onClick={openNewCustomerModal}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 5v14M5 12h14"/></svg>
                New Customer
              </button>
            </div>
          </div>
          <div className="cu-kpi-grid">
            {KPI_SPECS.map((spec) => (
              <SalesKpiCard
                key={spec.id}
                label={spec.label}
                value={kpiDisplayValue(spec, effectiveDash)}
                sub={spec.sub}
                accent={spec.accent}
                icon={spec.icon}
              />
            ))}
          </div>
        </section>

        {/* ── TOP CUSTOMERS BY REVENUE ── */}
        <section className="cu-top-section" aria-label="Top customers by revenue">
          <p className="cu-kpi-section-label">Top Customers by Revenue</p>
          <div className="cu-top-grid">
            {(effectiveDash?.top_customers || []).filter((c) => c.revenue > 0).length === 0 && customers.length > 0 ? (
              <p className="cu-empty-sub cu-empty-sub--pad">No revenue yet — top customers appear after sales orders.</p>
            ) : null}
            {(effectiveDash?.top_customers || [])
              .filter((c) => c.revenue > 0)
              .slice(0, TOP_CUSTOMERS_LIMIT)
              .map((c) => {
              const [abg, afg] = getAvatar(c.name);
              return (
                <button
                  key={c.id}
                  type="button"
                  className="cu-top-card"
                  title={`View ${c.name} · double-click filters table`}
                  onClick={() => openView(c.id)}
                  onDoubleClick={(e) => { e.preventDefault(); filterTableByCustomer(c.name); }}
                >
                  <div className="cu-top-card-head">
                    <div className="cu-top-avatar" style={{ "--avatar-bg": abg, "--avatar-fg": afg }}>{initials(c.name)}</div>
                    <div className="cu-top-meta">
                      <div className="cu-top-name">{c.name}</div>
                      <div className="cu-top-type">{c.type || "—"}</div>
                    </div>
                  </div>
                  <div className="cu-top-rev">
                    {c.revenue > 0 ? fmtK(c.revenue) : <span className="cu-top-none">No orders</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <div className="cu-filter-bar" aria-label="Customer filters">
          <ListFilters
            statusValue={typeFilter}
            statusOptions={typeFilterOptions}
            onStatusChange={onTypeChange}
            searchValue={search}
            onSearchChange={onSearchChange}
            searchPlaceholder="Search name, email…"
          />
          {(search || typeFilter) ? (
            <button type="button" className="pm-btn pm-btn-ghost cu-btn-ghost cu-btn-compact" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
        </div>

        {/* ── CUSTOMERS TABLE ── */}
        <div ref={tableRef}>
        <Card title={tableTitle}>
          {filtered.length === 0 ? (
            <SalesEmptyState
              icon={HiOutlineUsers}
              title={search || typeFilter ? "No matching customers" : "No customers yet"}
              description={search || typeFilter
                ? "Adjust filters or clear the search."
                : 'Click "New Customer" to add your first one.'}
            />
          ) : (
            <>
            <div className="cu-table-scroll">
              <table className="pm-table cu-table">
                <thead>
                  <tr>
                    <th className="cu-col-idx">#</th>
                    <th className="cu-col-name">Customer</th>
                    <th className="cu-col-type">Type</th>
                    <th className="cu-col-email">Email</th>
                    <th className="cu-col-mobile">Mobile</th>
                    <th className="cu-col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedCustomers.map((c, i) => {
                    const [abg, afg] = getAvatar(dispName(c));
                    const email = resolveCustomerEmail(c);
                    const rowIdx = (page - 1) * pageSize + i;
                    return (
                      <tr
                        key={c.name}
                        className="cu-row cu-row--clickable"
                        style={{ "--i": rowIdx }}
                        onClick={() => openView(c.name)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openView(c.name);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={`Open ${dispName(c)}`}
                      >
                        <td className="cu-td-muted cu-col-idx">{rowIdx + 1}</td>
                        <td className="cu-col-name">
                          <div className="cu-cell-name">
                            <div className="cu-row-avatar" style={{ "--avatar-bg": abg, "--avatar-fg": afg }}>{initials(dispName(c))}</div>
                            <div>
                              <div className="cu-cell-primary">{dispName(c)}</div>
                              {c.customer_name && c.customer_name !== c.name && (
                                <div className="cu-cell-id">{c.name}</div>
                              )}
                              {email ? (
                                <div className="cu-cell-inline-stats">
                                  <a
                                    className="cu-email-inline"
                                    href={`mailto:${email}`}
                                    title={email}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {email}
                                  </a>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="cu-col-type">
                          <span className={`cu-pill ${c.customer_type === "Company" ? "cu-pill-co" : "cu-pill-ind"}`}>
                            {c.customer_type || "—"}
                          </span>
                        </td>
                        <td className="cu-col-email cu-cell-clip" onClick={(e) => email && e.stopPropagation()}>
                          {email ? (
                            <a
                              className="cu-email-link"
                              href={`mailto:${email}`}
                              title={email}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {email}
                            </a>
                          ) : (
                            <span className="cu-td-muted">—</span>
                          )}
                        </td>
                        <td className="cu-td-sub cu-col-mobile cu-cell-clip" title={c.mobile_no || undefined}>
                          {c.mobile_no || "—"}
                        </td>
                        <td className="cu-td-actions cu-col-actions" onClick={(e) => e.stopPropagation()}>
                          <div className="cu-act-row">
                            {[
                              { cls: "view", title: "View",   fn: () => openView(c.name),
                                icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> },
                              { cls: "edit", title: "Edit",   fn: () => setEditCust(custForEdit(c)),
                                icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> },
                              { cls: "del",  title: "Delete", fn: () => { setDeleteLinkError(null); setDeleteTarget({ id: c.name, label: dispName(c) }); },
                                icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> },
                            ].map(({ cls, title, fn, icon }) => (
                              <button key={cls} type="button" className={`cu-act cu-act-${cls}`} title={title} onClick={(e) => { e.stopPropagation(); fn(); }}>{icon}</button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length > 0 && (
              <div className="sales-table-pagination">
                <label className="sales-table-pagination__size">
                  <span>Per page</span>
                  <select
                    value={pageSize}
                    aria-label="Rows per page"
                    className="sales-table-pagination__select"
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) {
                        setPageSize(n);
                        resetPage();
                      }
                    }}
                  >
                    {SALES_PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <ListPagination
                  page={page}
                  totalPages={totalPages}
                  total={total}
                  pageSize={pageSize}
                  onPageChange={setPage}
                />
              </div>
            )}
            </>
          )}
        </Card>
        </div>
      </div>

      {/* ── CREATE MODAL ── */}
      {showForm && (
        <SalesDetailModal title="New Customer" wide customer onClose={() => { setShowForm(false); setForm(initForm); setFormErrors({}); setFormUserOptions([]); }}>
          <CuForm form={form} onChange={handleCreateFieldChange} opts={opts} ownershipUsers={formUserOptions} activeTab={activeTab} setActiveTab={setActiveTab} isNew errors={formErrors} />
          <MFooter>
            <button type="button" className="pm-btn pm-btn-ghost cu-btn-ghost" onClick={() => { setShowForm(false); setForm(initForm); setFormErrors({}); }}>Cancel</button>
            <button type="button" className="pm-btn pm-btn-primary cu-btn-primary" onClick={saveCust} disabled={saving}>
              {saving ? "Saving…" : "Save Customer"}
            </button>
          </MFooter>
        </SalesDetailModal>
      )}

      {/* ── EDIT MODAL ── */}
      {editCust && (
        <SalesDetailModal title="Edit Customer" wide customer onClose={() => setEditCust(null)}>
          <CuForm form={editCust} setForm={setEditCust} opts={opts} activeTab={activeTab} setActiveTab={setActiveTab} />
          <MFooter>
            <button className="pm-btn pm-btn-ghost cu-btn-ghost" onClick={() => setEditCust(null)}>Cancel</button>
            <button className="pm-btn pm-btn-primary cu-btn-primary" onClick={updateCust} disabled={saving}>
              {saving ? "Updating…" : "Update"}
            </button>
          </MFooter>
        </SalesDetailModal>
      )}

      {/* ── VIEW MODAL ── */}
      {(viewCust || viewLoading) && (
        <SalesDetailModal title="View Customer" wide customer onClose={() => setViewCust(null)}>
          {viewLoading
            ? <div className="cu-modal-loading"><SalesPageLoader label="Loading customer…" /></div>
            : <CuView key={viewCust?.name} cust={viewCust} />}
          <MFooter>
            <button className="pm-btn pm-btn-ghost cu-btn-ghost" onClick={() => setViewCust(null)}>Close</button>
            <button type="button" className="pm-btn pm-btn-primary cu-btn-primary" onClick={() => { setEditCust(custForEdit(viewCust)); setViewCust(null); }}>
              Edit Customer
            </button>
          </MFooter>
        </SalesDetailModal>
      )}

      <ConfirmDeleteModal
        target={deleteTarget}
        title={deleteLinkError ? "Cannot Delete Customer" : "Delete Customer"}
        bodyLine2={deleteLinkError ? "" : "This cannot be undone. If the customer has quotations or orders, use Disable instead."}
        errorMessage={deleteLinkError}
        loading={deleteLoading}
        onCancel={closeDeleteModal}
        onConfirm={deleteLinkError ? undefined : confirmDeleteCustomer}
        secondaryAction={deleteLinkError ? {
          label: deleteLoading ? "Disabling…" : "Disable Customer",
          onClick: disableCustomerInstead,
        } : null}
      />
    </>
  );
}

/* ─── Customer Form ──────────────────────────────────────────── */
function CuForm({ form, setForm, onChange, opts, ownershipUsers, activeTab, setActiveTab, isNew, errors = {} }) {
  const reqOnCreate = Boolean(isNew);
  const inpClass = (key) => `cu-input${errors[key] ? " cu-input--invalid" : ""}`;
  const ownerOptions = (ownershipUsers?.length ? ownershipUsers : opts.users) || [];

  const setField = (name, value) => {
    if (onChange) {
      onChange({ target: { name, value } });
      return;
    }
    setForm((f) => ({ ...f, [name]: value }));
  };

  const onEmailChange = (value) => {
    const trimmed = value.trimStart();
    if (trimmed && /^\d+$/.test(trimmed)) return;
    setField("email_id", value);
  };

  const onPhoneChange = (value) => {
    setField("mobile_no", value.replace(/\D/g, "").slice(0, 10));
  };

  const onPanChange = (value) => {
    setField("pan", normalizePan(value));
  };

  const onAadharChange = (value) => {
    setField("aadhar", normalizeAadhar(value));
  };

  const onBankAccountChange = (value) => {
    setField("bank_account", value.replace(/\D/g, "").slice(0, 18));
  };

  const onIfscChange = (value) => {
    setField("bank_ifsc", value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11));
  };

  const onPinChange = (value) => {
    setField("pincode", value.replace(/\D/g, "").slice(0, 6));
  };

  const tabs = [
    { id: "basic", label: "Basic Info" },
    { id: "tax", label: "Tax & Bank" },
    { id: "contact", label: "Contact" },
    { id: "billing", label: "Billing Address" },
  ];

  return (
    <div>
      <div className="cu-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`cu-tab ${activeTab === t.id ? "cu-tab-active" : ""}`} type="button" onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="cu-form-stack">
        {activeTab === "basic" && (
          <>
            <div className="cu-form-grid">
              <F label="Customer Name" req half error={errors.customer_name}>
                <input className={inpClass("customer_name")} name="customer_name" placeholder="Full name or company" value={form.customer_name || ""} onChange={(e) => setField("customer_name", e.target.value)} />
              </F>
              <F label="Customer ID" half>
                <input className="cu-input cu-input--readonly" value={isNew ? "" : (form.name || "")} readOnly disabled placeholder="Auto-generated on save" />
              </F>
            </div>
            <div className="cu-form-grid">
              <F label="Lead ID" req={reqOnCreate} half error={errors.lead_id}>
                <select className={inpClass("lead_id")} name="lead_id" value={form.lead_id || ""} onChange={(e) => setField("lead_id", e.target.value)}>
                  <option value="">Select lead</option>
                  {(opts.leads || []).map((l) => (
                    <option key={l.name} value={l.name}>{l.label} — {l.name}</option>
                  ))}
                </select>
              </F>
              <F label="Ownership" req={reqOnCreate} half error={errors.ownership}>
                <select className={inpClass("ownership")} name="ownership" value={form.ownership || ""} onChange={(e) => setField("ownership", e.target.value)}>
                  <option value="">Select owner</option>
                  {ownerOptions.map((u) => (
                    <option key={u.name} value={u.name}>{u.label} ({u.name})</option>
                  ))}
                </select>
              </F>
            </div>
            <div className="cu-form-grid">
              <F label="Customer Type" half>
                <select className="cu-input" name="customer_type" value={form.customer_type || "Company"} onChange={(e) => setField("customer_type", e.target.value)}>
                  {opts.customer_type.map((t) => <option key={t}>{t}</option>)}
                </select>
              </F>
              <F label="Customer Group" req={reqOnCreate} half error={errors.customer_group}>
                <select className={inpClass("customer_group")} name="customer_group" value={form.customer_group || ""} onChange={(e) => setField("customer_group", e.target.value)}>
                  <option value="">Select group</option>
                  {opts.customer_group.map((g) => <option key={g}>{g}</option>)}
                </select>
              </F>
            </div>
            <div className="cu-form-grid">
              <F label="Territory" req={reqOnCreate} half error={errors.territory}>
                <select className={inpClass("territory")} name="territory" value={form.territory || ""} onChange={(e) => setField("territory", e.target.value)}>
                  <option value="">Select territory</option>
                  {opts.territory.map((t) => <option key={t}>{t}</option>)}
                </select>
              </F>
              <F label="Payment Terms" req={reqOnCreate} half error={errors.payment_terms}>
                <select className={inpClass("payment_terms")} name="payment_terms" value={form.payment_terms || ""} onChange={(e) => setField("payment_terms", e.target.value)}>
                  <option value="">Select terms</option>
                  {opts.payment_terms.map((p) => <option key={p}>{p}</option>)}
                </select>
              </F>
            </div>
            <div className="cu-form-grid">
              <F label="Credit Limit (₹)" half>
                <input className="cu-input cu-input--credit-limit" name="credit_limit" type="number" min="0" placeholder="0" value={form.credit_limit || ""} onChange={(e) => setField("credit_limit", e.target.value)} />
              </F>
            </div>
          </>
        )}

        {activeTab === "tax" && (
          <>
            <div className="cu-form-grid">
              <F label="PAN" req={reqOnCreate} half error={errors.pan}>
                <input className={inpClass("pan")} name="pan" placeholder="ABCDE1234F" value={form.pan || ""} onChange={(e) => onPanChange(e.target.value)} maxLength={10} autoComplete="off" />
              </F>
              <F label="Aadhar" req={reqOnCreate} half error={errors.aadhar}>
                <input className={inpClass("aadhar")} name="aadhar" placeholder="12-digit Aadhar" value={form.aadhar || ""} onChange={(e) => onAadharChange(e.target.value)} inputMode="numeric" maxLength={12} autoComplete="off" />
              </F>
            </div>
            <F label="Bank Name" req={reqOnCreate} error={errors.bank_name}>
              <input className={inpClass("bank_name")} name="bank_name" placeholder="Bank name" value={form.bank_name || ""} onChange={(e) => setField("bank_name", e.target.value)} />
            </F>
            <div className="cu-form-grid">
              <F label="Bank Account No." req={reqOnCreate} half error={errors.bank_account}>
                <input className={inpClass("bank_account")} name="bank_account" placeholder="Account number" value={form.bank_account || ""} onChange={(e) => onBankAccountChange(e.target.value)} inputMode="numeric" autoComplete="off" />
              </F>
              <F label="IFSC Code" req={reqOnCreate} half error={errors.bank_ifsc}>
                <input className={inpClass("bank_ifsc")} name="bank_ifsc" placeholder="HDFC0001234" value={form.bank_ifsc || ""} onChange={(e) => onIfscChange(e.target.value)} maxLength={11} autoComplete="off" />
              </F>
            </div>
          </>
        )}

        {activeTab === "contact" && (
          <>
            <div className="cu-form-grid">
              <F label="Email Address" req={reqOnCreate} half error={errors.email_id}>
                <input className={inpClass("email_id")} type="email" placeholder="email@example.com" value={form.email_id || ""} onChange={(e) => onEmailChange(e.target.value)} autoComplete="email" inputMode="email" />
              </F>
              <F label="Mobile No." req={reqOnCreate} half error={errors.mobile_no}>
                <div className={`cu-phone-field${errors.mobile_no ? " cu-phone-field--invalid" : ""}`}>
                  <span className="cu-phone-prefix" aria-hidden>{MOBILE_PREFIX}</span>
                  <input
                    className={`cu-input cu-input--phone${errors.mobile_no ? " cu-input--invalid" : ""}`}
                    type="tel"
                    value={extractPhoneDigits(form.mobile_no)}
                    onChange={(e) => onPhoneChange(e.target.value)}
                    placeholder="9876543210"
                    inputMode="numeric"
                    maxLength={10}
                    autoComplete="tel-national"
                    aria-label="Mobile number without country code"
                  />
                </div>
              </F>
            </div>
            <F label="Website">
              <input className="cu-input" name="website" type="url" placeholder="https://company.com" value={form.website || ""} onChange={(e) => setField("website", e.target.value)} />
            </F>
          </>
        )}

        {activeTab === "billing" && (
          <>
            <F label="Billing Street" req={reqOnCreate} error={errors.address_line1}>
              <input className={inpClass("address_line1")} name="address_line1" placeholder="Street / Building" value={form.address_line1 || ""} onChange={(e) => setField("address_line1", e.target.value)} />
            </F>
            <div className="cu-form-grid">
              <F label="City" req={reqOnCreate} half error={errors.city}>
                <input className={inpClass("city")} name="city" placeholder="City" value={form.city || ""} onChange={(e) => setField("city", e.target.value)} />
              </F>
              <F label="State" req={reqOnCreate} half error={errors.state}>
                <input className={inpClass("state")} name="state" placeholder="State" value={form.state || ""} onChange={(e) => setField("state", e.target.value)} />
              </F>
            </div>
            <div className="cu-form-grid">
              <F label="Pincode" req={reqOnCreate} half error={errors.pincode}>
                <input className={inpClass("pincode")} name="pincode" placeholder="6-digit pincode" value={form.pincode || ""} onChange={(e) => onPinChange(e.target.value)} inputMode="numeric" maxLength={6} />
              </F>
              <F label="Country" req={reqOnCreate} half error={errors.country}>
                <input
                  className={inpClass("country")}
                  name="country"
                  placeholder="Country"
                  value={form.country ?? ""}
                  onChange={(e) => setField("country", e.target.value)}
                  autoComplete="country-name"
                />
              </F>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function viewDisplay(value) {
  if (value == null) return "—";
  const s = String(value).trim();
  return s || "—";
}

/* ─── Customer View (read-only, same layout as New Customer form) ─ */
function CuView({ cust }) {
  const [viewTab, setViewTab] = useState("basic");
  if (!cust) return null;

  const STATUS_C = { "To Deliver and Bill": C.amber, Completed: C.emerald, Cancelled: C.red, Draft: C.muted };
  const email = resolveCustomerEmail(cust) || cust.contact?.email || "";
  const mobileRaw = cust.mobile_no || cust.contact?.phone || "";
  const mobileDigits = extractPhoneDigits(mobileRaw);
  const ownership = cust.ownership_label || cust.ownership || "";
  const creditDisplay = cust.credit_limit != null && cust.credit_limit !== ""
    ? Number(cust.credit_limit).toLocaleString("en-IN")
    : "";

  const tabs = [
    { id: "basic", label: "Basic Info" },
    { id: "tax", label: "Tax & Bank" },
    { id: "contact", label: "Contact" },
    { id: "billing", label: "Billing Address" },
  ];

  return (
    <div className="cu-view cu-view--form">
      <div className="cu-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`cu-tab ${viewTab === t.id ? "cu-tab-active" : ""}`}
            onClick={() => setViewTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="cu-form-stack">
        {viewTab === "basic" && (
          <>
            <div className="cu-form-grid">
              <VF label="Customer Name" half value={dispName(cust)} />
              <VF label="Customer ID" half value={cust.name} />
            </div>
            <div className="cu-form-grid">
              <VF label="Lead ID" half value={cust.lead_id} />
              <VF label="Ownership" half value={ownership} />
            </div>
            <div className="cu-form-grid">
              <VF label="Customer Type" half value={cust.customer_type} />
              <VF label="Payment Terms" half value={cust.payment_terms} />
            </div>
            <div className="cu-form-grid">
              <VF label="Credit Limit (₹)" half value={creditDisplay} />
              <VF label="Tax ID" half value={cust.tax_id} />
            </div>
            <div className="cu-form-grid">
              <VF label="Currency" half value={cust.default_currency} />
              <VF label="Created On" half value={cust.creation?.split(" ")[0]} />
            </div>
            <div className="cu-form-grid">
              <VF label="Total Revenue" half value={fmtK(cust.total_business)} />
              <VF label="Total Orders" half value={cust.total_orders ?? 0} />
            </div>
          </>
        )}

        {viewTab === "tax" && (
          <>
            <div className="cu-form-grid">
              <VF label="PAN" half value={cust.pan ? maskLastFour(cust.pan) : ""} />
              <VF label="Aadhar" half value={cust.aadhar ? maskLastFour(cust.aadhar) : ""} />
            </div>
            <VF label="Bank Name" value={cust.bank_name} />
            <div className="cu-form-grid">
              <VF label="Bank Account No." half value={cust.bank_account ? maskLastFour(cust.bank_account) : ""} />
              <VF label="IFSC Code" half value={cust.bank_ifsc} />
            </div>
          </>
        )}

        {viewTab === "contact" && (
          <>
            <div className="cu-form-grid">
              <VF label="Email Address" half value={email} />
              <F label="Mobile No." half>
                <div className="cu-phone-field">
                  <span className="cu-phone-prefix" aria-hidden>{MOBILE_PREFIX}</span>
                  <input
                    className="cu-input cu-input--phone cu-input--readonly cu-input--view"
                    value={mobileDigits || "—"}
                    readOnly
                    disabled
                    aria-label="Mobile number"
                  />
                </div>
              </F>
            </div>
            <VF label="Website" value={cust.website} />
          </>
        )}

        {viewTab === "billing" && (
          <>
            <VF label="Billing Street" value={cust.address_line1} />
            <VF label="Address Line 2" value={cust.address_line2} />
            <div className="cu-form-grid">
              <VF label="City" half value={cust.city} />
              <VF label="State" half value={cust.state} />
            </div>
            <div className="cu-form-grid">
              <VF label="Pincode" half value={cust.pincode} />
              <VF label="Country" half value={cust.country} />
            </div>
          </>
        )}
      </div>

      {cust.orders?.length > 0 && (
        <div className="cu-view-orders">
          <div className="cu-view-orders-title">Recent Orders</div>
          <div className="cu-view-orders-table-wrap">
            <table className="pm-table cu-view-orders-table">
              <thead>
                <tr>
                  {["Order ID", "Amount", "Status", "Delivery Date"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cust.orders.map((o) => {
                  const sc = STATUS_C[o.status] || C.sub;
                  return (
                    <tr key={o.name}>
                      <td className="cu-view-order-id">{o.name}</td>
                      <td className="cu-view-order-amt">{fmt(o.grand_total)}</td>
                      <td>
                        <span className="cu-view-order-status" style={{ "--pill-fg": sc, "--pill-bg": `${sc}22`, "--pill-bd": `${sc}44` }}>
                          {o.status}
                        </span>
                      </td>
                      <td className="cu-view-order-date">{o.delivery_date || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Helpers ────────────────────────────────────────────────── */
const F = ({ label, half, req, error, children }) => (
  <div className={`cu-field${half ? " cu-field--half" : ""}`}>
    <label className="cu-field-lbl">
      {label}
      {req ? <span className="cu-field-req"> *</span> : null}
    </label>
    {children}
    {error ? <span className="cu-field-error" role="alert">{error}</span> : null}
  </div>
);

const VF = ({ label, half, value }) => (
  <F label={label} half={half}>
    <input className="cu-input cu-input--readonly cu-input--view" value={viewDisplay(value)} readOnly disabled />
  </F>
);

const MFooter = SalesModalFooter;

/* ─── CSS ─────────────────────────────────────────────────────── */
