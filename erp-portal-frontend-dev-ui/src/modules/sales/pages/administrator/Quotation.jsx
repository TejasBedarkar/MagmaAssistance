import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { HiOutlineDocumentText } from "react-icons/hi2";
import api, { prefetchCsrf, prefetchCsrfInBackground } from "../../lib/apiUtils";
import ListFilters from "../../../../common/components/ListFilters.jsx";
import ListPagination from "../../../../common/components/ListPagination.jsx";
import usePagedRows from "../../../../common/hooks/usePagedRows.js";
import { SALES_PAGE_SIZE_OPTIONS } from "../../lib/pagination.js";
import SalesPageLoader from "../../components/SalesPageLoader.jsx";
import SalesEmptyState from "../../components/SalesEmptyState.jsx";
import ConfirmDeleteModal from "../../components/ConfirmDeleteModal.jsx";
import SalesDetailModal from "../../components/SalesDetailModal.jsx";
import SalesModalFooter from "../../components/SalesModalFooter.jsx";
import { SALES_COLORS as C } from "../../theme/tokens.js";
import { FINANCE_DOC_TRAIL_ROUTES, salesOrderCreatedToast } from "../../lib/salesWorkflowNav.js";
import SalesKpiCard from "../../components/SalesKpiCard.jsx";
import SalesDocumentId from "../../components/SalesDocumentId.jsx";
import useSalesToast, { SalesToast } from "../../components/useSalesToast.jsx";
import { toFriendlyError } from "../../lib/apiUtils";
import { useSalesAuth } from "../../hooks/useSalesAuth.js";
import { allowedActionsByRole } from "../../lib/roles.js";
import { refreshSalesNotifications } from "../../lib/salesNotifications.js";

const indigoLt = C.indigoLt;
/** Page accent — blue/teal (no amber/yellow). */
const QT_ACCENT = C.blue;
const QT_ACCENT_ALT = C.teal;

/* ─── Page stylesheet (top-level: avoids dev/HMR ordering issues) ─ */
const fmt    = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN")}`;
const fmtK   = (n) => n >= 1e7 ? `₹${(n/1e7).toFixed(1)}Cr` : n >= 1e5 ? `₹${(n/1e5).toFixed(1)}L` : n >= 1e3 ? `₹${(n/1e3).toFixed(0)}k` : `₹${n}`;
const today  = () => new Date().toISOString().split("T")[0];
const formatDisplayDate = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const d = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const initItem = {
  item_code: "",
  qty: 1,
  rate: 0,
  description: "",
  price_list_rate: 0,
  margin_type: "",
  margin_rate_or_amount: "",
};

const QUOTATION_ITEM_PRICING_API =
  "/api/method/sales_app.api.quotation.get_quotation_item_pricing";

const QUOTATION_PREVIEW_TOTALS_API =
  "/api/method/sales_app.api.quotation.preview_quotation_totals";
const QUOTATION_COMPONENT_COST_API =
  "/api/method/sales_app.api.quotation.get_quotation_item_component_cost";
const QUOTATION_PRODUCTION_LOAD_API =
  "/api/method/sales_app.api.quotation.get_quotation_item_production_load";
const QUOTATION_MATERIAL_AVAILABILITY_API =
  "/api/method/sales_app.api.quotation.get_quotation_item_material_availability";
const QUOTATION_MATERIAL_AVAILABILITY_STEP_API =
  "/api/method/sales_app.api.quotation.get_quotation_material_availability";
const QUOTATION_DELIVERY_READINESS_API =
  "/api/method/sales_app.api.quotation.get_quotation_delivery_readiness";
const QUOTATION_SET_PRODUCTION_ESTIMATE_API =
  "/api/method/sales_app.api.quotation.set_production_completion_estimate";
const QUOTATION_CAPACITY_SNAPSHOT_API =
  "/api/method/sales_app.api.quotation.get_quotation_capacity_snapshot";
const QUOTATION_FLOW_VALIDATION_API =
  "/api/method/sales_app.api.quotation.get_quotation_flow_validation";
const QUOTATION_CREATE_MATERIAL_REQUEST_API =
  "/api/method/sales_app.api.quotation.create_material_request_from_quotation";
const QUOTATION_DELIVERY_OPTIONS_API =
  "/api/method/sales_app.api.quotation.calculate_delivery_options";
const QUOTATION_SELECT_DELIVERY_OPTION_API =
  "/api/method/sales_app.api.quotation.select_delivery_option";
const QUOTATION_FULFILMENT_PLANTS_API =
  "/api/method/sales_app.api.quotation.get_fulfilment_plants";
const QUOTATION_SEND_TO_CUSTOMER_API =
  "/api/method/sales_app.api.quotation.send_quotation_to_customer";
const QUOTATION_RECORD_CUSTOMER_RESPONSE_API =
  "/api/method/sales_app.api.quotation.record_customer_quotation_response";
const QUOTATION_REVISE_AFTER_REJECTION_API =
  "/api/method/sales_app.api.quotation.revise_quotation_after_customer_rejection";
const QUOTATION_ATTACHMENT_UPLOAD_API =
  "/api/method/sales_app.api.quotation.upload_quotation_attachment";

const QUOTATION_MARGIN_TYPE_OPTIONS = [
  { value: "", label: "No margin" },
  { value: "Percentage", label: "%" },
  { value: "Amount", label: "₹" },
];
const initForm = {
  customer: "", valid_till: "", tentative_delivery_date: "", system_delivery_date: "", order_type: "Sales",
  terms: "", note: "",
  fulfilment_plant: "",
  delivery_plan_status: "Draft",
  material_arrival_date: "",
  material_arrival_warehouse: "",
  material_available_qty: "",
  expected_receipt_date: "",
  production_start_date: "",
  production_completion_estimate: "",
  capacity_committed: false,
  capacity_available_confirmed: false,
  machine_allocation: [],
  delivery_option_5: "",
  delivery_option_7: "",
  delivery_option_10: "",
  selected_delivery_option: "",
  discount_percent: "", discount_amount: "", apply_discount_on: "Grand Total", _discount_input_mode: "",
  attachment_file_url: "", attachment_file_name: "",
  items: [{ ...initItem }],
};

const QUOTATION_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const QUOTATION_ATTACHMENT_ACCEPT = ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const READINESS_SYNCABLE_PLAN_STATUSES = new Set(["", "Draft", "Awaiting Stores", "Awaiting Production"]);

function resolveDeliveryPlanStatus(formStatus, readinessStatus, optionsStatus) {
  const form = String(formStatus || "").trim();
  const readiness = String(readinessStatus || "").trim();
  const options = String(optionsStatus || "").trim();
  if (form && !READINESS_SYNCABLE_PLAN_STATUSES.has(form)) return form;
  return options || readiness || form || "Draft";
}

function deliveryPlanPillClass(status) {
  const label = String(status || "").trim().toLowerCase().replace(/\s+/g, "-");
  if (!label || label === "draft") return "";
  return ` qt-delivery-options__plan-pill--${label}`;
}

function quotationHasSaveableLineItems(items) {
  return quotationItemsForPayload(items).length > 0;
}

function parseQuotationDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = formatQuotationDateField(raw);
  if (!normalized) return null;
  const picked = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(picked.getTime()) ? null : picked;
}

function compareQuotationDates(left, right) {
  const leftDate = parseQuotationDate(left);
  const rightDate = parseQuotationDate(right);
  if (!leftDate || !rightDate) return null;
  const leftTime = leftDate.getTime();
  const rightTime = rightDate.getTime();
  if (leftTime === rightTime) return 0;
  return leftTime > rightTime ? 1 : -1;
}

function quotationFeasibleSystemDate(quotation, systemEstimate = "") {
  return formatQuotationDateField(quotation?.system_delivery_date) || formatQuotationDateField(systemEstimate);
}

function isValidTentativeDeliveryDate(value, systemDate = "") {
  const picked = parseQuotationDate(value);
  if (!String(value || "").trim()) return true;
  if (!picked) return false;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (picked < start) return false;
  const feasibleDate = parseQuotationDate(systemDate);
  return !feasibleDate || picked >= feasibleDate;
}

function tentativeDeliveryDateError(value, systemDate = "") {
  if (!String(value || "").trim()) return "";
  const picked = parseQuotationDate(value);
  if (!picked) return "Custom delivery date is not valid.";
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (picked < start) return "Custom delivery date must be today or later.";
  if (compareQuotationDates(value, systemDate) < 0) {
    return "Custom delivery date cannot be earlier than the system feasible delivery date.";
  }
  return "";
}

function formatQuotationDateField(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.split(" ")[0];
}

function lineHasQuotationBase(line) {
  const base = Number(line?.computed_base_per_unit ?? line?.price_list_rate);
  return Number.isFinite(base) && base > 0;
}

function linePricingBase(line) {
  const computed = Number(line?.computed_base_per_unit);
  if (Number.isFinite(computed) && computed > 0) return computed;
  return Number(line?.price_list_rate) || 0;
}

function pricingBaseFromApi(pricing, fallbackRate = 0) {
  const computed = Number(pricing?.computed_base_per_unit);
  if (Number.isFinite(computed) && computed > 0) return computed;
  return Number(pricing?.price_list_rate) || Number(pricing?.rate) || Number(fallbackRate) || 0;
}

function applyPricingToQuotationLine(line, pricing, fallbackRate = 0) {
  const base = pricingBaseFromApi(pricing, fallbackRate);
  const next = {
    ...line,
    price_list_rate: base,
    computed_base_per_unit: Number(pricing?.computed_base_per_unit) || base,
    has_computed_base: Boolean(pricing?.has_computed_base),
    description: line.description || pricing?.item_name || "",
  };
  if (line.margin_type && String(line.margin_rate_or_amount ?? "") !== "") {
    next.rate = computeQuotationLineRate(base, line.margin_type, line.margin_rate_or_amount, null);
  } else if (!(Number(line.rate) > 0)) {
    next.rate = Number(pricing?.rate) || base;
  }
  return next;
}

function computeQuotationLineRate(priceListRate, marginType, marginValue, explicitRate) {
  const base = Number(priceListRate);
  const margin = Number(marginValue);
  const explicit = Number(explicitRate);
  const hasBase = Number.isFinite(base) && base >= 0;
  const plr = hasBase ? base : 0;

  if (marginType === "Percentage" && Number.isFinite(margin) && margin !== 0 && plr > 0) {
    return Math.max(plr * (1 + margin / 100), 0);
  }
  if (marginType === "Amount" && Number.isFinite(margin) && margin !== 0 && plr > 0) {
    return Math.max(plr + margin, 0);
  }
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  return plr;
}

async function fetchQuotationItemPricing(customerId, itemCode, qty = 1) {
  const customer = String(customerId || "").trim();
  const item = String(itemCode || "").trim();
  if (!customer || !item) return null;
  try {
    const r = await api.get(QUOTATION_ITEM_PRICING_API, {
      params: { customer, item_code: item, qty },
    });
    const msg = r.data?.message || {};
    if (msg?.status === "error") return null;
    return msg;
  } catch {
    return null;
  }
}

function mapQuotationLineItemFromApi(row) {
  const computed = Number(row?.computed_base_per_unit);
  const plr = Number(row?.price_list_rate) || Number(row?.rate) || 0;
  const base = Number.isFinite(computed) && computed > 0 ? computed : plr;
  return {
    item_code: row?.item_code || "",
    qty: row?.qty ?? 1,
    rate: row?.rate ?? 0,
    description: row?.description || row?.item_name || "",
    price_list_rate: base,
    computed_base_per_unit: base,
    has_computed_base: Boolean(row?.has_computed_base),
    margin_type: row?.margin_type || "",
    margin_rate_or_amount:
      row?.margin_rate_or_amount != null && row?.margin_rate_or_amount !== ""
        ? String(row.margin_rate_or_amount)
        : "",
  };
}

const QUOTATION_DISCOUNT_ON_OPTIONS = ["Grand Total", "Net Total"];

function quotationDiscountPayload(form) {
  const pctRaw = String(form?.discount_percent ?? "").trim();
  const amtRaw = String(form?.discount_amount ?? "").trim();
  const pct = pctRaw === "" ? 0 : Number(pctRaw);
  const amt = amtRaw === "" ? 0 : Number(amtRaw);
  const mode = form?._discount_input_mode;
  const safePct = Number.isFinite(pct) ? pct : 0;
  const safeAmt = Number.isFinite(amt) ? amt : 0;
  return {
    discount_percent: mode === "amount" ? 0 : safePct,
    discount_amount: mode === "percent" ? 0 : safeAmt,
    apply_discount_on: QUOTATION_DISCOUNT_ON_OPTIONS.includes(form?.apply_discount_on)
      ? form.apply_discount_on
      : "Grand Total",
  };
}

function quotationItemsForPayload(items) {
  return (items || [])
    .map((it) => ({
      item_code: String(it?.item_code || "").trim(),
      qty: Number(it?.qty) || 1,
      rate: Number(it?.rate) || 0,
      description: it?.description || "",
      price_list_rate: Number(it?.price_list_rate) || 0,
      margin_type: it?.margin_type || "",
      margin_rate_or_amount:
        it?.margin_rate_or_amount != null && it?.margin_rate_or_amount !== ""
          ? Number(it.margin_rate_or_amount) || 0
          : undefined,
    }))
    .filter((it) => it.item_code);
}

async function fetchQuotationTotalsPreview(form) {
  const customer = String(form?.customer || "").trim();
  const items = quotationItemsForPayload(form?.items);
  if (!customer || !items.length) return null;
  try {
    const r = await api.get(QUOTATION_PREVIEW_TOTALS_API, {
      params: {
        customer,
        order_type: form?.order_type || "Sales",
        items: JSON.stringify(items),
        ...quotationDiscountPayload(form),
      },
    });
    const msg = r.data?.message || {};
    if (msg?.status === "error") return null;
    return msg;
  } catch {
    return null;
  }
}

async function fetchQuotationItemComponentCost(itemCode, qty = 1) {
  const item = String(itemCode || "").trim();
  if (!item) return null;
  try {
    const r = await api.get(QUOTATION_COMPONENT_COST_API, {
      params: { item_code: item, qty: Number(qty) || 1 },
    });
    const msg = r.data?.message || {};
    if (msg?.status === "error") return null;
    return msg;
  } catch {
    return null;
  }
}

async function fetchQuotationItemProductionLoad(itemCode) {
  const item = String(itemCode || "").trim();
  if (!item) return null;
  try {
    const r = await api.get(QUOTATION_PRODUCTION_LOAD_API, {
      params: { item_code: item },
    });
    const msg = r.data?.message || {};
    if (msg?.status === "error") return null;
    return msg;
  } catch {
    return null;
  }
}

async function fetchQuotationItemMaterialAvailability(itemCode, qty = 1, plant = "") {
  const item = String(itemCode || "").trim();
  if (!item) return null;
  try {
    const params = { item_code: item, qty: Number(qty) || 1 };
    const plantFilter = String(plant || "").trim();
    if (plantFilter) params.plant = plantFilter;
    const r = await api.get(QUOTATION_MATERIAL_AVAILABILITY_API, { params });
    const msg = r.data?.message || {};
    if (msg?.status === "error") return null;
    return msg;
  } catch {
    return null;
  }
}

function fmtStockQty(value) {
  const n = Number(value || 0);
  return n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

async function fetchQuotationMaterialAvailabilityStep(name, form) {
  const sourceItems = quotationItemsForPayload(form?.items);
  if (!sourceItems.length) return null;
  try {
    const params = {
      items: JSON.stringify(sourceItems),
      plant: String(form?.fulfilment_plant || "").trim(),
      material_arrival_date: form?.material_arrival_date || "",
    };
    const quotName = String(name || "").trim();
    if (quotName) params.name = quotName;
    const r = await api.get(QUOTATION_MATERIAL_AVAILABILITY_STEP_API, { params });
    const msg = r.data?.message || {};
    if (msg?.status === "error") return null;
    return msg;
  } catch {
    return null;
  }
}

async function raiseMaterialRequestForQuotation(name, showToast) {
  const quotName = String(name || "").trim();
  if (!quotName) {
    showToast?.("Save the quotation before raising a Material Request.", "error");
    return null;
  }
  await prefetchCsrf().catch(() => {});
  const res = await api.post(
    QUOTATION_CREATE_MATERIAL_REQUEST_API,
    new URLSearchParams({ name: quotName }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );
  const msg = res?.data?.message || {};
  if (msg?.status && msg.status !== "success") {
    throw new Error(msg.message || "Unable to create Material Request.");
  }
  return msg;
}

async function fetchQuotationDeliveryReadiness(name, items) {
  const sourceItems = quotationItemsForPayload(items);
  if (!sourceItems.length) return null;
  try {
    const params = {
      items: JSON.stringify(sourceItems),
    };
    const quotName = String(name || "").trim();
    if (quotName) params.name = quotName;
    const r = await api.get(QUOTATION_DELIVERY_READINESS_API, { params });
    const msg = r.data?.message || {};
    if (msg?.status === "error") return null;
    return msg;
  } catch {
    return null;
  }
}

async function fetchQuotationCapacitySnapshot(name, form) {
  const sourceItems = quotationItemsForPayload(form?.items);
  if (!sourceItems.length) return null;
  try {
    const params = {
      items: JSON.stringify(sourceItems),
      production_completion_estimate: form?.production_completion_estimate || "",
      material_arrival_date: form?.material_arrival_date || "",
      tentative_delivery_date: form?.tentative_delivery_date || "",
    };
    const quotName = String(name || "").trim();
    if (quotName) params.name = quotName;
    const r = await api.get(QUOTATION_CAPACITY_SNAPSHOT_API, { params });
    const msg = r.data?.message || {};
    if (msg?.status === "error") return null;
    return msg;
  } catch {
    return null;
  }
}

async function fetchQuotationFlowValidation(name, form) {
  const sourceItems = quotationItemsForPayload(form?.items);
  if (!sourceItems.length) return null;
  try {
    const params = {
      items: JSON.stringify(sourceItems),
      customer: String(form?.customer || "").trim(),
      production_completion_estimate: form?.production_completion_estimate || "",
      production_start_date: form?.production_start_date || "",
      material_arrival_date: form?.material_arrival_date || "",
      fulfilment_plant: form?.fulfilment_plant || "",
    };
    const quotName = String(name || "").trim();
    if (quotName) params.name = quotName;
    const r = await api.get(QUOTATION_FLOW_VALIDATION_API, { params });
    const msg = r.data?.message || {};
    if (msg?.status === "error") return null;
    return msg;
  } catch {
    return null;
  }
}

async function fetchQuotationDeliveryOptions(name, form) {
  const sourceItems = quotationItemsForPayload(form?.items);
  if (!sourceItems.length) return null;
  try {
    await prefetchCsrf().catch(() => {});
    const params = {
      items: JSON.stringify(sourceItems),
      production_completion_estimate: form?.production_completion_estimate || "",
      material_arrival_date: form?.material_arrival_date || "",
      tentative_delivery_date: form?.tentative_delivery_date || "",
    };
    const quotName = String(name || "").trim();
    if (quotName) params.name = quotName;
    const r = await api.post(
      QUOTATION_DELIVERY_OPTIONS_API,
      new URLSearchParams(params),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );
    const msg = r.data?.message || {};
    if (msg?.status === "error") return null;
    return msg;
  } catch {
    return null;
  }
}

function deliveryOptionDateForLabel(form, deliveryOptions, label) {
  const optionLabel = String(label || "").trim();
  const row = (deliveryOptions?.options || []).find(
    (item) => String(item?.label || "").trim() === optionLabel,
  );
  if (row?.date) return String(row.date).trim();
  const fieldByLabel = {
    "5 Days": form?.delivery_option_5,
    "7 Days": form?.delivery_option_7,
    "10 Days": form?.delivery_option_10,
  };
  return String(fieldByLabel[optionLabel] || "").trim();
}

function isAllowedQuotationAttachment(file) {
  const name = String(file?.name || "").toLowerCase();
  return name.endsWith(".pdf") || name.endsWith(".doc") || name.endsWith(".docx");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      const base64 = raw.includes(",") ? raw.split(",")[1] : raw;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

async function uploadQuotationAttachment(file, quotationName = "") {
  if (!file) return null;
  const base64 = await fileToBase64(file);
  const r = await api.post(QUOTATION_ATTACHMENT_UPLOAD_API, {
    filename: file.name,
    content_base64: base64,
    doctype: quotationName ? "Quotation" : "",
    docname: quotationName || "",
  });
  const msg = r.data?.message || {};
  if (msg?.status === "error") throw new Error(msg.message || "Unable to upload attachment.");
  return msg;
}

function quotationLineSubtotal(items) {
  return (items || []).reduce(
    (sum, it) => sum + (Number(it.qty) || 0) * (Number(it.rate) || 0),
    0,
  );
}

function formatDiscountAmountInput(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "";
  return n.toFixed(2).replace(/\.?0+$/, "");
}

function formatDiscountPercentInput(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n) || n <= 0) return "";
  return n.toFixed(4).replace(/\.?0+$/, "");
}

function calculateDiscountAmountFromPercent(items, discountPercent) {
  const pct = Number(discountPercent);
  if (!Number.isFinite(pct) || pct <= 0) return "";
  return formatDiscountAmountInput((quotationLineSubtotal(items) * pct) / 100);
}

function calculateDiscountPercentFromAmount(items, discountAmount) {
  const base = quotationLineSubtotal(items);
  const amount = Number(discountAmount);
  if (!Number.isFinite(amount) || amount <= 0 || base <= 0) return "";
  return formatDiscountPercentInput((amount / base) * 100);
}

function estimateQuotationTotalAfterDiscount(subtotal, discountPercent, discountAmount, discountInputMode = "") {
  const base = Number(subtotal) || 0;
  const pct = Number(discountPercent) || 0;
  const amt = Number(discountAmount) || 0;
  if (discountInputMode === "amount" && amt > 0) return Math.max(base - amt, 0);
  if (pct > 0) return Math.max(base * (1 - pct / 100), 0);
  if (amt > 0) return Math.max(base - amt, 0);
  return base;
}

/** Saved ERPNext totals on an existing quotation (used when edit form is locked). */
function quotationSavedTotalsFromForm(form) {
  if (!form?.name) return null;
  const net = Number(form.net_total);
  const gst = Number(form.gst_amount ?? form.total_taxes_and_charges);
  const grand = Number(form.grand_total);
  const hasSaved = (
    (Number.isFinite(grand) && grand > 0)
    || (Number.isFinite(gst) && gst > 0)
    || (Number.isFinite(net) && net > 0)
  );
  if (!hasSaved) return null;
  return {
    net_total: Number.isFinite(net) ? net : quotationLineSubtotal(form.items),
    gst_amount: Number.isFinite(gst) ? gst : 0,
    grand_total: Number.isFinite(grand)
      ? grand
      : (Number.isFinite(net) ? net : quotationLineSubtotal(form.items))
        + (Number.isFinite(gst) ? gst : 0),
    taxes: Array.isArray(form.taxes) ? form.taxes : [],
    taxes_and_charges: form.taxes_and_charges || "",
  };
}

const QUOTATION_ORDER_TYPES = ["Sales", "Maintenance"];

const CUSTOMER_PURCHASED_PRODUCTS_API =
  "/api/method/sales_app.api.lead.get_customer_purchased_products_history";

const CUSTOMER_LAST_SELLING_PRICE_API =
  "/api/method/sales_app.api.lead.get_customer_last_selling_price";

const CUSTOMER_QUOTATION_HISTORY_API =
  "/api/method/sales_app.api.lead.get_customer_quotation_history";

const QUOTATION_DETAIL_API =
  "/api/method/sales_app.api.quotation.get_quotation";

const QUOTATION_HISTORY_LIMIT = 10;

function fmtProductAmount(amount, currency = "INR") {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return fmt(n);
  }
}

async function fetchQuotationCustomerPurchasedProducts(customerId) {
  if (!customerId) return [];
  try {
    const r = await api.get(CUSTOMER_PURCHASED_PRODUCTS_API, {
      params: { customer: customerId },
    });
    return r.data?.message?.products || [];
  } catch {
    return [];
  }
}

async function fetchQuotationLastSellingPrice(customerId, itemCode) {
  const customer = String(customerId || "").trim();
  const item = String(itemCode || "").trim();
  if (!customer || !item) return { found: false, price: null };
  try {
    const r = await api.get(CUSTOMER_LAST_SELLING_PRICE_API, {
      params: { customer, product_interested: item },
    });
    return r.data?.message || { found: false, price: null };
  } catch {
    return { found: false, price: null };
  }
}

async function fetchQuotationCustomerQuotationHistory(customerId, limit = QUOTATION_HISTORY_LIMIT) {
  const customer = String(customerId || "").trim();
  if (!customer) return [];
  try {
    const r = await api.get(CUSTOMER_QUOTATION_HISTORY_API, {
      params: { customer, limit },
    });
    return r.data?.message?.quotations || [];
  } catch {
    return [];
  }
}

async function fetchQuotationDetailForCopy(name) {
  const quotName = String(name || "").trim();
  if (!quotName) throw new Error("Quotation is required.");
  const r = await api.get(QUOTATION_DETAIL_API, { params: { name: quotName } });
  const detail = r.data?.message;
  if (!detail?.name) throw new Error("Could not load quotation.");
  return detail;
}

function mapQuotationItemsForForm(items) {
  const rows = (items || [])
    .map((row) => mapQuotationLineItemFromApi(row))
    .filter((row) => row.item_code);
  return rows.length ? rows : [{ ...initItem }];
}

function applyPreviousQuotationToForm(setForm, source) {
  if (!source) return;
  const items = mapQuotationItemsForForm(source.items);
  const discountPct = Number(source.discount_percent);
  const discountAmt = Number(source.discount_amount);
  const hasPct = Number.isFinite(discountPct) && discountPct > 0;
  const hasAmt = Number.isFinite(discountAmt) && discountAmt > 0;
  setForm((f) => ({
    ...f,
    order_type: normalizeQuotationOrderType(source.order_type || f.order_type),
    terms: source.terms ?? f.terms ?? "",
    note: source.note ?? f.note ?? "",
    discount_percent: hasPct ? String(discountPct) : "",
    discount_amount: !hasPct && hasAmt ? String(discountAmt) : "",
    _discount_input_mode: hasPct ? "percent" : hasAmt ? "amount" : "",
    apply_discount_on: source.apply_discount_on || f.apply_discount_on || "Grand Total",
    tentative_delivery_date: formatQuotationDateField(
      source.tentative_delivery_date || f.tentative_delivery_date,
    ),
    system_delivery_date: formatQuotationDateField(
      source.system_delivery_date || f.system_delivery_date,
    ),
    items,
  }));
}

function ratesMatchForQuotation(a, b) {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) < 0.005;
}

function QuotationLineLastPriceHint({
  customerId,
  itemCode,
  disabled,
  currentRate,
  onUseLastPrice,
}) {
  const [priceInfo, setPriceInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const loadRef = useRef(0);

  useEffect(() => {
    const customer = String(customerId || "").trim();
    const item = String(itemCode || "").trim();
    if (!customer || !item) {
      loadRef.current += 1;
      setPriceInfo(null);
      setLoading(false);
      return undefined;
    }
    const loadId = ++loadRef.current;
    setLoading(true);
    fetchQuotationLastSellingPrice(customer, item)
      .then((info) => {
        if (loadId !== loadRef.current) return;
        setPriceInfo(info);
      })
      .finally(() => {
        if (loadId === loadRef.current) setLoading(false);
      });
    return () => {
      loadRef.current += 1;
    };
  }, [customerId, itemCode]);

  const customer = String(customerId || "").trim();
  const item = String(itemCode || "").trim();
  if (!customer || !item) return null;

  if (loading) {
    return (
      <div className="qt-line-last-price qt-line-last-price--loading">
        Loading last selling price…
      </div>
    );
  }

  if (!priceInfo?.found || !priceInfo?.price) {
    return (
      <div className="qt-line-last-price qt-line-last-price--empty">
        No previous selling price for this item with this customer.
      </div>
    );
  }

  const p = priceInfo.price;
  const lastRate = Number(p.last_rate);
  const rateApplied = ratesMatchForQuotation(currentRate, lastRate);

  return (
    <div className="qt-line-last-price">
      <div className="qt-line-last-price__text">
        <span className="qt-line-last-price__label">Last sold</span>
        <span className="qt-line-last-price__amount">{fmtProductAmount(p.last_rate, p.currency)}</span>
        <span className="qt-line-last-price__meta">
          {p.last_order ? `Order ${p.last_order}` : ""}
          {p.last_date ? `${p.last_order ? " · " : ""}${p.last_date}` : ""}
        </span>
      </div>
      {!disabled && onUseLastPrice && Number.isFinite(lastRate) && (
        <button
          type="button"
          className="pm-btn pm-btn-ghost qt-line-last-price__btn"
          disabled={rateApplied}
          onClick={() => onUseLastPrice(lastRate)}
        >
          {rateApplied ? "Applied" : "Use last price"}
        </button>
      )}
    </div>
  );
}

function applyPurchasedProductToQuotation(setForm, product) {
  const code = String(product?.item_code || "").trim();
  if (!code) return;
  const qtyRaw = Number(product?.last_qty);
  const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
  const rateRaw = Number(product?.last_rate);
  const rate = Number.isFinite(rateRaw) && rateRaw >= 0 ? rateRaw : 0;
  const description = product?.item_name || "";
  setForm((f) => {
    const items = [...(f.items || [{ ...initItem }])];
    const emptyIdx = items.findIndex((it) => !String(it.item_code || "").trim());
    const row = {
      item_code: code,
      qty,
      rate,
      description,
      price_list_rate: rate,
      margin_type: "",
      margin_rate_or_amount: "",
    };
    if (emptyIdx >= 0) {
      items[emptyIdx] = { ...items[emptyIdx], ...row };
    } else {
      items.push(row);
    }
    return { ...f, items };
  });
}

function QuotationPurchasedProductsPanel({
  customerId,
  disabled,
  onAddProduct,
  addedItemCodes,
}) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const loadRef = useRef(0);

  useEffect(() => {
    const customer = String(customerId || "").trim();
    if (!customer) {
      loadRef.current += 1;
      setProducts([]);
      setLoading(false);
      return undefined;
    }
    const loadId = ++loadRef.current;
    setLoading(true);
    fetchQuotationCustomerPurchasedProducts(customer)
      .then((rows) => {
        if (loadId !== loadRef.current) return;
        setProducts(rows || []);
      })
      .finally(() => {
        if (loadId === loadRef.current) setLoading(false);
      });
    return () => {
      loadRef.current += 1;
    };
  }, [customerId]);

  if (!customerId) return null;

  return (
    <div className="qt-customer-products">
      <div className="qt-customer-products__title">Previously purchased products</div>
      {loading ? (
        <p className="qt-customer-products__hint">Loading previous purchased products…</p>
      ) : !products.length ? (
        <p className="qt-customer-products__hint">No previous purchased products for this customer.</p>
      ) : (
        <div className="qt-customer-products__table-wrap">
          <table className="pm-table qt-customer-products__table">
            <thead>
              <tr>
                {[
                  { label: "Product", className: "qt-col-code" },
                  { label: "Item name", className: "qt-col-name" },
                  { label: "Last qty", className: "qt-col-num" },
                  { label: "Last rate", className: "qt-col-num" },
                  { label: "Last order", className: "qt-col-doc" },
                  { label: "Date", className: "qt-col-date" },
                  { label: "Action", className: "qt-col-action" },
                ].map((col) => (
                  <th key={col.label} className={col.className}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const isAdded = addedItemCodes?.has?.(p.item_code);
                return (
                  <tr
                    key={p.item_code}
                    className={isAdded ? "qt-customer-products__row--added" : undefined}
                  >
                    <td className="qt-col-code">{p.item_code}</td>
                    <td className="qt-col-name">{p.item_name || "—"}</td>
                    <td className="qt-col-num">{p.last_qty ?? "—"}</td>
                    <td className="qt-col-num">{fmtProductAmount(p.last_rate, p.currency)}</td>
                    <td className="qt-col-doc">{p.last_order || "—"}</td>
                    <td className="qt-col-date">{p.last_date || "—"}</td>
                    <td className="qt-col-action">
                      <button
                        type="button"
                        className="pm-btn pm-btn-ghost qt-customer-products__add-btn"
                        disabled={disabled || !onAddProduct}
                        onClick={() => onAddProduct?.(p)}
                      >
                        {isAdded ? "Added" : "Add to quote"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function QuotationPreviousQuotationsPanel({
  customerId,
  disabled,
  currentQuotationName,
  onCopy,
  copyingQuotationName,
  copiedFromQuotationName,
}) {
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(false);
  const loadRef = useRef(0);

  useEffect(() => {
    const customer = String(customerId || "").trim();
    if (!customer) {
      loadRef.current += 1;
      setQuotations([]);
      setLoading(false);
      return undefined;
    }
    const loadId = ++loadRef.current;
    setLoading(true);
    fetchQuotationCustomerQuotationHistory(customer)
      .then((rows) => {
        if (loadId !== loadRef.current) return;
        setQuotations(rows || []);
      })
      .finally(() => {
        if (loadId === loadRef.current) setLoading(false);
      });
    return () => {
      loadRef.current += 1;
    };
  }, [customerId]);

  if (!customerId) return null;

  const currentName = String(currentQuotationName || "").trim();

  return (
    <div className="qt-customer-products qt-customer-quotation-history">
      <div className="qt-customer-products__title">Previous quotations</div>
      {loading ? (
        <p className="qt-customer-products__hint">Loading previous quotations…</p>
      ) : !quotations.length ? (
        <p className="qt-customer-products__hint">No previous quotations for this customer.</p>
      ) : (
        <div className="qt-customer-products__table-wrap">
          <table className="pm-table qt-customer-products__table">
            <thead>
              <tr>
                {[
                  { label: "Quotation", className: "qt-col-doc" },
                  { label: "Date", className: "qt-col-date" },
                  { label: "Amount", className: "qt-col-num" },
                  { label: "Status", className: "qt-col-status" },
                  { label: "Valid till", className: "qt-col-date" },
                  { label: "Action", className: "qt-col-action" },
                ].map((col) => (
                  <th key={col.label} className={col.className}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quotations.map((q) => {
                const isCopying = copyingQuotationName === q.name;
                const isCopied = copiedFromQuotationName === q.name;
                const isCurrent = currentName && currentName === q.name;
                return (
                  <tr
                    key={q.name}
                    className={isCopied ? "qt-customer-products__row--added" : undefined}
                  >
                    <td className="qt-col-doc">{q.name}</td>
                    <td className="qt-col-date">{q.date || "—"}</td>
                    <td className="qt-col-num">{fmtProductAmount(q.grand_total, q.currency)}</td>
                    <td className="qt-col-status">{q.status || "—"}</td>
                    <td className="qt-col-date">{q.valid_till || "—"}</td>
                    <td className="qt-col-action">
                      <button
                        type="button"
                        className="pm-btn pm-btn-ghost qt-customer-products__add-btn"
                        disabled={disabled || !onCopy || isCopying || isCurrent}
                        onClick={() => onCopy?.(q)}
                      >
                        {isCurrent ? "Current" : isCopying ? "Copying…" : isCopied ? "Copied" : "Copy to quote"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function quotationOrderTypes(apiTypes) {
  const base = apiTypes?.length ? apiTypes : QUOTATION_ORDER_TYPES;
  const filtered = base.filter((o) => o && o !== "Shopping Cart");
  return filtered.length ? filtered : QUOTATION_ORDER_TYPES;
}

function normalizeQuotationOrderType(value) {
  if (!value || value === "Shopping Cart") return "Sales";
  return quotationOrderTypes([value]).includes(value) ? value : "Sales";
}

const FRAPPE_OPS_ADMIN_ROLES = new Set(["Administrator", "System Manager"]);

function hasFrappeRole(roles = [], allowed = []) {
  const roleSet = new Set((roles || []).map((r) => String(r || "").trim()));
  return allowed.some((role) => roleSet.has(role));
}

function hasStoresRole(roles = []) {
  return hasFrappeRole(roles, ["Stock Manager", "Stores", ...FRAPPE_OPS_ADMIN_ROLES]);
}

function hasProductionHeadRole(roles = []) {
  return hasFrappeRole(roles, ["Production Head", ...FRAPPE_OPS_ADMIN_ROLES]);
}

function buildPlanningApiForm(form, planningSnapshot, isNew) {
  if (isNew) {
    return {
      ...form,
      production_start_date: "",
      production_completion_estimate: "",
      material_arrival_date: "",
      machine_allocation: [],
    };
  }
  return {
    ...form,
    production_start_date: planningSnapshot.production_start_date || "",
    production_completion_estimate: planningSnapshot.production_completion_estimate || "",
    material_arrival_date: planningSnapshot.material_arrival_date || "",
    machine_allocation: planningSnapshot.machine_allocation || [],
  };
}

/** Stable key for delivery-options API — only planning inputs that affect 5/7/10 cards. */
function buildPlanningOptionsKey(form, planningSnapshot, isNew) {
  const items = quotationItemsForPayload(form?.items);
  if (!items.length) return "";
  if (isNew) {
    return JSON.stringify({ items, production: "", material: "" });
  }
  return JSON.stringify({
    name: String(form?.name || "").trim(),
    items,
    production: planningSnapshot.production_completion_estimate || "",
    production_start: planningSnapshot.production_start_date || "",
    material: planningSnapshot.material_arrival_date || "",
  });
}

function persistedDeliveryPlanStatus(form) {
  return String(form?.delivery_plan_status || "Draft").trim() || "Draft";
}

function shouldApplyDeliveryPlanStatus(currentStatus, incomingStatus, selectionInvalidated) {
  const current = String(currentStatus || "").trim();
  const incoming = String(incomingStatus || "").trim();
  if (!incoming) return false;
  if (selectionInvalidated) return incoming !== current;
  if (current === "Finalized") return false;
  if (incoming === "Options Ready" && current === "Awaiting Production") return false;
  return incoming !== current;
}

function isDeliveryPlanSelectableStatus(status) {
  const label = String(status || "").trim();
  return label === "Options Ready" || label === "Finalized";
}

function formatPlanningDisplayDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  return formatDisplayDate(raw) || raw;
}

function QuotationPlanningStepBanner({
  persistedPlanStatus,
  materialsAvailable,
  canSelectDeliveryOption,
  isFinalized,
  quotation,
  autoApproveEligible = false,
}) {
  const status = persistedPlanStatus;
  let message = "";

  if (status === "Awaiting Stores") {
    message = "Materials are pending from Stores. Delivery options unlock when stock is ready.";
  } else if (status === "Awaiting Production") {
    message = materialsAvailable
      ? "Next: Production Head should commit capacity in Manufacturing > Capacity Commitments (capacity is tight)."
      : "Waiting for Production to commit capacity.";
  } else if (status === "Options Ready") {
    message = canSelectDeliveryOption
      ? "Material and capacity are ready. Select 5, 7, or 10 day delivery option below."
      : "Waiting for Sales to select a delivery option.";
  } else if (status === "Finalized" || isFinalized) {
    if (Number(quotation?.docstatus) === 1) {
      message = "Delivery plan complete. Quotation is submitted.";
    } else if (isAutoApprovedAwaitingCustomer(quotation)) {
      message = "Auto-approve path: send to customer, then record accept/reject to finalize approval.";
    } else if (isPendingApproval(quotation)) {
      message = "Awaiting Sales Manager approval.";
    } else if (isRejectedApproval(quotation)) {
      message = "Quotation was rejected. Revise rates and resubmit for approval.";
    } else {
      message = autoApproveEligible
        ? "Margin is above base cost. Use Submit quotation (auto-approve) in the footer."
        : "Delivery option saved. Submit for manager approval from the footer.";
    }
  } else {
    message = "Add line items to start delivery planning.";
  }

  return (
    <div className="qt-planning-step-banner">
      <span className="qt-planning-step-banner__detail">{message}</span>
    </div>
  );
}

function QuotationPlanningReadOnlyRow({ label, value }) {
  return (
    <div className="qt-planning-readonly-row">
      <span className="qt-planning-readonly-row__label">{label}</span>
      <span className="qt-planning-readonly-row__value">{value}</span>
    </div>
  );
}

function isDeliveryPlanFinalized(quotation) {
  if (!quotation) return false;
  const selected = String(quotation.selected_delivery_option || "").trim();
  const systemDate = String(quotation.system_delivery_date || "").trim();
  if (!selected || !systemDate) return false;
  const status = String(quotation.delivery_plan_status || "").trim();
  if (status === "Finalized") return true;
  return status === "Options Ready";
}

function quotationEffectiveDeliveryDate(quotation, systemEstimate = "") {
  const custom = formatQuotationDateField(quotation?.tentative_delivery_date);
  const system = quotationFeasibleSystemDate(quotation, systemEstimate);
  if (custom && (!system || compareQuotationDates(custom, system) >= 0)) return custom;
  return system;
}

/** Compact dual-date panel: custom pick (left) + 3-step status (right). */
function QuotationDeliveryDatesFlow({ form, systemEstimate = "", locked = false }) {
  const custom = formatQuotationDateField(form?.tentative_delivery_date);
  const system = quotationFeasibleSystemDate(form, systemEstimate);
  const estimate = formatQuotationDateField(systemEstimate);
  const systemDisplay = system || estimate;
  const systemIsEstimate = Boolean(!formatQuotationDateField(form?.system_delivery_date) && estimate);
  const planDone = isDeliveryPlanFinalized(form);
  const committed = quotationEffectiveDeliveryDate(form, systemEstimate);
  const customBeforeSystem = Boolean(custom && system && compareQuotationDates(custom, system) < 0);

  const steps = [
    {
      id: "custom",
      label: "Custom delivery date",
      done: Boolean(custom),
      value: custom,
    },
    {
      id: "system",
      label: "System delivery date",
      done: planDone,
      value: systemDisplay,
      sub: systemIsEstimate ? "estimated preview" : (form?.selected_delivery_option || ""),
    },
    {
      id: "committed",
      label: "Committed date (Sales Order)",
      done: Boolean(committed),
      value: committed,
    },
  ];

  return (
    <div className="qt-delivery-dates-flow" role="region" aria-label="Delivery date flow">
      <p className="qt-delivery-dates-flow__title">Delivery date flow</p>
      <ol className="qt-delivery-dates-flow__list">
        {steps.map((step, idx) => (
          <li
            key={step.id}
            className={`qt-delivery-dates-flow__step${step.done ? " qt-delivery-dates-flow__step--done" : ""}`}
          >
            <span className="qt-delivery-dates-flow__step-num">{idx + 1}</span>
            <div className="qt-delivery-dates-flow__step-body">
              <span className="qt-delivery-dates-flow__step-label">{step.label}</span>
              {step.value ? (
                <span className="qt-delivery-dates-flow__step-value">
                  {formatDisplayDate(step.value)}
                  {step.sub ? <em className="qt-delivery-dates-flow__step-sub"> · {step.sub}</em> : null}
                </span>
              ) : (
                <span className="qt-delivery-dates-flow__step-pending">
                  {step.id === "system" ? "Select 5 / 7 / 10 days below" : "—"}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="qt-delivery-dates-flow__rule">
        Sales Order uses the feasible system date unless the customer requests a later date.
      </p>
      {customBeforeSystem ? (
        <p className="qt-delivery-dates-flow__locked">
          Custom date is earlier than system feasibility. Sales Order will use {formatDisplayDate(system)}.
        </p>
      ) : null}
      {locked ? (
        <p className="qt-delivery-dates-flow__locked">Locked while submitted or in approval.</p>
      ) : null}
    </div>
  );
}

function deliveryPlanningBannerMessage() {
  return null;
}

function quotationListPlanHint(quotation) {
  const portal = quotationDisplayStatus(quotation);
  const plan = String(quotation?.delivery_plan_status || "").trim();
  if (!plan || plan === "Draft") return "";
  if (portal !== "Draft" && portal !== "Open") return "";
  if (plan === "Finalized" && isDeliveryPlanFinalized(quotation)) return "";
  return plan;
}

const QT_KPI_IDS = ["total", "ordered", "open_quotes", "open_value", "expired", "avg_value"];
/** Status values shown in the toolbar filter (only these + All). */
const QT_AWAITING_APPROVAL_LABEL = "Awaiting Approval";
const QT_AWAITING_CUSTOMER_LABEL = "Awaiting Customer";
/** Status values shown in the toolbar filter (only these + All). */
const QT_STATUS_FILTER_OPTIONS = ["Draft", QT_AWAITING_APPROVAL_LABEL, QT_AWAITING_CUSTOMER_LABEL, "Rejected", "Open", "Expired"];

const QT_STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...QT_STATUS_FILTER_OPTIONS.map((s) => ({ value: s, label: s })),
];

/** Trimmed string for comparisons */
function normQtStatus(s) {
  return String(s ?? "").trim();
}

/** Status pill colors — keys are lower-case (matches ERPNext + API casing). */
const QUOTATION_STATUS_PILL = {
  draft: { fg: C.muted, bg: C.surface2 },
  "pending approval": { fg: C.amber, bg: C.amberLt },
  "awaiting approval": { fg: C.amber, bg: C.amberLt },
  "awaiting customer": { fg: C.teal, bg: C.tealLt },
  "auto approved": { fg: C.green, bg: C.greenDim },
  rejected: { fg: C.red, bg: C.redDim },
  open: { fg: C.teal, bg: C.tealLt },
  replied: { fg: C.indigo, bg: C.indigoLt },
  "partially ordered": { fg: C.amber, bg: C.amberLt },
  ordered: { fg: C.green, bg: C.greenDim },
  lost: { fg: C.sub, bg: C.surface2 },
  cancelled: { fg: C.red, bg: C.redDim },
  expired: { fg: C.red, bg: C.redLt },
  submitted: { fg: C.indigo, bg: C.indigoLt },
};

function quotationPillTheme(statusRaw) {
  const key = normQtStatus(statusRaw).toLowerCase() || "draft";
  return QUOTATION_STATUS_PILL[key] || { fg: C.sub, bg: C.surface2 };
}

function isQuotationDraftLike(status, docstatus = 0) {
  if (Number(docstatus) === 1) return false;
  const t = normQtStatus(status).toLowerCase();
  return !t || t === "draft";
}

/** Draft + Open — matches dashboard_data draft bucket for KPI drill. */
function isQuotationOpenLike(status, docstatus = 0) {
  if (Number(docstatus) === 1) return false;
  const t = normQtStatus(status).toLowerCase();
  return !t || t === "draft" || t === "open";
}

function isAutoApprovedAwaitingCustomer(q) {
  if (Number(q?.docstatus) === 1) return false;
  if (q?.awaiting_customer === true) return true;
  return normQtStatus(q?.portal_approval_status).toLowerCase() === "auto approved";
}

function quotationCustomerActionsReady(q) {
  if (!q?.name) return false;
  if (q.superseded_by) return false;
  return Number(q?.docstatus) === 1 || isAutoApprovedAwaitingCustomer(q);
}

function quotationDisplayStatus(q) {
  if (Number(q?.docstatus) === 1) return normQtStatus(q?.status || q?.display_status) || "Open";
  if (isRejectedApproval(q)) return "Rejected";
  if (isAutoApprovedAwaitingCustomer(q)) return QT_AWAITING_CUSTOMER_LABEL;
  if (isPendingApproval(q)) return QT_AWAITING_APPROVAL_LABEL;
  return normQtStatus(q?.display_status || q?.portal_approval_status) || "Draft";
}

function isPendingApproval(q) {
  if (Number(q?.docstatus) === 1) return false;
  if (isAutoApprovedAwaitingCustomer(q)) return false;
  const portal = normQtStatus(q?.portal_approval_status).toLowerCase();
  if (portal === "rejected") return false;
  if (portal === "pending approval") return true;
  return Boolean(q?.submitted_for_approval_at);
}

function isRejectedApproval(q) {
  return Number(q?.docstatus) !== 1
    && normQtStatus(q?.portal_approval_status).toLowerCase() === "rejected";
}

function formatQuotationMarginPct(pricing) {
  const marginPct = pricing?.margin_pct;
  if (marginPct == null || !Number.isFinite(Number(marginPct))) return "";
  return ` · ${Number(marginPct).toFixed(1)}%`;
}

/** Pricing pill: separates margin math from approval workflow state. */
function quotationMarginPillDisplay(quotation, pricing) {
  const suffix = formatQuotationMarginPct(pricing);
  const autoApprove = Boolean(pricing?.auto_approve);
  const submitted = Number(quotation?.docstatus) === 1;

  if (submitted) {
    return {
      label: autoApprove ? `Auto approved${suffix}` : `Manager approved${suffix}`,
      variant: autoApprove ? "ok" : "info",
    };
  }
  if (isPendingApproval(quotation)) {
    return {
      label: `Pending manager approval${suffix}`,
      variant: "pending",
    };
  }
  if (isAutoApprovedAwaitingCustomer(quotation)) {
    return {
      label: `Auto approve · awaiting customer${suffix}`,
      variant: "ok",
    };
  }
  if (isRejectedApproval(quotation)) {
    return {
      label: `Rejected${suffix}`,
      variant: "warn",
    };
  }
  if (autoApprove) {
    return {
      label: `Auto approve${suffix}`,
      variant: "ok",
    };
  }
  return {
    label: `Below base cost${suffix}`,
    variant: "warn",
  };
}

function quotationMarginPillClass(variant) {
  const base = "qt-flow-margin-pill";
  if (variant === "ok") return `${base} qt-flow-margin-pill--ok`;
  if (variant === "info") return `${base} qt-flow-margin-pill--info`;
  if (variant === "pending") return `${base} qt-flow-margin-pill--pending`;
  return `${base} qt-flow-margin-pill--warn`;
}

/** Match `dashboard_data` rules for expired (valid_till past, not Ordered/Cancelled). */
function quotationIsExpired(q, startOfToday) {
  const st = normQtStatus(q.status).toLowerCase();
  if (!q.valid_till) return false;
  if (st === "ordered" || st === "cancelled") return false;
  const vt = new Date(q.valid_till);
  vt.setHours(0, 0, 0, 0);
  return vt < startOfToday;
}

/**
 * Table status filter: Draft / Open / Expired only (+ All).
 * Expired uses valid_till (same rule as KPI drill), not status text alone.
 */
function quotationRowMatchesStatusFilter(qt, filterRaw, startOfToday) {
  const f = normQtStatus(filterRaw);
  if (!f) return true;
  const fl = f.toLowerCase();
  if (fl === "expired") {
    return quotationIsExpired(qt, startOfToday);
  }
  const r = quotationDisplayStatus(qt);
  const rl = r.toLowerCase();
  if (fl === "draft") {
    return isQuotationDraftLike(qt?.status, qt?.docstatus)
      && !isPendingApproval(qt)
      && !isRejectedApproval(qt)
      && !isAutoApprovedAwaitingCustomer(qt);
  }
  if (fl === "awaiting approval" || fl === "pending approval") {
    return isPendingApproval(qt);
  }
  if (fl === "awaiting customer") {
    return isAutoApprovedAwaitingCustomer(qt);
  }
  if (fl === "rejected") {
    return isRejectedApproval(qt);
  }
  if (fl === "open") {
    return rl === "open";
  }
  return rl === fl;
}

function kpiSpec(id, dash) {
  const total = Number(dash?.total || 0);
  const totalVal = Number(dash?.total_val || 0);
  const ordered = Number(dash?.ordered || 0);
  const orderedVal = Number(dash?.ordered_val || 0);
  const openCount = Math.max(total - ordered, 0);
  const openVal = Math.max(totalVal - orderedVal, 0);
  const avgVal = total > 0 ? totalVal / total : 0;

  switch (id) {
    case "total":
      return {
        label: "Total Value",
        value: fmtK(totalVal),
        sub: `${total} quotations`,
        accent: QT_ACCENT,
        icon: "sales",
      };
    case "ordered":
      return {
        label: "Ordered Value",
        value: fmtK(dash?.ordered_val || 0),
        sub: `${dash?.ordered || 0} converted`,
        accent: C.green,
        icon: "check",
      };
    case "open_quotes":
      return {
        label: "Open Quotations",
        value: dash?.draft || 0,
        sub: "Draft / Open",
        accent: C.teal,
        icon: "invoice",
      };
    case "open_value":
      return {
        label: "Open Pipeline",
        value: fmtK(openVal),
        sub: `${openCount} pending`,
        accent: C.indigo,
        icon: "folder",
      };
    case "expired":
      return {
        label: "Expired",
        value: dash?.expired || 0,
        sub: "Past valid date",
        accent: C.red,
        icon: "clock",
      };
    case "avg_value":
      return {
        label: "Avg Quote Value",
        value: fmtK(avgVal),
        sub: "Per quotation",
        accent: C.slate,
        icon: "chart",
      };
    default:
      return { label: "", value: "", sub: "", accent: C.slate, icon: "" };
  }
}

/* ─── Card wrapper ───────────────────────────────────────────── */
const Card = ({ title, action, children }) => (
  <div className="qt-card">
    {title ? (
      <div className="qt-card-hd">
        <span className="qt-card-title">{title}</span>
        {action}
      </div>
    ) : null}
    <div className="qt-card-body">{children}</div>
  </div>
);

/* ─── Status Pill ────────────────────────────────────────────── */
const Pill = ({ status }) => {
  const label = normQtStatus(status) || "Draft";
  const { fg, bg } = quotationPillTheme(status);
  return <span className="sales-status-pill" style={{ "--pill-fg": fg, "--pill-bg": bg }}>{label}</span>;
};

function QuotationListStatus({ quotation, submitting, onSubmitForApproval, canSubmitForApproval }) {
  const display = quotationDisplayStatus(quotation);
  const planHint = quotationListPlanHint(quotation);
  const rejected = isRejectedApproval(quotation);
  const showResubmit = rejected && canSubmitForApproval && Number(quotation?.docstatus) !== 1
    && isDeliveryPlanFinalized(quotation);

  return (
    <div className="qt-list-status-cell">
      <Pill status={display} />
      {planHint ? (
        <span className={`qt-list-plan-pill${deliveryPlanPillClass(planHint)}`}>{planHint}</span>
      ) : null}
      {showResubmit && (
        <button
          type="button"
          className="pm-btn pm-btn-ghost qt-btn-ghost qt-btn-compact qt-resubmit-btn"
          disabled={submitting}
          title="Resubmit for approval"
          onClick={(e) => { e.stopPropagation(); onSubmitForApproval?.(quotation.name); }}
        >
          {submitting ? "Submitting…" : "Resubmit"}
        </button>
      )}
    </div>
  );
}

/* ─── Toast state ────────────────────────────────────────────── */

const QT_TRAIL_ROUTES = {
  Lead: "/sales/leads",
  Opportunity: "/sales/opportunities",
  "Sales Order": "/sales/orders",
  ...FINANCE_DOC_TRAIL_ROUTES,
};

function fmtQtTrailAmount(value) {
  const n = Number(value);
  if (!n) return "";
  return `₹ ${n.toLocaleString("en-IN")}`;
}

function QuotationDocumentTrail({ trail, loading, onNavigate }) {
  if (loading) {
    return (
      <div className="lm-view-panel lm-view-doc-trail">
        <div className="lm-view-panel-title">Document trail</div>
        <p className="lm-doc-trail__loading">Loading linked documents…</p>
      </div>
    );
  }
  if (!trail) return null;

  if (!trail.has_documents) {
    return (
      <div className="lm-view-panel lm-view-doc-trail">
        <div className="lm-view-panel-title">Document trail</div>
        <p className="lm-doc-trail__empty">No linked documents yet.</p>
      </div>
    );
  }

  const sections = [
    { label: "Lead", items: trail.lead ? [trail.lead] : [] },
    { label: "Opportunity", items: trail.opportunity ? [trail.opportunity] : [] },
    { label: "Sales orders", items: trail.sales_orders || [] },
    { label: "Delivery notes", items: trail.delivery_notes || [] },
    { label: "Invoices", items: trail.invoices || [] },
  ];

  return (
    <div className="lm-view-panel lm-view-doc-trail">
      <div className="lm-view-panel-title">Document trail</div>
      {sections.map(({ label, items }) => (
        items.length > 0 ? (
          <div key={label} className="lm-doc-trail__section">
            <div className="lm-doc-trail__section-title">{label}</div>
            <ul className="lm-doc-trail__list">
              {items.map((row) => (
                <li key={`${row.doctype}-${row.name}`}>
                  <button type="button" className="lm-doc-trail__link" onClick={() => onNavigate(row)}>
                    <span className="lm-doc-trail__name">{row.name}</span>
                    {row.status && row.status !== "-" && (
                      <span className="lm-doc-trail__status">{row.status}</span>
                    )}
                    {row.grand_total != null && Number(row.grand_total) > 0 && (
                      <span className="lm-doc-trail__amount">{fmtQtTrailAmount(row.grand_total)}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════ */
export default function QuotationDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const openedFromUrlRef = useRef("");
  const [dash, setDash]           = useState(null);
  const [quots, setQuots]         = useState([]);
  const [opts, setOpts]           = useState({ customers: [], items: [], order_type: [], status: [] });
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm]   = useState(false);
  const [viewQ, setViewQ]         = useState(null);   // full detail obj
  const [viewLoading, setViewLoading] = useState(false);
  const [viewQTrail, setViewQTrail] = useState(null);
  const [viewQTrailLoading, setViewQTrailLoading] = useState(false);
  const viewQTrailRef = useRef(0);
  const [editQ, setEditQ]         = useState(null);
  const [form, setForm]           = useState(initForm);
  const [savingMode, setSavingMode] = useState(null); // null | "create" | "update"
    const [delTarget, setDelTarget] = useState(null);
  const [deleting, setDeleting]   = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [submittingQuotName, setSubmittingQuotName] = useState(null);
  const [editAutoApproveEligible, setEditAutoApproveEligible] = useState(false);
  const [creatingSoFromQuot, setCreatingSoFromQuot] = useState("");
  const [customerActionLoading, setCustomerActionLoading] = useState("");
  const [customerRejectDialog, setCustomerRejectDialog] = useState(null);
  const [pageSize, setPageSize] = useState(10);

  const { toast, showToast } = useSalesToast(3200);
  const { salesRole, roles, isAdministrator } = useSalesAuth();
  const quotationPerms = useMemo(() => allowedActionsByRole(salesRole), [salesRole]);
  const canEditMaterialArrival = useMemo(
    () => hasStoresRole(roles) || Boolean(isAdministrator),
    [roles, isAdministrator],
  );
  const canEditProductionEstimate = useMemo(
    () => hasProductionHeadRole(roles) || Boolean(isAdministrator),
    [roles, isAdministrator],
  );

  const [metaLoading, setMetaLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    try {
      const [dRes, oRes] = await Promise.all([
        api.get("/api/method/sales_app.api.quotation.dashboard_data"),
        api.get("/api/method/sales_app.api.quotation.get_options"),
      ]);
      setDash(dRes.data.message);
      if (oRes.data.message) {
        const msg = oRes.data.message;
        setOpts({ ...msg, order_type: quotationOrderTypes(msg.order_type) });
      }
    } catch {
      /* KPIs / form options — table still usable if these fail */
    } finally { setMetaLoading(false); }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    prefetchCsrfInBackground();
    try {
      const qRes = await api.get("/api/method/sales_app.api.quotation.get_quotations");
      const list = qRes.data.message || [];
      setQuots(list);
      void loadMeta();
      return list;
    } catch (e) {
      const msg = toFriendlyError(e, "Could not load quotations.");
      setLoadError(msg);
      showToast(msg, "error");
      return [];
    } finally {
      setLoading(false);
    }
  }, [loadMeta, showToast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (!editQ) setEditAutoApproveEligible(false);
  }, [editQ]);

  useEffect(() => {
    const quotName = String(viewQ?.name || "").trim();
    if (!quotName) {
      setViewQTrail(null);
      setViewQTrailLoading(false);
      return undefined;
    }
    const loadId = ++viewQTrailRef.current;
    setViewQTrailLoading(true);
    setViewQTrail(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/api/method/sales_app.api.quotation.get_quotation_document_trail", {
          params: { name: quotName },
        });
        if (!cancelled && loadId === viewQTrailRef.current) {
          setViewQTrail(res.data?.message || null);
        }
      } catch {
        if (!cancelled && loadId === viewQTrailRef.current) {
          setViewQTrail(null);
        }
      } finally {
        if (!cancelled && loadId === viewQTrailRef.current) {
          setViewQTrailLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewQ?.name]);

  const openTrailDocument = useCallback((row) => {
    const route = QT_TRAIL_ROUTES[row?.doctype];
    const docName = String(row?.name || "").trim();
    if (!route || !docName) {
      showToast("Cannot open this document.", "error");
      return;
    }
    setViewQ(null);
    navigate(`${route}?open=${encodeURIComponent(docName)}`);
  }, [navigate, showToast]);

  useEffect(() => {
    if (loading) return;
    const openId = String(searchParams.get("open") || "").trim();
    if (!openId || openedFromUrlRef.current === openId) return;

    const openFromUrl = async () => {
      openedFromUrlRef.current = openId;
      const inList = quots.find((q) => q.name === openId);
      if (inList) {
        setViewQ(inList);
      } else {
        try {
          const res = await api.get("/api/method/sales_app.api.quotation.get_quotation", {
            params: { name: openId },
          });
          const doc = res.data?.message;
          if (doc) setViewQ(doc);
          else showToast(`Quotation ${openId} not found.`, "error");
        } catch {
          showToast(`Quotation ${openId} not found.`, "error");
        }
      }
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("open");
      setSearchParams(nextParams, { replace: true });
    };

    void openFromUrl();
  }, [loading, quots, searchParams, setSearchParams, showToast]);

  /* URL-encoded POST for Frappe */
  const post = (url, data) => {
    const p = new URLSearchParams();
    const allowEmptyKeys = new Set([
      "tentative_delivery_date",
      "valid_till",
      "note",
      "terms",
      "attachment_file_url",
      "attachment_file_name",
    ]);
    Object.entries(data).forEach(([k, v]) => {
      if (v == null) return;
      if (v === "" && !allowEmptyKeys.has(k)) return;
        p.append(k, typeof v === "object" ? JSON.stringify(v) : v);
    });
    return api.post(url, p, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  };

  const saveQuot = async () => {
    if (!form.customer) return;
    if (!quotationHasSaveableLineItems(form.items)) {
      showToast("Add at least one line item before saving.", "error");
      return;
    }
    const deliveryDateError = tentativeDeliveryDateError(
      form.tentative_delivery_date,
      quotationFeasibleSystemDate(form),
    );
    if (deliveryDateError) {
      showToast(deliveryDateError, "error");
      return;
    }
    setSavingMode("create");
    try {
      await prefetchCsrf().catch(() => {});
      const res = await post("/api/method/sales_app.api.quotation.create_quotation", {
        customer:   form.customer,
        valid_till: form.valid_till,
        tentative_delivery_date: form.tentative_delivery_date,
        order_type: form.order_type,
        terms:      form.terms,
        note:       form.note,
        attachment_file_url: form.attachment_file_url || "",
        attachment_file_name: form.attachment_file_name || "",
        items:      form.items,
        fulfilment_plant: form.fulfilment_plant || "",
        ...quotationDiscountPayload(form),
      });
      const msg = res?.data?.message || {};
      if (msg?.status && msg.status !== "success") {
        throw new Error(msg.message || "Unable to create quotation.");
      }
      const createdName = String(msg?.name || "").trim();
      if (!createdName) {
        throw new Error("Quotation was created but no ID was returned.");
      }
      await loadAll();
      setShowForm(false);
      setForm(initForm);
      await openEdit(createdName);
      showToast("Quotation saved. Complete delivery planning, then submit for approval.");
    } catch (e) {
      const server =
        e?.response?.data?.message?.message ||
        e?.response?.data?._error_message ||
        e?.message ||
        "Unable to save quotation.";
      showToast(server, "error");
    } finally { setSavingMode(null); }
  };

  const updateQuot = async () => {
    if (!editQ) return;
    if (Number(editQ.docstatus) === 1) {
      showToast("This quotation is already submitted in ERPNext. Cancel or amend it there to edit.", "error");
      return;
    }
    const deliveryDateError = tentativeDeliveryDateError(
      editQ.tentative_delivery_date,
      quotationFeasibleSystemDate(editQ),
    );
    if (deliveryDateError) {
      showToast(deliveryDateError, "error");
      return;
    }
    setSavingMode("update");
    try {
      await prefetchCsrf().catch(() => {});
      const res = await post("/api/method/sales_app.api.quotation.update_quotation", {
        name:       editQ.name,
        customer:   editQ.customer,
        valid_till: editQ.valid_till,
        tentative_delivery_date: editQ.tentative_delivery_date,
        order_type: editQ.order_type,
        status:     editQ.status,
        items:      editQ.items,
        terms:      editQ.terms,
        note:       editQ.note,
        attachment_file_url: editQ.attachment_file_url || "",
        attachment_file_name: editQ.attachment_file_name || "",
        fulfilment_plant: editQ.fulfilment_plant || "",
        ...quotationDiscountPayload(editQ),
      });
      const msg = res?.data?.message || {};
      if (msg?.status && msg.status !== "success") {
        throw new Error(msg.message || "Unable to update quotation.");
      }
      setEditQ(null);
      await loadAll();
      showToast("Quotation updated!");
    } catch (e) {
      const server =
        e?.response?.data?.message?.message ||
        e?.response?.data?._error_message ||
        e?.message ||
        "Unable to update quotation.";
      showToast(server, "error");
    } finally { setSavingMode(null); }
  };

  const patchQuotationInList = useCallback((name, patch) => {
    if (!name || !patch) return;
    setQuots((rows) => rows.map((q) => (q.name === name ? { ...q, ...patch } : q)));
  }, []);

  const submitQuotForApproval = async (name) => {
    if (!name || submittingQuotName) return;
    if (!quotationPerms.canSubmitForApproval) return;

    let row = editQ?.name === name ? editQ : quots.find((q) => q.name === name);
    try {
      await prefetchCsrf().catch(() => {});
      const res = await api.get("/api/method/sales_app.api.quotation.get_quotation", { params: { name } });
      const fresh = res?.data?.message;
      if (fresh) {
        row = {
          ...(row || {}),
          name: fresh.name,
          docstatus: fresh.docstatus,
          portal_approval_status: fresh.portal_approval_status,
          submitted_for_approval_at: fresh.submitted_for_approval_at,
          delivery_plan_status: fresh.delivery_plan_status,
          selected_delivery_option: fresh.selected_delivery_option,
          system_delivery_date: formatQuotationDateField(fresh.system_delivery_date),
          tentative_delivery_date: formatQuotationDateField(fresh.tentative_delivery_date),
        };
        if (editQ?.name === name) {
          setEditQ((prev) => (
            prev
              ? {
                ...prev,
                delivery_plan_status: fresh.delivery_plan_status || prev.delivery_plan_status,
                selected_delivery_option: fresh.selected_delivery_option || prev.selected_delivery_option,
                system_delivery_date: formatQuotationDateField(fresh.system_delivery_date)
                  || prev.system_delivery_date,
                tentative_delivery_date: formatQuotationDateField(fresh.tentative_delivery_date)
                  || prev.tentative_delivery_date,
              }
              : prev
          ));
        }
        patchQuotationInList(name, {
          delivery_plan_status: fresh.delivery_plan_status,
          selected_delivery_option: fresh.selected_delivery_option,
          system_delivery_date: formatQuotationDateField(fresh.system_delivery_date),
          tentative_delivery_date: formatQuotationDateField(fresh.tentative_delivery_date),
        });
      }
    } catch {
      // Fall back to in-memory row when refresh fails.
    }

    if (!row) return;
    if (isPendingApproval(row)) return;
    if (!isDeliveryPlanFinalized(row)) {
      showToast(
        "Complete delivery planning and select a delivery option (5, 7, or 10 days) before submitting.",
        "error",
      );
      return;
    }
    setSubmittingQuotName(name);
    try {
      const res = await post("/api/method/sales_app.api.quotation.submit_quotation_for_approval", { name });
      const msg = res?.data?.message || {};
      if (msg?.status && msg.status !== "success") {
        throw new Error(msg.message || "Unable to submit for approval.");
      }
      const wasEdit = editQ?.name === name;
      if (wasEdit) setEditQ(null);
      await loadAll();
      showToast(
        msg.message || (msg.awaiting_customer
          ? "Quotation submitted. Send to customer next."
          : msg.auto_approved
            ? "Quotation auto-approved."
            : "Submitted for Sales Manager approval."),
      );
      if (msg.awaiting_customer) {
        await openView(name);
      }
      refreshSalesNotifications();
    } catch (e) {
      const server =
        e?.response?.data?.message?.message ||
        e?.response?.data?._error_message ||
        e?.message ||
        "Unable to submit for approval.";
      showToast(server, "error");
    } finally {
      setSubmittingQuotName(null);
    }
  };

  const deleteQuot = async (name) => {
    setDeleting(true);
    try {
      await prefetchCsrf().catch(() => {});
      const res = await post("/api/method/sales_app.api.quotation.delete_quotation", { name });
      const msg = res?.data?.message || {};
      if (msg?.status && msg.status !== "success") {
        throw new Error(msg.message || "Unable to delete quotation.");
      }
      await loadAll();
      setDelTarget(null);
      showToast("Quotation deleted.");
    } catch (e) {
      const server =
        e?.response?.data?.message?.message ||
        e?.response?.data?._error_message ||
        e?.message ||
        "Unable to delete quotation.";
      showToast(server, "error");
    } finally {
      setDeleting(false);
    }
  };

  const openView = async (name) => {
    setEditQ(null);
    setShowForm(false);
    setViewLoading(true);
    setViewQ(null);
    try {
      const res = await api.get("/api/method/sales_app.api.quotation.get_quotation", { params: { name } });
      setViewQ(res.data.message);
    } finally { setViewLoading(false); }
  };

  const createSalesOrderFromQuotation = async (quotationName) => {
    const name = String(quotationName || "").trim();
    if (!name) return;
    setCreatingSoFromQuot(name);
    try {
      await prefetchCsrf().catch(() => {});
      const body = new URLSearchParams({ name, submit: "1" });
      const res = await api.post(
        "/api/method/sales_app.api.sales_order.create_sales_order_from_quotation",
        body,
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );
      const msg = res?.data?.message || {};
      if (!msg.name) throw new Error("Sales order failed");
      showToast(salesOrderCreatedToast(), "success", 3200);
      setViewQ(null);
      await loadAll();
    } catch (err) {
      showToast(toFriendlyError(err, "Could not create Sales Order from quotation."), "error");
    } finally {
      setCreatingSoFromQuot("");
    }
  };

  const postQuotationAction = async (url, params) => {
    await prefetchCsrf().catch(() => {});
    const body = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v != null && v !== "") body.append(k, String(v));
    });
    const res = await api.post(url, body, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    const msg = res?.data?.message || {};
    if (msg?.status && msg.status !== "success") {
      throw new Error(msg.message || "Request failed.");
    }
    return msg;
  };

  const sendQuotationToCustomer = async (quotationName) => {
    const name = String(quotationName || "").trim();
    if (!name) return;
    setCustomerActionLoading(`send-${name}`);
    try {
      const msg = await postQuotationAction(QUOTATION_SEND_TO_CUSTOMER_API, { name });
      showToast(msg.message || "Quotation sent to customer.");
      refreshSalesNotifications();
      if (viewQ?.name === name) {
        const res = await api.get("/api/method/sales_app.api.quotation.get_quotation", { params: { name } });
        setViewQ(res.data.message);
      }
      await loadAll();
    } catch (err) {
      showToast(toFriendlyError(err, "Could not send quotation to customer."), "error");
    } finally {
      setCustomerActionLoading("");
    }
  };

  const recordCustomerResponse = async (quotationName, accepted, reason = "") => {
    const name = String(quotationName || "").trim();
    if (!name) return false;
    if (!accepted && !String(reason || "").trim()) {
      showToast("Enter a rejection reason.", "error");
      return false;
    }
    setCustomerActionLoading(`${accepted ? "accept" : "reject"}-${name}`);
    try {
      const msg = await postQuotationAction(QUOTATION_RECORD_CUSTOMER_RESPONSE_API, {
        name,
        accepted: accepted ? "1" : "0",
        reason,
        channel: "In Person",
      });
      showToast(msg.message || (accepted ? "Customer accepted." : "Customer rejected."));
      refreshSalesNotifications();
      if (viewQ?.name === name) {
        const res = await api.get("/api/method/sales_app.api.quotation.get_quotation", { params: { name } });
        setViewQ(res.data.message);
      }
      await loadAll();
      return true;
    } catch (err) {
      showToast(toFriendlyError(err, "Could not record customer response."), "error");
      return false;
    } finally {
      setCustomerActionLoading("");
    }
  };

  const openCustomerRejectDialog = (quotation) => {
    const name = String(quotation?.name || "").trim();
    if (!name) return;
    setCustomerRejectDialog({ quotationName: name, reason: "" });
  };

  const closeCustomerRejectDialog = () => {
    if (customerActionLoading.startsWith("reject-")) return;
    setCustomerRejectDialog(null);
  };

  const confirmCustomerRejected = async () => {
    const name = String(customerRejectDialog?.quotationName || "").trim();
    const reason = String(customerRejectDialog?.reason || "").trim();
    if (!name) return;
    const saved = await recordCustomerResponse(name, false, reason);
    if (saved) setCustomerRejectDialog(null);
  };

  const reviseQuotationAfterRejection = async (quotationName) => {
    const name = String(quotationName || "").trim();
    if (!name) return;
    setCustomerActionLoading(`revise-${name}`);
    try {
      const msg = await postQuotationAction(QUOTATION_REVISE_AFTER_REJECTION_API, { name });
      showToast(msg.message || "New draft quotation created.");
      setViewQ(null);
      await loadAll();
      if (msg.name) await openEdit(msg.name);
    } catch (err) {
      showToast(toFriendlyError(err, "Could not revise quotation."), "error");
    } finally {
      setCustomerActionLoading("");
    }
  };

  const openEdit = async (name) => {
    setViewQ(null);
    setViewLoading(false);
    setShowForm(false);
    setEditLoading(true);
    try {
      const res = await api.get("/api/method/sales_app.api.quotation.get_quotation", { params: { name } });
      const d = res?.data?.message;
      if (!d) {
        showToast("Could not load quotation for edit.", "error");
        return;
      }
      if (isPendingApproval(d) && !quotationPerms.canApprove && !canEditMaterialArrival && !canEditProductionEstimate) {
        showToast("This quotation is pending approval and cannot be edited.", "error");
        return;
      }
      if (isAutoApprovedAwaitingCustomer(d)) {
        showToast("Quotation is with the customer. Record accept/reject from View.", "warn");
        await openView(name);
        return;
      }
      const items =
        d.items?.length > 0
          ? d.items.map((it) => mapQuotationLineItemFromApi(it))
          : [{ ...initItem }];
      const docstatus = Number(d.docstatus);
      setEditQ({
        name: d.name,
        customer: d.customer,
        party_name: d.customer,
        valid_till: d.valid_till || "",
        tentative_delivery_date: formatQuotationDateField(d.tentative_delivery_date),
        system_delivery_date: formatQuotationDateField(d.system_delivery_date),
        order_type: normalizeQuotationOrderType(d.order_type),
        status: d.status || "Draft",
        portal_approval_status: d.portal_approval_status || "Draft",
        awaiting_customer: Boolean(d.awaiting_customer),
        submitted_for_approval_at: d.submitted_for_approval_at || "",
        rejection_reason: d.rejection_reason || "",
        delivery_plan_status: d.delivery_plan_status || "Draft",
        material_arrival_date: d.material_arrival_date || "",
        material_arrival_warehouse: d.material_arrival_warehouse || "",
        material_available_qty: d.material_available_qty != null && d.material_available_qty !== ""
          ? String(d.material_available_qty)
          : "",
        expected_receipt_date: d.expected_receipt_date || "",
        production_start_date: d.production_start_date || "",
        production_completion_estimate: d.production_completion_estimate || "",
        capacity_committed: Boolean(d.capacity_committed),
        capacity_available_confirmed: Boolean(d.capacity_available_confirmed),
        machine_allocation: Array.isArray(d.machine_allocation) ? d.machine_allocation : [],
        delivery_option_5: d.delivery_option_5 || "",
        delivery_option_7: d.delivery_option_7 || "",
        delivery_option_10: d.delivery_option_10 || "",
        selected_delivery_option: d.selected_delivery_option || "",
        fulfilment_plant: d.fulfilment_plant || "",
        docstatus: Number.isFinite(docstatus) ? docstatus : 0,
        terms: d.terms || "",
        note: d.note || "",
        attachment_file_url: d.attachment_file_url || "",
        attachment_file_name: d.attachment_file_name || "",
        discount_percent: d.discount_percent ? String(d.discount_percent) : "",
        discount_amount: d.discount_amount ? String(d.discount_amount) : "",
        _discount_input_mode: d.discount_percent ? "percent" : d.discount_amount ? "amount" : "",
        apply_discount_on: d.apply_discount_on || "Grand Total",
        net_total: Number(d.net_total) || 0,
        grand_total: Number(d.grand_total) || 0,
        gst_amount: Number(d.gst_amount ?? d.total_taxes_and_charges) || 0,
        total_taxes_and_charges: Number(d.total_taxes_and_charges) || 0,
        taxes_and_charges: d.taxes_and_charges || "",
        taxes: Array.isArray(d.taxes) ? d.taxes : [],
        items,
      });
    } catch {
      showToast("Could not load quotation for edit.", "error");
    } finally {
      setEditLoading(false);
    }
  };

  const startOfToday = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  const filtered = useMemo(() => {
    const qSearch = search.trim().toLowerCase();
    return quots.filter((qt) => {
      const hay = [qt.name, qt.party_name, qt.status, qt.portal_approval_status, qt.order_type]
        .map((x) => (x == null ? "" : String(x)))
        .join(" ")
        .toLowerCase();
      const matchSearch = !qSearch || hay.includes(qSearch);
      const matchStatus = quotationRowMatchesStatusFilter(qt, statusFilter, startOfToday);
      return matchSearch && matchStatus;
    });
  }, [quots, search, statusFilter, startOfToday]);

  const { page, setPage, totalPages, pageRows: pagedQuots, total, resetPage } =
    usePagedRows(filtered, pageSize);

  const onStatusChange = (v) => {
    setStatusFilter(v);
    resetPage();
  };

  const onSearchChange = (v) => {
    setSearch(v);
    resetPage();
  };

  /* ── Loading / load error ── */
  if (loading && !quots.length && !loadError) {
    return <SalesPageLoader label="Loading quotations…" />;
  }

  if (!loading && !quots.length && loadError) {
    return (
      <>
        <SalesToast toast={toast} />
        <div className="pm-page qt-page">
          <SalesEmptyState
            icon={HiOutlineDocumentText}
            title="Could not load quotations"
            description={loadError}
            action={(
              <button type="button" className="pm-btn pm-btn-primary qt-btn-primary" onClick={() => void loadAll()}>
                Retry
              </button>
            )}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <SalesToast toast={toast} />

      <div className="pm-page qt-page">

        {/* ── KPI STRIP ── */}
        <section className="qt-kpi-section" aria-label="Quotation KPIs">
          <div className="qt-kpi-section-row">
            <p className="qt-kpi-section-label">
              Quotation KPIs
              {metaLoading ? <span className="op-kpi-section-hint"> · updating…</span> : null}
            </p>
            <button
              type="button"
              className="pm-btn pm-btn-primary qt-btn-primary"
              onClick={() => { setViewQ(null); setEditQ(null); setShowForm(true); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden><path d="M12 5v14M5 12h14"/></svg>
              New Quotation
            </button>
          </div>
          <div className="qt-kpi-grid">
            {QT_KPI_IDS.map((kid) => {
              const spec = kpiSpec(kid, dash);
              return (
                <SalesKpiCard
                  key={kid}
                  label={spec.label}
                  value={spec.value}
                  sub={spec.sub}
                  accent={spec.accent}
                  icon={spec.icon}
                />
              );
            })}
          </div>
        </section>

        {/* ── SEARCH & STATUS FILTER ── */}
        <div className="qt-filter-bar">
          <ListFilters
            statusValue={statusFilter}
            statusOptions={QT_STATUS_OPTIONS}
            onStatusChange={onStatusChange}
            searchValue={search}
            onSearchChange={onSearchChange}
            searchPlaceholder="Search quotations…"
          />
          {(search || statusFilter) ? (
            <button
              type="button"
              className="pm-btn pm-btn-ghost qt-btn-ghost qt-btn-compact"
              onClick={() => { setSearch(""); setStatusFilter(""); resetPage(); }}
            >
              Clear filters
            </button>
          ) : null}
        </div>

        {/* ── QUOTATIONS TABLE ── */}
        <Card title={`All Quotations${filtered.length !== quots.length ? ` — ${filtered.length} shown` : ""}`}>
          {filtered.length === 0 ? (
            <SalesEmptyState
              icon={HiOutlineDocumentText}
              title={search || statusFilter ? "No matching quotations" : "No quotations yet"}
              description={search || statusFilter ? "Adjust filters or clear search." : 'Click "New Quotation" to create your first one.'}
            />
          ) : (
            <>
            <div className="sales-table-scroll">
              <table className="pm-table qt-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th className="qt-col-id">Quotation ID</th>
                    <th className="qt-col-customer">Customer</th>
                    <th>Order Type</th>
                    <th>Grand Total</th>
                    <th>Status</th>
                    <th className="sales-th-center qt-col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedQuots.map((q, i) => {
                    const rowIdx = (page - 1) * pageSize + i;
                    return (
                    <tr
                      key={q.name}
                      className="qt-row"
                      style={{ "--i": rowIdx }}
                      onClick={() => openView(q.name)}
                      title="Click to open quotation"
                    >
                      <td className="sales-td-muted">{rowIdx + 1}</td>
                      <td className="qt-col-id">
                        <SalesDocumentId id={q.name} />
                      </td>
                      <td className="sales-td-strong qt-col-customer">{q.party_name || "—"}</td>
                      <td className="sales-td-sub">{q.order_type || "—"}</td>
                      <td className="qt-money">{fmt(q.grand_total)}</td>
                      <td className="qt-col-status" onClick={(e) => e.stopPropagation()}>
                        <QuotationListStatus
                          quotation={q}
                          submitting={submittingQuotName === q.name}
                          onSubmitForApproval={submitQuotForApproval}
                          canSubmitForApproval={quotationPerms.canSubmitForApproval}
                        />
                      </td>
                      <td className="qt-col-actions" onClick={(e) => e.stopPropagation()}>
                        <div className="sales-row-actions">
                          {[
                            { cls: "view", title: "View", fn: () => openView(q.name), icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> },
                            { cls: "edit", title: "Edit", fn: () => openEdit(q.name), disabled: editLoading || (isPendingApproval(q) && !quotationPerms.canApprove && !canEditMaterialArrival && !canEditProductionEstimate),
                              icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> },
                            { cls: "del",  title: "Delete", fn: () => setDelTarget({ id: q.name, label: q.party_name || q.name }),
                              icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> },
                          ].map(({ cls, title, fn, icon, disabled }) => (
                            <button
                              key={cls}
                              className={`qt-act qt-act-${cls}`}
                              title={title}
                              onClick={(e) => {
                                e.stopPropagation();
                                fn();
                              }}
                              disabled={disabled}
                            >
                              {icon}
                            </button>
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

      {/* ── CREATE MODAL ── */}
      {showForm && (
        <SalesDetailModal
          title="New Quotation"
          wide
          quotation
          onClose={() => { setShowForm(false); setForm(initForm); }}
          footer={
            <>
              <button type="button" className="pm-btn pm-btn-ghost qt-btn-ghost" onClick={() => { setShowForm(false); setForm(initForm); }}>Cancel</button>
              <button
                type="button"
                className="pm-btn pm-btn-primary qt-btn-primary"
                onClick={saveQuot}
                disabled={
                  savingMode !== null
                  || !form.customer
                  || !quotationHasSaveableLineItems(form.items)
                }
                title={
                  !form.customer
                    ? "Select a customer first"
                    : !quotationHasSaveableLineItems(form.items)
                      ? "Add at least one line item"
                      : "Save as draft and continue delivery planning"
                }
              >
                {savingMode === "create" ? "Saving…" : "Save quotation"}
            </button>
            </>
          }
        >
          <QuotForm form={form} setForm={setForm} opts={opts} isNew showToast={showToast} canSelectDeliveryOption={quotationPerms.canEdit} canProcure={quotationPerms.canEdit} />
        </SalesDetailModal>
      )}

      {/* ── VIEW MODAL (before Edit so Edit stacks above if both mount briefly) ── */}
      {(viewQ || viewLoading) && (
        <SalesDetailModal title="Quotation Detail" onClose={() => setViewQ(null)} wide>
          {viewLoading
            ? <div className="sales-modal-body-loading"><SalesPageLoader label="Loading quotation…" /></div>
            : (
              <>
                <QuotView q={viewQ} />
                <QuotationDocumentTrail
                  trail={viewQTrail}
                  loading={viewQTrailLoading}
                  onNavigate={openTrailDocument}
                />
              </>
            )
          }
          <MFooter>
            <button className="pm-btn pm-btn-ghost qt-btn-ghost" onClick={() => setViewQ(null)}>Close</button>
            {quotationCustomerActionsReady(viewQ) && viewQ?.name && !viewQ?.superseded_by ? (
              <>
                {String(viewQ.customer_response_status || "Not Sent") === "Not Sent" ? (
                  <button
                    type="button"
                    className="pm-btn pm-btn-ghost qt-btn-ghost"
                    disabled={customerActionLoading === `send-${viewQ.name}`}
                    onClick={() => sendQuotationToCustomer(viewQ.name)}
                  >
                    {customerActionLoading === `send-${viewQ.name}` ? "Sending…" : "Send to customer"}
                  </button>
                ) : null}
                {["Sent", "Not Sent"].includes(String(viewQ.customer_response_status || "")) ? (
                  <>
                    <button
                      type="button"
                      className="pm-btn pm-btn-ghost qt-btn-ghost"
                      disabled={customerActionLoading === `reject-${viewQ.name}`}
                      onClick={() => openCustomerRejectDialog(viewQ)}
                    >
                      {customerActionLoading === `reject-${viewQ.name}` ? "Saving…" : "Customer rejected"}
                    </button>
                    <button
                      type="button"
                      className="pm-btn pm-btn-ghost qt-btn-ghost"
                      disabled={customerActionLoading === `accept-${viewQ.name}`}
                      onClick={() => recordCustomerResponse(viewQ.name, true)}
                    >
                      {customerActionLoading === `accept-${viewQ.name}` ? "Saving…" : "Customer accepted"}
                    </button>
                  </>
                ) : null}
                {String(viewQ.customer_response_status || "") === "Rejected" ? (
                  <button
                    type="button"
                    className="pm-btn pm-btn-ghost qt-btn-ghost"
                    disabled={customerActionLoading === `revise-${viewQ.name}`}
                    onClick={() => reviseQuotationAfterRejection(viewQ.name)}
                  >
                    {customerActionLoading === `revise-${viewQ.name}` ? "Creating…" : "Revise quotation"}
                  </button>
                ) : null}
                {canCreateSalesOrderFromQuotation(viewQ) ? (
                  <button
                    type="button"
                    className="pm-btn pm-btn-primary qt-btn-primary"
                    disabled={creatingSoFromQuot === viewQ.name}
                    onClick={() => createSalesOrderFromQuotation(viewQ.name)}
                  >
                    {creatingSoFromQuot === viewQ.name ? "Creating…" : "Create Sales Order"}
                  </button>
                ) : null}
              </>
            ) : null}
          </MFooter>
        </SalesDetailModal>
      )}

      {/* ── EDIT MODAL ── */}
      {editQ && (
        <SalesDetailModal
          title="Edit Quotation"
          wide
          quotation
          onClose={() => setEditQ(null)}
          footer={
            <>
              <button type="button" className="pm-btn pm-btn-ghost qt-btn-ghost" onClick={() => setEditQ(null)}>Cancel</button>
              {quotationPerms.canSubmitForApproval
                && Number(editQ.docstatus) !== 1
                && !isPendingApproval(editQ)
                && !isAutoApprovedAwaitingCustomer(editQ)
                && (isQuotationDraftLike(editQ.status, editQ.docstatus) || isRejectedApproval(editQ)) ? (
              <button
                type="button"
                    className={`pm-btn qt-btn-ghost${editAutoApproveEligible ? " qt-btn-auto-approve" : ""}`}
                    onClick={() => submitQuotForApproval(editQ.name)}
                    disabled={
                      submittingQuotName === editQ.name
                      || savingMode !== null
                      || editLoading
                      || !isDeliveryPlanFinalized(editQ)
                    }
                    title={
                      isDeliveryPlanFinalized(editQ)
                        ? (editAutoApproveEligible
                          ? "Submit quotation — auto-approves after customer accepts"
                          : "Submit for Sales Manager approval")
                        : "Select a delivery option (5/7/10 days) before submitting"
                    }
                  >
                    {submittingQuotName === editQ.name
                      ? "Submitting…"
                      : (editAutoApproveEligible ? "Submit quotation (Auto approve)" : "Submit for approval")}
              </button>
                ) : null}
              <button type="button" className="pm-btn pm-btn-primary qt-btn-primary" onClick={updateQuot} disabled={savingMode !== null || editLoading || Number(editQ.docstatus) === 1 || (isPendingApproval(editQ) && !quotationPerms.canApprove)}>
              {Number(editQ.docstatus) === 1 ? "Submitted" : savingMode === "update" ? "Updating…" : "Update"}
            </button>
            </>
          }
        >
          <QuotForm
            form={editQ}
            setForm={setEditQ}
            opts={opts}
            showToast={showToast}
            canApprove={quotationPerms.canApprove || Boolean(isAdministrator)}
            canEditProductionEstimate={canEditProductionEstimate}
            canSelectDeliveryOption={quotationPerms.canEdit}
            canProcure={quotationPerms.canEdit}
            onDeliveryPlanUpdated={patchQuotationInList}
            onFlowPricingChange={setEditAutoApproveEligible}
          />
        </SalesDetailModal>
      )}

      {customerRejectDialog ? (
        <div className="qt-reject-dialog-backdrop" role="presentation" onMouseDown={closeCustomerRejectDialog}>
          <div
            className="qt-reject-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qt-reject-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="qt-reject-dialog__icon" aria-hidden="true">
              <HiOutlineDocumentText size={22} />
            </div>
            <div className="qt-reject-dialog__content">
              <h3 id="qt-reject-dialog-title">Customer rejected quotation</h3>
              <p>Enter the customer rejection reason before saving this response.</p>
              <textarea
                className="qt-input qt-textarea qt-reject-dialog__textarea"
                rows={4}
                autoFocus
                placeholder="Reason shared by customer"
                value={customerRejectDialog.reason}
                disabled={customerActionLoading === `reject-${customerRejectDialog.quotationName}`}
                onChange={(event) => setCustomerRejectDialog((prev) => (
                  prev ? { ...prev, reason: event.target.value } : prev
                ))}
              />
              <div className="qt-reject-dialog__actions">
                <button
                  type="button"
                  className="pm-btn pm-btn-ghost qt-btn-ghost"
                  disabled={customerActionLoading === `reject-${customerRejectDialog.quotationName}`}
                  onClick={closeCustomerRejectDialog}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="pm-btn pm-btn-primary qt-btn-primary"
                  disabled={
                    customerActionLoading === `reject-${customerRejectDialog.quotationName}`
                    || !String(customerRejectDialog.reason || "").trim()
                  }
                  onClick={confirmCustomerRejected}
                >
                  {customerActionLoading === `reject-${customerRejectDialog.quotationName}` ? "Saving…" : "Save rejection"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDeleteModal
        target={delTarget}
        title="Delete Quotation"
        loading={deleting}
        onCancel={() => setDelTarget(null)}
        onConfirm={() => delTarget?.id && deleteQuot(delTarget.id)}
      />
    </>
  );
}

/* ─── Quotation totals / GST preview ─────────────────────────── */
function QuotationTotalsPanel({ form, locked }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  const previewKey = useMemo(
    () => JSON.stringify({
      customer: form?.customer,
      order_type: form?.order_type,
      items: quotationItemsForPayload(form?.items),
      ...quotationDiscountPayload(form),
    }),
    [
      form?.customer,
      form?.order_type,
      form?.items,
      form?.discount_percent,
      form?.discount_amount,
      form?._discount_input_mode,
      form?.apply_discount_on,
    ],
  );

  useEffect(() => {
    if (locked) {
      setPreview(null);
      setLoading(false);
      return undefined;
    }

    let parsed;
    try {
      parsed = JSON.parse(previewKey);
    } catch {
      setPreview(null);
      return undefined;
    }

    const customer = String(parsed?.customer || "").trim();
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    if (!customer || !items.length) {
      setPreview(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      const result = await fetchQuotationTotalsPreview(form);
      setPreview(result);
      setLoading(false);
    }, 400);

    return () => clearTimeout(timer);
  }, [previewKey, locked, form]);

  const lineSubtotal = quotationLineSubtotal(form?.items);
  const hasCustomer = Boolean(String(form?.customer || "").trim());
  const hasLineItems = quotationItemsForPayload(form?.items).length > 0;
  const savedTotals = locked ? quotationSavedTotalsFromForm(form) : null;
  const activeTotals = (preview && hasCustomer && hasLineItems)
    ? preview
    : savedTotals;
  const hasTotals = Boolean(activeTotals);
  const netTotal = hasTotals
    ? Number(activeTotals.net_total)
    : lineSubtotal;
  const gstAmount = hasTotals ? Number(activeTotals.gst_amount) || 0 : 0;
  const grandTotal = hasTotals
    ? Number(activeTotals.grand_total)
    : estimateQuotationTotalAfterDiscount(
      lineSubtotal,
      form?.discount_percent,
      form?.discount_amount,
      form?._discount_input_mode,
    );
  const taxRows = hasTotals && Array.isArray(activeTotals.taxes) ? activeTotals.taxes : [];

  return (
    <div className="qt-totals-panel">
      <div className="qt-totals-panel__head">
        <span className="qt-totals-panel__title">Totals &amp; GST</span>
        {loading ? <span className="qt-totals-panel__status">Calculating…</span> : null}
      </div>

      {!hasCustomer || !hasLineItems ? (
        <p className="qt-totals-panel__hint">
          Select a customer and add line items to preview GST from ERPNext.
        </p>
      ) : null}

      <div className="qt-totals-panel__rows">
        <div className="qt-totals-row">
          <span className="qt-totals-row__label">Net Total</span>
          <span className="qt-money qt-totals-row__value">{fmt(netTotal)}</span>
        </div>

        {taxRows.length > 0 ? (
          taxRows.map((tax, index) => (
            <div className="qt-totals-row qt-totals-row--tax" key={`${tax.description || "tax"}-${index}`}>
              <span className="qt-totals-row__label">
                {tax.description || "Tax"}
                {Number(tax.rate) > 0 ? ` (${tax.rate}%)` : ""}
              </span>
              <span className="qt-money qt-totals-row__value">{fmt(tax.tax_amount)}</span>
            </div>
          ))
        ) : (
          <div className="qt-totals-row qt-totals-row--tax">
            <span className="qt-totals-row__label">GST</span>
            <span className="qt-money qt-totals-row__value">{fmt(gstAmount)}</span>
          </div>
        )}

        <div className="qt-totals-row qt-totals-row--grand">
          <span className="qt-totals-row__label">Grand Total</span>
          <span className="qt-money qt-totals-row__value">{fmt(grandTotal)}</span>
        </div>
      </div>

      {hasTotals && activeTotals.taxes_and_charges ? (
        <p className="qt-totals-panel__template">
          Tax template: <strong>{activeTotals.taxes_and_charges}</strong>
        </p>
      ) : null}
    </div>
  );
}

function QuotationComponentCostPanel({ items }) {
  const [costRows, setCostRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const loadRef = useRef(0);

  const sourceRows = useMemo(
    () => (items || [])
      .map((row) => ({
        item_code: String(row?.item_code || "").trim(),
        qty: Number(row?.qty) || 1,
      }))
      .filter((row) => row.item_code),
    [items],
  );

  useEffect(() => {
    if (!sourceRows.length) {
      loadRef.current += 1;
      setCostRows([]);
      setLoading(false);
      return undefined;
    }
    const loadId = ++loadRef.current;
    setLoading(true);
    Promise.all(
      sourceRows.map(async (row) => {
        const payload = await fetchQuotationItemComponentCost(row.item_code, row.qty);
        return { ...row, payload };
      }),
    ).then((rows) => {
      if (loadId !== loadRef.current) return;
      setCostRows(rows);
      setLoading(false);
    });
    return () => {
      loadRef.current += 1;
    };
  }, [sourceRows]);

  if (!sourceRows.length) return null;
  const totalComponentCost = costRows.reduce(
    (sum, row) => sum + (Number(row?.payload?.component_cost_total) || 0),
    0,
  );

  return (
    <div className="qt-component-cost">
      <div className="qt-component-cost__head">
        <span className="qt-component-cost__title">Component cost</span>
        {loading ? <span className="qt-component-cost__status">Fetching BOM cost…</span> : null}
      </div>
      <div className="qt-component-cost__rows">
        {costRows.map((row, index) => {
          const payload = row.payload || {};
          const hasBom = Boolean(payload.has_bom);
          return (
            <div className="qt-component-cost__row" key={`${row.item_code}-${index}`}>
              <span className="qt-component-cost__item">
                {row.item_code}
                {hasBom && payload.bom_no ? ` (${payload.bom_no})` : " (No BOM)"}
              </span>
              <span className="qt-money">
                {hasBom ? fmt(payload.component_cost_total) : "—"}
              </span>
            </div>
          );
        })}
      </div>
      <div className="qt-component-cost__total">
        <span>Estimated total component cost</span>
        <span className="qt-money">{fmt(totalComponentCost)}</span>
      </div>
    </div>
  );
}

function QuotationProductionLoadPanel({ items }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const loadRef = useRef(0);

  const codes = useMemo(
    () => [...new Set((items || []).map((row) => String(row?.item_code || "").trim()).filter(Boolean))],
    [items],
  );

  useEffect(() => {
    if (!codes.length) {
      loadRef.current += 1;
      setRows([]);
      setLoading(false);
      return undefined;
    }
    const loadId = ++loadRef.current;
    setLoading(true);
    Promise.all(codes.map(async (code) => ({ code, payload: await fetchQuotationItemProductionLoad(code) })))
      .then((next) => {
        if (loadId !== loadRef.current) return;
        setRows(next);
        setLoading(false);
      });
    return () => {
      loadRef.current += 1;
    };
  }, [codes]);

  if (!codes.length) return null;
  const totalOpen = rows.reduce((sum, row) => sum + (Number(row?.payload?.open_work_orders) || 0), 0);
  const totalPending = rows.reduce((sum, row) => sum + (Number(row?.payload?.pending_qty) || 0), 0);

  return (
    <div className="qt-production-load">
      <div className="qt-production-load__head">
        <span className="qt-production-load__title">Production load</span>
        {loading ? <span className="qt-production-load__status">Checking active work orders…</span> : null}
      </div>
      <div className="qt-production-load__rows">
        {rows.map((row, index) => {
          const payload = row.payload || {};
          return (
            <div className="qt-production-load__row" key={`${row.code}-${index}`}>
              <span className="qt-production-load__item">{row.code}</span>
              <span>
                {(Number(payload.open_work_orders) || 0)} WO • Pending {Number(payload.pending_qty || 0).toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="qt-production-load__total">
        <span>Total active WOs</span>
        <span>{totalOpen} • Pending qty {totalPending.toFixed(2)}</span>
      </div>
    </div>
  );
}

function QuotationCostLoadSummary({ items }) {
  return (
    <div className="qt-cost-load-grid">
      <QuotationComponentCostPanel items={items} />
      <QuotationProductionLoadPanel items={items} />
    </div>
  );
}

function QuotationDeliveryStatusStrip({
  readinessLoading,
  deliveryReadiness,
  planningPlanStatus,
  capacityLoading,
  capacitySnapshot,
}) {
  const parts = [];
  if (readinessLoading) {
    parts.push("Checking materials…");
  } else if (deliveryReadiness) {
    parts.push(
      deliveryReadiness.materials_available
        ? `Materials OK (${deliveryReadiness.ready_count}/${deliveryReadiness.line_count})`
        : `Materials short (${deliveryReadiness.shortage_count || 0} signals)`,
    );
  }
  if (capacityLoading) {
    parts.push("Loading capacity…");
  } else if (capacitySnapshot) {
    const mb = capacitySnapshot.machine_breakdown || {};
    const reqHours = Number(
      capacitySnapshot.total_required_hours ?? mb.total_required_hours ?? 0,
    );
    const availHours = Number(
      capacitySnapshot.total_available_hours ?? mb.total_available_hours ?? 0,
    );
    if (reqHours > 0 || availHours > 0) {
      const tight = capacitySnapshot.capacity_available === false ? " · tight" : "";
      parts.push(`Capacity: ${reqHours.toFixed(1)}h req · ${availHours.toFixed(1)}h avail${tight}`);
    } else {
      const ws = capacitySnapshot.machine_availability || {};
      parts.push(
        `Capacity: ${Number(capacitySnapshot.open_work_orders || 0)} open WO · ${Number(ws.workstation_available || 0)}/${Number(ws.workstation_total || 0)} machines`,
      );
    }
  }

  return (
    <div className="qt-delivery-status-strip">
      {planningPlanStatus && planningPlanStatus !== "Draft" ? (
        <span className={`qt-delivery-options__plan-pill${deliveryPlanPillClass(planningPlanStatus)}`}>
          {planningPlanStatus}
        </span>
      ) : null}
      <span className="qt-delivery-status-strip__text">
        {parts.length ? parts.join(" · ") : "Status updates when line items are added."}
      </span>
    </div>
  );
}

function canCreateSalesOrderFromQuotation(quotation) {
  if (!quotation?.name) return false;
  if (quotation.can_create_sales_order === true) return true;
  if (quotation.can_create_sales_order === false) return false;
  if (Number(quotation.docstatus) !== 1) return false;
  if (quotation.superseded_by) return false;
  if (String(quotation.status || "") === "Ordered") return false;
  return String(quotation.customer_response_status || "") === "Accepted";
}

function customerResponseLabel(status) {
  const s = String(status || "Not Sent").trim();
  if (s === "Accepted") return "Customer accepted";
  if (s === "Rejected") return "Customer rejected";
  if (s === "Sent") return "Awaiting customer";
  return "Not sent to customer";
}

function QuotationFlowValidationPanel({
  name,
  customer,
  items,
  materialArrivalDate,
  productionStartDate,
  productionCompletionEstimate,
  fulfilmentPlant = "",
  onFulfilmentPlantChange,
  plantOptions = [],
  showToast,
  canProcure = false,
  docstatus = 0,
  portalApprovalStatus = "",
  submittedForApprovalAt = "",
  onFlowLoaded,
}) {
  const [flow, setFlow] = useState(null);
  const [loading, setLoading] = useState(false);
  const [procuring, setProcuring] = useState(false);
  const loadRef = useRef(0);

  const sourceItems = useMemo(() => quotationItemsForPayload(items), [items]);
  const flowForm = useMemo(
    () => ({
      customer,
      items,
      material_arrival_date: materialArrivalDate,
      production_start_date: productionStartDate,
      production_completion_estimate: productionCompletionEstimate,
      fulfilment_plant: fulfilmentPlant,
    }),
    [customer, items, materialArrivalDate, productionStartDate, productionCompletionEstimate, fulfilmentPlant],
  );

  useEffect(() => {
    if (!sourceItems.length) {
      loadRef.current += 1;
      setFlow(null);
      setLoading(false);
      return undefined;
    }
    const loadId = ++loadRef.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      const payload = await fetchQuotationFlowValidation(name, flowForm);
      if (loadId !== loadRef.current) return;
      setFlow(payload);
      onFlowLoaded?.(payload);
      setLoading(false);
    }, 350);
    return () => {
      clearTimeout(timer);
      loadRef.current += 1;
    };
  }, [name, sourceItems, flowForm, onFlowLoaded]);

  const handleProcurement = useCallback(async () => {
    setProcuring(true);
    try {
      const msg = await raiseMaterialRequestForQuotation(name, showToast);
      if (!msg) return;
      const refs = (msg.material_requests || []).filter(Boolean);
      const label = refs.length > 1 ? refs.join(", ") : (msg.material_request || refs[0] || "Material Request");
      showToast?.(msg.message || `Material Request ${label} created.`);
      const payload = await fetchQuotationFlowValidation(name, flowForm);
      if (payload) setFlow(payload);
    } catch (e) {
      showToast?.(toFriendlyError(e, "Unable to create Material Request."), "error");
    } finally {
      setProcuring(false);
    }
  }, [name, showToast, flowForm]);

  if (!sourceItems.length) return null;

  const material = flow?.material_check || {};
  const capacity = flow?.capacity_check || {};
  const baseCost = flow?.base_cost || {};
  const pricing = flow?.pricing || {};
  const timeline = flow?.delivery_timeline || {};
  const procurement = flow?.procurement || {};
  const procTimeline = flow?.procurement_timeline || {};
  const materialPlanning = flow?.material_planning || {};
  const materialsOk = Boolean(material.materials_available);
  const materialReady = Boolean(materialPlanning.material_ready ?? materialsOk);
  const capacityOk = Boolean(capacity.capacity_available);
  const capacityReady = Boolean(capacity.capacity_ready ?? capacityOk);
  const approvalState = {
    docstatus,
    portal_approval_status: portalApprovalStatus,
    submitted_for_approval_at: submittedForApprovalAt,
  };
  const marginPill = quotationMarginPillDisplay(approvalState, pricing);
  const shortages = (material.shortages || []).slice(0, 6);
  const machines = (capacity.machines || []).slice(0, 8);
  const startDate = capacity.production_start_date || "";
  const completionDate = capacity.production_completion_date || "";

  return (
    <section className="qt-form-section qt-flow-section">
      <div className="qt-flow-section__head">
        <h3 className="qt-form-section__title">Planning summary</h3>
        {loading ? <span className="qt-flow-section__status">Checking…</span> : null}
      </div>

      {plantOptions.length || onFulfilmentPlantChange ? (
        <div className="qt-flow-plant-row">
          <label className="qt-flow-plant-row__label" htmlFor="qt-fulfilment-plant">Fulfilment plant</label>
          <select
            id="qt-fulfilment-plant"
            className="qt-input qt-input--compact"
            value={fulfilmentPlant || ""}
            onChange={(e) => onFulfilmentPlantChange?.(e.target.value)}
          >
            <option value="">Auto (best plant)</option>
            {plantOptions.map((p) => (
              <option key={p.plant} value={p.plant}>{p.plant}</option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="qt-flow-grid">
        <div className="qt-flow-col">
          <div className="qt-flow-col__title">Materials</div>
          {materialsOk ? (
            <span className="qt-pill-ok">Available</span>
          ) : materialReady ? (
            <span className="qt-pill-ok">Planning committed</span>
          ) : (
            <span className="qt-pill-warn">Shortage</span>
          )}
          <p className="qt-flow-col__meta">
            {Number(material.ready_count || 0)} / {Number(material.line_count || 0)} ready
            {material.shortage_count ? ` · ${material.shortage_count} short` : ""}
          </p>
          {materialPlanning.material_arrival_committed ? (
            <p className="qt-flow-col__hint">Arrival: {procurement.material_arrival_date || materialArrivalDate}</p>
          ) : null}
          {(procurement.purchase_orders || []).length ? (
            <p className="qt-flow-col__hint">
              PO: {(procurement.purchase_orders || []).join(", ")}
            </p>
          ) : null}
          {procTimeline.source_label && !materialsOk ? (
            <p className="qt-flow-col__hint">
              Procurement: {procTimeline.source_label}
              {procTimeline.procurement_days != null ? ` (${procTimeline.procurement_days} days)` : ""}
            </p>
          ) : null}
          {(procurement.material_requests || []).length ? (
            <p className="qt-flow-col__hint">
              MR: {(procurement.material_requests || []).join(", ")}
            </p>
          ) : null}
          {shortages.length ? (
            <ul className="qt-flow-plants">
              {shortages.map((row, idx) => (
                <li key={`${row.item_code}-${idx}`}>
                  {row.item_code}: need {Number(row.required_qty || 0).toFixed(0)}, have {Number(row.available_qty || 0).toFixed(0)}
                </li>
              ))}
            </ul>
          ) : null}
          {(material.plant_checks || []).length ? (
            <p className="qt-flow-col__hint">
              Plants:{" "}
              {(material.plant_checks || [])
                .map((p) => `${p.plant_name || p.plant}: ${p.materials_available ? "OK" : "Short"}`)
                .join(" · ")}
            </p>
          ) : null}
          {!materialReady && canProcure && name ? (
            <button
              type="button"
              className="pm-btn pm-btn-primary qt-btn-primary qt-btn-compact"
              disabled={procuring}
              onClick={handleProcurement}
            >
              {procuring ? "Creating…" : "Raise Material Request"}
            </button>
          ) : null}
        </div>

        <div className="qt-flow-col">
          <div className="qt-flow-col__title">Capacity</div>
          {capacityOk ? (
            <span className="qt-pill-ok">Available</span>
          ) : capacityReady ? (
            <span className="qt-pill-ok">Committed</span>
          ) : (
            <span className="qt-pill-warn">Short</span>
          )}
          <p className="qt-flow-col__meta">
            Need {Number(capacity.required_hours || 0).toFixed(1)}h · Avail {Number(capacity.available_hours || 0).toFixed(1)}h
          </p>
          {(startDate || completionDate) ? (
            <p className="qt-flow-col__hint">
              {startDate ? `Start ${startDate}` : ""}
              {startDate && completionDate ? " · " : ""}
              {completionDate ? `Complete ${completionDate}` : ""}
            </p>
          ) : null}
          {(capacity.plant_capacity?.plant || capacity.plant_capacity?.fulfilment_plant) ? (
            <p className="qt-flow-col__hint">
              Plant: {capacity.plant_capacity.plant || capacity.plant_capacity.fulfilment_plant}
              {capacity.plant_capacity.capacity_ok === false ? " · short" : ""}
            </p>
          ) : null}
          {machines.length ? (
            <table className="qt-flow-machine-table">
              <thead>
                <tr>
                  <th>Machine</th>
                  <th>Req</th>
                  <th>Avail</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {machines.map((row) => (
                  <tr key={row.machine}>
                    <td>{row.machine}</td>
                    <td>{Number(row.required_hours || 0).toFixed(1)}</td>
                    <td>{Number(row.available_hours || 0).toFixed(1)}</td>
                    <td>{row.capacity_ok ? <span className="qt-pill-ok">OK</span> : <span className="qt-pill-warn">Short</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>

      <div className="qt-flow-summary">
        <div className="qt-flow-summary__block">
          <span className="qt-flow-summary__label">System delivery date</span>
          <strong>{timeline.system_delivery_date || timeline.tentative_delivery_date || "—"}</strong>
          {timeline.custom_delivery_date ? (
            <span className="qt-flow-col__meta">
              Custom: {formatDisplayDate(timeline.custom_delivery_date)}
            </span>
          ) : null}
          {timeline.total_days != null ? (
            <span className="qt-flow-col__meta">
              {Number(timeline.procurement_days || 0)}d procurement + {Number(timeline.production_days || 0)}d production + {Number(timeline.qc_days || 0)}d QC + {Number(timeline.dispatch_days || 0)}d dispatch
            </span>
          ) : null}
          {timeline.procurement_source_label ? (
            <span className="qt-flow-col__hint">Procurement source: {timeline.procurement_source_label}</span>
          ) : null}
          {timeline.selected_delivery_option ? (
            <span className="qt-flow-col__meta">{timeline.selected_delivery_option}</span>
          ) : null}
        </div>
        <div className="qt-flow-summary__block">
          <span className="qt-flow-summary__label">Base cost</span>
          <strong>{fmt(baseCost.total_base_cost)}</strong>
          {(baseCost.material_cost != null || baseCost.machine_cost != null) ? (
            <span className="qt-flow-col__meta">
              Material {fmt(baseCost.material_cost)} · Machine {fmt(baseCost.machine_cost)} · Labour {fmt(baseCost.labor_cost)} · Transport {fmt(baseCost.transport_cost)}
            </span>
          ) : null}
        </div>
        <div className="qt-flow-summary__block">
          <span className="qt-flow-summary__label">Selling total</span>
          <strong>{fmt(pricing.selling_total)}</strong>
          <span className={quotationMarginPillClass(marginPill.variant)}>
            {marginPill.label}
          </span>
          {Boolean(pricing?.auto_approve) && Number(docstatus) !== 1
            && normQtStatus(portalApprovalStatus).toLowerCase() !== "auto approved" ? (
            <span className="qt-flow-auto-approve-hint">Submit quotation (auto-approve) after delivery plan</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function InventoryWarehouseTable({ rows, emptyLabel = "No stock recorded in any warehouse." }) {
  const breakdown = Array.isArray(rows) ? rows : [];
  if (!breakdown.length) {
    return <p className="qt-inventory-check__empty">{emptyLabel}</p>;
  }
  return (
    <div className="qt-inventory-check__table-wrap">
      <table className="qt-inventory-check__table">
        <thead>
          <tr>
            <th>Warehouse</th>
            <th>Current Stock</th>
            <th>Reserved Stock</th>
            <th>Available Stock</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((wh) => (
            <tr key={wh.warehouse}>
              <td>{wh.warehouse}</td>
              <td>{fmtStockQty(wh.current_stock ?? wh.actual_qty)}</td>
              <td>{fmtStockQty(wh.reserved_stock ?? wh.reserved_qty)}</td>
              <td>{fmtStockQty(wh.available_stock ?? wh.available_qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuotationInventoryCheckPanel({ items, fulfilmentPlant = "" }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const loadRef = useRef(0);
  const plantFilter = String(fulfilmentPlant || "").trim();

  const sourceRows = useMemo(
    () => (items || [])
      .map((row) => ({
        item_code: String(row?.item_code || "").trim(),
        qty: Number(row?.qty) || 1,
      }))
      .filter((row) => row.item_code),
    [items],
  );

  useEffect(() => {
    if (!sourceRows.length) {
      loadRef.current += 1;
      setRows([]);
      setLoading(false);
      return undefined;
    }
    const loadId = ++loadRef.current;
    setLoading(true);
    Promise.all(
      sourceRows.map(async (row) => ({
        ...row,
        payload: await fetchQuotationItemMaterialAvailability(row.item_code, row.qty, plantFilter),
      })),
    ).then((next) => {
      if (loadId !== loadRef.current) return;
      setRows(next);
      setLoading(false);
    });
    return () => {
      loadRef.current += 1;
    };
  }, [sourceRows, plantFilter]);

  if (!sourceRows.length) return null;

  const stockLines = rows.filter((row) => row?.payload?.is_stock_item !== false);
  const enoughCount = stockLines.filter((row) => Boolean(row?.payload?.enough_now)).length;
  const allEnough = stockLines.length > 0 && enoughCount === stockLines.length;
  const hasStockItems = stockLines.length > 0;

  return (
    <section
      className={`qt-inventory-check${allEnough ? " qt-inventory-check--ok" : hasStockItems ? " qt-inventory-check--warn" : " qt-inventory-check--ok"}`}
      role="region"
      aria-label="Supply Chain inventory check"
    >
      <div className="qt-inventory-check__head">
        <p className="qt-inventory-check__title">Inventory Check</p>
        <div className="qt-inventory-check__head-meta">
          {loading ? (
            <span className="qt-inventory-check__status">Checking stock…</span>
          ) : hasStockItems ? (
            <>
              {allEnough ? (
                <span className="qt-inventory-check__badge qt-inventory-check__badge--ok">Stock available</span>
              ) : (
                <span className="qt-inventory-check__badge qt-inventory-check__badge--warn">Stock insufficient</span>
              )}
              <span className="qt-inventory-check__count">{enoughCount} / {stockLines.length} ready</span>
            </>
          ) : (
            <span className="qt-inventory-check__badge qt-inventory-check__badge--ok">Service items only</span>
          )}
        </div>
      </div>

      <div className="qt-inventory-check__lines">
        {rows.map((row, index) => {
          const payload = row.payload || {};
          const isStockItem = payload.is_stock_item !== false;
          const enough = Boolean(payload.enough_now);
          const components = payload.components || [];
          const available = payload.available_stock ?? payload.available_qty;
          return (
            <div className="qt-inventory-check__line" key={`${row.item_code}-${index}`}>
              <div className="qt-inventory-check__line-head">
                <span className="qt-inventory-check__item">{row.item_code}</span>
                {isStockItem ? (
                  <span className="qt-inventory-check__required">
                    Avail {fmtStockQty(available)} / Req {fmtStockQty(row.qty)}
                  </span>
                ) : (
                  <span className="qt-inventory-check__required">Service item</span>
                )}
                {isStockItem ? (
                  <span className={enough ? "qt-pill-ok" : "qt-pill-warn"}>
                    {enough ? "OK" : "Short"}
                  </span>
                ) : (
                  <span className="qt-pill-ok">N/A</span>
                )}
              </div>

              {components.length ? (
                <div className="qt-inventory-check__components">
                  {components.map((comp) => {
                    const compEnough = Boolean(comp.enough_now);
                    return (
                      <div className="qt-inventory-check__component" key={comp.item_code}>
                        <span className="qt-inventory-check__item">{comp.item_code}</span>
                        <span className="qt-inventory-check__required">
                          Avail {fmtStockQty(comp.available_stock ?? comp.available_qty)} / Req {fmtStockQty(comp.required_qty)}
                        </span>
                        <span className={compEnough ? "qt-pill-ok" : "qt-pill-warn"}>
                          {compEnough ? "OK" : "Short"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function QuotationMaterialCheckSections({ bomRequirements = [], plantChecks = [], decision = null }) {
  if (!bomRequirements.length && !plantChecks.length && !decision?.next_section) return null;

  return (
    <div className="qt-material-check-sections">
      {decision?.next_section ? (
        <div
          className={`qt-material-check-decision qt-material-check-decision--${
            decision.materials_available ? "ok" : "warn"
          }`}
        >
          <strong>Section {decision.next_section}:</strong> {decision.next_section_label || "—"}
        </div>
      ) : null}

      {bomRequirements.length ? (
        <>
          <p className="qt-material-step__planned-title">BOM material requirements</p>
          <div className="qt-material-check-table-wrap">
            <table className="qt-material-check-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Required</th>
                  <th>Available</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {bomRequirements.map((row) => (
                  <tr key={row.item_code}>
                    <td>{row.item_code}</td>
                    <td>{fmtStockQty(row.required_qty)}</td>
                    <td>{fmtStockQty(row.available_qty)}</td>
                    <td>
                      {row.enough_now ? (
                        <span className="qt-pill-ok">OK</span>
                      ) : (
                        <span className="qt-pill-warn">Short</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {plantChecks.length ? (
        <>
          <p className="qt-material-step__planned-title">Plant material check</p>
          <div className="qt-material-check-table-wrap">
            <table className="qt-material-check-table">
              <thead>
                <tr>
                  <th>Plant</th>
                  <th>Warehouses</th>
                  <th>Shortages</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {plantChecks.map((row) => (
                  <tr key={row.plant || row.plant_name}>
                    <td>{row.plant_name || row.plant}</td>
                    <td>{(row.warehouses || []).join(", ") || "—"}</td>
                    <td>{row.shortage_count ?? (row.shortages || []).length ?? 0}</td>
                    <td>
                      {row.materials_available ? (
                        <span className="qt-pill-ok">Available</span>
                      ) : (
                        <span className="qt-pill-warn">Short</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

function QuotationMaterialStockLocations({ locations = [] }) {
  if (!locations.length) return null;
  return (
    <ul className="qt-material-check-locations">
      {locations.map((loc, idx) => (
        <li key={`${loc.warehouse}-${loc.rack}-${loc.bin}-${idx}`}>
          {loc.warehouse}
          {loc.rack ? ` · Rack ${loc.rack}` : ""}
          {loc.bin ? ` · Bin ${loc.bin}` : ""}
          {" — "}
          {fmtStockQty(loc.qty)}
        </li>
      ))}
    </ul>
  );
}

function QuotationMaterialLineStockDetail({ line }) {
  const components = line?.bom_components || [];
  const locations = line?.stock_locations || [];
  if (!components.length && !locations.length) return null;

  return (
    <div className="qt-material-step__stock-detail">
      {components.map((comp) => (
        <div className="qt-material-step__bom-line" key={comp.item_code}>
          <span className="qt-material-step__item">{comp.item_code}</span>
          <span className="qt-material-step__line-meta">
            Req {fmtStockQty(comp.required_qty)} · Avail {fmtStockQty(comp.available_qty)}
          </span>
          <QuotationMaterialStockLocations locations={comp.stock_locations || []} />
        </div>
      ))}
      {!components.length ? <QuotationMaterialStockLocations locations={locations} /> : null}
    </div>
  );
}

function QuotationMaterialAvailabilityStepPanel({
  name,
  items,
  fulfilmentPlant = "",
  materialArrivalDate = "",
  canProcure = false,
  showToast,
  onProcurementChange,
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [procuring, setProcuring] = useState(false);
  const loadRef = useRef(0);

  const sourceItems = useMemo(() => quotationItemsForPayload(items), [items]);
  const stepForm = useMemo(
    () => ({
      items,
      fulfilment_plant: fulfilmentPlant,
      material_arrival_date: materialArrivalDate,
    }),
    [items, fulfilmentPlant, materialArrivalDate],
  );

  const loadSnapshot = useCallback(async () => {
    if (!sourceItems.length) return null;
    return fetchQuotationMaterialAvailabilityStep(name, stepForm);
  }, [name, sourceItems, stepForm]);

  useEffect(() => {
    if (!sourceItems.length) {
      loadRef.current += 1;
      setSnapshot(null);
      setLoading(false);
      return undefined;
    }
    const loadId = ++loadRef.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      const payload = await loadSnapshot();
      if (loadId !== loadRef.current) return;
      setSnapshot(payload);
      setLoading(false);
    }, 300);
    return () => {
      clearTimeout(timer);
      loadRef.current += 1;
    };
  }, [sourceItems, loadSnapshot]);

  const handleRaiseMaterialRequest = useCallback(async () => {
    setProcuring(true);
    try {
      const msg = await raiseMaterialRequestForQuotation(name, showToast);
      if (!msg) return;
      const refs = (msg.material_requests || []).filter(Boolean);
      const label = refs.length > 1 ? refs.join(", ") : (msg.material_request || refs[0] || "Material Request");
      showToast?.(msg.message || `Material Request ${label} created.`);
      const payload = await loadSnapshot();
      if (payload) {
        setSnapshot(payload);
        onProcurementChange?.(payload);
      }
    } catch (e) {
      showToast?.(toFriendlyError(e, "Unable to create Material Request."), "error");
    } finally {
      setProcuring(false);
    }
  }, [name, showToast, loadSnapshot, onProcurementChange]);

  if (!sourceItems.length) return null;

  const materialsOk = Boolean(snapshot?.materials_available);
  const fgOk = Boolean(snapshot?.finished_goods_available);
  const materialReady = Boolean(snapshot?.material_ready);
  const procurement = snapshot?.procurement || {};
  const planned = snapshot?.planned_requests || {};
  const manufactureItems = planned.manufacture_items || [];
  const purchaseItems = planned.purchase_items || [];
  const mrDetails = procurement.details || [];
  const storesTimeline = snapshot?.stores_timeline || {};
  const supplierAvailability = snapshot?.supplier_availability || [];
  const nextAction = String(snapshot?.next_action || "").trim();
  const showRaiseMr = !materialsOk && !materialReady && canProcure && Boolean(name);
  const panelTone = materialsOk ? "ok" : materialReady ? "ok" : "warn";

  return (
    <section
      className={`qt-material-step qt-material-step--${panelTone}`}
      role="region"
      aria-label="Supply Chain material availability"
    >
      <div className="qt-material-step__head">
        <p className="qt-material-step__title">Material Availability</p>
        {loading ? (
          <span className="qt-material-step__status">Checking…</span>
        ) : materialsOk ? (
          <span className="qt-material-step__badge qt-material-step__badge--ok">All materials available</span>
        ) : materialReady ? (
          <span className="qt-material-step__badge qt-material-step__badge--ok">Planning committed</span>
        ) : !fgOk ? (
          <span className="qt-material-step__badge qt-material-step__badge--warn">FG stock short</span>
        ) : (
          <span className="qt-material-step__badge qt-material-step__badge--warn">Raw material short</span>
        )}
      </div>

      {!loading && snapshot ? (
        <>
          <div className="qt-material-step__summary">
            <div className="qt-material-step__metric">
              <span className="qt-material-step__label">FG ready</span>
              <strong>{Number(snapshot.fg_ready_count || 0)} / {Number(snapshot.line_count || 0)}</strong>
            </div>
            <div className="qt-material-step__metric">
              <span className="qt-material-step__label">FG short</span>
              <strong>{Number(snapshot.fg_shortage_count || 0)}</strong>
            </div>
            <div className="qt-material-step__metric">
              <span className="qt-material-step__label">Component short</span>
              <strong>{Number(snapshot.component_shortage_count || 0)}</strong>
            </div>
            <div className="qt-material-step__metric">
              <span className="qt-material-step__label">Next</span>
              <strong>
                {nextAction === "ready"
                  ? "Proceed"
                  : nextAction === "planning_committed"
                    ? "Committed"
                    : nextAction === "raise_material_request"
                      ? "Raise MR"
                      : "MR / Stores"}
              </strong>
            </div>
          </div>

          <QuotationMaterialCheckSections
            bomRequirements={snapshot.bom_requirements || []}
            plantChecks={snapshot.plant_checks || []}
            decision={snapshot.decision || null}
          />

          {(snapshot.lines || []).map((line) => (
            <div className="qt-material-step__line" key={line.item_code}>
              <div className="qt-material-step__line-head">
                <span className="qt-material-step__item">{line.item_code}</span>
                <span className="qt-material-step__line-meta">
                  Req {fmtStockQty(line.required_qty)} · Avail {fmtStockQty(line.available_qty)}
                  {!line.fg_available && line.recommended_request_type
                    ? ` · ${line.recommended_request_type} MR`
                    : ""}
                </span>
                {line.fg_available ? (
                  <span className="qt-pill-ok">OK</span>
                ) : (
                  <span className="qt-pill-warn">Short</span>
                )}
              </div>
              <QuotationMaterialLineStockDetail line={line} />
            </div>
          ))}

          {!materialsOk && (manufactureItems.length || purchaseItems.length) ? (
            <div className="qt-material-step__planned">
              <p className="qt-material-step__planned-title">Planned MR</p>
              {manufactureItems.length ? (
                <p className="qt-material-step__planned-line">
                  Manufacture: {manufactureItems.map((row) => `${row.item_code} (${fmtStockQty(row.qty)})`).join(", ")}
                </p>
              ) : null}
              {purchaseItems.length ? (
                <p className="qt-material-step__planned-line">
                  Purchase: {purchaseItems.map((row) => `${row.item_code} (${fmtStockQty(row.qty)})`).join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}

          {mrDetails.length ? (
            <div className="qt-material-step__procurement">
              <p className="qt-material-step__planned-title">Linked Material Request(s)</p>
              <ul className="qt-material-step__mr-list">
                {mrDetails.map((row) => (
                  <li key={row.name}>
                    <strong>{row.name}</strong>
                    <span>{row.type || "Material Request"}</span>
                    {row.status ? <span>{row.status}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {snapshot.material_arrival_date || storesTimeline.material_arrival_date ? (
            <p className="qt-material-step__stores">
              Stores material arrival: {storesTimeline.material_arrival_date || snapshot.material_arrival_date}
              {storesTimeline.material_arrival_warehouse
                ? ` · ${storesTimeline.material_arrival_warehouse}`
                : ""}
              {storesTimeline.material_available_qty
                ? ` · Qty ${fmtStockQty(storesTimeline.material_available_qty)}`
                : ""}
              {storesTimeline.expected_receipt_date
                ? ` · Expected ${storesTimeline.expected_receipt_date}`
                : ""}
            </p>
          ) : null}

          {!materialsOk && supplierAvailability.length ? (
            <div className="qt-material-step__procurement">
              <p className="qt-material-step__planned-title">Supplier availability (SCM)</p>
              <ul className="qt-material-step__mr-list">
                {supplierAvailability.map((row) => (
                  <li key={`sup-${row.item_code}`}>
                    <strong>{row.item_code}</strong>
                    {(row.suppliers || []).length ? (
                      <span>
                        {(row.suppliers || []).slice(0, 2).map((s) => s.supplier_name || s.supplier).join(", ")}
                      </span>
                    ) : (
                      <span>No compliant supplier history</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {showRaiseMr ? (
            <div className="qt-material-step__actions">
              <button
                type="button"
                className="pm-btn pm-btn-primary qt-btn-primary qt-btn-compact"
                disabled={procuring}
                onClick={handleRaiseMaterialRequest}
              >
                {procuring ? "Creating…" : "Raise Material Request → Supply Chain"}
              </button>
            </div>
          ) : null}

          {!materialsOk && !materialReady && !name ? (
            <p className="qt-material-step__stores">Save quotation first, then raise Material Request to Supply Chain.</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function QuotationDeliveryOptionsPanel({
  deliveryOptions,
  loading,
  readiness,
  capacity,
  materialArrivalDate,
  productionCompletionEstimate,
  deliveryPlanStatus,
  persistedPlanStatus = "",
  planningPlanStatus = "",
  selectedOption,
  canSelect = false,
  previewOnly = false,
  selecting = false,
  locked = false,
  onSelect,
  onRecalculate,
  recalculating = false,
  selectionInvalidated = false,
}) {
  const options = deliveryOptions?.options || [];
  const optionsReady = Boolean(deliveryOptions?.options_ready);
  const savedPlanStatus = String(persistedPlanStatus || deliveryPlanStatus || "").trim();
  const uiPlanStatus = String(planningPlanStatus || savedPlanStatus || deliveryPlanStatus || "").trim();
  const statusLabel = resolveDeliveryPlanStatus(
    deliveryPlanStatus,
    readiness?.delivery_plan_status,
    deliveryOptions?.delivery_plan_status,
  );
  const isFinalized = savedPlanStatus === "Finalized" || statusLabel === "Finalized";
  const displayPlanStatus = isFinalized
    ? "Finalized"
    : (savedPlanStatus === "Options Ready" ? "Options Ready" : statusLabel);
  const canPickOption = canSelect
    && !locked
    && optionsReady
    && !selecting
    && isDeliveryPlanSelectableStatus(savedPlanStatus);
  const showDeliveryCards = isDeliveryPlanSelectableStatus(savedPlanStatus) || isFinalized;

  const resolveOptionLabel = (opt) => opt.label || `${opt.days} Days`;

  return (
    <div className="qt-delivery-options">
      <div className="qt-delivery-options__head">
        <span className="qt-delivery-options__title">Delivery options</span>
        <div className="qt-delivery-options__badges">
          <span className={`qt-delivery-options__status-pill${optionsReady ? " qt-delivery-options__status-pill--ready" : ""}${isFinalized ? " qt-delivery-options__status-pill--finalized" : ""}`}>
            {isFinalized ? "Finalized" : savedPlanStatus === "Options Ready" ? "Options Ready" : optionsReady ? "Preview ready" : "Waiting for planning inputs"}
          </span>
          <span className={`qt-delivery-options__plan-pill${deliveryPlanPillClass(uiPlanStatus || displayPlanStatus)}`}>{uiPlanStatus || displayPlanStatus}</span>
          {onRecalculate ? (
            <button
              type="button"
              className="pm-btn pm-btn-ghost qt-btn-ghost qt-btn-compact qt-delivery-options__recalc-btn"
              disabled={loading || recalculating}
              onClick={onRecalculate}
            >
              {recalculating ? "Recalculating…" : "Recalculate"}
            </button>
          ) : null}
        </div>
      </div>

      {selectionInvalidated && (selectedOption || isFinalized) ? (
        <p className="qt-delivery-options__hint qt-delivery-options__hint--warn">
          Planning inputs changed. Previous delivery selection was cleared — please select an option again.
        </p>
      ) : null}

      {loading ? (
        <p className="qt-delivery-options__hint">Calculating delivery options (5 / 7 / 10 days)…</p>
      ) : showDeliveryCards && options.length ? (
        <>
          <div className="qt-delivery-options__cards">
            {options.map((opt) => {
              const label = resolveOptionLabel(opt);
              const isSelected = selectedOption === label;
              const CardTag = canPickOption ? "button" : "div";
              return (
                <CardTag
                  type={canPickOption ? "button" : undefined}
                  className={`qt-delivery-options__card${isSelected ? " qt-delivery-options__card--selected" : ""}${canPickOption ? " qt-delivery-options__card--selectable" : ""}${!canPickOption ? " qt-delivery-options__card--locked" : ""}`}
                  key={opt.days || opt.label}
                  disabled={!canPickOption || selecting}
                  onClick={canPickOption ? () => onSelect?.(label) : undefined}
                >
                  <span className="qt-delivery-options__card-label">{label}</span>
                  <span className="qt-delivery-options__card-date">{formatDisplayDate(opt.date)}</span>
                  <span className="qt-delivery-options__card-reason">
                    {opt.adjusted_days && opt.adjusted_days !== opt.days
                      ? `${opt.days} days + ${opt.adjusted_days - opt.days} buffer`
                      : `${opt.days || "—"} day lead time`}
                  </span>
                  {isSelected ? <span className="qt-delivery-options__card-selected">Selected</span> : null}
                </CardTag>
              );
            })}
          </div>
          {canPickOption ? (
            <p className="qt-delivery-options__hint">Click an option to set the final tentative delivery date.</p>
          ) : previewOnly && options.length ? (
            <p className="qt-delivery-options__hint">Preview only — save the quotation, then select 5 / 7 / 10 days in edit mode.</p>
          ) : optionsReady && !canSelect ? (
            <p className="qt-delivery-options__hint">Only Sales Executive can select the final delivery option.</p>
          ) : optionsReady && locked && !canPickOption && isDeliveryPlanSelectableStatus(savedPlanStatus) ? (
            <p className="qt-delivery-options__hint">
              Select a <strong>5 / 7 / 10 day</strong> option to finalize delivery before approval.
            </p>
          ) : isFinalized && selectedOption ? (
            <p className="qt-delivery-options__hint">Finalized: <strong>{selectedOption}</strong></p>
          ) : null}
        </>
      ) : !loading && options.length && !showDeliveryCards ? (
        <p className="qt-delivery-options__hint">
          Complete Stores timeline, then commit production capacity in <strong>Manufacturing &gt; Capacity Commitments</strong>. <strong>5 / 7 / 10 day</strong> cards appear when status is <strong>Options Ready</strong>.
        </p>
      ) : (
        <p className="qt-delivery-options__hint">Delivery options are unavailable right now.</p>
      )}

      {capacity?.machine_breakdown?.machines?.length ? (
        <div className="qt-delivery-options__capacity">
          <p className="qt-delivery-options__hint">
            MFG machine capacity ({Number(capacity.total_required_hours || 0).toFixed(1)}h required ·{" "}
            {Number(capacity.total_available_hours || 0).toFixed(1)}h available)
          </p>
          <table className="qt-flow-machine-table qt-delivery-options__machine-table">
            <thead>
              <tr>
                <th>Machine</th>
                <th>Req (h)</th>
                <th>Booked (h)</th>
                <th>Avail (h)</th>
              </tr>
            </thead>
            <tbody>
              {capacity.machine_breakdown.machines.slice(0, 6).map((row) => (
                <tr key={row.machine || row.workstation_name || row.workstation}>
                  <td>{row.machine || row.workstation_name || row.workstation}</td>
                  <td>{Number(row.required_hours || 0).toFixed(1)}</td>
                  <td>{Number(row.booked_hours || 0).toFixed(1)}</td>
                  <td>{Number(row.available_hours || 0).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/* ─── Quotation Form ─────────────────────────────────────────── */
function QuotForm({
  form,
  setForm,
  opts,
  isNew,
  showToast,
  canApprove = false,
  canEditProductionEstimate = false,
  canSelectDeliveryOption = false,
  canProcure = false,
  onDeliveryPlanUpdated,
  onFlowPricingChange,
}) {
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setDiscountPercent = (value) => {
    setForm((f) => ({
      ...f,
      discount_percent: value,
      discount_amount: calculateDiscountAmountFromPercent(f.items, value),
      _discount_input_mode: value ? "percent" : "",
    }));
  };
  const setDiscountAmount = (value) => {
    setForm((f) => ({
      ...f,
      discount_amount: value,
      discount_percent: calculateDiscountPercentFromAmount(f.items, value),
      _discount_input_mode: value ? "amount" : "",
    }));
  };
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [copyingQuotationName, setCopyingQuotationName] = useState("");
  const [copiedFromQuotationName, setCopiedFromQuotationName] = useState("");
  const [deliveryReadiness, setDeliveryReadiness] = useState(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [capacitySnapshot, setCapacitySnapshot] = useState(null);
  const [capacityLoading, setCapacityLoading] = useState(false);
  const [deliveryOptions, setDeliveryOptions] = useState(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [selectingDeliveryOption, setSelectingDeliveryOption] = useState(false);
  const [plantOptions, setPlantOptions] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api.get(QUOTATION_FULFILMENT_PLANTS_API)
      .then((r) => {
        if (!cancelled) setPlantOptions(r.data?.message?.plants || []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [recalculatingOptions, setRecalculatingOptions] = useState(false);
  const [selectionInvalidated, setSelectionInvalidated] = useState(false);
  const [systemDateEstimate, setSystemDateEstimate] = useState("");
  const [autoApproveEligible, setAutoApproveEligible] = useState(false);
  const [planningSnapshot, setPlanningSnapshot] = useState({
    production_start_date: "",
    production_completion_estimate: "",
    material_arrival_date: "",
    machine_allocation: [],
  });
  const prevCustomerRef = useRef(form.customer);
  const customerPricingLoadRef = useRef(0);
  const readinessLoadRef = useRef(0);
  const capacityLoadRef = useRef(0);
  const optionsLoadRef = useRef(0);
  const lastFetchedOptionsKeyRef = useRef("");
  const formPlanningRef = useRef(form);
  const planningSnapshotRef = useRef(planningSnapshot);
  formPlanningRef.current = form;
  planningSnapshotRef.current = planningSnapshot;

  useEffect(() => {
    setCopiedFromQuotationName("");
  }, [form.customer]);

  useEffect(() => {
    lastFetchedOptionsKeyRef.current = "";
    setSelectionInvalidated(false);
    setPlanningSnapshot({
      production_start_date: formatQuotationDateField(form?.production_start_date),
      production_completion_estimate: formatQuotationDateField(form?.production_completion_estimate),
      material_arrival_date: formatQuotationDateField(form?.material_arrival_date),
      machine_allocation: Array.isArray(form?.machine_allocation) ? form.machine_allocation : [],
    });
  }, [form?.name]);

  useEffect(() => {
    const customer = String(form.customer || "").trim();
    const prevCustomer = String(prevCustomerRef.current || "").trim();
    prevCustomerRef.current = form.customer;
    if (!customer || customer === prevCustomer) return undefined;

    const loadId = ++customerPricingLoadRef.current;

    setForm((f) => {
      const lines = f.items || [];
      const indexedCodes = lines
        .map((line, index) => ({ index, code: String(line?.item_code || "").trim() }))
        .filter((row) => row.code);
      if (!indexedCodes.length) return f;

      Promise.all(
        indexedCodes.map(async ({ index, code }) => {
          const qty = Number(lines[index]?.qty) || 1;
          const pricing = await fetchQuotationItemPricing(customer, code, qty);
          return { index, pricing, code };
        }),
      ).then((results) => {
        if (loadId !== customerPricingLoadRef.current) return;
        setForm((current) => {
          const items = [...(current.items || [])];
          results.forEach(({ index, pricing, code }) => {
            const line = items[index];
            if (!line) return;
            const found = opts.items?.find((o) => o.code === code);
            const fetchedBase = Number(pricing?.price_list_rate) || Number(pricing?.rate) || 0;
            if (fetchedBase > 0) {
              items[index] = applyPricingToQuotationLine(line, pricing, found?.rate);
              return;
            }
            if (!lineHasQuotationBase(line) && found?.rate) {
              items[index] = applyPricingToQuotationLine(line, null, found.rate);
            }
          });
          return { ...current, items };
        });
      });

      return f;
    });

    return () => {
      customerPricingLoadRef.current += 1;
    };
  }, [form.customer, setForm, opts.items]);

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { ...initItem }] }));
  const removeItem = (i) => setForm(f => ({ ...f, items: f.items.filter((_, j) => j !== i) }));

  const patchLineItem = useCallback((index, patch) => {
    setForm((f) => {
      const items = [...(f.items || [])];
      items[index] = { ...items[index], ...patch };
    return { ...f, items };
  });
  }, [setForm]);

  const handleItemCodeChange = useCallback(async (index, itemCode) => {
    const code = String(itemCode || "").trim();
    if (!code) {
      patchLineItem(index, { ...initItem });
      return;
    }
    const customer = String(form.customer || "").trim();
    const currentQty = Number(form.items?.[index]?.qty) || 1;
    const found = opts.items?.find((o) => o.code === code);
    let nextRow = {
      ...form.items[index],
      item_code: code,
      margin_type: "",
      margin_rate_or_amount: "",
    };
    if (customer) {
      const pricing = await fetchQuotationItemPricing(customer, code, currentQty);
      if (pricing) {
        nextRow = applyPricingToQuotationLine(nextRow, pricing, found?.rate);
      } else if (found) {
        nextRow = applyPricingToQuotationLine(nextRow, null, found.rate);
      }
    } else if (found) {
      nextRow = applyPricingToQuotationLine(nextRow, null, found.rate);
    }
    patchLineItem(index, nextRow);
  }, [form.customer, form.items, opts.items, patchLineItem]);

  const handleLineQtyChange = useCallback((index, qtyValue) => {
    patchLineItem(index, { qty: qtyValue });
  }, [patchLineItem]);

  const handleBasePriceChange = useCallback((index, baseValue) => {
    const line = form.items?.[index] || initItem;
    const baseNum = Number(baseValue);
    const safeBase = Number.isFinite(baseNum) && baseNum >= 0 ? baseNum : 0;
    const rate = line.margin_type && String(line.margin_rate_or_amount ?? "") !== ""
      ? computeQuotationLineRate(safeBase, line.margin_type, line.margin_rate_or_amount, null)
      : (Number(line.rate) > 0 ? line.rate : safeBase);
    patchLineItem(index, {
      price_list_rate: baseValue,
      rate,
    });
  }, [form.items, patchLineItem]);

  const handleMarginTypeChange = useCallback((index, marginType) => {
    const line = form.items?.[index] || initItem;
    const base = linePricingBase(line);
    const marginVal = line.margin_rate_or_amount;
    const rate = computeQuotationLineRate(base, marginType, marginVal, null);
    patchLineItem(index, {
      margin_type: marginType,
      margin_rate_or_amount: marginType ? line.margin_rate_or_amount : "",
      rate: marginType && lineHasQuotationBase(line) ? rate : line.rate,
    });
  }, [form.items, patchLineItem]);

  const handleMarginValueChange = useCallback((index, marginValue) => {
    const line = form.items?.[index] || initItem;
    const base = linePricingBase(line);
    const rate = computeQuotationLineRate(base, line.margin_type, marginValue, null);
    patchLineItem(index, {
      margin_rate_or_amount: marginValue,
      rate,
    });
  }, [form.items, patchLineItem]);

  const handleLineRateChange = useCallback((index, rateValue) => {
    patchLineItem(index, {
      rate: rateValue,
      margin_type: "",
      margin_rate_or_amount: "",
    });
  }, [patchLineItem]);

  const lineItemCodes = useMemo(
    () => new Set((form.items || []).map((it) => String(it.item_code || "").trim()).filter(Boolean)),
    [form.items],
  );
  const handleAddPurchasedProduct = useCallback(
    (product) => applyPurchasedProductToQuotation(setForm, product),
    [setForm],
  );

  const handleFlowLoaded = useCallback((payload) => {
    const eligible = Boolean(payload?.pricing?.auto_approve);
    setAutoApproveEligible(eligible);
    onFlowPricingChange?.(eligible);
    const timeline = payload?.delivery_timeline || {};
    const estimate = formatQuotationDateField(
      timeline.system_delivery_date || timeline.tentative_delivery_date,
    );
    setSystemDateEstimate(estimate);
  }, [onFlowPricingChange]);

  const locked = !isNew && (
    Number(form.docstatus) === 1
    || isAutoApprovedAwaitingCustomer(form)
    || (isPendingApproval(form) && !canApprove)
  );
  const customDeliveryDateLocked = locked;
  const currentQuotationName = !isNew ? form.name : "";
  const feasibleSystemDate = quotationFeasibleSystemDate(form, systemDateEstimate);
  const customDeliveryMinDate = feasibleSystemDate || today();

  useEffect(() => {
    if (locked) return;
    if (form?._discount_input_mode === "percent" && form?.discount_percent) {
      const nextAmount = calculateDiscountAmountFromPercent(form.items, form.discount_percent);
      if (String(form.discount_amount || "") === String(nextAmount || "")) return;
      setForm((f) => ({ ...f, discount_amount: nextAmount }));
      return;
    }
    if (form?._discount_input_mode === "amount" && form?.discount_amount) {
      const nextPercent = calculateDiscountPercentFromAmount(form.items, form.discount_amount);
      if (String(form.discount_percent || "") === String(nextPercent || "")) return;
      setForm((f) => ({ ...f, discount_percent: nextPercent }));
    }
  }, [
    form?.items,
    form?.discount_percent,
    form?.discount_amount,
    form?._discount_input_mode,
    locked,
    setForm,
  ]);

  const handleAttachmentPick = useCallback(async (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    if (!isAllowedQuotationAttachment(file)) {
      showToast?.("Only PDF, DOC, or DOCX files are allowed.", "error");
      event.target.value = "";
      return;
    }
    if (file.size > QUOTATION_ATTACHMENT_MAX_BYTES) {
      showToast?.("Attachment exceeds 5 MB limit.", "error");
      event.target.value = "";
      return;
    }
    setUploadingAttachment(true);
    try {
      const uploaded = await uploadQuotationAttachment(file, currentQuotationName);
      setForm((f) => ({
        ...f,
        attachment_file_url: uploaded?.file_url || "",
        attachment_file_name: uploaded?.file_name || file.name,
      }));
      showToast?.("Attachment uploaded.");
    } catch (e) {
      showToast?.(toFriendlyError(e, "Could not upload attachment."), "error");
    } finally {
      setUploadingAttachment(false);
      event.target.value = "";
    }
  }, [setForm, showToast, currentQuotationName]);

  const clearAttachment = useCallback(() => {
    setForm((f) => ({ ...f, attachment_file_url: "", attachment_file_name: "" }));
  }, [setForm]);

  const handleCopyPreviousQuotation = useCallback(async (quotationRow) => {
    const quotName = String(quotationRow?.name || "").trim();
    if (!quotName || locked) return;
    setCopyingQuotationName(quotName);
    try {
      const detail = await fetchQuotationDetailForCopy(quotName);
      applyPreviousQuotationToForm(setForm, detail);
      setCopiedFromQuotationName(quotName);
      showToast?.(`Copied lines from ${quotName} into this quotation.`);
    } catch (e) {
      showToast?.(toFriendlyError(e, "Could not copy quotation."), "error");
    } finally {
      setCopyingQuotationName("");
    }
  }, [setForm, locked, showToast]);

  const applyDeliveryOptionsPayload = useCallback((payload) => {
    if (!payload) return;
    setDeliveryOptions(payload);
    const currentForm = formPlanningRef.current;
    const hadSelection = Boolean(String(currentForm?.selected_delivery_option || "").trim())
      || String(currentForm?.delivery_plan_status || "").trim() === "Finalized";
    if (payload.selection_invalidated && hadSelection) {
      setSelectionInvalidated(true);
    } else if (!payload.selection_invalidated) {
      setSelectionInvalidated(false);
    }
    setForm((f) => {
      let changed = false;
      const next = { ...f };
      const nextStatus = payload.delivery_plan_status
        || (payload.options_ready ? "Options Ready" : "");
      if (shouldApplyDeliveryPlanStatus(f.delivery_plan_status, nextStatus, payload.selection_invalidated)) {
        next.delivery_plan_status = nextStatus;
        changed = true;
      }
      if (Array.isArray(payload.options) && payload.options.length >= 3) {
        const opt5 = payload.options[0]?.date || f.delivery_option_5 || "";
        const opt7 = payload.options[1]?.date || f.delivery_option_7 || "";
        const opt10 = payload.options[2]?.date || f.delivery_option_10 || "";
        if (next.delivery_option_5 !== opt5) {
          next.delivery_option_5 = opt5;
          changed = true;
        }
        if (next.delivery_option_7 !== opt7) {
          next.delivery_option_7 = opt7;
          changed = true;
        }
        if (next.delivery_option_10 !== opt10) {
          next.delivery_option_10 = opt10;
          changed = true;
        }
      }
      if (payload.selection_invalidated) {
        if (next.selected_delivery_option) {
          next.selected_delivery_option = "";
          changed = true;
        }
        if (next.system_delivery_date) {
          next.system_delivery_date = "";
          changed = true;
        }
      }
      return changed ? next : f;
    });
  }, [setForm]);

  const loadDeliveryOptionsImmediate = useCallback(async (apiForm, planningKey) => {
    optionsLoadRef.current += 1;
    const loadId = optionsLoadRef.current;
    setOptionsLoading(true);
    try {
      const name = String(apiForm?.name || form?.name || "").trim();
      const payload = await fetchQuotationDeliveryOptions(name, apiForm);
      if (loadId !== optionsLoadRef.current) return payload;
      applyDeliveryOptionsPayload(payload);
      if (payload) {
        lastFetchedOptionsKeyRef.current = planningKey;
      }
      return payload;
    } finally {
      if (loadId === optionsLoadRef.current) {
        setOptionsLoading(false);
      }
    }
  }, [applyDeliveryOptionsPayload, form?.name]);

  const handleSelectDeliveryOption = useCallback(async (deliveryOption) => {
    const name = String(form?.name || "").trim();
    const optionLabel = String(deliveryOption || "").trim();
    if (!name) {
      showToast?.("Save the quotation before selecting a delivery option.", "error");
      return;
    }
    if (!optionLabel) return;
    const optionDate = deliveryOptionDateForLabel(form, deliveryOptions, optionLabel);
    setSelectingDeliveryOption(true);
    try {
      await prefetchCsrf().catch(() => {});
      const params = { name, delivery_option: optionLabel };
      if (optionDate) params.delivery_option_date = optionDate;
      const res = await api.post(
        QUOTATION_SELECT_DELIVERY_OPTION_API,
        new URLSearchParams(params),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );
      const msg = res?.data?.message || {};
      if (msg?.status && msg.status !== "success") {
        throw new Error(msg.message || "Unable to select delivery option.");
      }
      setForm((f) => ({
        ...f,
        selected_delivery_option: msg.selected_delivery_option || optionLabel,
        system_delivery_date: formatQuotationDateField(msg.system_delivery_date) || f.system_delivery_date,
        delivery_plan_status: msg.delivery_plan_status || "Finalized",
      }));
      onDeliveryPlanUpdated?.(name, {
        delivery_plan_status: msg.delivery_plan_status || "Finalized",
        selected_delivery_option: msg.selected_delivery_option || optionLabel,
        system_delivery_date: formatQuotationDateField(msg.system_delivery_date),
      });
      setDeliveryOptions((prev) => (
        prev
          ? { ...prev, delivery_plan_status: msg.delivery_plan_status || "Finalized" }
          : prev
      ));
      showToast?.(msg.message || "Delivery option selected.");
      setSelectionInvalidated(false);
    } catch (e) {
      showToast?.(
        e?.response?.data?.message?.message
          || e?.response?.data?._error_message
          || e?.message
          || "Unable to select delivery option.",
        "error",
      );
    } finally {
      setSelectingDeliveryOption(false);
    }
  }, [deliveryOptions, form, onDeliveryPlanUpdated, setForm, showToast]);

  const handleRecalculateDeliveryOptions = useCallback(async () => {
    if (!quotationHasSaveableLineItems(form?.items)) return;
    setRecalculatingOptions(true);
    setSelectionInvalidated(false);
    lastFetchedOptionsKeyRef.current = "";
    try {
      const apiForm = buildPlanningApiForm(form, planningSnapshot, isNew);
      await loadDeliveryOptionsImmediate(
        apiForm,
        buildPlanningOptionsKey(form, planningSnapshot, isNew),
      );
    } finally {
      setRecalculatingOptions(false);
    }
  }, [form, isNew, loadDeliveryOptionsImmediate, planningSnapshot]);

  const lineSubtotal = quotationLineSubtotal(form.items);
  const hasLineItems = quotationHasSaveableLineItems(form.items);
  const planningApiForm = useMemo(
    () => buildPlanningApiForm(form, planningSnapshot, isNew),
    [form, planningSnapshot, isNew],
  );
  const planningOptionsKey = useMemo(
    () => buildPlanningOptionsKey(form, planningSnapshot, isNew),
    [
      form?.name,
      form?.items,
      planningSnapshot.production_completion_estimate,
      planningSnapshot.material_arrival_date,
      isNew,
    ],
  );
  const optionsReady = Boolean(deliveryOptions?.options_ready);
  const persistedPlanStatus = persistedDeliveryPlanStatus(form);
  const displayPlanStatus = (() => {
    if (persistedPlanStatus === "Finalized") return "Finalized";
    if (persistedPlanStatus === "Options Ready") return "Options Ready";
    return resolveDeliveryPlanStatus(
      form?.delivery_plan_status,
      deliveryReadiness?.delivery_plan_status,
      deliveryOptions?.delivery_plan_status,
    );
  })();
  /** Authoritative step for planning UI — prefers persisted DB status, falls back to synced readiness. */
  const planningPlanStatus = (() => {
    if (isDeliveryPlanFinalized(form)) return "Finalized";
    if (persistedPlanStatus === "Finalized" || persistedPlanStatus === "Options Ready") {
      return persistedPlanStatus;
    }
    const readinessStatus = String(deliveryReadiness?.delivery_plan_status || "").trim();
    if (
      readinessStatus
      && READINESS_SYNCABLE_PLAN_STATUSES.has(persistedPlanStatus)
      && readinessStatus !== persistedPlanStatus
    ) {
      return readinessStatus;
    }
    return persistedPlanStatus !== "Draft" ? persistedPlanStatus : (displayPlanStatus || persistedPlanStatus);
  })();
  const deliveryPlanningIncomplete = !isDeliveryPlanFinalized(form)
    && isDeliveryPlanSelectableStatus(planningPlanStatus);
  const deliveryOptionsLocked = locked && !deliveryPlanningIncomplete;

  useEffect(() => {
    if (!hasLineItems) {
      readinessLoadRef.current += 1;
      setDeliveryReadiness(null);
      setReadinessLoading(false);
      return undefined;
    }

    const loadId = ++readinessLoadRef.current;
    setReadinessLoading(true);
    const timer = setTimeout(async () => {
      const payload = await fetchQuotationDeliveryReadiness(form?.name, form?.items);
      if (loadId !== readinessLoadRef.current) return;
      setDeliveryReadiness(payload);
      if (payload?.delivery_plan_status) {
        setForm((f) => {
          const current = String(f.delivery_plan_status || "Draft");
          if (!READINESS_SYNCABLE_PLAN_STATUSES.has(current)) return f;
          if (current === payload.delivery_plan_status) return f;
          return { ...f, delivery_plan_status: payload.delivery_plan_status };
        });
      }
      setReadinessLoading(false);
    }, 250);

    return () => {
      clearTimeout(timer);
      readinessLoadRef.current += 1;
    };
  }, [form?.name, form?.items, hasLineItems]);

  useEffect(() => {
    if (!hasLineItems) {
      capacityLoadRef.current += 1;
      setCapacitySnapshot(null);
      setCapacityLoading(false);
      return undefined;
    }
    const loadId = ++capacityLoadRef.current;
    setCapacityLoading(true);
    const timer = setTimeout(async () => {
      const payload = await fetchQuotationCapacitySnapshot(form?.name, planningApiForm);
      if (loadId !== capacityLoadRef.current) return;
      setCapacitySnapshot(payload);
      setCapacityLoading(false);
    }, 300);
    return () => {
      clearTimeout(timer);
      capacityLoadRef.current += 1;
    };
  }, [
    form?.name,
    form?.items,
    planningSnapshot.production_completion_estimate,
    planningSnapshot.material_arrival_date,
    form?.tentative_delivery_date,
    hasLineItems,
    planningApiForm,
  ]);

  useEffect(() => {
    if (!hasLineItems) {
      optionsLoadRef.current += 1;
      setDeliveryOptions(null);
      setOptionsLoading(false);
      lastFetchedOptionsKeyRef.current = "";
      return undefined;
    }

    if (!planningOptionsKey) {
      return undefined;
    }

    if (planningOptionsKey === lastFetchedOptionsKeyRef.current) {
      setOptionsLoading(false);
      return undefined;
    }

    const loadId = ++optionsLoadRef.current;
    setOptionsLoading(true);
    const timer = setTimeout(async () => {
      try {
        if (planningOptionsKey === lastFetchedOptionsKeyRef.current) return;
        const apiForm = buildPlanningApiForm(formPlanningRef.current, planningSnapshotRef.current, isNew);
        const payload = await fetchQuotationDeliveryOptions(formPlanningRef.current?.name, apiForm);
        if (loadId !== optionsLoadRef.current) return;
        applyDeliveryOptionsPayload(payload);
        if (payload) {
          lastFetchedOptionsKeyRef.current = planningOptionsKey;
        }
      } finally {
        if (loadId === optionsLoadRef.current) {
          setOptionsLoading(false);
        }
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      optionsLoadRef.current += 1;
    };
  }, [planningOptionsKey, hasLineItems, isNew, applyDeliveryOptionsPayload]);

  return (
    <div className="qt-form-stack">
      {isNew && (
        <div className="qt-form-banner">
          <strong>Step 1 — Create draft.</strong> Select customer, add line items, then click <strong>Save quotation</strong>.
          Delivery planning and approval happen in the next step (edit mode).
        </div>
      )}
      {!isNew && !isPendingApproval(form) && Number(form.docstatus) !== 1 && !isDeliveryPlanFinalized(form) && (() => {
        const planningBanner = deliveryPlanningBannerMessage(planningPlanStatus);
        return planningBanner ? (
          <div className="qt-form-banner">{planningBanner}</div>
        ) : null;
      })()}
      {locked && (
        <div className="qt-form-banner">
          This quotation is <strong>submitted</strong> in ERPNext (read-only here). Cancel or amend it in ERPNext if you need changes.
        </div>
      )}

      <section className="qt-form-section">
        <h3 className="qt-form-section__title">Quotation details</h3>
      <div className="qt-form-grid-2">
        <F label="Customer *">
          {opts.customers?.length ? (
            <select className="qt-input" name="customer" value={form.customer || ""} disabled={locked} onChange={(e) => setField("customer", e.target.value)}>
              <option value="">Select customer</option>
              {opts.customers.map(c => <option key={c.name} value={c.name}>{c.label}</option>)}
            </select>
          ) : (
            <input className="qt-input" placeholder="Customer name" value={form.customer || ""} disabled={locked} onChange={(e) => setField("customer", e.target.value)} />
          )}
        </F>
        <F label="Order Type">
          <select className="qt-input" value={form.order_type || "Sales"} disabled={locked} onChange={(e) => setField("order_type", e.target.value)}>
            {quotationOrderTypes(opts.order_type).map((o) => <option key={o}>{o}</option>)}
          </select>
        </F>
        <F label="Valid Till">
          <input className="qt-input" type="date" value={form.valid_till || ""} disabled={locked} onChange={(e) => setField("valid_till", e.target.value)} />
        </F>
      </div>

      <div className="qt-delivery-dates-row">
        <div className="qt-delivery-dates-row__editor">
          <F label="Custom Delivery Date">
            <input
              className="qt-input"
              type="date"
              min={customDeliveryMinDate}
              value={form.tentative_delivery_date || ""}
              disabled={customDeliveryDateLocked}
              onChange={(e) => setField("tentative_delivery_date", e.target.value)}
            />
            <span className="qt-form-status-hint">
              Optional customer request. It must be on or after the system feasible date.
            </span>
          </F>
        </div>
        <QuotationDeliveryDatesFlow
          form={form}
          systemEstimate={systemDateEstimate}
          locked={customDeliveryDateLocked}
        />
      </div>
      </section>

      {/* Line Items */}
      <div>
        <div className="qt-items-header">
          <span className="qt-items-title">Line Items</span>
          <button className="pm-btn pm-btn-ghost qt-btn-ghost qt-items-add-btn" onClick={addItem} type="button" disabled={locked}>+ Add Item</button>
        </div>

        <div className="qt-items-box">
          <div className="qt-items-table-scroll">
          <table className="pm-table qt-items-table qt-items-edit-table qt-items-edit-table--margin">
            <thead>
              <tr>
                {[
                  "Item Code",
                  "Qty",
                  "Cost base (₹)",
                  "Margin",
                  "Margin val",
                  "Rate (₹)",
                  "Amount",
                  "",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {form.items.map((it, i) => (
                <tr key={i}>
                  <td className="qt-col-item">
                    {opts.items?.length ? (
                      <select
                        className="qt-input qt-input--compact"
                        value={it.item_code}
                        disabled={locked}
                        onChange={(e) => handleItemCodeChange(i, e.target.value)}
                      >
                        <option value="">Select item</option>
                        {opts.items.map(o => <option key={o.code} value={o.code}>{o.label || `${o.code} — ${o.name}`}</option>)}
                      </select>
                    ) : (
                      <input
                        className="qt-input qt-input--compact"
                        placeholder="Item code"
                        value={it.item_code}
                        disabled={locked}
                        onChange={(e) => handleItemCodeChange(i, e.target.value)}
                      />
                    )}
                  </td>
                  <td className="qt-col-qty">
                    <input
                      className="qt-input qt-input--compact"
                      type="number"
                      min="1"
                      value={it.qty}
                      disabled={locked}
                      onChange={(e) => handleLineQtyChange(i, e.target.value)}
                    />
                  </td>
                  <td className="qt-col-base">
                    <input
                      className="qt-input qt-input--compact"
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0"
                      value={it.price_list_rate ?? ""}
                      disabled={locked || !String(it.item_code || "").trim()}
                      onChange={(e) => handleBasePriceChange(i, e.target.value)}
                    />
                    {!lineHasQuotationBase(it) && it.item_code ? (
                      <p className="qt-line-base-hint">Enter base price or select customer to fetch.</p>
                    ) : it.has_computed_base ? (
                      <p className="qt-line-base-hint">Computed from BOM cost.</p>
                    ) : null}
                  </td>
                  <td className="qt-col-margin-type">
                    <select
                      className="qt-input qt-input--compact"
                      value={it.margin_type || ""}
                      disabled={locked || !String(it.item_code || "").trim() || !lineHasQuotationBase(it)}
                      onChange={(e) => handleMarginTypeChange(i, e.target.value)}
                    >
                      {QUOTATION_MARGIN_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value || "none"} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="qt-col-margin-val">
                    <input
                      className="qt-input qt-input--compact"
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0"
                      value={it.margin_rate_or_amount ?? ""}
                      disabled={locked || !it.margin_type}
                      onChange={(e) => handleMarginValueChange(i, e.target.value)}
                    />
                  </td>
                  <td className="qt-col-rate">
                    <input
                      className="qt-input qt-input--compact"
                      type="number"
                      min="0"
                      step="any"
                      value={it.rate}
                      disabled={locked}
                      onChange={(e) => handleLineRateChange(i, e.target.value)}
                    />
                    <QuotationLineLastPriceHint
                      customerId={form.customer}
                      itemCode={it.item_code}
                      disabled={locked}
                      currentRate={it.rate}
                      onUseLastPrice={(rate) => handleLineRateChange(i, rate)}
                    />
                  </td>
                  <td className="qt-money">
                    {fmt((Number(it.qty) || 0) * (Number(it.rate) || 0))}
                  </td>
                  <td className="qt-col-act">
                    {form.items.length > 1 && !locked ? (
                      <button type="button" className="qt-items-remove-btn" onClick={() => removeItem(i)} aria-label="Remove line">×</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="qt-items-total">
            <span className="qt-items-total-label">Line Subtotal</span>
            <span className="qt-money qt-items-total-val">{fmt(lineSubtotal)}</span>
          </div>
        </div>
      </div>

      <section className="qt-form-section">
        <h3 className="qt-form-section__title">Planning</h3>
        <QuotationFlowValidationPanel
          name={form.name}
          customer={form.customer}
          items={form.items}
          materialArrivalDate={form.material_arrival_date}
          productionStartDate={form.production_start_date}
          productionCompletionEstimate={form.production_completion_estimate}
          fulfilmentPlant={form.fulfilment_plant || ""}
          onFulfilmentPlantChange={(v) => setField("fulfilment_plant", v)}
          plantOptions={plantOptions}
          showToast={showToast}
          canProcure={canProcure}
          docstatus={form.docstatus}
          portalApprovalStatus={form.portal_approval_status}
          submittedForApprovalAt={form.submitted_for_approval_at}
          onFlowLoaded={handleFlowLoaded}
        />
      </section>

      <section className="qt-form-section qt-form-section--delivery">
        <h3 className="qt-form-section__title">Delivery planning</h3>
        {!hasLineItems ? (
          <div className="qt-form-banner qt-form-banner--muted">
            Add line items above to unlock delivery options (5 / 7 / 10 days).
          </div>
        ) : (
          <>
            {isNew ? (
              <div className="qt-form-banner qt-form-banner--muted">
                Save the quotation first, then complete delivery planning below.
              </div>
            ) : (
              <div className="qt-planning-actions">
                <QuotationPlanningStepBanner
                  persistedPlanStatus={planningPlanStatus}
                  materialsAvailable={deliveryReadiness?.materials_available ?? deliveryOptions?.materials_available}
                  canSelectDeliveryOption={canSelectDeliveryOption}
                  isFinalized={isDeliveryPlanFinalized(form)}
                  quotation={form}
                  autoApproveEligible={autoApproveEligible}
                />

                {(isRejectedApproval(form) && form.rejection_reason) || isPendingApproval(form) || isAutoApprovedAwaitingCustomer(form) ? (
                  <F label="Status">
                    <div className="qt-form-status-row">
                      <Pill status={quotationDisplayStatus(form)} />
                      {planningPlanStatus && planningPlanStatus !== "Draft" ? (
                        <span className={`qt-form-plan-pill${deliveryPlanPillClass(planningPlanStatus)}`}>
                          Plan: {planningPlanStatus}
                        </span>
                      ) : null}
                      {isRejectedApproval(form) && form.rejection_reason ? (
                        <span className="qt-form-status-hint">Rejected: {form.rejection_reason}</span>
                      ) : null}
                      {isPendingApproval(form) && !canApprove ? (
                        <span className="qt-form-status-hint">Waiting for manager approval.</span>
                      ) : null}
                      {isAutoApprovedAwaitingCustomer(form) ? (
                        <span className="qt-form-status-hint">Auto-approve eligible — send to customer from View.</span>
                      ) : null}
                    </div>
                  </F>
                ) : null}
              </div>
            )}

            <QuotationDeliveryOptionsPanel
              deliveryOptions={deliveryOptions}
              loading={optionsLoading}
              readiness={deliveryReadiness}
              capacity={capacitySnapshot}
              materialArrivalDate={form?.material_arrival_date}
              productionCompletionEstimate={form?.production_completion_estimate}
              deliveryPlanStatus={displayPlanStatus}
              persistedPlanStatus={persistedPlanStatus}
              planningPlanStatus={planningPlanStatus}
              selectedOption={form?.selected_delivery_option}
              canSelect={canSelectDeliveryOption && !isNew}
              previewOnly={isNew}
              selecting={selectingDeliveryOption}
              locked={deliveryOptionsLocked}
              onSelect={handleSelectDeliveryOption}
              onRecalculate={handleRecalculateDeliveryOptions}
              recalculating={recalculatingOptions}
              selectionInvalidated={selectionInvalidated}
            />
          </>
        )}
      </section>

      <div className="qt-form-grid-2 qt-discount-grid">
        <F label="Discount %">
          <input
            className="qt-input"
            type="number"
            min="0"
            max="100"
            step="any"
            placeholder="e.g. 5"
            value={form.discount_percent ?? ""}
            disabled={locked}
            onChange={(e) => setDiscountPercent(e.target.value)}
          />
        </F>
        <F label="Discount Amount (₹)">
          <input
            className="qt-input"
            type="number"
            min="0"
            step="any"
            placeholder="e.g. 1000"
            value={form.discount_amount ?? ""}
            disabled={locked}
            onChange={(e) => setDiscountAmount(e.target.value)}
          />
        </F>
        <F label="Apply Discount On">
          <select
            className="qt-input"
            value={form.apply_discount_on || "Grand Total"}
            disabled={locked}
            onChange={(e) => setField("apply_discount_on", e.target.value)}
          >
            {QUOTATION_DISCOUNT_ON_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </F>
      </div>

      <F label="Attachment (PDF / DOC / DOCX)">
        <div className="qt-attachment-row">
          <input
            className="qt-input"
            type="file"
            accept={QUOTATION_ATTACHMENT_ACCEPT}
            disabled={locked || uploadingAttachment}
            onChange={handleAttachmentPick}
          />
          {form.attachment_file_url ? (
            <div className="qt-attachment-meta">
              <a
                href={form.attachment_file_url}
                target="_blank"
                rel="noreferrer"
                className="qt-attachment-link"
              >
                {form.attachment_file_name || "View attachment"}
              </a>
              {!locked && (
                <button
                  type="button"
                  className="pm-btn pm-btn-ghost qt-btn-ghost qt-btn-compact"
                  onClick={clearAttachment}
                >
                  Remove
                </button>
              )}
            </div>
          ) : (
            <p className="qt-attachment-hint">
              Upload proposal or supporting document (max 5 MB).
            </p>
          )}
          {uploadingAttachment ? <p className="qt-attachment-hint">Uploading attachment…</p> : null}
        </div>
      </F>

      <QuotationTotalsPanel form={form} locked={locked} />

      <F label="Terms & Conditions">
        <textarea
          className="qt-input qt-textarea"
          placeholder="Payment terms, delivery terms, warranty, etc."
          rows={3}
          value={form.terms || ""}
          readOnly={locked}
          disabled={locked}
          onChange={(e) => setField("terms", e.target.value)}
        />
      </F>
      <F label="Notes">
        <textarea
          className="qt-input qt-textarea"
          placeholder="Internal notes for this quotation…"
          rows={2}
          value={form.note || ""}
          readOnly={locked}
          disabled={locked}
          onChange={(e) => setField("note", e.target.value)}
        />
      </F>
    </div>
  );
}

/* ─── Quotation View (compact typography) ─────────────────────── */
function QuotView({ q }) {
  if (!q) return null;
  return (
    <div className="qt-view-stack">
      <div className="qt-view-hero">
        <div>
          <div className="qt-view-tag">Quotation</div>
          <div className="qt-view-name">{q.name}</div>
          <div className="qt-view-customer">{q.customer}</div>
        </div>
        <div className="qt-view-hero-right">
          <div className="qt-money qt-view-money-lg">{fmt(q.grand_total)}</div>
          <div className="qt-view-pill-wrap"><Pill status={quotationDisplayStatus(q)} /></div>
          {isRejectedApproval(q) && q.rejection_reason ? (
            <div className="qt-view-valid">Rejected: {q.rejection_reason}</div>
          ) : null}
          {q.system_delivery_date && (
            <div className="qt-view-valid">System delivery {formatQuotationDateField(q.system_delivery_date)}</div>
          )}
          {q.tentative_delivery_date && (
            <div className="qt-view-valid">Custom delivery {formatQuotationDateField(q.tentative_delivery_date)}</div>
          )}
        </div>
      </div>

      <div className="qt-view-grid qt-view-grid--3">
        {[
          { label: "Order Type", value: q.order_type },
          { label: "System Delivery", value: formatQuotationDateField(q.system_delivery_date) || "—" },
          { label: "Custom Delivery", value: formatQuotationDateField(q.tentative_delivery_date) || "—" },
          { label: "Committed Delivery", value: quotationEffectiveDeliveryDate(q) || "—" },
          { label: "Currency",   value: q.currency },
          { label: "Total Qty",  value: q.total_qty },
          { label: "Net Total",  value: fmt(q.net_total) },
          ...(Array.isArray(q.taxes) && q.taxes.length
            ? q.taxes.map((tax, index) => ({
              label: tax.description || `Tax ${index + 1}`,
              value: fmt(tax.tax_amount),
            }))
            : [{ label: "GST", value: fmt(q.gst_amount ?? q.total_taxes_and_charges) }]),
          ...(q.taxes_and_charges
            ? [{ label: "Tax Template", value: q.taxes_and_charges }]
            : []),
          ...(Number(q.discount_percent) > 0
            ? [{ label: "Discount %", value: `${q.discount_percent}%` }]
            : []),
          ...(Number(q.discount_amount) > 0
            ? [{ label: "Discount Amount", value: fmt(q.discount_amount) }]
            : []),
          ...(Number(q.discount_percent) > 0 || Number(q.discount_amount) > 0
            ? [{ label: "Discount Applied On", value: q.apply_discount_on || "Grand Total" }]
            : []),
          { label: "Created",    value: q.creation?.split(" ")[0] },
          { label: "Modified",   value: q.modified?.split(" ")[0] },
          { label: "Fulfilment plant", value: q.fulfilment_plant || "Auto" },
          { label: "Customer response", value: customerResponseLabel(q.customer_response_status) },
          ...(q.customer_rejection_reason
            ? [{ label: "Customer rejection reason", value: q.customer_rejection_reason }]
            : []),
          ...(q.superseded_by ? [{ label: "Superseded by", value: q.superseded_by }] : []),
        ].map(({ label, value }) => (
          <div key={label} className="qt-view-field">
            <div className="qt-view-lbl">{label}</div>
            <div className="qt-view-val">
              {value === undefined || value === null || value === "" ? "—" : value}
            </div>
          </div>
        ))}
      </div>

      {q.items?.length > 0 && (
        <div>
          <div className="qt-view-items-title">Line Items</div>
          <div className="qt-view-items-box">
            <table className="pm-table qt-items-table">
              <thead>
                <tr>
                  {["Item", "Description", "Qty", "Base", "Margin", "Rate", "Amount"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.items.map((it, i) => (
                  <tr key={i}>
                    <td className="qt-view-item-name">{it.item_name || it.item_code}</td>
                    <td className="qt-view-item-muted">{it.description || "—"}</td>
                    <td className="qt-view-item-muted">{it.qty}</td>
                    <td className="qt-view-item-muted">{fmt(it.price_list_rate)}</td>
                    <td className="qt-view-item-muted">
                      {it.margin_type
                        ? (it.margin_type === "Percentage"
                          ? `${it.margin_rate_or_amount}%`
                          : fmt(it.margin_rate_or_amount))
                        : "—"}
                    </td>
                    <td className="qt-view-item-muted">{fmt(it.rate)}</td>
                    <td className="qt-money">{fmt(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="qt-view-items-total">
              <span className="qt-view-items-total-lbl">Net Total</span>
              <span className="qt-money">{fmt(q.net_total)}</span>
            </div>
            <div className="qt-view-items-total">
              <span className="qt-view-items-total-lbl">GST</span>
              <span className="qt-money">{fmt(q.gst_amount ?? q.total_taxes_and_charges)}</span>
            </div>
            <div className="qt-view-items-total qt-view-items-total--grand">
              <span className="qt-view-items-total-lbl">Grand Total</span>
              <span className="qt-money">{fmt(q.grand_total)}</span>
            </div>
          </div>
        </div>
      )}

      {q.terms && (
        <div className="qt-notes-box">
          <div className="qt-notes-label">Terms & Conditions</div>
          <p className="qt-view-note">{stripQuotationTermsText(q.terms)}</p>
        </div>
      )}
      {q.attachment_file_url && (
        <div className="qt-notes-box">
          <div className="qt-notes-label">Attachment</div>
          <a
            className="qt-attachment-link"
            href={q.attachment_file_url}
            target="_blank"
            rel="noreferrer"
          >
            {q.attachment_file_name || "View attachment"}
          </a>
        </div>
      )}
      {q.note && (
        <div className="qt-notes-box">
          <div className="qt-notes-label">Notes</div>
          <p className="qt-view-note">{q.note}</p>
        </div>
      )}
    </div>
  );
}

function stripQuotationTermsText(html) {
  if (!html || typeof html !== "string") return "";
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.textContent || d.innerText || "").trim() || html;
}

/* ─── Tiny helpers ───────────────────────────────────────────── */
const F = ({ label, children }) => (
  <div className="qt-field">
    <label className="qt-field-lbl">{label}</label>
    {children}
  </div>
);

const MFooter = SalesModalFooter;

