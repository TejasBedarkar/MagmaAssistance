import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  HiOutlineBolt,
  HiOutlineBriefcase,
  HiOutlineBuildingOffice2,
  HiOutlineCalendarDays,
  HiOutlineDocumentText,
  HiOutlineEnvelope,
  HiOutlineEye,
  HiOutlineGlobeAlt,
  HiOutlineMagnifyingGlass,
  HiOutlineMapPin,
  HiOutlinePencilSquare,
  HiOutlinePhone,
  HiOutlineShoppingBag,
  HiOutlineTrash,
  HiOutlineUser,
  HiOutlineUsers,
} from "react-icons/hi2";
import api, { toFriendlyError } from "../../lib/apiUtils";
import ListFilters from "../../../../common/components/ListFilters.jsx";
import ListPagination from "../../../../common/components/ListPagination.jsx";
import usePagedRows from "../../../../common/hooks/usePagedRows.js";
import { SALES_PAGE_SIZE_OPTIONS } from "../../lib/pagination.js";
import { dispatchPipelineRefresh } from "../../lib/pipelineRefresh.js";
import SalesPageLoader from "../../components/SalesPageLoader.jsx";
import SalesEmptyState from "../../components/SalesEmptyState.jsx";
import useSalesToast, { SalesToast } from "../../components/useSalesToast.jsx";
import ConfirmDeleteModal from "../../components/ConfirmDeleteModal.jsx";
import SalesDetailModal from "../../components/SalesDetailModal.jsx";
import SalesKpiCard from "../../components/SalesKpiCard.jsx";
import { StatusPill } from "../../../../common/components/StatusPill.jsx";
import { SALES_COLORS as C } from "../../theme/tokens.js";
import { useSalesAuth } from "../../hooks/useSalesAuth.js";

/* ═══════════════════════════════════════════════════════════════
   API PATHS  — all in the two NEW files (auto-discovered)
   lead.py → sales_app.api.lead.*  (single file, all functions)
═══════════════════════════════════════════════════════════════ */
const A = {
  ping:        "/api/method/sales_app.api.lead.ping",
  create:      "/api/method/sales_app.api.lead.create_lead",
  get:         "/api/method/sales_app.api.lead.get_lead",
  list:        "/api/method/sales_app.api.lead.get_leads",
  update:      "/api/method/sales_app.api.lead.update_lead",
  status:      "/api/method/sales_app.api.lead.update_lead_status",
  del:         "/api/method/sales_app.api.lead.delete_lead",
  qualify:     "/api/method/sales_app.api.lead.qualify_lead",
  sources:     "/api/method/sales_app.api.lead.get_lead_sources",
  industries:  "/api/method/sales_app.api.lead.get_industry_types",
  states:      "/api/method/sales_app.api.lead.get_lead_states",
  districts:   "/api/method/sales_app.api.lead.get_lead_districts",
  tehsils:     "/api/method/sales_app.api.lead.get_lead_tehsils",
  products:    "/api/method/sales_app.api.lead.get_lead_product_options",
  checkCustomer: "/api/method/sales_app.api.lead.check_customer_for_lead",
  customerForLeadPanel: "/api/method/sales_app.api.lead.get_customer_for_lead_panel",
  customerQuotations: "/api/method/sales_app.api.lead.get_customer_quotation_history",
  customerPurchasedProducts: "/api/method/sales_app.api.lead.get_customer_purchased_products_history",
  customerLastSellingPrice: "/api/method/sales_app.api.lead.get_customer_last_selling_price",
  customerPaymentHistory: "/api/method/sales_app.api.lead.get_customer_payment_history",
  customerPendingDues: "/api/method/sales_app.api.lead.get_customer_pending_dues",
  createRepeatQuotation: "/api/method/sales_app.api.lead.create_repeat_quotation_for_customer",
  repeatQuotation: "/api/method/sales_app.api.lead.create_repeat_quotation_from_quotation",
};

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════ */
const STATUSES = ["Open", "Contacted", "Qualified", "Hold", "Opportunity", "Converted", "Dropped", "Replied", "Interested"];
/** UC-01 manual statuses on create/edit form */
const MANUAL_STATUSES = ["Open", "Contacted", "Qualified", "Hold", "Dropped"];
/** Row status dropdown — includes Opportunity (qualify) and Converted */
const STATUS_DROPDOWN_STATUSES = ["Open", "Contacted", "Qualified", "Hold", "Dropped", "Opportunity", "Converted"];
const FILTER_STATUSES = ["Open", "Contacted", "Qualified", "Hold", "Opportunity", "Converted", "Dropped"];

const LEAD_STATUS_TRANSITIONS = {
  Lead: ["Open", "Contacted", "Dropped"],
  Open: ["Contacted", "Dropped"],
  Contacted: ["Qualified", "Hold", "Dropped"],
  Replied: ["Qualified", "Contacted", "Dropped"],
  Qualified: ["Hold", "Opportunity", "Dropped"],
  Hold: ["Qualified", "Opportunity", "Dropped"],
  Interested: ["Opportunity", "Dropped"],
  Dropped: ["Open"],
  Opportunity: ["Converted", "Dropped"],
};

const LEAD_STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...FILTER_STATUSES.map((s) => ({ value: s, label: s })),
];
/** Same logic as the "Qualified+" KPI card. */
const QUALIFIED_PLUS_STATUSES = ["Qualified", "Interested", "Opportunity", "Converted"];
/** Same preset as backend `LEAD_SOURCES` — used until API loads and merged after. */
const SOURCES_PRESET = [
  "Advertisement",
  "Campaign",
  "Cold Call",
  "Cold Calling",
  "Customer's Vendor",
  "Direct Outreach",
  "Email",
  "Event",
  "Exhibition",
  "Existing Customer",
  "Inbound",
  "LinkedIn",
  "Mass Mailing",
  "Other",
  "Reference",
  "Referral",
  "Supplier Reference",
  "Walk In",
  "Web",
  "Website",
];
const TERRITORIES = ["All Territories", "India", "North India", "South India", "East India", "West India"];

const SM = {
  Open:        { fg: C.blue,   bg: C.blueDim,   bd: "rgba(56, 189, 248, 0.35)",  dot: C.blue },
  Contacted:   { fg: C.purple, bg: C.purpleDim, bd: "rgba(167, 139, 250, 0.35)", dot: C.purple },
  Qualified:   { fg: C.green,  bg: C.greenDim,  bd: "rgba(74, 222, 128, 0.35)",  dot: C.green },
  Hold:        { fg: C.amber,  bg: C.amberDim,  bd: "rgba(251, 191, 36, 0.35)",  dot: C.amber },
  Replied:     { fg: C.purple, bg: C.purpleDim, bd: "rgba(167, 139, 250, 0.35)", dot: C.purple },
  Interested:  { fg: C.green,  bg: C.greenDim,  bd: "rgba(74, 222, 128, 0.35)",  dot: C.green },
  Opportunity: { fg: C.amber,  bg: C.amberDim,  bd: "rgba(251, 191, 36, 0.35)",  dot: C.amber },
  Converted:   { fg: C.green,  bg: C.greenDim,  bd: "rgba(74, 222, 128, 0.4)",   dot: C.emerald },
  Dropped:     { fg: C.red,    bg: C.redDim,    bd: "rgba(248, 113, 113, 0.35)", dot: C.red },
};
const FUNNEL = ["Open", "Contacted", "Qualified", "Opportunity", "Converted"];

/** Lead status → portal StatusPill tone (global .pm-pill-*). */
const LEAD_PILL_TONE = {
  Open: "info",
  Contacted: "default",
  Qualified: "success",
  Hold: "warn",
  Replied: "default",
  Interested: "success",
  Opportunity: "warn",
  Converted: "success",
  Dropped: "danger",
};
const AV_CLR = [
  [C.blueDim, C.blue],
  [C.purpleDim, C.purple],
  [C.greenDim, C.green],
  [C.amberDim, C.amber],
  [C.cyanDim, C.cyan],
  [C.indigoLt, C.indigo],
];

const KPI_STATS = [
  { key: "total", label: "Total leads", sub: "All leads in pipeline", icon: "users", accent: C.blue },
  { key: "with_email", label: "With email", sub: "Contact email on file", icon: "envelope", accent: C.purple },
  { key: "interested_plus", label: "Qualified+", sub: "Qualified & beyond", icon: "chart", accent: C.teal },
  { key: "converted", label: "Converted", sub: "Won / converted leads", icon: "check-circle", accent: C.green },
];

const VIEW_FIELDS = [
  { label: "Lead ID", key: "name", Icon: HiOutlineUser },
  { label: "Contact Person", key: "contact_person", Icon: HiOutlineUser },
  { label: "Job Title", key: "job_title", Icon: HiOutlineBriefcase },
  { label: "Email", key: "email", Icon: HiOutlineEnvelope },
  { label: "Phone", key: "phone", Icon: HiOutlinePhone },
  { label: "Source", key: "source", Icon: HiOutlineGlobeAlt },
  { label: "Owner", key: "lead_owner", Icon: HiOutlineUser },
  { label: "Territory", key: "territory", Icon: HiOutlineMapPin },
  { label: "Industry", key: "industry", Icon: HiOutlineBuildingOffice2 },
  { label: "Product Interested", key: "product_interested_label", Icon: HiOutlineShoppingBag },
  { label: "Quantity", key: "quantity", Icon: HiOutlineShoppingBag },
  { label: "Target Delivery Date", key: "target_delivery_date", Icon: HiOutlineCalendarDays },
  { label: "Street", key: "street", Icon: HiOutlineMapPin },
  { label: "State", key: "state", Icon: HiOutlineMapPin },
  { label: "District", key: "district", Icon: HiOutlineMapPin },
  { label: "Tehsil", key: "tehsil", Icon: HiOutlineMapPin },
  { label: "Pin Code", key: "pin_code", Icon: HiOutlineMapPin },
  { label: "Notes", key: "notes", Icon: HiOutlineDocumentText },
];

const OPPORTUNITY_VIEW_FIELDS = [
  { label: "Opportunity ID", key: "opportunity_name", Icon: HiOutlineUser },
  { label: "Expected Order Value (₹)", key: "expected_order_value", Icon: HiOutlineShoppingBag },
  { label: "Priority", key: "priority", Icon: HiOutlineBolt },
];

const PRIORITY_PILL_TONE = {
  High: "danger",
  Medium: "warn",
  Low: "default",
};

const MOBILE_PREFIX = "+91";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const PIN_PATTERN = /^\d{6}$/;

function defaultLeadOwner({ fullName, user } = {}) {
  return String(fullName || user || "").trim();
}

const INIT_FORM = {
  contact_person: "",
  email: "",
  phone: "",
  company: "",
  job_title: "",
  status: "Open",
  source: "",
  lead_owner: "",
  territory: "All Territories",
  industry: "",
  product_interested: "",
  product_request: "",
  quantity: "",
  target_delivery_date: "",
  street: "",
  state: "",
  district: "",
  tehsil: "",
  pin_code: "",
  notes: "",
};

const INIT_CONVERT_FORM = {
  product_interested: "",
  product_request: "",
  quantity: "",
  expected_order_value: "",
  required_delivery_timeline: "",
  priority: "Medium",
};

const CONVERT_PRIORITY_OPTIONS = ["Low", "Medium", "High"];
/** Select option value when product is not yet in Item master. */
const NEW_PRODUCT_OPTION = "__NEW_PRODUCT__";

function isValidConvertDeliveryDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  const picked = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(picked.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return picked >= today;
}

/* ═══════════════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════════════ */
const dn     = (l) => l?.contact_person || l?.lead_name || l?.name || "";
const avClr  = (s="") => AV_CLR[(s.charCodeAt(0)||0) % AV_CLR.length];

function leadViewFieldValue(lead, key) {
  if (key === "product_interested_label") {
    const request = String(lead?.product_request || "").trim();
    if (request && request !== "-") {
      return `${request} (new product)`;
    }
    return lead?.product_interested_label || lead?.product_interested || "";
  }
  if (key === "contact_person") {
    return lead?.contact_person || lead?.lead_name || "";
  }
  if (key === "expected_order_value") {
    const raw = lead?.expected_order_value;
    if (!raw || raw === "-") return "";
    const num = Number(raw);
    return Number.isFinite(num) ? fmtQuotationAmount(num) : String(raw);
  }
  if (key === "required_delivery_timeline") {
    const raw = lead?.required_delivery_timeline;
    return raw && raw !== "-" ? String(raw) : "";
  }
  if (key === "target_delivery_date") {
    const raw = lead?.target_delivery_date;
    return raw && raw !== "-" ? String(raw).slice(0, 10) : "";
  }
  if (key === "priority") {
    const raw = lead?.priority;
    return raw && raw !== "-" ? String(raw) : "";
  }
  if (key === "notes") {
    const raw = lead?.notes;
    return raw && raw !== "-" ? String(raw) : "";
  }
  const val = lead?.[key];
  return val && val !== "-" ? String(val) : "";
}

function hasLeadViewFieldValue(lead, key) {
  return Boolean(String(leadViewFieldValue(lead, key) || "").trim());
}

function visibleLeadViewFields(lead, fields) {
  return fields.filter(({ key }) => hasLeadViewFieldValue(lead, key));
}

function shouldShowOpportunityDetails(lead) {
  const status = lead?.status;
  if (status !== "Opportunity" && status !== "Converted") return false;
  return Boolean(linkedOpportunityId(lead))
    || OPPORTUNITY_VIEW_FIELDS.some(({ key }) => Boolean(leadViewFieldValue(lead, key)));
}

function linkedOpportunityId(lead) {
  const id = String(lead?.opportunity_id || "").trim();
  if (id && id !== "-") return id;
  const name = String(lead?.opportunity_name || "").trim();
  if (name && name !== "-") return name;
  return "";
}

function renderLeadViewFieldValue(lead, key) {
  const value = leadViewFieldValue(lead, key);
  if (key === "priority" && value) {
    return (
      <span className="lm-pill-slot">
        <StatusPill tone={PRIORITY_PILL_TONE[value] || "default"}>{value}</StatusPill>
      </span>
    );
  }
  return value || "—";
}

function post(url, data) {
  return api.post(url, data);
}

function stripHtml(html) {
  if (!html || typeof html !== "string") return "";
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.textContent || d.innerText || "").trim();
}

function frappeErrorMessage(err, fallback = "Request failed.") {
  return stripHtml(toFriendlyError(err, fallback));
}

/** API returns { status, name, message } inside response.data.message */
function parseLeadApiPayload(res) {
  const m = res?.data?.message;
  return m && typeof m === "object" ? m : null;
}

const MATCHED_BY_LABEL = {
  email: "email",
  phone: "phone",
  company: "organization name",
};

function newCustomerCreatedText(customer) {
  const label = customer?.customer_name || customer?.name || "Customer";
  return `New customer created: ${label}.`;
}

function existingCustomerNoticeText(existingCustomer) {
  if (!existingCustomer?.exists) return "";
  const c = existingCustomer.customer || {};
  const label = c.customer_name || c.name || "Customer";
  const by = MATCHED_BY_LABEL[existingCustomer.matched_by] || existingCustomer.matched_by || "details";
  return `Customer already exists: ${label} (matched by ${by}).`;
}

const LIVE_CUSTOMER_CHECK_DEBOUNCE_MS = 500;

function hasLiveCustomerCheckInput(company, email, phone) {
  const emailTrim = String(email || "").trim();
  const phoneDigits = extractPhoneDigits(phone);
  const companyTrim = String(company || "").trim();
  if (emailTrim.includes("@") && emailTrim.length >= 5) return true;
  if (phoneDigits.length >= 10) return true;
  if (companyTrim.length >= 2) return true;
  return false;
}

async function fetchLiveCustomerCheck({ company, email, phone }) {
  const r = await api.get(A.checkCustomer, {
    params: {
      company: String(company || "").trim(),
      email: String(email || "").trim(),
      phone: formatPhoneForApi(phone),
    },
  });
  return r.data?.message || { exists: false, matched_by: null, customer: null };
}

function LiveCustomerCheckNotice({ loading, match }) {
  if (!loading && !match?.exists) return null;
  return (
    <div
      className={`lm-live-customer-check${loading ? " lm-live-customer-check--loading" : ""}`}
      role="status"
      aria-live="polite"
    >
      {loading ? (
        <p className="lm-live-customer-check__text">Checking for existing customer…</p>
      ) : (
        <>
          <strong className="lm-live-customer-check__title">Existing customer matched</strong>
          <p className="lm-live-customer-check__text">{existingCustomerNoticeText(match)}</p>
          <p className="lm-live-customer-check__hint">
            You can still save this lead. Customer history will appear after save.
          </p>
        </>
      )}
    </div>
  );
}

function fmtQuotationAmount(amount, currency = "INR") {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return String(n);
  }
}

async function fetchCustomerForLeadPanel(customerId) {
  if (!customerId) return null;
  try {
    const r = await api.get(A.customerForLeadPanel, { params: { customer: customerId } });
    return r.data?.message || null;
  } catch {
    return null;
  }
}

function initialCustomerHistoryState(existingCustomer, leadName, productInterested) {
  return {
    ...existingCustomer,
    lead_name: leadName || "",
    product_interested: productInterested || "",
    quotations: [],
    products: [],
    payments: [],
    pendingDues: null,
    lastSellingPrice: null,
    customerDetails: null,
    quotationsLoading: true,
    productsLoading: true,
    paymentsLoading: true,
    pendingDuesLoading: true,
    lastSellingPriceLoading: true,
    customerDetailsLoading: true,
  };
}

async function fetchCustomerHistoryBundle(customerId, productInterested) {
  const [
    quotations,
    products,
    lastSellingPrice,
    payments,
    pendingDues,
    customerDetails,
  ] = await Promise.all([
    fetchCustomerQuotationHistory(customerId),
    fetchCustomerPurchasedProducts(customerId),
    fetchCustomerLastSellingPrice(customerId, productInterested),
    fetchCustomerPaymentHistory(customerId),
    fetchCustomerPendingDues(customerId),
    fetchCustomerForLeadPanel(customerId),
  ]);
  return {
    quotations,
    products,
    payments,
    pendingDues,
    lastSellingPrice,
    customerDetails,
    quotationsLoading: false,
    productsLoading: false,
    paymentsLoading: false,
    pendingDuesLoading: false,
    lastSellingPriceLoading: false,
    customerDetailsLoading: false,
  };
}

function shouldShowCustomerDetailsSection(notice) {
  if (!notice?.exists) return false;
  if (notice.customerDetailsLoading) return true;
  return Boolean(notice.customerDetails);
}

function shouldShowLastSellingPriceSection(notice) {
  if (!String(notice?.product_interested || "").trim()) return false;
  if (notice.lastSellingPriceLoading) return true;
  return Boolean(notice.lastSellingPrice?.found && notice.lastSellingPrice?.price);
}

function shouldShowQuotationsSection(notice) {
  if (notice.quotationsLoading) return true;
  return (notice.quotations?.length || 0) > 0;
}

function shouldShowPurchasedProductsSection(notice) {
  if (notice.productsLoading) return true;
  return (notice.products?.length || 0) > 0;
}

function shouldShowPaymentHistorySection(notice) {
  if (notice.paymentsLoading) return true;
  return (notice.payments?.length || 0) > 0;
}

function shouldShowPendingDuesSection(notice) {
  if (notice.pendingDuesLoading) return true;
  const total = Number(notice.pendingDues?.total_outstanding) || 0;
  return total > 0 || (notice.pendingDues?.invoices?.length || 0) > 0;
}

function hasVisibleCustomerHistoryContent(notice) {
  if (!notice?.exists) return false;
  return (
    shouldShowCustomerDetailsSection(notice)
    || shouldShowLastSellingPriceSection(notice)
    || shouldShowQuotationsSection(notice)
    || shouldShowPurchasedProductsSection(notice)
    || shouldShowPaymentHistorySection(notice)
    || shouldShowPendingDuesSection(notice)
  );
}

function CustomerHistoryPanels({
  notice,
  showProductActions = false,
  onRepeat,
  repeatingQuotationName,
  onReuse,
  onQuote,
  reusingProductCode,
  quotingProductCode,
}) {
  if (!hasVisibleCustomerHistoryContent(notice)) return null;
  return (
    <>
      {shouldShowCustomerDetailsSection(notice) ? (
        <div className="lm-cust-quotations">
          <CustomerDetailsPanel
            details={notice.customerDetails}
            loading={notice.customerDetailsLoading}
          />
        </div>
      ) : null}
      {shouldShowLastSellingPriceSection(notice) ? (
        <div className="lm-cust-quotations">
          <div className="lm-cust-quotations__title">Last selling price</div>
          <CustomerLastSellingPriceInfo
            priceInfo={notice.lastSellingPrice}
            loading={notice.lastSellingPriceLoading}
            productInterested={notice.product_interested}
          />
        </div>
      ) : null}
      {shouldShowQuotationsSection(notice) ? (
        <div className="lm-cust-quotations">
          <div className="lm-cust-quotations__title">Previous quotations</div>
          <CustomerQuotationHistoryTable
            quotations={notice.quotations}
            loading={notice.quotationsLoading}
            onRepeat={showProductActions ? onRepeat : undefined}
            repeatingQuotationName={repeatingQuotationName}
          />
        </div>
      ) : null}
      {shouldShowPurchasedProductsSection(notice) ? (
        <div className="lm-cust-quotations">
          <div className="lm-cust-quotations__title">Previous purchased products</div>
          <CustomerPurchasedProductsTable
            products={notice.products}
            loading={notice.productsLoading}
            onReuse={showProductActions ? onReuse : undefined}
            onQuote={showProductActions ? onQuote : undefined}
            reusingProductCode={reusingProductCode}
            quotingProductCode={quotingProductCode}
            reusedProduct={notice.reused_product}
          />
        </div>
      ) : null}
      {shouldShowPaymentHistorySection(notice) ? (
        <div className="lm-cust-quotations">
          <div className="lm-cust-quotations__title">Payment history</div>
          <CustomerPaymentHistoryTable
            payments={notice.payments}
            loading={notice.paymentsLoading}
          />
        </div>
      ) : null}
      {shouldShowPendingDuesSection(notice) ? (
        <div className="lm-cust-quotations">
          <div className="lm-cust-quotations__title">Pending dues</div>
          <CustomerPendingDuesPanel
            pendingDues={notice.pendingDues}
            loading={notice.pendingDuesLoading}
          />
        </div>
      ) : null}
    </>
  );
}

function CustomerDetailsPanel({ details, loading }) {
  if (loading) {
    return <p className="lm-cust-quotations__loading">Loading customer details…</p>;
  }
  if (!details) {
    return <p className="lm-cust-quotations__empty">Customer details could not be loaded.</p>;
  }
  const addressParts = [
    details.address_line1,
    details.address_line2,
    details.city,
    details.state,
    details.pincode,
  ].filter(Boolean);
  const rows = [
    ["Type", details.customer_type],
    ["Group", details.customer_group],
    ["Territory", details.territory],
    ["Email", details.email_id || details.contact?.email],
    ["Phone", details.mobile_no || details.contact?.phone],
    ["Address", addressParts.length ? addressParts.join(", ") : null],
    [
      "Total orders",
      details.total_orders != null && Number(details.total_orders) > 0
        ? String(details.total_orders)
        : null,
    ],
    [
      "Total business",
      details.total_business != null && Number(details.total_business) > 0
        ? fmtQuotationAmount(details.total_business, details.default_currency)
        : null,
    ],
    [
      "Credit limit",
      Number(details.credit_limit) > 0
        ? fmtQuotationAmount(details.credit_limit, details.default_currency)
        : null,
    ],
    ["Payment terms", details.payment_terms],
    ["Account manager", details.ownership_label || details.ownership],
    ["Website", details.website],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");

  return (
    <div className="lm-cust-details">
      <div className="lm-cust-details__grid">
        {rows.map(([label, value]) => (
          <div key={label} className="lm-cust-details__row">
            <span className="lm-cust-details__label">{label}</span>
            <span className="lm-cust-details__value">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

async function fetchCustomerQuotationHistory(customerId) {
  if (!customerId) return [];
  try {
    const r = await api.get(A.customerQuotations, { params: { customer: customerId } });
    return r.data?.message?.quotations || [];
  } catch {
    return [];
  }
}

async function fetchCustomerPurchasedProducts(customerId) {
  if (!customerId) return [];
  try {
    const r = await api.get(A.customerPurchasedProducts, { params: { customer: customerId } });
    return r.data?.message?.products || [];
  } catch {
    return [];
  }
}

async function fetchCustomerPendingDues(customerId) {
  if (!customerId) return { total_outstanding: 0, currency: "INR", invoices: [] };
  try {
    const r = await api.get(A.customerPendingDues, { params: { customer: customerId } });
    return r.data?.message || { total_outstanding: 0, currency: "INR", invoices: [] };
  } catch {
    return { total_outstanding: 0, currency: "INR", invoices: [] };
  }
}

async function fetchCustomerPaymentHistory(customerId) {
  if (!customerId) return [];
  try {
    const r = await api.get(A.customerPaymentHistory, { params: { customer: customerId } });
    return r.data?.message?.payments || [];
  } catch {
    return [];
  }
}

async function fetchCustomerLastSellingPrice(customerId, productInterested) {
  if (!customerId || !productInterested) return { found: false, price: null };
  try {
    const r = await api.get(A.customerLastSellingPrice, {
      params: { customer: customerId, product_interested: productInterested },
    });
    return r.data?.message || { found: false, price: null };
  } catch {
    return { found: false, price: null };
  }
}

function CustomerLastSellingPriceInfo({ priceInfo, loading, productInterested }) {
  if (!productInterested) {
    return (
      <p className="lm-cust-quotations__empty">
        No product selected on this lead — last selling price is shown when Product Interested is set.
      </p>
    );
  }
  if (loading) {
    return <p className="lm-cust-quotations__loading">Loading last selling price…</p>;
  }
  if (!priceInfo?.found || !priceInfo?.price) {
    return (
      <p className="lm-cust-quotations__empty">
        No previous selling price for <strong>{productInterested}</strong> with this customer.
      </p>
    );
  }
  const p = priceInfo.price;
  return (
    <div className="lm-cust-last-price">
      <p className="lm-cust-last-price__amount">
        {fmtQuotationAmount(p.last_rate, p.currency)}
        <span className="lm-cust-last-price__meta">
          {" "}
          for {p.item_name || p.item_code} · qty {p.last_qty ?? "—"}
        </span>
      </p>
      <p className="lm-cust-last-price__detail">
        Order {p.last_order || "—"}
        {p.last_date ? ` · ${p.last_date}` : ""}
      </p>
    </div>
  );
}

function CustomerPendingDuesPanel({ pendingDues, loading }) {
  if (loading) {
    return <p className="lm-cust-quotations__loading">Loading pending dues…</p>;
  }
  const total = Number(pendingDues?.total_outstanding) || 0;
  const currency = pendingDues?.currency || "INR";
  const invoices = pendingDues?.invoices || [];
  if (total <= 0 && !invoices.length) {
    return <p className="lm-cust-quotations__empty">No pending dues for this customer.</p>;
  }
  return (
    <>
      <div className="lm-cust-pending-dues">
        <p className="lm-cust-pending-dues__total">
          Total outstanding: {fmtQuotationAmount(total, currency)}
        </p>
      </div>
      {invoices.length > 0 && (
        <div className="lm-cust-quotations__table-wrap">
          <table className="pm-table lm-cust-quotations__table">
            <thead>
              <tr>
                {["Invoice", "Date", "Due date", "Invoice total", "Outstanding", "Status"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.name}>
                  <td>{inv.name}</td>
                  <td>{inv.date || "—"}</td>
                  <td>{inv.due_date || "—"}</td>
                  <td>{fmtQuotationAmount(inv.grand_total, inv.currency)}</td>
                  <td>{fmtQuotationAmount(inv.outstanding_amount, inv.currency)}</td>
                  <td>{inv.status || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function CustomerPaymentHistoryTable({ payments, loading }) {
  if (loading) {
    return <p className="lm-cust-quotations__loading">Loading payment history…</p>;
  }
  if (!payments?.length) {
    return <p className="lm-cust-quotations__empty">No payment history for this customer.</p>;
  }
  return (
    <div className="lm-cust-quotations__table-wrap">
      <table className="pm-table lm-cust-quotations__table">
        <thead>
          <tr>
            {["Payment", "Date", "Amount", "Mode", "Reference", "Status"].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.name}>
              <td>{p.name}</td>
              <td>{p.date || "—"}</td>
              <td>{fmtQuotationAmount(p.amount, p.currency)}</td>
              <td>{p.mode_of_payment || "—"}</td>
              <td>{p.reference_no || "—"}</td>
              <td>{p.status || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseRepeatQuotationResponse(res) {
  const msg = res?.data?.message || res?.data || {};
  if (msg?.status === "error") {
    throw new Error(msg.message || "Could not create quotation.");
  }
  if (msg?.status && msg.status !== "success" && !msg?.name) {
    throw new Error(msg.message || "Could not create quotation.");
  }
  return msg;
}

function CustomerPurchasedProductsTable({
  products,
  loading,
  onReuse,
  onQuote,
  reusingProductCode,
  quotingProductCode,
  reusedProduct,
}) {
  if (loading) {
    return <p className="lm-cust-quotations__loading">Loading previous purchased products…</p>;
  }
  if (!products?.length) {
    return <p className="lm-cust-quotations__empty">No previous purchased products for this customer.</p>;
  }
  const showActions = Boolean(onReuse || onQuote);
  const columns = [
    "Product",
    "Item name",
    "Last qty",
    "Last rate",
    "Last order",
    "Date",
    "Total qty",
    ...(showActions ? ["Actions"] : []),
  ];
  return (
    <div className="lm-cust-quotations__table-wrap">
      <table className="pm-table lm-cust-quotations__table">
        <thead>
          <tr>
            {columns.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const isReused = reusedProduct && reusedProduct === p.item_code;
            const isReusing = reusingProductCode === p.item_code;
            const isQuoting = quotingProductCode === p.item_code;
            return (
              <tr key={p.item_code} className={isReused ? "lm-cust-products__row--reused" : undefined}>
                <td>{p.item_code}</td>
                <td>{p.item_name || "—"}</td>
                <td>{p.last_qty ?? "—"}</td>
                <td>{fmtQuotationAmount(p.last_rate, p.currency)}</td>
                <td>{p.last_order || "—"}</td>
                <td>{p.last_date || "—"}</td>
                <td>{p.total_qty ?? "—"}</td>
                {showActions && (
                  <td>
                    <div className="lm-cust-actions">
                      <button
                        type="button"
                        className="pm-btn pm-btn-ghost lm-cust-reuse-btn"
                        disabled={!onReuse || isReusing || isQuoting}
                        onClick={() => onReuse?.(p)}
                      >
                        {isReusing ? "Applying…" : isReused ? "Reused" : "Reuse"}
                      </button>
                      <button
                        type="button"
                        className="pm-btn pm-btn-ghost lm-cust-reuse-btn"
                        disabled={!onQuote || isQuoting || isReusing}
                        onClick={() => onQuote?.(p)}
                      >
                        {isQuoting ? "Creating…" : "Quote"}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CustomerQuotationHistoryTable({
  quotations,
  loading,
  onRepeat,
  repeatingQuotationName,
}) {
  if (loading) {
    return <p className="lm-cust-quotations__loading">Loading previous quotations…</p>;
  }
  if (!quotations?.length) {
    return <p className="lm-cust-quotations__empty">No previous quotations for this customer.</p>;
  }
  const columns = ["Quotation", "Date", "Amount", "Status", "Valid till", ...(onRepeat ? ["Actions"] : [])];
  return (
    <div className="lm-cust-quotations__table-wrap">
      <table className="pm-table lm-cust-quotations__table">
        <thead>
          <tr>
            {columns.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {quotations.map((q) => {
            const isRepeating = repeatingQuotationName === q.name;
            return (
              <tr key={q.name}>
                <td>{q.name}</td>
                <td>{q.date || "—"}</td>
                <td>{fmtQuotationAmount(q.grand_total, q.currency)}</td>
                <td>{q.status || "—"}</td>
                <td>{q.valid_till || "—"}</td>
                {onRepeat && (
                  <td>
                    <button
                      type="button"
                      className="pm-btn pm-btn-ghost lm-cust-reuse-btn"
                      disabled={isRepeating}
                      onClick={() => onRepeat(q)}
                    >
                      {isRepeating ? "Creating…" : "Repeat"}
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

async function openExistingLeadByName(name, { openViewLead, showToast, loadLeads }) {
  await loadLeads();
  try {
    const r = await api.get(A.get, { params: { name } });
    const lead = r.data?.message;
    if (lead) await openViewLead(lead);
  } catch {
    showToast(`Existing lead: ${name}`, "warn");
  }
}

/** Headers for export / import template (order matches sample CSV). */
const LEAD_CSV_HEADERS = [
  "contact_person",
  "lead_name",
  "email",
  "phone",
  "company",
  "job_title",
  "status",
  "source",
  "lead_owner",
  "territory",
  "industry",
  "product_interested",
  "product_request",
  "quantity",
  "target_delivery_date",
  "street",
  "state",
  "district",
  "tehsil",
  "pin_code",
  "notes",
];

const LEAD_CSV_SAMPLE_ROW = {
  contact_person: "John Doe",
  lead_name: "John Doe",
  email: "john@example.com",
  phone: "+919876543210",
  company: "Acme Pvt Ltd",
  job_title: "Business Head",
  status: "Open",
  source: "Website",
  lead_owner: "",
  territory: "All Territories",
  industry: "Technology",
  product_interested: "",
  quantity: "10",
  target_delivery_date: "",
  street: "12 MG Road",
  state: "Maharashtra",
  district: "Pune",
  tehsil: "Haveli",
  pin_code: "411001",
  notes: "Sample row — replace with your lead data",
};

function downloadCsvFile(csvContent, filename) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
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

/** Keep only the 10-digit mobile part (strip +91 / spaces from saved values). */
function extractPhoneDigits(value) {
  const raw = String(value || "").replace(/\D/g, "");
  if (!raw) return "";
  if (raw.startsWith("91") && raw.length >= 12) return raw.slice(2, 12);
  return raw.slice(0, 10);
}

/** API payload: +91 followed by 10 digits. */
function formatPhoneForApi(phoneDigits) {
  const digits = extractPhoneDigits(phoneDigits);
  return digits ? `${MOBILE_PREFIX}${digits}` : "";
}

function isNewProductLeadForm(form) {
  return String(form?.product_interested || "").trim() === NEW_PRODUCT_OPTION;
}

function isNewProductLead(lead) {
  if (!lead) return false;
  if (lead.is_new_product) return true;
  const request = String(lead.product_request || "").trim();
  return Boolean(request && request !== "-");
}

function leadProductApiPayload(form) {
  if (isNewProductLeadForm(form)) {
    return {
      product_interested: "",
      product_request: String(form.product_request || "").trim(),
    };
  }
  return {
    product_interested: String(form.product_interested || "").trim(),
    product_request: "",
  };
}

function leadFormProductForHistory(form) {
  if (isNewProductLeadForm(form)) {
    return String(form.product_request || "").trim();
  }
  return String(form.product_interested || "").trim();
}

function convertProductApiPayload(form) {
  if (isNewProductLeadForm(form)) {
    return {
      product_interested: "",
      product_request: String(form.product_request || "").trim(),
      product_code: String(form.product_request || "").trim(),
    };
  }
  const code = String(form.product_interested || "").trim();
  return {
    product_interested: code,
    product_request: "",
    product_code: code,
  };
}

function validateConvertToOpportunityForm(form) {
  const errors = {};
  const usingNewProduct = isNewProductLeadForm(form);
  const productInterested = String(form.product_interested || "").trim();
  const productRequest = String(form.product_request || "").trim();
  const quantityRaw = String(form.quantity ?? "").trim();
  const rawValue = String(form.expected_order_value ?? "").trim();
  const priority = String(form.priority ?? "").trim();

  const requireField = (key, value, message) => {
    if (!value) errors[key] = message;
  };

  if (usingNewProduct) {
    requireField("product_request", productRequest, "New product name is required.");
  } else {
    requireField("product_interested", productInterested, "Product interested is required.");
  }
  if (!quantityRaw) {
    errors.quantity = "Quantity is required.";
  } else {
    const qty = Number(quantityRaw);
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.quantity = "Quantity must be greater than zero.";
    }
  }
  if (!rawValue || !Number.isFinite(Number(rawValue)) || Number(rawValue) <= 0) {
    errors.expected_order_value = "Enter a valid expected order value greater than 0.";
  }
  if (!CONVERT_PRIORITY_OPTIONS.includes(priority)) {
    errors.priority = "Select a priority (Low, Medium, or High).";
  }
  return errors;
}

function validateLeadForm(form, { isCreate = false } = {}) {
  const errors = {};
  const leadName = String(form.contact_person || form.lead_name || "").trim();
  const email = String(form.email || "").trim();
  const phoneDigits = extractPhoneDigits(form.phone);
  const pinCode = String(form.pin_code || "").trim();
  const company = String(form.company || "").trim();
  const jobTitle = String(form.job_title || "").trim();
  const source = String(form.source || "").trim();
  const leadOwner = String(form.lead_owner || "").trim();
  const industry = String(form.industry || "").trim();
  const productInterested = String(form.product_interested || "").trim();
  const productRequest = String(form.product_request || "").trim();
  const usingNewProduct = isNewProductLeadForm(form);
  const quantityRaw = String(form.quantity ?? "").trim();
  const targetDeliveryDate = String(form.target_delivery_date ?? "").trim();
  const street = String(form.street || "").trim();
  const state = String(form.state || "").trim();
  const district = String(form.district || "").trim();
  const tehsil = String(form.tehsil || "").trim();

  const requireField = (key, value, message) => {
    if (!value) errors[key] = message;
  };

  if (!leadName) {
    errors.contact_person = "Contact person is required.";
  }

  if (isCreate) {
    requireField("email", email, "Email is required.");
    requireField("company", company, "Organization name is required.");
    requireField("job_title", jobTitle, "Job title is required.");
    requireField("source", source, "Lead source is required.");
    requireField("lead_owner", leadOwner, "Lead owner is required.");
    requireField("industry", industry, "Industry is required.");
    requireField("street", street, "Street is required.");
    requireField("state", state, "State is required.");
    requireField("district", district, "District is required.");
    requireField("tehsil", tehsil, "Tehsil is required.");
    requireField("pin_code", pinCode, "Pin code is required.");
    if (!phoneDigits) {
      errors.phone = "Mobile number is required.";
    }
  }

  if (email) {
    if (/^\d+$/.test(email)) {
      errors.email = "Enter a valid email address, not numbers only.";
    } else if (!EMAIL_PATTERN.test(email)) {
      errors.email = "Enter a valid email address (e.g. name@example.com).";
    }
  }

  if (phoneDigits && phoneDigits.length !== 10) {
    errors.phone = "Mobile number must be exactly 10 digits after +91.";
  }

  if (pinCode) {
    if (!PIN_PATTERN.test(pinCode)) {
      errors.pin_code = "Pin code must be exactly 6 digits.";
    }
  }

  if (!isCreate && quantityRaw) {
    const qty = Number(quantityRaw);
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.quantity = "Quantity must be greater than zero.";
    }
  }

  if (!isCreate && !usingNewProduct && targetDeliveryDate && !isValidConvertDeliveryDate(targetDeliveryDate)) {
    errors.target_delivery_date = "Select a valid delivery date (today or later).";
  }

  return errors;
}

function leadForEdit(lead) {
  if (!lead) return null;
  const qty = lead.quantity;
  const hasNewProduct = isNewProductLead(lead);
  return {
    ...lead,
    contact_person: lead.contact_person || lead.lead_name || "",
    phone: extractPhoneDigits(lead.phone),
    pin_code: String(lead.pin_code || "").replace(/\D/g, "").slice(0, 6),
    quantity: qty == null || qty === "" ? "" : String(qty),
    target_delivery_date: lead.target_delivery_date
      ? String(lead.target_delivery_date).slice(0, 10)
      : "",
    product_interested: hasNewProduct
      ? NEW_PRODUCT_OPTION
      : (lead.product_interested && lead.product_interested !== "-" ? lead.product_interested : ""),
    product_request: lead.product_request && lead.product_request !== "-"
      ? String(lead.product_request)
      : (hasNewProduct ? String(lead.product_interested_label || "").replace(/\s*\(new product\)$/i, "") : ""),
  };
}

/** Shared address + notes payload for create / update / CSV import. */
function leadFormApiPayload(form) {
  return {
    street: form.street || "",
    state: form.state || "",
    district: form.district || "",
    tehsil: form.tehsil || "",
    pin_code: form.pin_code || "",
  };
}

function escapeCsvField(val) {
  const s = val == null ? "" : String(val);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function leadsToCsv(rows) {
  const head = LEAD_CSV_HEADERS.map(escapeCsvField).join(",");
  const body = rows.map((l) =>
    LEAD_CSV_HEADERS.map((h) => escapeCsvField(l[h] ?? "")).join(",")
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

/** Parse CSV into array of plain objects (keys = normalized header names). */
function parseLeadCsvRows(text) {
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

function pickLeadRowField(row, keys) {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/** Map one CSV row to create_lead POST body (same shape as saveLead). */
function csvRowToCreatePayload(row) {
  const leadName = pickLeadRowField(row, [
    "contact_person",
    "lead_name",
    "name",
    "full_name",
    "fullname",
    "title",
  ]);
  const source = pickLeadRowField(row, ["source", "lead_source"]);
  return {
    name: leadName,
    contact_person: leadName,
    email: pickLeadRowField(row, ["email", "email_id"]),
    phone: pickLeadRowField(row, ["phone", "mobile_no", "mobile"]),
    company: pickLeadRowField(row, ["company", "company_name", "organization"]),
    job_title: pickLeadRowField(row, ["job_title", "designation"]),
    status: pickLeadRowField(row, ["status"]) || "Open",
    lead_source: source,
    lead_owner: pickLeadRowField(row, ["lead_owner", "owner"]),
    territory: pickLeadRowField(row, ["territory"]),
    industry: pickLeadRowField(row, ["industry"]),
    product_interested: pickLeadRowField(row, ["product_interested", "product", "item_code"]),
    product_request: pickLeadRowField(row, ["product_request", "new_product", "product_name"]),
    quantity: pickLeadRowField(row, ["quantity", "qty"]),
    target_delivery_date: pickLeadRowField(row, ["target_delivery_date", "delivery_date"]),
    street: pickLeadRowField(row, ["street", "address", "address_line1"]),
    state: pickLeadRowField(row, ["state"]),
    district: pickLeadRowField(row, ["district"]),
    tehsil: pickLeadRowField(row, ["tehsil", "tahshil", "taluka"]),
    pin_code: pickLeadRowField(row, ["pin_code", "pincode", "pin"]),
    notes: pickLeadRowField(row, ["notes", "description", "remarks"]),
  };
}

/* ═══════════════════════════════════════════════════════════════
   SMALL UI PIECES
═══════════════════════════════════════════════════════════════ */
function Pill({ status, lg }) {
  const tone = LEAD_PILL_TONE[status] || "default";
  return (
    <span className={lg ? "lm-pill-slot lm-pill-slot--lg" : "lm-pill-slot"}>
      <StatusPill tone={tone}>{status}</StatusPill>
    </span>
  );
}

function normalizedFunnelStatus(status) {
  if (status === "Replied") return "Contacted";
  if (status === "Interested") return "Qualified";
  if (status === "Hold") return "Qualified";
  if (status === "Lead") return "Open";
  return status || "Open";
}

function allowedLeadStatusOptions(currentStatus) {
  const current = currentStatus || "Open";
  const opts = LEAD_STATUS_TRANSITIONS[current] || [];
  return opts.filter((s) => STATUS_DROPDOWN_STATUSES.includes(s));
}

function FunnelBar({status}) {
  const normalized = normalizedFunnelStatus(status);
  const idx = FUNNEL.indexOf(normalized);
  return (
    <div className="lm-funnel">
      {FUNNEL.map((s,i) => (
        <div
          key={s}
          title={s}
          className="lm-funnel-seg"
          data-active={i <= idx}
          style={{ "--funnel-color": SM[s].dot }}
        />
      ))}
    </div>
  );
}

function StatusDrop({ lead, onDone, onError, onOpportunityConvert }) {
  const [open,setOpen]   = useState(false);
  const [busy,setBusy]   = useState(false);
  const ref              = useRef();
  const locked           = lead.status === "Converted";
  const menuStatuses     = allowedLeadStatusOptions(lead.status);
  const canOpen          = !locked && menuStatuses.length > 0;

  useEffect(()=>{
    const fn = e => { if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown",fn);
    return ()=>document.removeEventListener("mousedown",fn);
  },[]);

  const pick = async (s) => {
    if(s===lead.status){setOpen(false);return;}
    setOpen(false);
    if (s === "Opportunity") {
      onOpportunityConvert?.(lead);
      return;
    }
    setBusy(true);
    try {
      await post(A.status, { name: lead.name, status: s });
      onDone(lead.name, s);
      dispatchPipelineRefresh();
    } catch (e) {
      onError?.(e);
    }
    finally{setBusy(false);}
  };

  const m = SM[lead.status]||SM["Open"];
  return (
    <div ref={ref} className="lm-status-wrap">
      <button
        type="button"
        className="lm-status-btn lm-status-pill"
        onClick={()=>!busy&&canOpen&&setOpen(v=>!v)}
        disabled={busy}
        style={{ "--pill-fg": m.fg, "--pill-bg": m.bg, "--pill-bd": m.bd, "--pill-dot": m.dot }}
      >
        <span className="lm-status-btn-dot" />
        {busy?"…":lead.status}
        {canOpen&&<svg width="9" height="9" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="3"><polyline points="6 9 12 15 18 9"/></svg>}
      </button>
      {open&&(
        <div className="lm-status-menu">
          {(locked ? [] : menuStatuses).map(s=>{
            const sm=SM[s]; const act=s===lead.status;
            return (
              <button
                key={s}
                type="button"
                className="lm-status-menu-item"
                data-active={act}
                onClick={()=>pick(s)}
                style={{ "--pill-fg": sm.fg, "--pill-bg": sm.bg, "--pill-dot": sm.dot }}
              >
                <span className="lm-status-menu-dot" />
                <span className="lm-status-menu-label">{s}</span>
                {act&&<svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke={sm.fg} strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Fld({ label, req, half, error, children }) {
  return (
    <div className={`pm-field ${half ? "lm-field--half" : "lm-field--full"}`}>
      <label className="lm-field-label">
        {label}
        {req ? <span className="lm-field-req"> *</span> : null}
      </label>
      {children}
      {error ? <span className="lm-field-error" role="alert">{error}</span> : null}
    </div>
  );
}

function mergeSelectOptions(options, currentValue) {
  const seen = new Set();
  const out = [];
  const add = (value) => {
    const v = String(value || "").trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  for (const item of options || []) add(item);
  add(currentValue);
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function LeadForm({
  form,
  setForm,
  isEdit,
  sources,
  industryOptions = [],
  stateOptions = [],
  loadDistricts,
  loadTehsils,
  productOptions = [],
  errors = {},
  onClearError,
}) {
  const isCreate = !isEdit;
  const [districtOptions, setDistrictOptions] = useState([]);
  const [tehsilOptions, setTehsilOptions] = useState([]);
  const [geoLoading, setGeoLoading] = useState({ district: false, tehsil: false });

  const set = (k, v) => {
    onClearError?.(k);
    setForm((f) => ({ ...f, [k]: v }));
  };

  const industrySelectOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    const add = (value, label) => {
      const v = String(value || "").trim();
      if (!v || seen.has(v)) return;
      seen.add(v);
      out.push({ value: v, label: String(label || v).trim() || v });
    };
    for (const row of industryOptions || []) add(row.value, row.label);
    const current = String(form.industry || "").trim();
    if (current) add(current, current);
    return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [industryOptions, form.industry]);

  const stateSelectOptions = useMemo(
    () => mergeSelectOptions(stateOptions, form.state),
    [stateOptions, form.state],
  );

  const districtSelectOptions = useMemo(
    () => mergeSelectOptions(districtOptions, form.district),
    [districtOptions, form.district],
  );

  const tehsilSelectOptions = useMemo(
    () => mergeSelectOptions(tehsilOptions, form.tehsil),
    [tehsilOptions, form.tehsil],
  );

  useEffect(() => {
    let cancelled = false;
    const state = String(form.state || "").trim();
    if (!state || typeof loadDistricts !== "function") {
      setDistrictOptions([]);
      return undefined;
    }
    setGeoLoading((prev) => ({ ...prev, district: true }));
    (async () => {
      try {
        const rows = await loadDistricts(state);
        if (!cancelled) setDistrictOptions(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setDistrictOptions([]);
      } finally {
        if (!cancelled) setGeoLoading((prev) => ({ ...prev, district: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form.state, loadDistricts]);

  useEffect(() => {
    let cancelled = false;
    const state = String(form.state || "").trim();
    const district = String(form.district || "").trim();
    if (!state || !district || typeof loadTehsils !== "function") {
      setTehsilOptions([]);
      return undefined;
    }
    setGeoLoading((prev) => ({ ...prev, tehsil: true }));
    (async () => {
      try {
        const rows = await loadTehsils(state, district);
        if (!cancelled) setTehsilOptions(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setTehsilOptions([]);
      } finally {
        if (!cancelled) setGeoLoading((prev) => ({ ...prev, tehsil: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form.state, form.district, loadTehsils]);

  const onStateChange = (value) => {
    onClearError?.("state");
    onClearError?.("district");
    onClearError?.("tehsil");
    setForm((f) => ({ ...f, state: value, district: "", tehsil: "" }));
  };

  const onDistrictChange = (value) => {
    onClearError?.("district");
    onClearError?.("tehsil");
    setForm((f) => ({ ...f, district: value, tehsil: "" }));
  };

  const onEmailChange = (value) => {
    const trimmed = value.trimStart();
    if (trimmed && /^\d+$/.test(trimmed)) return;
    set("email", value);
  };

  const onPhoneChange = (value) => {
    set("phone", value.replace(/\D/g, "").slice(0, 10));
  };

  const onPinChange = (value) => {
    set("pin_code", value.replace(/\D/g, "").slice(0, 6));
  };

  const inpClass = (key) => `lm-inp${errors[key] ? " lm-inp--invalid" : ""}`;

  return (
    <div className="lm-form-grid">
      <Fld label="Contact Person" req half error={errors.contact_person}>
        <input
          className={inpClass("contact_person")}
          value={form.contact_person || form.lead_name || ""}
          onChange={(e) => set("contact_person", e.target.value)}
          placeholder="Full name"
        />
      </Fld>
      <Fld label="Lead ID" half>
        <input
          className="lm-inp lm-inp--readonly"
          value={isEdit ? (form.name || "") : ""}
          readOnly
          disabled
          placeholder="Auto-generated on save"
          title="Assigned automatically when the lead is saved"
        />
      </Fld>
      <Fld label="Organization Name" half req={isCreate} error={errors.company}>
        <input className={inpClass("company")} value={form.company||""} onChange={e=>set("company",e.target.value)} placeholder="Organization"/>
      </Fld>
      <Fld label="Job Title" half req={isCreate} error={errors.job_title}>
        <input className={inpClass("job_title")} value={form.job_title||""} onChange={e=>set("job_title",e.target.value)} placeholder="e.g. Business Head"/>
      </Fld>
      <Fld label="Email ID" half req={isCreate} error={errors.email}>
        <input
          className={inpClass("email")}
          type="email"
          value={form.email || ""}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder="email@example.com"
          autoComplete="email"
          inputMode="email"
        />
      </Fld>
      <Fld label="Mobile Number" half req={isCreate} error={errors.phone}>
        <div className={`lm-phone-field${errors.phone ? " lm-phone-field--invalid" : ""}`}>
          <span className="lm-phone-prefix" aria-hidden>{MOBILE_PREFIX}</span>
          <input
            className={`lm-inp lm-inp--phone${errors.phone ? " lm-inp--invalid" : ""}`}
            type="tel"
            value={extractPhoneDigits(form.phone)}
            onChange={(e) => onPhoneChange(e.target.value)}
            placeholder="9876543210"
            inputMode="numeric"
            maxLength={10}
            autoComplete="tel-national"
            aria-label="Mobile number without country code"
          />
        </div>
      </Fld>
      <Fld label="Lead Source" half req={isCreate} error={errors.source}>
        <select className={inpClass("source")} value={form.source || ""} onChange={(e) => set("source", e.target.value)}>
          <option value="">— Select —</option>
          {(sources?.length ? sources : SOURCES_PRESET).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Fld>
      <Fld label="Status" half>
        {isCreate ? (
          <input className="lm-inp" value="Open" readOnly disabled title="New leads always start as Open" />
        ) : isEdit && (form.status === "Converted" || form.status === "Opportunity") ? (
          <input className="lm-inp" value={form.status} readOnly disabled title="Use the status column on the lead row to update" />
        ) : (
          <select className="lm-inp" value={form.status||"Open"} onChange={e=>set("status",e.target.value)}>
            {MANUAL_STATUSES.map(s=><option key={s}>{s}</option>)}
          </select>
        )}
      </Fld>
      <Fld label="Lead Owner" half req={isCreate} error={errors.lead_owner}>
        <input className={inpClass("lead_owner")} value={form.lead_owner||""} onChange={e=>set("lead_owner",e.target.value)} placeholder="Owner name or email"/>
      </Fld>
      <Fld label="Territory" half>
        <select className="lm-inp" value={form.territory||"All Territories"} onChange={e=>set("territory",e.target.value)}>
          {TERRITORIES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </Fld>
      <Fld label="Industry" half req={isCreate} error={errors.industry}>
        <select
          className={inpClass("industry")}
          value={form.industry || ""}
          onChange={(e) => set("industry", e.target.value)}
        >
          <option value="">— Select —</option>
          {industrySelectOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Fld>
      {isEdit ? (
        <>
      <div className="lm-field--full lm-section-label lm-section-label--spaced">Product interest</div>
      <Fld label="Product Interested" req={isCreate} half error={errors.product_interested || errors.product_request}>
        <select
          className={inpClass(errors.product_request ? "product_request" : "product_interested")}
          value={form.product_interested || ""}
          onChange={(e) => {
            const next = e.target.value;
            set("product_interested", next);
            if (next !== NEW_PRODUCT_OPTION) {
              set("product_request", "");
              onClearError?.("product_request");
            } else {
              set("target_delivery_date", "");
              onClearError?.("target_delivery_date");
            }
          }}
        >
          <option value="">— Select product —</option>
          {productOptions.map((item) => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
          <option value={NEW_PRODUCT_OPTION}>+ New product (not in list)</option>
        </select>
      </Fld>
      {isNewProductLeadForm(form) ? (
        <Fld label="New Product Name" req={isCreate} half error={errors.product_request}>
          <input
            className={inpClass("product_request")}
            value={form.product_request || ""}
            onChange={(e) => set("product_request", e.target.value)}
            placeholder="e.g. Custom Industrial Motor"
          />
        </Fld>
      ) : (
        <div className="lm-field--half" aria-hidden="true" />
      )}
      <Fld label="Quantity" req={isCreate} half error={errors.quantity}>
        <input
          type="number"
          min="0.001"
          step="any"
          className={inpClass("quantity")}
          value={form.quantity ?? ""}
          onChange={(e) => set("quantity", e.target.value)}
          placeholder="e.g. 10"
        />
      </Fld>
      {!isNewProductLeadForm(form) ? (
        <Fld label="Target Delivery Date" half error={errors.target_delivery_date}>
          <input
            type="date"
            className={inpClass("target_delivery_date")}
            value={form.target_delivery_date || ""}
            onChange={(e) => set("target_delivery_date", e.target.value)}
          />
        </Fld>
      ) : (
        <div className="lm-field--half" aria-hidden="true" />
      )}
        </>
      ) : null}
      <div className="lm-field--full lm-section-label lm-section-label--spaced">Address Details</div>
      <Fld label="Street" req={isCreate} error={errors.street}>
        <input className={inpClass("street")} value={form.street||""} onChange={e=>set("street",e.target.value)} placeholder="Street / area"/>
      </Fld>
      <Fld label="State" half req={isCreate} error={errors.state}>
        <select
          className={inpClass("state")}
          value={form.state || ""}
          onChange={(e) => onStateChange(e.target.value)}
        >
          <option value="">— Select —</option>
          {stateSelectOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Fld>
      <Fld label="District" half req={isCreate} error={errors.district}>
        <select
          className={inpClass("district")}
          value={form.district || ""}
          onChange={(e) => onDistrictChange(e.target.value)}
          disabled={!form.state || geoLoading.district}
        >
          <option value="">{form.state ? "— Select —" : "Select state first"}</option>
          {districtSelectOptions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </Fld>
      <Fld label="Tehsil" half req={isCreate} error={errors.tehsil}>
        <select
          className={inpClass("tehsil")}
          value={form.tehsil || ""}
          onChange={(e) => set("tehsil", e.target.value)}
          disabled={!form.district || geoLoading.tehsil}
        >
          <option value="">{form.district ? "— Select —" : "Select district first"}</option>
          {tehsilSelectOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Fld>
      <Fld label="Pin Code" half req={isCreate} error={errors.pin_code}>
        <input
          className={inpClass("pin_code")}
          value={form.pin_code || ""}
          onChange={(e) => onPinChange(e.target.value)}
          placeholder="e.g. 411001"
          inputMode="numeric"
          maxLength={6}
          pattern="\d{6}"
        />
      </Fld>
      <Fld label="Notes">
        <textarea className="lm-inp lm-inp--notes" value={form.notes||""} onChange={e=>set("notes",e.target.value)}
          rows={2} placeholder="Any notes…"/>
      </Fld>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN
═══════════════════════════════════════════════════════════════ */
export default function Lead() {
  const navigate = useNavigate();
  const { user, fullName } = useSalesAuth();
  const [leads,       setLeads]      = useState([]);
  const [loading,     setLoading]    = useState(true);
  const [apiErr,      setApiErr]     = useState(null); // "417"|"500"|null
  const [search,      setSearch]     = useState("");
  const [sfilt,       setSfilt]      = useState("");
  const [pageSize,    setPageSize]   = useState(10);
  const [showCreate,  setShowCreate] = useState(false);
  const [editLead,    setEditLead]   = useState(null);
  const [viewLead,    setViewLead]   = useState(null);
  const [viewLeadCustomer, setViewLeadCustomer] = useState(null);
  const [delTarget,   setDelTarget]  = useState(null);
  const [convertLead, setConvertLead] = useState(null);
  const [convertForm, setConvertForm] = useState(INIT_CONVERT_FORM);
  const [convertFormErrors, setConvertFormErrors] = useState({});
  const [converting,  setConverting]  = useState(false);
  const [cForm,       setCForm]      = useState(INIT_FORM);
  const [customerMatchNotice, setCustomerMatchNotice] = useState(null);
  const [leadProductPrefill, setLeadProductPrefill] = useState(null);
  const [reusingProductCode, setReusingProductCode] = useState("");
  const [quotingProductCode, setQuotingProductCode] = useState("");
  const [repeatingQuotationName, setRepeatingQuotationName] = useState("");
  const [cFormErrors, setCFormErrors] = useState({});
  const [liveCustomerCheck, setLiveCustomerCheck] = useState({ loading: false, match: null });
  const [editFormErrors, setEditFormErrors] = useState({});
  const [sourceOptions, setSourceOptions] = useState(SOURCES_PRESET);
  const [industryOptions, setIndustryOptions] = useState([]);
  const [stateOptions, setStateOptions] = useState([]);
  const [productOptions, setProductOptions] = useState([]);
  const [saving,      setSaving]     = useState(false);
  const [importing,   setImporting]  = useState(false);
  const csvFileRef = useRef(null);
  const viewLeadLoadRef = useRef(0);
  const { toast, showToast } = useSalesToast(3400);

  /* ── LOAD ── */
  const loadLeads = useCallback(async () => {
    setLoading(true); setApiErr(null);
    try {
      const r = await api.get(A.list);
      setLeads(r.data.message || []);
    } catch(e) {
      const s = e?.response?.status;
      if(s===417||s===404) setApiErr("417");
      else { setApiErr("500"); showToast("Server error in get_leads.","error"); }
    } finally { setLoading(false); }
  },[showToast]);

  useEffect(()=>{ loadLeads(); },[loadLeads]);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const merge = (apiList) => {
        const seen = new Set();
        const out = [];
        for (const x of [...SOURCES_PRESET, ...(apiList || [])]) {
          const s = String(x || "").trim();
          if (s && !seen.has(s)) {
            seen.add(s);
            out.push(s);
          }
        }
        out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
        return out;
      };
      try {
        const r = await api.get(A.sources);
        const arr = r?.data?.message;
        if (!mounted) return;
        if (Array.isArray(arr) && arr.length) {
          setSourceOptions(merge(arr.map((v) => String(v || "").trim()).filter(Boolean)));
        } else {
          setSourceOptions(merge([]));
        }
      } catch {
        if (mounted) setSourceOptions(merge([]));
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await api.get(A.industries);
        const arr = r?.data?.message;
        if (!mounted) return;
        if (Array.isArray(arr)) {
          setIndustryOptions(
            arr
              .map((row) => ({
                value: String(row?.value || "").trim(),
                label: String(row?.label || row?.value || "").trim(),
              }))
              .filter((row) => row.value),
          );
        } else {
          setIndustryOptions([]);
        }
      } catch {
        if (mounted) setIndustryOptions([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await api.get(A.states);
        const arr = r?.data?.message;
        if (!mounted) return;
        if (Array.isArray(arr)) {
          setStateOptions(arr.map((v) => String(v || "").trim()).filter(Boolean));
        } else {
          setStateOptions([]);
        }
      } catch {
        if (mounted) setStateOptions([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  const loadDistricts = useCallback(async (state) => {
    const r = await api.get(A.districts, { params: { state } });
    const arr = r?.data?.message;
    return Array.isArray(arr) ? arr.map((v) => String(v || "").trim()).filter(Boolean) : [];
  }, []);
  const loadTehsils = useCallback(async (state, district) => {
    const r = await api.get(A.tehsils, { params: { state, district } });
    const arr = r?.data?.message;
    return Array.isArray(arr) ? arr.map((v) => String(v || "").trim()).filter(Boolean) : [];
  }, []);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await api.get(A.products);
        const arr = r?.data?.message;
        if (!mounted) return;
        if (Array.isArray(arr)) {
          setProductOptions(
            arr
              .map((item) => ({
                code: String(item?.code || "").trim(),
                name: String(item?.name || item?.code || "").trim(),
              }))
              .filter((item) => item.code)
          );
        }
      } catch {
        if (mounted) setProductOptions([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (sfilt && !FILTER_STATUSES.includes(sfilt)) setSfilt("");
  }, [sfilt]);

  useEffect(() => {
    if (!showCreate) return undefined;

    const { company, email, phone } = cForm;
    if (!hasLiveCustomerCheckInput(company, email, phone)) {
      setLiveCustomerCheck({ loading: false, match: null });
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLiveCustomerCheck({ loading: true, match: null });
      try {
        const match = await fetchLiveCustomerCheck({ company, email, phone });
        if (!cancelled) {
          setLiveCustomerCheck({ loading: false, match });
        }
      } catch {
        if (!cancelled) {
          setLiveCustomerCheck({ loading: false, match: null });
        }
      }
    }, LIVE_CUSTOMER_CHECK_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showCreate, cForm.company, cForm.email, cForm.phone]);

  const handleStatusUpdate = useCallback((name, newStatus) => {
    setLeads(p => p.map(l => l.name===name ? {...l,status:newStatus} : l));
    dispatchPipelineRefresh();
    if (newStatus === "Opportunity") {
      loadLeads();
      showToast("Lead moved to Opportunity.");
    }
  }, [loadLeads, showToast]);

  const openConvertToOpportunity = useCallback((lead) => {
    const isNewProduct = isNewProductLead(lead);
    setConvertForm({
      ...INIT_CONVERT_FORM,
      product_interested: isNewProduct
        ? NEW_PRODUCT_OPTION
        : (lead?.product_interested && lead.product_interested !== "-"
          ? lead.product_interested
          : ""),
      product_request: isNewProduct
        ? String(lead?.product_request || "").replace(/\s*\(new product\)$/i, "")
        : "",
      quantity: lead?.quantity != null && lead.quantity !== "" ? String(lead.quantity) : "",
      priority: String(lead?.priority || "Medium").trim() || "Medium",
    });
    setConvertFormErrors({});
    setConvertLead(lead);
  }, []);

  const closeConvertToOpportunity = useCallback(() => {
    if (converting) return;
    setConvertLead(null);
    setConvertForm(INIT_CONVERT_FORM);
    setConvertFormErrors({});
  }, [converting]);

  const saveConvertToOpportunity = useCallback(async () => {
    if (!convertLead) return;
    const errors = validateConvertToOpportunityForm(convertForm);
    if (Object.keys(errors).length) {
      setConvertFormErrors(errors);
      showToast("Please fill all required opportunity fields.", "error");
      return;
    }
    const usingNewProduct = isNewProductLeadForm(convertForm);
    setConvertFormErrors({});
    setConverting(true);
    try {
      const r = await post(A.qualify, {
        name: convertLead.name,
        lead_id: convertLead.name,
        expected_order_value: String(convertForm.expected_order_value ?? "").trim(),
        required_delivery_timeline: "",
        priority: String(convertForm.priority ?? "Medium").trim() || "Medium",
        quantity: String(convertForm.quantity ?? "").trim(),
        ...convertProductApiPayload(convertForm),
      });
      const d = r.data?.message;
      if (d?.status === "error") {
        showToast(d.message || "Failed to move lead to Opportunity.", "error");
        return;
      }
      const leadName = convertLead.name;
      const oppName = d?.opportunity || "";
      setConvertLead(null);
      setConvertForm(INIT_CONVERT_FORM);
      handleStatusUpdate(leadName, "Opportunity");
      if (oppName) {
        showToast(`Opportunity ${oppName} created. Opening details…`);
        navigate(`/sales/opportunities?open=${encodeURIComponent(oppName)}`);
      }
      dispatchPipelineRefresh();
    } catch (e) {
      showToast(frappeErrorMessage(e, "Could not move lead to Opportunity."), "error");
    } finally {
      setConverting(false);
    }
  }, [convertLead, convertForm, handleStatusUpdate, navigate, showToast]);

  /* ── FILTER + PAGINATE ── */
  const filtered = leads.filter((l) => {
    const txt = [
      l.name, dn(l), l.email, l.phone, l.company, l.job_title, l.source, l.lead_owner, l.territory,
      l.product_interested, l.product_interested_label, l.quantity,
      l.street, l.state, l.district, l.tehsil, l.pin_code,
    ]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase());
    return txt && (!sfilt || l.status === sfilt);
  });

  const { page, setPage, totalPages: totalPg, pageRows, total, resetPage } =
    usePagedRows(filtered, pageSize);

  const onStatusChange = (v) => {
    setSfilt(v);
    resetPage();
  };

  const onSearchChange = (v) => {
    setSearch(v);
    resetPage();
  };

  useEffect(() => {
    resetPage();
  }, [pageSize]);
  const counts   = Object.fromEntries(STATUSES.map(s=>[s, leads.filter(l=>l.status===s).length]));

  const exportLeadsCsv = useCallback(() => {
    const clean = (v) => {
      if (v == null || v === "—" || v === "-") return "";
      return String(v);
    };
    const rows = filtered.map((l) => ({
      contact_person: clean(dn(l)),
      lead_name: clean(dn(l)),
      email: clean(l.email),
      phone: clean(l.phone),
      company: clean(l.company),
      job_title: clean(l.job_title),
      status: clean(l.status) || "Open",
      source: clean(l.source),
      lead_owner: clean(l.lead_owner),
      territory: clean(l.territory),
      industry: clean(l.industry),
      product_interested: clean(l.product_interested),
      product_request: clean(l.product_request),
      quantity: clean(l.quantity),
      target_delivery_date: clean(l.target_delivery_date),
      street: clean(l.street),
      state: clean(l.state),
      district: clean(l.district),
      tehsil: clean(l.tehsil),
      pin_code: clean(l.pin_code),
      notes: clean(l.notes),
    }));
    downloadCsvFile(leadsToCsv(rows), `leads_export_${new Date().toISOString().slice(0, 10)}.csv`);
    showToast(`Exported ${rows.length} lead(s) (current filters).`);
  }, [filtered, showToast]);

  const downloadSampleLeadsCsv = useCallback(() => {
    downloadCsvFile(leadsToCsv([LEAD_CSV_SAMPLE_ROW]), "leads_import_sample.csv");
    showToast("Sample CSV downloaded.");
  }, [showToast]);

  const onPickCsvImport = useCallback(() => {
    if (importing) return;
    csvFileRef.current?.click();
  }, [importing]);

  const refreshCustomerQuotations = useCallback(async (customerId, updatePanel) => {
    if (!customerId || !updatePanel) return;
    const quotations = await fetchCustomerQuotationHistory(customerId);
    updatePanel((prev) => (prev ? { ...prev, quotations } : prev));
  }, []);

  const resolveCustomerPanelContext = useCallback(() => {
    if (viewLead && viewLeadCustomer?.exists) {
      return {
        customerId: viewLeadCustomer.customer?.name,
        leadName: viewLead.name || "",
        updatePanel: setViewLeadCustomer,
      };
    }
    if (customerMatchNotice?.exists) {
      return {
        customerId: customerMatchNotice.customer?.name,
        leadName: customerMatchNotice.lead_name || "",
        updatePanel: setCustomerMatchNotice,
      };
    }
    return null;
  }, [viewLead, viewLeadCustomer, customerMatchNotice]);

  const handleCreateRepeatQuotationFromProduct = useCallback(async (product) => {
    const itemCode = String(product?.item_code || "").trim();
    if (!itemCode) return;
    const ctx = resolveCustomerPanelContext();
    const customerId = ctx?.customerId;
    if (!customerId) {
      showToast("Customer is required to create a quotation.", "error");
      return;
    }
    const qtyNum = Number(product?.last_qty);
    const quantity = Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1;
    const rate = Number(product?.last_rate);

    setQuotingProductCode(itemCode);
    try {
      const res = await post(A.createRepeatQuotation, {
        customer: customerId,
        item_code: itemCode,
        quantity,
        rate: Number.isFinite(rate) && rate > 0 ? rate : undefined,
        lead_name: ctx.leadName || "",
      });
      const msg = parseRepeatQuotationResponse(res);
      await refreshCustomerQuotations(customerId, ctx.updatePanel);
      showToast(
        msg?.name
          ? `Quotation ${msg.name} created as Draft.`
          : "Repeat quotation created as Draft.",
      );
    } catch (e) {
      showToast(frappeErrorMessage(e, "Could not create quotation."), "error");
    } finally {
      setQuotingProductCode("");
    }
  }, [resolveCustomerPanelContext, refreshCustomerQuotations, showToast]);

  const handleRepeatQuotationFromHistory = useCallback(async (quotation) => {
    const quotName = String(quotation?.name || "").trim();
    const ctx = resolveCustomerPanelContext();
    const customerId = ctx?.customerId;
    if (!quotName || !customerId) return;

    setRepeatingQuotationName(quotName);
    try {
      const res = await post(A.repeatQuotation, {
        customer: customerId,
        quotation: quotName,
        lead_name: ctx.leadName || "",
      });
      const msg = parseRepeatQuotationResponse(res);
      await refreshCustomerQuotations(customerId, ctx.updatePanel);
      showToast(
        msg?.name
          ? `Repeat quotation ${msg.name} created from ${quotName}.`
          : `Repeat quotation created from ${quotName}.`,
      );
    } catch (e) {
      showToast(frappeErrorMessage(e, "Could not repeat quotation."), "error");
    } finally {
      setRepeatingQuotationName("");
    }
  }, [resolveCustomerPanelContext, refreshCustomerQuotations, showToast]);

  const handleReusePurchasedProduct = useCallback(async (product) => {
    const itemCode = String(product?.item_code || "").trim();
    if (!itemCode) return;
    const ctx = resolveCustomerPanelContext();
    const qtyNum = Number(product?.last_qty);
    const quantity = Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1;
    const qtyStr = String(quantity);

    setLeadProductPrefill({ product_interested: itemCode, quantity: qtyStr });
    setReusingProductCode(itemCode);
    try {
      const leadName = ctx?.leadName;
      const customerId = ctx?.customerId;
      if (leadName) {
        await post(A.update, { name: leadName, product_interested: itemCode, quantity });
        await loadLeads();
        setViewLead((prev) => (
          prev?.name === leadName
            ? { ...prev, product_interested: itemCode, quantity: qtyStr }
            : prev
        ));
      }
      if (customerId && ctx?.updatePanel) {
        const lastSellingPrice = await fetchCustomerLastSellingPrice(customerId, itemCode);
        ctx.updatePanel((prev) => (
          prev
            ? {
                ...prev,
                product_interested: itemCode,
                lastSellingPrice,
                reused_product: itemCode,
              }
            : prev
        ));
      }
      if (leadName) {
        showToast(`Reused ${itemCode} on lead ${leadName} (qty ${quantity}).`);
      } else {
        showToast(`Reused ${itemCode} (qty ${quantity}) — prefilled for next Create Lead.`);
      }
    } catch (e) {
      showToast(frappeErrorMessage(e, "Could not reuse product."), "error");
    } finally {
      setReusingProductCode("");
    }
  }, [resolveCustomerPanelContext, loadLeads, showToast]);

  const handleExistingCustomerMatch = useCallback(async (existingCustomer, leadName, productInterested) => {
    if (!existingCustomer?.exists) return;
    const customerId = existingCustomer.customer?.name;
    setCustomerMatchNotice(initialCustomerHistoryState(existingCustomer, leadName, productInterested));
    const bundle = await fetchCustomerHistoryBundle(customerId, productInterested);
    setCustomerMatchNotice({
      ...initialCustomerHistoryState(existingCustomer, leadName, productInterested),
      ...bundle,
    });
  }, []);

  const closeViewLead = useCallback(() => {
    viewLeadLoadRef.current += 1;
    setViewLead(null);
    setViewLeadCustomer(null);
  }, []);

  const openLinkedOpportunity = useCallback((lead) => {
    const oppId = linkedOpportunityId(lead);
    if (!oppId) {
      showToast("No linked opportunity found for this lead.", "error");
      return;
    }
    closeViewLead();
    navigate(`/sales/opportunities?open=${encodeURIComponent(oppId)}`);
  }, [closeViewLead, navigate, showToast]);

  const openViewLead = useCallback(async (lead) => {
    const loadId = ++viewLeadLoadRef.current;
    setViewLead(lead);
    setViewLeadCustomer(null);
    let viewData = lead;
    try {
      const detailRes = await api.get(A.get, { params: { name: lead.name } });
      const fresh = detailRes.data?.message;
      if (loadId === viewLeadLoadRef.current && fresh) {
        viewData = { ...lead, ...fresh };
        setViewLead(viewData);
      }
    } catch {
      // Keep list row data when detail fetch fails.
    }
    try {
      const match = await fetchLiveCustomerCheck({
        company: viewData.company,
        email: viewData.email,
        phone: viewData.phone,
      });
      if (loadId !== viewLeadLoadRef.current) return;
      if (!match?.exists) return;

      const productInterested = viewData.product_interested || "";
      setViewLeadCustomer(initialCustomerHistoryState(match, viewData.name, productInterested));
      const bundle = await fetchCustomerHistoryBundle(match.customer?.name, productInterested);
      if (loadId !== viewLeadLoadRef.current) return;
      setViewLeadCustomer({
        ...initialCustomerHistoryState(match, viewData.name, productInterested),
        ...bundle,
      });
    } catch {
      if (loadId === viewLeadLoadRef.current) {
        setViewLeadCustomer(null);
      }
    }
  }, []);

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
      const parsed = parseLeadCsvRows(text);
      let ok = 0;
      let fail = 0;
      let skipped = 0;
      const errSamples = [];
      for (const row of parsed) {
        const p = csvRowToCreatePayload(row);
        if (!p.name) continue;
        try {
          const res = await post(A.create, {
            name: p.name,
            email: p.email,
            phone: p.phone,
            company: p.company,
            job_title: p.job_title,
            status: p.status,
            lead_source: p.lead_source,
            lead_owner: p.lead_owner,
            territory: p.territory,
            industry: p.industry,
            product_interested: p.product_interested,
            product_request: p.product_request,
            quantity: p.quantity,
            notes: p.notes,
            street: p.street,
            state: p.state,
            district: p.district,
            tehsil: p.tehsil,
            pin_code: p.pin_code,
          });
          const payload = parseLeadApiPayload(res);
          if (payload?.status === "existing") skipped++;
          else {
            ok++;
            if (payload?.existing_customer?.exists) {
              handleExistingCustomerMatch(payload.existing_customer, payload.name, p.product_interested);
            }
          }
        } catch (err) {
          fail++;
          if (errSamples.length < 3) {
            errSamples.push(`${p.name}: ${frappeErrorMessage(err, "failed").slice(0, 72)}`);
          }
        }
      }
      try {
        await loadLeads();
      } catch {
        /* loadLeads surfaces its own error state */
      }
      if (ok === 0 && fail === 0 && skipped === 0) {
        showToast("No importable rows (need contact_person values).", "error");
      } else if (fail > 0) {
        const skipPart = skipped ? `, ${skipped} duplicate email(s) skipped` : "";
        showToast(
          `Imported ${ok}${skipPart}, failed ${fail}.${errSamples.length ? ` ${errSamples.join(" | ")}` : ""}`.slice(0, 280),
          "error"
        );
      } else {
        const skipPart = skipped ? ` (${skipped} already existed by email)` : "";
        showToast(`Imported ${ok} lead(s)${skipPart}.`);
      }
      setImporting(false);
    },
    [handleExistingCustomerMatch, loadLeads, showToast]
  );

  const openCreateLead = () => {
    setCFormErrors({});
    setLiveCustomerCheck({ loading: false, match: null });
    setCForm({ ...INIT_FORM, lead_owner: defaultLeadOwner({ fullName, user }) });
    setCustomerMatchNotice(null);
    setShowCreate(true);
  };

  /* ── CREATE ── */
  const saveLead = async () => {
    const errors = validateLeadForm(cForm, { isCreate: true });
    setCFormErrors(errors);
    if (Object.keys(errors).length) {
      showToast("Please fill all required fields. Notes is optional.", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await post(A.create, {
        name: cForm.contact_person,
        contact_person: cForm.contact_person,
        email: cForm.email.trim(),
        phone: formatPhoneForApi(cForm.phone),
        company: cForm.company,
        job_title: cForm.job_title,
        status: "Open",
        lead_source: cForm.source,
        lead_owner: cForm.lead_owner,
        territory: cForm.territory,
        industry: cForm.industry,
        notes: cForm.notes,
        ...leadFormApiPayload(cForm),
      });
      const payload = parseLeadApiPayload(res);
      setShowCreate(false);
      setCFormErrors({});
      setCForm(INIT_FORM);
      if (payload?.status === "existing" && payload.name) {
        showToast(
          `A lead with this email already exists (${payload.name}). Opening it.`,
          "warn",
        );
        await openExistingLeadByName(payload.name, { openViewLead, showToast, loadLeads });
      } else {
        await loadLeads();
        const createdMsg = payload?.name ? `Lead ${payload.name} created!` : "Lead created!";
        if (payload?.existing_customer?.exists) {
          await handleExistingCustomerMatch(
            payload.existing_customer,
            payload.name,
            leadFormProductForHistory(cForm),
          );
          showToast(`${createdMsg} ${existingCustomerNoticeText(payload.existing_customer)}`, "warn");
        } else if (payload?.customer_created && payload?.customer) {
          showToast(`${createdMsg} ${newCustomerCreatedText(payload.customer)}`);
        } else if (payload?.customer_warning) {
          showToast(`${createdMsg} ${payload.customer_warning}`, "warn");
        } else {
          showToast(createdMsg);
        }
        dispatchPipelineRefresh();
      }
    } catch (e) {
      showToast(frappeErrorMessage(e, "Failed to create lead."), "error");
    } finally { setSaving(false); }
  };

  /* ── UPDATE ── */
  const updateLead = async () => {
    const errors = validateLeadForm(editLead);
    setEditFormErrors(errors);
    if (Object.keys(errors).length) {
      showToast("Please fix the highlighted fields.", "error");
      return;
    }
    setSaving(true);
    try {
      await post(A.update, {
        name: editLead.name,
        lead_name: editLead.contact_person || editLead.lead_name || "",
        contact_person: editLead.contact_person || editLead.lead_name || "",
        email: (editLead.email || "").trim(),
        phone: formatPhoneForApi(editLead.phone),
        company: editLead.company || "",
        job_title: editLead.job_title || "",
        status: editLead.status || "Open",
        lead_source: editLead.source || "",
        lead_owner: editLead.lead_owner || "",
        territory: editLead.territory || "",
        industry: editLead.industry || "",
        ...leadProductApiPayload(editLead),
        quantity: editLead.quantity ?? "",
        target_delivery_date: isNewProductLeadForm(editLead) ? "" : (editLead.target_delivery_date || ""),
        notes: editLead.notes || "",
        ...leadFormApiPayload(editLead),
      });
      setEditFormErrors({});
      setEditLead(null);
      await loadLeads();
      showToast("Lead updated!");
    } catch { showToast("Failed to update.","error"); }
    finally { setSaving(false); }
  };

  /* ── DELETE ── */
  const confirmDelete = async () => {
    if(!delTarget) return;
    try {
      await post(A.del, {name: delTarget.id});
      setDelTarget(null); await loadLeads(); showToast("Lead deleted.");
    } catch(e) {
      showToast("Failed to delete. " + (e?.response?.data?.exception?.slice(0,60)||""), "error");
      setDelTarget(null);
    }
  };

  /* ═══════════════ 417 / 500 ERROR SCREEN ═══════════════ */
  if (apiErr) {
    return (
      <div className="pm-page lm-pg">
        <div className="lm-api-err">
          <div className="lm-api-err__icon" aria-hidden>⚙️</div>
          <h2 className="lm-api-err__title">
            {apiErr === "417" ? "New API Files Required" : "Server Error in get_leads"}
          </h2>
          <p className="lm-api-err__desc">
            {apiErr === "417"
              ? "The new API files aren't on your server yet."
              : "There's a Python error — check the Frappe error log."}
          </p>
          {apiErr === "417" && (
            <div className="lm-api-panel">
              <p className="lm-api-panel-title">Copy this ONE file to your server:</p>
              {[
                { n: "1", t: "Copy lead.py to server", c: "apps/sales_app/sales_app/api/lead.py" },
                { n: "2", t: "Run clear-cache", c: "bench --site YOURSITE clear-cache" },
                { n: "3", t: "Verify in browser", c: "http://localhost:8000/api/method/sales_app.api.lead.ping" },
              ].map((s) => (
                <div key={s.n} className="lm-api-step">
                  <div className="lm-api-step-num">{s.n}</div>
                  <div>
                    <div className="lm-api-step-title">{s.t}</div>
                    <code className="lm-api-code">{s.c}</code>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="pm-btn pm-btn-primary" onClick={() => { setApiErr(null); loadLeads(); }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     MAIN RENDER
  ═══════════════════════════════════════════════════════════════ */
  return (
    <>
      <SalesToast toast={toast} />

      <div className="pm-page lm-pg">

        {customerMatchNotice?.exists && (
          <div className="lm-customer-notice" role="status">
            <div className="lm-customer-notice__body">
              <strong>Existing customer matched</strong>
              <p>{existingCustomerNoticeText(customerMatchNotice)}</p>
              {customerMatchNotice.lead_name && (
                <p className="lm-customer-notice__meta">Lead saved: {customerMatchNotice.lead_name}</p>
              )}
              <CustomerHistoryPanels
                notice={customerMatchNotice}
                showProductActions
                onRepeat={handleRepeatQuotationFromHistory}
                repeatingQuotationName={repeatingQuotationName}
                onReuse={handleReusePurchasedProduct}
                onQuote={handleCreateRepeatQuotationFromProduct}
                reusingProductCode={reusingProductCode}
                quotingProductCode={quotingProductCode}
              />
            </div>
            <button
              type="button"
              className="pm-btn pm-btn-ghost lm-customer-notice__dismiss"
              onClick={() => setCustomerMatchNotice(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        <section className="lm-kpi-section" aria-label="Lead KPIs">
          <div className="lm-kpi-section-row">
            <p className="lm-kpi-section-label">Lead KPIs</p>
            <div className="lm-hdr-actions">
              <input
                ref={csvFileRef}
                type="file"
                accept=".csv,text/csv"
                className="lm-hidden-input"
                onChange={onCsvFileChange}
              />
              <button
                type="button"
                className="pm-btn pm-btn-ghost"
                disabled={importing || filtered.length === 0}
                onClick={exportLeadsCsv}
                title="Download leads that match the current search and status filters"
              >
                Export CSV
              </button>
              <button type="button" className="pm-btn pm-btn-ghost" disabled={importing} onClick={onPickCsvImport} title="Create leads from a CSV file">
                {importing ? "Importing…" : "Import CSV"}
              </button>
              <button
                type="button"
                className="pm-btn pm-btn-ghost"
                onClick={downloadSampleLeadsCsv}
                title="Download a CSV template with column headers and one example row"
              >
                Sample CSV
              </button>
              <button type="button" className="pm-btn pm-btn-primary" onClick={openCreateLead}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden><path d="M12 5v14M5 12h14"/></svg>
                Create Lead
              </button>
            </div>
          </div>
          <div className="lm-stats">
          {KPI_STATS.map((s) => {
            const val =
              s.key === "total"
                ? leads.length
                : s.key === "with_email"
                  ? leads.filter((l) => l.email).length
                  : s.key === "interested_plus"
                    ? leads.filter((l) => QUALIFIED_PLUS_STATUSES.includes(l.status)).length
                    : counts["Converted"] || 0;
            return (
              <SalesKpiCard
                key={s.key}
                label={s.label}
                value={val}
                sub={s.sub}
                accent={s.accent}
                icon={s.icon}
                iconSize={20}
                aria-label={`${s.label}: ${val}`}
              />
            );
          })}
          </div>
        </section>

        {/* TOOLBAR */}
        <div className="lm-bar">
          <ListFilters
            statusValue={sfilt}
            statusOptions={LEAD_STATUS_OPTIONS}
            onStatusChange={onStatusChange}
            searchValue={search}
            onSearchChange={onSearchChange}
            searchPlaceholder="Search name, email, company…"
          />
          {(search || sfilt) && (
            <button
              type="button"
              className="pm-btn pm-btn-danger lm-clr"
              onClick={() => {
                setSearch("");
                setSfilt("");
                resetPage();
              }}
            >
              ✕ Clear
            </button>
          )}
          <span className="lm-results-meta">
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* TABLE */}
        <div className="lm-card">
          {loading ? (
            <SalesPageLoader label="Loading leads…" />
          ) : pageRows.length === 0 ? (
            <SalesEmptyState
              icon={HiOutlineUsers}
              title={search || sfilt ? "No matches" : "No leads yet"}
              description={search || sfilt ? "Try clearing filters." : "Click Create Lead to start."}
            />
          ) : (
            <>
              <div className="pm-table-wrap lm-tbl-wrap">
                <table className="pm-table lm-tbl">
                  <thead>
                    <tr>
                      <th className="lm-col-num">#</th>
                      <th className="lm-col-name">Contact person</th>
                      <th className="lm-col-email">Email</th>
                      <th className="lm-col-phone">Phone</th>
                      <th className="lm-col-org">Organization</th>
                      <th className="lm-col-status">Status</th>
                      <th className="lm-col-act">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((l,i)=>{
                      const name = dn(l);
                      const [abg,afg] = avClr(name);
                      const isConv = l.status==="Converted";
                      return (
                        <tr key={l.name} className="lm-tr" style={{"--i":i}}>
                          <td className="lm-col-num lm-col-num-cell">
                            {(page - 1) * pageSize + i + 1}
                          </td>
                          <td className="lm-col-name">
                            <div
                              className="lm-name-cell"
                              title={[l.source, l.territory, l.industry, l.job_title].filter((v) => v && v !== "-").join(" · ") || undefined}
                            >
                              <div className="lm-avatar" style={{ "--avatar-bg": abg, "--avatar-fg": afg }}>
                                {(name||"?")[0].toUpperCase()}
                              </div>
                              <div className="lm-name-text">
                                <div className="lm-name-primary">{name}</div>
                                {l.lead_owner ? <div className="lm-name-sub">{l.lead_owner}</div> : null}
                              </div>
                            </div>
                          </td>
                          <td className="lm-col-email lm-cell-clip">
                            {l.email
                              ? <a href={`mailto:${l.email}`} className="lm-lnk" title={l.email}>{l.email}</a>
                              : <span className="lm-empty">—</span>}
                          </td>
                          <td className="lm-col-phone lm-cell-clip lm-col-phone-sub">
                            {l.phone || <span className="lm-empty">—</span>}
                          </td>
                          <td className="lm-col-org">
                            {l.company
                              ? <span className="lm-co-badge" title={l.company}>{l.company}</span>
                              : <span className="lm-empty">—</span>}
                          </td>
                          <td className="lm-col-status">
                            <StatusDrop
                              lead={l}
                              onDone={handleStatusUpdate}
                              onOpportunityConvert={openConvertToOpportunity}
                              onError={(e) => showToast(
                                frappeErrorMessage(e, l.status === "Qualified" || l.status === "Interested" || l.status === "Hold"
                                  ? "Could not move lead to Opportunity."
                                  : "Could not update lead status."),
                                "error",
                              )}
                            />
                          </td>
                          <td className="lm-col-act">
                            <div className="lm-act-row">
                              <button type="button" className="lm-act lm-act-v" title="View" onClick={() => openViewLead(l)}>
                                <HiOutlineEye size={12} strokeWidth={2} aria-hidden />
                              </button>
                              <button
                                type="button"
                                className={`lm-act lm-act-e${isConv ? " lm-act--disabled" : ""}`}
                                title="Edit"
                                disabled={isConv}
                                onClick={() => { setEditFormErrors({}); setEditLead(leadForEdit(l)); }}
                              >
                                <HiOutlinePencilSquare size={12} strokeWidth={2} aria-hidden />
                              </button>
                              <button type="button" className="lm-act lm-act-d" title="Delete" onClick={()=>setDelTarget({id:l.name,label:dn(l)})}>
                                <HiOutlineTrash size={12} strokeWidth={2} aria-hidden />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* PAGINATION */}
              {filtered.length > 0 && (
                <div className="sales-table-pagination lm-pag--center">
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
                    totalPages={totalPg}
                    total={total}
                    pageSize={pageSize}
                    onPageChange={setPage}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ═════ CREATE MODAL ═════ */}
      {showCreate && (
        <SalesDetailModal
          title="Create New Lead"
          onClose={() => {
            setShowCreate(false);
            setCFormErrors({});
            setCForm(INIT_FORM);
            setLiveCustomerCheck({ loading: false, match: null });
          }}
          wide
          footer={
            <>
              <button
                type="button"
                className="pm-btn pm-btn-ghost"
                onClick={() => {
                  setShowCreate(false);
                  setCFormErrors({});
                  setCForm(INIT_FORM);
                  setLiveCustomerCheck({ loading: false, match: null });
                }}
              >
                Cancel
              </button>
              <button type="button" className="pm-btn pm-btn-primary" onClick={saveLead} disabled={saving}>
                {saving ? "Saving…" : "Save Lead"}
              </button>
            </>
          }
        >
          <LiveCustomerCheckNotice
            loading={liveCustomerCheck.loading}
            match={liveCustomerCheck.match}
          />
          <LeadForm
            form={cForm}
            setForm={setCForm}
            isEdit={false}
            sources={sourceOptions}
            industryOptions={industryOptions}
            stateOptions={stateOptions}
            loadDistricts={loadDistricts}
            loadTehsils={loadTehsils}
            productOptions={productOptions}
            errors={cFormErrors}
            onClearError={(key) => setCFormErrors((prev) => {
              if (!prev[key]) return prev;
              const next = { ...prev };
              delete next[key];
              return next;
            })}
          />
        </SalesDetailModal>
      )}

      {/* ═════ VIEW MODAL ═════ */}
      {viewLead && (
        <SalesDetailModal
          title="Lead Details"
          onClose={closeViewLead}
          wide
          footer={
            <>
              <button type="button" className="pm-btn pm-btn-ghost" onClick={closeViewLead}>Close</button>
              {viewLead.status !== "Converted" && (
                <button type="button" className="pm-btn pm-btn-primary" onClick={() => { setEditFormErrors({}); setEditLead(leadForEdit(viewLead)); closeViewLead(); }}>
                  Edit
                </button>
              )}
            </>
          }
        >
          <div className="lm-view">
            <div className="lm-view-profile">
              {(()=>{const n=dn(viewLead);const[abg,afg]=avClr(n);return(
                <div className="lm-view-avatar" style={{ "--avatar-bg": abg, "--avatar-fg": afg }}>{(n||"?")[0].toUpperCase()}</div>
              );})()}
              <div className="lm-view-head">
                <div className="lm-view-name">{dn(viewLead)}</div>
                {viewLead.company&&<div className="lm-view-co">{viewLead.company}</div>}
                <div className="lm-view-pill-wrap"><Pill status={viewLead.status} lg/></div>
              </div>
            </div>
            <div className="lm-view-panel">
              <div className="lm-view-panel-title">Conversion progress</div>
              <FunnelBar status={viewLead.status}/>
              <div className="lm-view-funnel-labels">
                {FUNNEL.map(s=><span key={s}>{s}</span>)}
              </div>
            </div>
            <div className="lm-view-grid">
              {visibleLeadViewFields(viewLead, VIEW_FIELDS).map(({label,key,Icon})=>(
                <div key={label} className={`lm-view-field${key === "notes" ? " lm-view-field--full" : ""}`}>
                  <span className="lm-view-field-ico" aria-hidden><Icon size={16} strokeWidth={2} /></span>
                  <div className="lm-view-field-body">
                    <div className="lm-view-field-label">{label}</div>
                    <div className="lm-view-field-val">{renderLeadViewFieldValue(viewLead, key)}</div>
                  </div>
                </div>
              ))}
            </div>
            {shouldShowOpportunityDetails(viewLead) && (
              <div className="lm-view-panel lm-view-panel--opportunity">
                <div className="lm-view-panel-title-row">
                  <div className="lm-view-panel-title">Opportunity details</div>
                  {linkedOpportunityId(viewLead) && (
                    <button
                      type="button"
                      className="pm-btn pm-btn-ghost pm-btn-sm"
                      onClick={() => openLinkedOpportunity(viewLead)}
                    >
                      Open Opportunity
                    </button>
                  )}
                </div>
                <div className="lm-view-grid">
                  {visibleLeadViewFields(viewLead, OPPORTUNITY_VIEW_FIELDS).map(({ label, key, Icon }) => (
                    <div key={label} className="lm-view-field">
                      <span className="lm-view-field-ico" aria-hidden><Icon size={16} strokeWidth={2} /></span>
                      <div className="lm-view-field-body">
                        <div className="lm-view-field-label">{label}</div>
                        <div className="lm-view-field-val">{renderLeadViewFieldValue(viewLead, key)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {viewLeadCustomer?.exists && hasVisibleCustomerHistoryContent(viewLeadCustomer) && (
              <div className="lm-view-customer-history">
                <div className="lm-view-customer-history__header">
                  <p className="lm-view-customer-history__match">{existingCustomerNoticeText(viewLeadCustomer)}</p>
                </div>
                <CustomerHistoryPanels
                  notice={viewLeadCustomer}
                  showProductActions
                  onRepeat={handleRepeatQuotationFromHistory}
                  repeatingQuotationName={repeatingQuotationName}
                  onReuse={handleReusePurchasedProduct}
                  onQuote={handleCreateRepeatQuotationFromProduct}
                  reusingProductCode={reusingProductCode}
                  quotingProductCode={quotingProductCode}
                />
              </div>
            )}
          </div>
        </SalesDetailModal>
      )}

      {/* ═════ EDIT MODAL ═════ */}
      {editLead && (
        <SalesDetailModal
          title="Edit Lead"
          onClose={() => { setEditFormErrors({}); setEditLead(null); }}
          wide
          footer={
            <>
              <button type="button" className="pm-btn pm-btn-ghost" onClick={() => { setEditFormErrors({}); setEditLead(null); }}>Cancel</button>
              <button type="button" className="pm-btn pm-btn-primary" onClick={updateLead} disabled={saving}>
                {saving ? "Updating…" : "Update Lead"}
              </button>
            </>
          }
        >
          <LeadForm
            form={editLead}
            setForm={setEditLead}
            isEdit
            sources={sourceOptions}
            industryOptions={industryOptions}
            stateOptions={stateOptions}
            loadDistricts={loadDistricts}
            loadTehsils={loadTehsils}
            productOptions={productOptions}
            errors={editFormErrors}
            onClearError={(key) => setEditFormErrors((prev) => {
              if (!prev[key]) return prev;
              const next = { ...prev };
              delete next[key];
              return next;
            })}
          />
        </SalesDetailModal>
      )}

      {/* ═════ CONVERT TO OPPORTUNITY (UC-02) ═════ */}
      {convertLead && (
        <SalesDetailModal
          title="Convert Lead to Opportunity"
          onClose={closeConvertToOpportunity}
          wide
          footer={
            <>
              <button
                type="button"
                className="pm-btn pm-btn-ghost"
                onClick={closeConvertToOpportunity}
                disabled={converting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pm-btn pm-btn-primary"
                onClick={saveConvertToOpportunity}
                disabled={converting}
              >
                {converting ? "Saving…" : "Save Opportunity"}
              </button>
            </>
          }
        >
          <div className="lm-conv-context" role="status">
            <span className="lm-conv-context__label">Converting lead</span>
            <span className="lm-conv-context__name">{dn(convertLead)}</span>
          </div>
          <p className="lm-conv-context__hint">
            Add product interest and opportunity details below.
          </p>
          <div className="lm-section-label">Product interest</div>
          <div className="lm-convert-grid">
            <Fld label="Product Interested" half req error={convertFormErrors.product_interested || convertFormErrors.product_request}>
              <select
                className={`lm-inp${convertFormErrors.product_interested || convertFormErrors.product_request ? " lm-inp--invalid" : ""}`}
                value={convertForm.product_interested || ""}
                onChange={(e) => {
                  const next = e.target.value;
                  setConvertFormErrors((prev) => {
                    const n = { ...prev };
                    delete n.product_interested;
                    delete n.product_request;
                    return n;
                  });
                  setConvertForm((f) => ({
                    ...f,
                    product_interested: next,
                    product_request: next === NEW_PRODUCT_OPTION ? f.product_request : "",
                  }));
                }}
                disabled={converting}
              >
                <option value="">— Select product —</option>
                {productOptions.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
                <option value={NEW_PRODUCT_OPTION}>+ New product (not in list)</option>
              </select>
            </Fld>
            <Fld label="Quantity" half req error={convertFormErrors.quantity}>
              <input
                className={`lm-inp${convertFormErrors.quantity ? " lm-inp--invalid" : ""}`}
                type="number"
                min="0.001"
                step="any"
                value={convertForm.quantity ?? ""}
                onChange={(e) => {
                  setConvertFormErrors((prev) => {
                    if (!prev.quantity) return prev;
                    const n = { ...prev };
                    delete n.quantity;
                    return n;
                  });
                  setConvertForm((f) => ({ ...f, quantity: e.target.value }));
                }}
                placeholder="e.g. 10"
                disabled={converting}
              />
            </Fld>
            {isNewProductLeadForm(convertForm) ? (
              <Fld label="New Product Name" req error={convertFormErrors.product_request}>
                <input
                  className={`lm-inp${convertFormErrors.product_request ? " lm-inp--invalid" : ""}`}
                  value={convertForm.product_request || ""}
                  onChange={(e) => {
                    setConvertFormErrors((prev) => {
                      if (!prev.product_request) return prev;
                      const n = { ...prev };
                      delete n.product_request;
                      return n;
                    });
                    setConvertForm((f) => ({ ...f, product_request: e.target.value }));
                  }}
                  placeholder="e.g. Custom Industrial Motor"
                  disabled={converting}
                />
              </Fld>
            ) : null}
          </div>
          <div className="lm-section-label lm-section-label--spaced">Opportunity details</div>
          <div className="lm-convert-grid">
            <Fld label="Expected Order Value (₹)" half req error={convertFormErrors.expected_order_value}>
              <input
                className={`lm-inp${convertFormErrors.expected_order_value ? " lm-inp--invalid" : ""}`}
                type="number"
                min="0"
                step="any"
                value={convertForm.expected_order_value}
                onChange={(e) => {
                  setConvertFormErrors((prev) => {
                    if (!prev.expected_order_value) return prev;
                    const next = { ...prev };
                    delete next.expected_order_value;
                    return next;
                  });
                  setConvertForm((f) => ({ ...f, expected_order_value: e.target.value }));
                }}
                placeholder="e.g. 500000"
                disabled={converting}
              />
            </Fld>
            <Fld label="Priority" half req error={convertFormErrors.priority}>
              <select
                className={`lm-inp${convertFormErrors.priority ? " lm-inp--invalid" : ""}`}
                value={convertForm.priority}
                onChange={(e) => {
                  setConvertFormErrors((prev) => {
                    if (!prev.priority) return prev;
                    const next = { ...prev };
                    delete next.priority;
                    return next;
                  });
                  setConvertForm((f) => ({ ...f, priority: e.target.value }));
                }}
                disabled={converting}
              >
                <option value="">Select priority</option>
                {CONVERT_PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </Fld>
          </div>
        </SalesDetailModal>
      )}

      <ConfirmDeleteModal
        target={delTarget}
        title="Delete Lead"
        onCancel={() => setDelTarget(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}