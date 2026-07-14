import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { HiOutlineBriefcase } from "react-icons/hi2";
import api, { prefetchCsrf, prefetchCsrfInBackground } from "../../lib/apiUtils";
import SalesPageLoader from "../../components/SalesPageLoader.jsx";
import SalesEmptyState from "../../components/SalesEmptyState.jsx";
import ConfirmDeleteModal from "../../components/ConfirmDeleteModal.jsx";
import SalesDetailModal from "../../components/SalesDetailModal.jsx";
import SalesModalFooter from "../../components/SalesModalFooter.jsx";
import {
  opportunityOnDeliveryPipeline,
  interestedTargetApiStage,
  pipelineColumnForApiStage,
  pipelineColumnLabel,
} from "../../lib/pipelineStageMap.js";
import ListPagination from "../../../../common/components/ListPagination.jsx";
import usePagedRows from "../../../../common/hooks/usePagedRows.js";
import { SALES_PAGE_SIZE_OPTIONS } from "../../lib/pagination.js";
import { SALES_COLORS as C } from "../../theme/tokens.js";
import { salesOrderCreatedToast } from "../../lib/salesWorkflowNav.js";
import SalesKpiCard from "../../components/SalesKpiCard.jsx";
import SalesDocumentId from "../../components/SalesDocumentId.jsx";
import useSalesToast, { SalesToast } from "../../components/useSalesToast.jsx";
import { useSalesAuth } from "../../hooks/useSalesAuth.js";
import { canAccessSalesPipeline } from "../../lib/roles.js";
import { toFriendlyError } from "../../lib/apiUtils";
import { notifyManufacturingDashboardRefresh } from "../../lib/productDevEvents.js";
import { dispatchPipelineRefresh } from "../../lib/pipelineRefresh.js";

const STATUS_PILL = {
  Open:        [C.blue,   C.blueDim],
  Quotation:   [C.indigo, C.indigoLt],
  Converted:   [C.cyan,   C.cyanLt],
  Won:         [C.green,  C.greenDim],
  Lost:        [C.red,    C.redDim],
  Closed:      [C.muted,  C.surface2],
};

const initForm = {
  lead: "",
  opportunity_name: "",
  opportunity_owner: "",
  expected_revenue: "",
  probability: "50",
  close_date: "",
  stage: "",
  source: "",
  product_code: "",
  quantity: "",
  required_delivery_timeline: "",
  contact_email: "",
  contact_mobile: "",
  notes: "",
};

function itemMasterVerified(opp, { loading = false } = {}) {
  if (loading) return false;
  const verification = opp?.product_verification;
  if (verification && typeof verification.item_exists === "boolean") {
    return verification.item_exists;
  }
  const hasProduct = Boolean(
    opp?.effective_product_code || opp?.product_code || opp?.product_request,
  );
  if (hasProduct) return false;
  return Boolean(opp?.product_exists);
}

function productDevStatusLabel(opp, { loading = false } = {}) {
  if (loading) return "";
  const display = String(opp?.product_dev_status_display || "").trim();
  if (display) return display;
  const raw = String(opp?.product_dev_status || "").trim();
  if (raw) return raw;
  return itemMasterVerified(opp, { loading }) ? "Not Required" : "Not Started";
}

function opportunityProductReady(opp) {
  return itemMasterVerified(opp);
}

function fmtItemMasterCost(value) {
  const n = Number(value || 0);
  if (!n) return "";
  return `₹ ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function opportunityItemMasterFields(opp) {
  const v = opp?.product_verification;
  if (!v?.item_exists) return [];

  const fields = [];
  if (v.uom) fields.push({ label: "UOM", value: v.uom });
  const cost = fmtItemMasterCost(v.standard_cost);
  if (cost) fields.push({ label: "Standard Cost", value: cost });
  const category = String(v.category || v.item_type || "").trim();
  if (category) fields.push({ label: "Category", value: category });
  const status = v.active_status || (v.active ? "Active" : v.active === false ? "Disabled" : "");
  if (status) fields.push({ label: "Item Status", value: status });
  if (v.hsn) fields.push({ label: "HSN", value: v.hsn });
  if (v.gst) fields.push({ label: "GST", value: v.gst });
  if (v.warehouse) fields.push({ label: "Default Warehouse", value: v.warehouse });
  return fields;
}

const MOBILE_PREFIX = "+91";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

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

function oppForEdit(opp) {
  if (!opp) return null;
  return {
    ...opp,
    close_date: opp.expected_closing || opp.close_date || "",
    stage: opp.sales_stage || opp.stage || "",
    lead: opp.party_name_id || opp.party_name || opp.lead || "",
    opportunity_owner: opp.opportunity_owner || "",
    product_code: opp.effective_product_code || opp.product_code || opp.product_request || "",
    quantity: opp.quantity == null || opp.quantity === "" ? "" : String(opp.quantity),
    required_delivery_timeline: opp.required_delivery_timeline
      ? String(opp.required_delivery_timeline).slice(0, 10)
      : "",
    contact_mobile: extractPhoneDigits(opp.contact_mobile),
  };
}

function validateOpportunityForm(form, { isCreate = false } = {}) {
  const errors = {};
  const requireField = (key, value, message) => {
    if (!value) errors[key] = message;
  };

  const lead = String(form.lead || "").trim();
  const owner = String(form.opportunity_owner || "").trim();
  const title = String(form.opportunity_name || "").trim();
  const revenueRaw = String(form.expected_revenue ?? "").trim();
  const probabilityRaw = String(form.probability ?? "").trim();
  const stage = String(form.stage || "").trim();
  const closeDate = String(form.close_date || "").trim();
  const source = String(form.source || "").trim();
  const productCode = String(form.product_code || "").trim();
  const quantityRaw = String(form.quantity ?? "").trim();
  const email = String(form.contact_email || "").trim();
  const mobileDigits = extractPhoneDigits(form.contact_mobile);

  if (!isCreate) {
    if (quantityRaw) {
      const qty = Number(quantityRaw);
      if (Number.isNaN(qty) || qty <= 0) {
        errors.quantity = "Quantity must be greater than zero.";
      }
    }
    return errors;
  }

  requireField("lead", lead, "Select a lead to link this opportunity.");
  requireField("opportunity_owner", owner, "Opportunity owner is required.");
  requireField("opportunity_name", title, "Opportunity title is required.");
  requireField("stage", stage, "Sales stage is required.");
  requireField("close_date", closeDate, "Expected close date is required.");
  requireField("source", source, "Lead source is required.");
  requireField("product_code", productCode, "Product is required.");
  if (!quantityRaw) {
    errors.quantity = "Quantity is required.";
  } else {
    const qty = Number(quantityRaw);
    if (Number.isNaN(qty) || qty <= 0) {
      errors.quantity = "Quantity must be greater than zero.";
    }
  }

  if (!revenueRaw) {
    errors.expected_revenue = "Expected revenue is required.";
  } else {
    const revenue = Number(revenueRaw);
    if (Number.isNaN(revenue) || revenue < 0) {
      errors.expected_revenue = "Enter a valid revenue amount (0 or greater).";
    }
  }

  if (!probabilityRaw) {
    errors.probability = "Probability is required.";
  } else {
    const prob = Number(probabilityRaw);
    if (Number.isNaN(prob) || prob < 0 || prob > 100) {
      errors.probability = "Probability must be between 0 and 100.";
    }
  }

  if (!email) {
    errors.contact_email = "Contact email is required.";
  } else if (/^\d+$/.test(email)) {
    errors.contact_email = "Enter a valid email address, not numbers only.";
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.contact_email = "Enter a valid email address (e.g. name@example.com).";
  }

  if (!mobileDigits) {
    errors.contact_mobile = "Contact mobile is required.";
  } else if (mobileDigits.length !== 10) {
    errors.contact_mobile = "Mobile number must be exactly 10 digits after +91.";
  }

  return errors;
}

function firstOppFormTabWithErrors(errors) {
  const basicKeys = [
    "lead", "opportunity_owner", "opportunity_name", "expected_revenue",
    "probability", "stage", "close_date", "source", "product_code", "quantity",
  ];
  if (basicKeys.some((k) => errors[k])) return "basic";
  if (errors.contact_email || errors.contact_mobile) return "contact";
  return "basic";
}

const fmt = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN")}`;
const fmtK = (n) => n >= 100000 ? `₹${(n/100000).toFixed(1)}L` : n >= 1000 ? `₹${(n/1000).toFixed(0)}k` : `₹${n}`;

/** Same rule as `dashboard_data` open_count — not Won, Lost, or Closed */
function isDashboardOpenStatus(status) {
  const s = status || "";
  return !["Won", "Lost", "Closed"].includes(s);
}

function oppMatchesKpiFilter(o, kpiFilter) {
  if (!kpiFilter || kpiFilter === "total_pipeline" || kpiFilter === "weighted") return true;
  if (kpiFilter === "open") return isDashboardOpenStatus(o.status);
  if (kpiFilter === "won") return o.status === "Won";
  if (kpiFilter === "lost") return o.status === "Lost";
  return true;
}

/**
 * ERPNext "Sales Stage" doc names that correspond to the SPA pipeline step "Discussion"
 * (must stay aligned with sales_stage synonyms in sales_app.api.opportunity).
 */
const DISCUSSION_STAGE_ALIASES = new Set([
  "Discussion",
  "Prospecting",
  "Qualification",
  "Needs Analysis",
  "Needs Analysis / Requirement Gathering",
  "Lead",
  "Open",
]);

const STAGE_FLOW_KEYS = new Set([
  "Discussion",
  "Proposal",
  "Negotiation",
  "Closed Won",
  "Closed Lost",
]);

function opportunityStageRaw(opp) {
  return (opp?.sales_stage || opp?.stage || "").trim();
}

/** Canonical step for action buttons (must match backend STAGE_FLOW + ERPNext labels). */
function pipelineStageForActions(raw) {
  const s = (raw || "").trim();
  if (!s) return "Discussion";
  if (STAGE_FLOW_KEYS.has(s)) return s;
  if (DISCUSSION_STAGE_ALIASES.has(s)) return "Discussion";
  const low = s.toLowerCase();
  if (low === "closed won" || low === "won") return "Closed Won";
  if (low === "closed lost" || low === "lost") return "Closed Lost";
  if (low.includes("negotiation")) return "Negotiation";
  if (low.includes("proposal") || low.includes("quotation") || low.includes("price quote")) return "Proposal";
  if (low.includes("identifying") && low.includes("decision")) return "Proposal";
  if (low.includes("prospect") || low.includes("qualif") || low.includes("needs analysis")) return "Discussion";
  return "Discussion";
}

/** Fixed pill colors by pipeline stage (readable on dark theme). */
function stagePillStyle(raw) {
  const canonical = pipelineStageForActions(raw);
  const styles = {
    Discussion: { color: C.blue, bg: C.blueDim },
    Proposal: { color: C.red, bg: C.redDim },
    Negotiation: { color: C.cyan, bg: C.cyanLt },
    "Closed Won": { color: C.green, bg: C.greenDim },
    "Closed Lost": { color: C.purple, bg: C.purpleDim },
  };
  return styles[canonical] || { color: C.sub, bg: "rgba(148, 163, 184, 0.16)" };
}

/** Show Interested / Not interested for any open deal (not Won/Lost). */
function shouldShowCustomerResponse(opp) {
  const status = (opp?.status || "").trim();
  if (status === "Won" || status === "Lost") return false;
  const pipe = pipelineStageForActions(opportunityStageRaw(opp));
  return pipe !== "Closed Won" && pipe !== "Closed Lost";
}

/** Table/view label: group early CRM stages under “Discussion”. */
function stageDisplayLabel(raw) {
  const s = (raw || "").trim();
  if (!s) return "Discussion";
  if (DISCUSSION_STAGE_ALIASES.has(s)) return "Discussion";
  const low = s.toLowerCase();
  if (low.includes("negotiation")) return "Negotiation";
  if (low.includes("proposal") || low.includes("quotation") || low.includes("price quote")) return "Proposal";
  if (low === "closed won" || low === "won") return "Closed Won";
  if (low === "closed lost" || low === "lost") return "Closed Lost";
  return s;
}

/* ─── Section card ───────────────────────────────────────────── */
const Card = ({ title, children }) => (
  <div className="op-card">
    {title && (
      <div className="op-card-hd">
        <span className="op-card-title">{title}</span>
      </div>
    )}
    <div className="op-card-body">{children}</div>
  </div>
);

/* ─── Toast ──────────────────────────────────────────────────── */

/* ─── Main Component ─────────────────────────────────────────── */
function parseApiErrorMessage(e, fallback) {
  const data = e?.response?.data;
  try {
    if (data?._server_messages) {
      const arr = JSON.parse(data._server_messages);
      const first = Array.isArray(arr) ? arr[0] : arr;
      if (first) return String(first).replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').trim().slice(0, 240);
    }
    if (data?._error_message) return String(data._error_message).trim().slice(0, 240);
    if (data?.exception) {
      return String(data.exception).replace(/frappe\.exceptions\.\w+:/g, "").trim().slice(0, 240);
    }
  } catch {
    /* keep fallback */
  }
  return fallback;
}

export default function OpportunityDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const openedFromUrlRef = useRef("");
  const { user, roles: portalRoles, salesRole } = useSalesAuth();
  const managerPipelineAccess = useMemo(
    () => canAccessSalesPipeline(salesRole, portalRoles),
    [salesRole, portalRoles],
  );
  const [dash, setDash]         = useState(null);
  const [opps, setOpps]         = useState([]);
  const [options, setOptions]   = useState({ stage: [], source: [], status: [], leads: [], users: [], products: [] });
  const [loading, setLoading]   = useState(true);
  const [metaLoading, setMetaLoading] = useState(true);
  const [search, setSearch]     = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editOpp, setEditOpp]   = useState(null);
  const [viewOpp, setViewOpp]   = useState(null);
  const [viewOppDetailLoading, setViewOppDetailLoading] = useState(false);
  const [form, setForm]         = useState(initForm);
  const [formErrors, setFormErrors] = useState({});
  const [editFormErrors, setEditFormErrors] = useState({});
  const [saving, setSaving]     = useState(false);
    const [activeTab, setActiveTab] = useState("basic");
  const [filterStage, setFilterStage] = useState("");
  /** null | "total_pipeline" | "weighted" | "open" | "won" | "lost" — narrows the table; matches dashboard KPIs */
  const [kpiFilter, setKpiFilter] = useState(null);
  const [wonFlowState, setWonFlowState] = useState({});
  const [pageSize, setPageSize] = useState(10);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [stageBusy, setStageBusy] = useState(null);

  const { toast, showToast } = useSalesToast(3200);

  const openNewOpportunityModal = () => {
    setFormErrors({});
    setForm({
      ...initForm,
      stage: options.stage?.[0] ?? "",
      source: options.source?.[0] ?? "",
      opportunity_owner: user || "",
    });
    setShowForm(true);
    setActiveTab("basic");
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

  const fetchOpportunityDetail = useCallback(async (oppOrName) => {
    const name = typeof oppOrName === "string" ? oppOrName : oppOrName?.name;
    if (!name) return null;
    try {
      const res = await api.get("/api/method/sales_app.api.opportunity.get_opportunity", {
        params: { name },
      });
      return res.data?.message || null;
    } catch {
      return typeof oppOrName === "object" ? oppOrName : null;
    }
  }, []);

  const openViewOpp = useCallback(async (opp) => {
    const name = opp?.name;
    if (!name) return;
    setViewOppDetailLoading(true);
    setViewOpp({ name });
    try {
      const fresh = await fetchOpportunityDetail(name);
      if (fresh) setViewOpp(fresh);
      else if (opp) setViewOpp(opp);
    } finally {
      setViewOppDetailLoading(false);
    }
  }, [fetchOpportunityDetail]);

  const closeViewOpp = useCallback(() => {
    setViewOpp(null);
    setViewOppDetailLoading(false);
  }, []);

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    try {
      const [dashRes, optsRes] = await Promise.all([
        api.get("/api/method/sales_app.api.opportunity.dashboard_data"),
        api.get("/api/method/sales_app.api.opportunity.get_options"),
      ]);
      setDash(dashRes.data.message);
      if (optsRes.data.message) setOptions(optsRes.data.message);
    } catch {
      /* KPI / form options — list still usable if these fail */
    } finally {
      setMetaLoading(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    prefetchCsrfInBackground();
    try {
      const oppsRes = await api.get("/api/method/sales_app.api.opportunity.get_opportunities");
      const list = oppsRes.data.message || [];
      setOpps(list);
      void loadMeta();
      return list;
    } catch (e) {
      showToast(toFriendlyError(e, "Could not load opportunities."), "error");
      setOpps([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [loadMeta, showToast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (loading) return;
    const openId = String(searchParams.get("open") || "").trim();
    if (!openId || openedFromUrlRef.current === openId) return;

    const openFromUrl = async () => {
      openedFromUrlRef.current = openId;
      const inList = opps.find((o) => o.name === openId);
      if (inList) {
        void openViewOpp(inList);
      } else {
        try {
          setViewOppDetailLoading(true);
          const opp = await fetchOpportunityDetail(openId);
          if (opp) setViewOpp(opp);
          else showToast(`Opportunity ${openId} not found.`, "error");
        } catch {
          showToast(`Opportunity ${openId} not found.`, "error");
        } finally {
          setViewOppDetailLoading(false);
        }
      }
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("open");
      setSearchParams(nextParams, { replace: true });
    };

    void openFromUrl();
  }, [loading, opps, searchParams, setSearchParams, showToast, openViewOpp, fetchOpportunityDetail]);

  useEffect(() => {
    if (!pendingDelete) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !deleting) setPendingDelete(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingDelete, deleting]);

  const post = (url, data) => {
    const p = new URLSearchParams();
    Object.entries(data).forEach(([k, v]) => { if (v !== "" && v != null) p.append(k, v); });
    return api.post(url, p, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  };

  const saveOpp = async () => {
    const errors = validateOpportunityForm(form, { isCreate: true });
    setFormErrors(errors);
    if (Object.keys(errors).length) {
      setActiveTab(firstOppFormTabWithErrors(errors));
      showToast("Please fill all required fields. Notes is optional.", "error");
      return;
    }
    setSaving(true);
    try {
      await post("/api/method/sales_app.api.opportunity.create_opportunity", {
        ...form,
        contact_mobile: formatPhoneForApi(form.contact_mobile),
      });
      setShowForm(false);
      setForm(initForm);
      setFormErrors({});
      await loadAll();
      dispatchPipelineRefresh();
      showToast("Opportunity created!");
    } catch (e) {
      let msg = "Could not save opportunity.";
      const data = e?.response?.data;
      try {
        if (data?._error_message) {
          msg = String(data._error_message).trim().slice(0, 240);
        } else if (data?.exc) {
          const raw = typeof data.exc === "string" ? JSON.parse(data.exc) : data.exc;
          const line = Array.isArray(raw) ? raw[0] : raw;
          if (line) msg = String(line).trim().slice(0, 240);
        } else if (data?._server_messages) {
          const sm = data._server_messages;
          const arr = typeof sm === "string" ? JSON.parse(sm) : sm;
          const first = arr?.[0];
          let inner = first;
          if (typeof first === "string") {
            try {
              inner = JSON.parse(first);
            } catch {
              inner = first;
            }
          }
          if (typeof inner === "string") {
            msg = inner.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').trim().slice(0, 240);
          } else if (inner?.message) {
            msg = String(inner.message).slice(0, 240);
          }
        } else if (data?.exception) {
          msg = String(data.exception)
            .replace(/frappe\.exceptions\.\w+:/g, "")
            .trim()
            .slice(0, 240);
        } else if (typeof data?.message === "string" && data.message && data.exc_type) {
          msg = data.message.trim().slice(0, 240);
        }
      } catch {
        /* keep default */
      }
      showToast(msg, "error");
    } finally { setSaving(false); }
  };

  const updateOpp = async () => {
    const errors = validateOpportunityForm(editOpp, { isCreate: false });
    setEditFormErrors(errors);
    if (Object.keys(errors).length) {
      setActiveTab(firstOppFormTabWithErrors(errors));
      showToast("Please fix the highlighted fields.", "error");
      return;
    }
    setSaving(true);
    try {
      await post("/api/method/sales_app.api.opportunity.update_opportunity", {
        ...editOpp,
        contact_mobile: formatPhoneForApi(editOpp.contact_mobile),
      });
      setEditOpp(null);
      setEditFormErrors({});
      await loadAll();
      showToast("Opportunity updated!");
    } finally { setSaving(false); }
  };

  const requestDeleteOpp = (o) => {
    const label = [o.name, o.source].filter(Boolean).join(" · ") || o.name;
    setPendingDelete({ id: o.name, label });
  };

  const confirmDeleteOpp = async () => {
    if (!pendingDelete?.id) return;
    setDeleting(true);
    try {
      await post("/api/method/sales_app.api.opportunity.delete_opportunity", { name: pendingDelete.id });
      setPendingDelete(null);
      await loadAll();
      showToast("Opportunity deleted.", "error");
    } catch {
      showToast("Could not delete opportunity.", "error");
    } finally {
      setDeleting(false);
    }
  };

  const updateStage = async (opportunityId, stage) => {
    if (!opportunityId || !stage) return;
    setStageBusy(opportunityId);
    try {
      await prefetchCsrf().catch(() => {});
      const body = new URLSearchParams({ opportunity_id: opportunityId, stage });
      await api.post("/api/method/sales_app.api.opportunity.update_stage", body, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const list = await loadAll();
      const fresh = list?.find((o) => o.name === opportunityId);
      if (fresh) {
        setViewOpp((prev) => (prev?.name === opportunityId ? fresh : prev));
      }
      showToast(`Updated · ${stageDisplayLabel(stage)}`);
      dispatchPipelineRefresh();
    } catch (e) {
      let msg = "Could not update stage.";
      const data = e?.response?.data;
      try {
        if (data?._server_messages) {
          const arr = JSON.parse(data._server_messages);
          const first = Array.isArray(arr) ? arr[0] : arr;
          if (first) msg = String(first).replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').trim().slice(0, 240);
        } else if (data?._error_message) msg = String(data._error_message).trim().slice(0, 240);
        else if (typeof data?.exc === "string") {
          const raw = JSON.parse(data.exc);
          const line = Array.isArray(raw) ? raw[0] : raw;
          if (line) msg = String(line).trim().slice(0, 240);
        } else if (data?.exception) {
          msg = String(data.exception).replace(/frappe\.exceptions\.\w+:/g, "").trim().slice(0, 240);
        } else if (typeof data?.message === "string" && data.message && data.exc_type) {
          msg = data.message.trim().slice(0, 240);
        }
      } catch {
        /* keep default */
      }
      showToast(msg, "error");
    } finally {
      setStageBusy(null);
    }
  };

  const markCustomerInterested = async (opp) => {
    const id = opp?.name;
    if (!id) return;

    if (!opportunityOnDeliveryPipeline(opp)) {
      showToast(
        "This opportunity is not linked to a lead. Qualify or convert a lead first to use Sales pipeline.",
        "error",
      );
      return;
    }

    if (!opportunityProductReady(opp)) {
      const pendingDev = String(opp.product_dev_status || "").trim() === "Pending";
      showToast(
        pendingDev
          ? "Complete Product Development review and approval on this opportunity first."
          : "Product not in Item master — request Product Development before Sales pipeline.",
        "error",
      );
      return;
    }

    const canonical = pipelineStageForActions(opportunityStageRaw(opp));
    const targetApi = interestedTargetApiStage(canonical);
    const pipelineColumn = pipelineColumnForApiStage(targetApi || canonical);
    const pipelineLabel = pipelineColumnLabel(pipelineColumn);

    setStageBusy(id);
    try {
      await prefetchCsrf().catch(() => {});
      if (targetApi && canonical !== targetApi) {
        const body = new URLSearchParams({ opportunity_id: id, stage: targetApi });
        await api.post("/api/method/sales_app.api.opportunity.update_stage", body, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      }
      setViewOpp(null);
      await loadAll();
      dispatchPipelineRefresh();
      if (managerPipelineAccess) {
        showToast(`Moved to ${pipelineLabel} — continue on Sales pipeline`);
        navigate(`/sales/pipeline?opp=${encodeURIComponent(id)}`);
      } else {
        showToast(`Customer marked interested · stage ${pipelineLabel}. Sales Manager will track on Sales pipeline.`);
      }
    } catch (e) {
      showToast(parseApiErrorMessage(e, "Could not update opportunity for pipeline."), "error");
    } finally {
      setStageBusy(null);
    }
  };

  const markCustomerNotInterested = async (opp) => {
    const id = opp?.name;
    if (!id) return;
    setStageBusy(id);
    try {
      await prefetchCsrf().catch(() => {});
      const body = new URLSearchParams({ opportunity_id: id });
      await api.post("/api/method/sales_app.api.opportunity.mark_not_interested", body, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const list = await loadAll();
      const fresh = list?.find((o) => o.name === id);
      if (fresh) setViewOpp((prev) => (prev?.name === id ? fresh : prev));
      setViewOpp(null);
      showToast("Marked as not interested · Lost");
      dispatchPipelineRefresh();
      if (opportunityOnDeliveryPipeline(opp) && managerPipelineAccess) {
        navigate(`/sales/pipeline?opp=${encodeURIComponent(id)}`);
      }
    } catch (e) {
      showToast(parseApiErrorMessage(e, "Could not mark as not interested."), "error");
    } finally {
      setStageBusy(null);
    }
  };

  const createSalesOrderForOpp = async (opp) => {
    setStageBusy(opp.name);
    try {
      await prefetchCsrf().catch(() => {});
      const linkedQuotation = String(opp.linked_quotation || "").trim();
      if (!linkedQuotation) {
        showToast("Create and approve a quotation before creating a Sales Order.", "error");
        return;
      }

      const qRes = await api.get("/api/method/sales_app.api.quotation.get_quotation", {
        params: { name: linkedQuotation },
      });
      const qDoc = qRes.data?.message;
      if (Number(qDoc?.docstatus) !== 1) {
        showToast(
          "Quotation must be submitted (approved) before creating a Sales Order. Complete delivery planning and submit for approval.",
          "error",
        );
        return;
      }
      if (!qDoc?.can_create_sales_order && String(qDoc?.customer_response_status || "") !== "Accepted") {
        showToast(
          "Customer must accept the quotation before creating a Sales Order. Send the quote and record acceptance first.",
          "error",
        );
        return;
      }

      const quotBody = new URLSearchParams({ name: linkedQuotation, submit: "1" });
      const soRes = await api.post(
        "/api/method/sales_app.api.sales_order.create_sales_order_from_quotation",
        quotBody,
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );
      const soMsg = soRes?.data?.message || {};
      const soName = soMsg.name || "";
      if (!soName) throw new Error("Sales order failed");

      setWonFlowState((prev) => ({
        ...prev,
        [opp.name]: { ...(prev[opp.name] || {}), salesOrder: soName, poReceived: true, workStarted: true },
      }));
      showToast(salesOrderCreatedToast(), "success", 3200);
    } catch (e) {
      let msg = "Could not create Sales Order.";
      const data = e?.response?.data;
      const unwrapFrappeToast = (raw) => {
        let s = String(raw ?? "").replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').trim();
        if (s.startsWith("{") && s.includes('"message"')) {
          try {
            const o = JSON.parse(s);
            if (o && typeof o.message === "string") return o.message.trim().slice(0, 280);
          } catch {
            /* keep s */
          }
        }
        return s.slice(0, 280);
      };
      try {
        if (data?._server_messages) {
          const arr = JSON.parse(data._server_messages);
          const first = Array.isArray(arr) ? arr[0] : arr;
          if (first) msg = unwrapFrappeToast(first);
        } else if (data?._error_message) msg = unwrapFrappeToast(data._error_message);
        else if (typeof data?.message === "string" && data.message && data.exc_type) {
          msg = unwrapFrappeToast(data.message);
        } else if (data?.exception) {
          msg = String(data.exception).replace(/frappe\.exceptions\.\w+:/g, "").trim().slice(0, 280);
        }
      } catch {
        /* keep default */
      }
      showToast(msg, "error");
    } finally {
      setStageBusy(null);
    }
  };

  const generateInvoiceForOpp = async (opp) => {
    const soName = wonFlowState[opp.name]?.salesOrder;
    if (!soName) {
      showToast("Create Sales Order first.", "error");
      return;
    }
    setStageBusy(opp.name);
    try {
      await prefetchCsrf().catch(() => {});
      const invBody = new URLSearchParams({ order_id: soName });
      const invRes = await api.post("/api/method/sales_app.api.invoice.generate_invoice", invBody, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const invoiceName = invRes?.data?.message?.name;
      if (!invoiceName) throw new Error("Invoice failed");
      setWonFlowState((prev) => ({ ...prev, [opp.name]: { ...(prev[opp.name] || {}), invoice: invoiceName, invoiceSent: true } }));
      showToast(`Invoice generated: ${invoiceName}`);
    } catch {
      showToast("Could not generate invoice.", "error");
    } finally {
      setStageBusy(null);
    }
  };

  const recordPaymentForOpp = async (opp, type) => {
    const invoiceName = wonFlowState[opp.name]?.invoice;
    if (!invoiceName) {
      showToast("Generate invoice first.", "error");
      return;
    }
    setStageBusy(opp.name);
    try {
      await prefetchCsrf().catch(() => {});
      const payBody = new URLSearchParams({
        invoice_id: invoiceName,
        type,
        amount: String(type === "Full Payment" ? (opp.expected_revenue || 1) : Math.max(Number(opp.expected_revenue || 0) / 2, 1)),
      });
      const res = await api.post("/api/method/sales_app.api.payment.record_payment", payBody, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const msg = res?.data?.message || {};
      const leadNames = msg.lead_names || msg.lead_conversion?.lead_names || [];
      setWonFlowState((prev) => ({ ...prev, [opp.name]: { ...(prev[opp.name] || {}), paymentType: type } }));
      let toastText = `Payment recorded: ${type}`;
      if (leadNames.length) {
        toastText += `. Lead ${leadNames.join(", ")} marked as Converted.`;
      }
      showToast(toastText);
    } catch {
      showToast("Payment recording failed.", "error");
    } finally {
      setStageBusy(null);
    }
  };

  const refreshViewOpp = async (oppName) => {
    const fresh = await fetchOpportunityDetail(oppName);
    if (fresh) {
      setViewOpp((prev) => (prev?.name === oppName ? fresh : prev));
      setOpps((prev) => prev.map((o) => (o.name === oppName ? { ...o, ...fresh } : o)));
    }
    return fresh;
  };

  const syncOpportunityFromLead = async (opp) => {
    const id = opp?.name;
    const leadId = opp?.party_name_id || opp?.party_name;
    if (!id || !leadId) {
      showToast("This opportunity is not linked to a lead.", "error");
      return;
    }
    setStageBusy(id);
    try {
      await prefetchCsrf().catch(() => {});
      const body = new URLSearchParams({ opportunity_id: id, lead_id: leadId });
      await api.post(
        "/api/method/sales_app.api.opportunity.sync_opportunity_from_lead",
        body,
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );
      await refreshViewOpp(id);
      showToast("Product synced from lead");
    } catch (e) {
      showToast(parseApiErrorMessage(e, "Could not sync product from lead."), "error");
    } finally {
      setStageBusy(null);
    }
  };

  const createQuotationFromOpp = async (opp) => {
    const id = opp?.name;
    if (!id) return;
    setStageBusy(id);
    try {
      await prefetchCsrf().catch(() => {});
      const body = new URLSearchParams({ opportunity_id: id });
      const res = await api.post(
        "/api/method/sales_app.api.opportunity.create_quotation_from_opportunity",
        body,
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );
      const msg = res?.data?.message;
      const quotName = msg?.quotation || msg?.name;
      if (!quotName) throw new Error(msg?.message || "Quotation failed");
      await refreshViewOpp(id);
      showToast(`Quotation ${quotName} created`);
      dispatchPipelineRefresh();
      navigate("/sales/quotations");
    } catch (e) {
      showToast(parseApiErrorMessage(e, "Could not create quotation."), "error");
    } finally {
      setStageBusy(null);
    }
  };

  const requestProductDevForOpp = async (opp) => {
    const id = opp?.name;
    if (!id) return;
    setStageBusy(id);
    try {
      await prefetchCsrf().catch(() => {});
      const body = new URLSearchParams({
        opportunity_id: id,
        product_request: opp.effective_product_code || opp.product_code || opp.product_request || "",
      });
      await api.post(
        "/api/method/sales_app.api.opportunity.request_product_development",
        body,
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );
      await refreshViewOpp(id);
      notifyManufacturingDashboardRefresh();
      showToast("Product development request submitted");
    } catch (e) {
      showToast(parseApiErrorMessage(e, "Could not request product development."), "error");
    } finally {
      setStageBusy(null);
    }
  };

  const filtered = useMemo(() => {
    const rows = opps.filter((o) => {
      if (!oppMatchesKpiFilter(o, kpiFilter)) return false;
      const q = search.trim().toLowerCase();
      const haystack = [
        o.name,
        o.opportunity_name,
        o.party_name,
        o.party_label,
        o.sales_stage,
        stageDisplayLabel(o.sales_stage),
        o.status,
        o.source,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchSearch = !q || haystack.includes(q);
      const matchStage =
        !filterStage
        || o.sales_stage === filterStage
        || (filterStage === "Discussion" && pipelineStageForActions(o.sales_stage) === "Discussion")
        || (DISCUSSION_STAGE_ALIASES.has(filterStage) && pipelineStageForActions(o.sales_stage) === "Discussion");
      return matchSearch && matchStage;
    });
    if (kpiFilter === "weighted") {
      return [...rows].sort((a, b) => {
        const revA = Number(a.expected_revenue ?? a.opportunity_amount) || 0;
        const revB = Number(b.expected_revenue ?? b.opportunity_amount) || 0;
        const wa = revA * (Number(a.probability) || 0) / 100;
        const wb = revB * (Number(b.probability) || 0) / 100;
        return wb - wa;
      });
    }
    return rows;
  }, [opps, search, filterStage, kpiFilter]);

  const { page: listPage, setPage: setListPage, totalPages: listTotalPages, pageRows: pagedOpps, total, resetPage } =
    usePagedRows(filtered, pageSize);

  const onSearchChange = (v) => {
    setSearch(v);
    resetPage();
  };

  useEffect(() => {
    resetPage();
  }, [filterStage, kpiFilter, pageSize]);

  if (loading && !opps.length) return <SalesPageLoader label="Loading opportunities…" />;

  return (
    <>
      <SalesToast toast={toast} />

      <div className="pm-page op-page">

        <section className="op-kpi-section" aria-label="Opportunity KPIs">
          <div className="op-kpi-section-row">
            <p className="op-kpi-section-label">
              Opportunity KPIs
              {metaLoading ? <span className="op-kpi-section-hint"> · updating…</span> : null}
            </p>
            <div className="op-kpi-section-actions">
              <button type="button" className="pm-btn pm-btn-primary op-btn-primary" onClick={openNewOpportunityModal}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden><path d="M12 5v14M5 12h14"/></svg>
                New Opportunity
              </button>
            </div>
          </div>
          <div className="op-kpi-grid">
          <SalesKpiCard
            label="Total Pipeline"
            value={fmtK(dash?.total_revenue || 0)}
            sub={`${dash?.total || 0} opportunities`}
            color={C.blue}
            icon="briefcase"
            iconSize={18}
            active={kpiFilter === "total_pipeline"}
            onClick={() => { setKpiFilter((p) => (p === "total_pipeline" ? null : "total_pipeline")); resetPage(); }}
          />
          <SalesKpiCard
            label="Weighted Value"
            value={fmtK(dash?.weighted_rev || 0)}
            sub="Probability adjusted"
            color={C.indigo}
            icon="scale"
            iconSize={18}
            active={kpiFilter === "weighted"}
            onClick={() => { setKpiFilter((p) => (p === "weighted" ? null : "weighted")); resetPage(); }}
          />
          <SalesKpiCard
            label="Open"
            value={dash?.open_count ?? 0}
            sub="Active deals"
            color={C.cyan}
            icon="refresh"
            iconSize={18}
            active={kpiFilter === "open"}
            onClick={() => { setKpiFilter((p) => (p === "open" ? null : "open")); resetPage(); }}
          />
          <SalesKpiCard
            label="Won"
            value={dash?.won_count ?? 0}
            sub={`${dash?.win_rate ?? 0}% win rate`}
            color={C.green}
            icon="trophy"
            iconSize={18}
            active={kpiFilter === "won"}
            onClick={() => { setKpiFilter((p) => (p === "won" ? null : "won")); resetPage(); }}
          />
          <SalesKpiCard
            label="Lost"
            value={dash?.lost_count ?? 0}
            sub={
              Number(dash?.lost_lead_count || 0) > 0
                ? `${dash?.lost_opportunity_count ?? 0} deals · ${dash?.lost_lead_count ?? 0} leads`
                : "Closed lost"
            }
            color={C.red}
            icon="x"
            iconSize={18}
            active={kpiFilter === "lost"}
            onClick={() => { setKpiFilter((p) => (p === "lost" ? null : "lost")); resetPage(); }}
          />
          </div>
        </section>

        <div className="op-filter-bar" aria-label="Opportunity filters">
          <div className="pm-list-filters op-list-filters">
            <div className="pm-list-filters__field">
              <label className="pm-list-filters__label" htmlFor="op-stage-filter">Stage</label>
              <select
                id="op-stage-filter"
                value={filterStage}
                onChange={(e) => { setFilterStage(e.target.value); setKpiFilter(null); resetPage(); }}
                className="pm-select pm-list-filters__select"
                aria-label="Filter by stage"
              >
                <option value="">All Stages</option>
                <option value="Won">Won</option>
                <option value="Lost">Lost</option>
                <option value="Negotiation">Negotiation</option>
                <option value="Proposal">Proposal</option>
                <option value="Discussion">Discussion</option>
              </select>
            </div>
            <div className="pm-list-filters__field pm-list-filters__field--grow">
              <label className="pm-list-filters__label" htmlFor="op-search-filter">Search</label>
              <input
                id="op-search-filter"
                className="pm-input"
                type="search"
                placeholder="Search opportunities…"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
              />
            </div>
          </div>
          {(search || filterStage || kpiFilter) && (
            <button
              type="button"
              className="op-clear-filters"
              onClick={() => { setSearch(""); setFilterStage(""); setKpiFilter(null); resetPage(); }}
            >
              Clear filters
            </button>
          )}
        </div>

        <Card title={`All Opportunities${filtered.length !== opps.length ? ` — ${filtered.length} shown` : ""}`}>
          {filtered.length === 0 ? (
            <SalesEmptyState
              icon={HiOutlineBriefcase}
              title={search || filterStage || kpiFilter ? "No matching opportunities" : "No opportunities yet"}
              description={search || filterStage || kpiFilter
                ? "Try changing search, stage, or KPI filter, or use Clear filters."
                : 'Click "New Opportunity" to add your first deal.'}
            />
          ) : (
            <>
            <div className="op-table-wrap">
              <table className="pm-table op-table">
                <thead>
                  <tr>
                    <th className="op-col-num">#</th>
                    <th className="op-col-cust">Customer</th>
                    <th className="op-col-opp">Opportunity</th>
                    <th className="op-col-src">Source</th>
                    <th className="op-col-stage">Stage</th>
                    <th className="op-col-rev">Revenue</th>
                    <th className="op-col-status">Status</th>
                    <th className="op-col-act">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedOpps.map((o, i) => {
                    const [fg, bg] = STATUS_PILL[o.status] || [C.sub, C.surface2];
                    const stageStyle = stagePillStyle(o.sales_stage);
                    const stageShown = stageDisplayLabel(o.sales_stage);
                    const rowIdx = (listPage - 1) * pageSize + i;
                    const customer = o.party_label || o.party_name || "—";
                    return (
                      <tr
                        key={o.name}
                        className="op-row op-row--click"
                        style={{ "--i": rowIdx }}
                        onClick={() => void openViewOpp(o)}
                        title="Click to view details"
                      >
                        <td className="op-col-num op-cell-muted">{rowIdx + 1}</td>
                        <td className="op-col-cust op-cell-clip">
                          <span className="op-cell-cust" title={customer}>{customer}</span>
                        </td>
                        <td className="op-col-opp" title={o.name}>
                          <SalesDocumentId id={o.name} className="op-table-id" />
                        </td>
                        <td className="op-col-src op-cell-clip" title={o.source_display || o.source || ""}>
                          <span className="op-opp-src">{o.source_display || o.source || "—"}</span>
                        </td>
                        <td className="op-col-stage op-cell-clip">
                          {o.sales_stage ? (
                            <span
                              className={`op-stage-pill${stageShown === "Discussion" ? " op-stage-pill--discussion" : ""}`}
                              style={{ "--pill-fg": stageStyle.color, "--pill-bg": stageStyle.bg }}
                              title={o.sales_stage}
                            >
                              {stageShown}
                            </span>
                          ) : (
                            <span className="op-cell-muted">—</span>
                          )}
                        </td>
                        <td className="op-col-rev op-cell-rev op-cell-clip" title={fmt(o.expected_revenue ?? o.opportunity_amount)}>
                          {fmt(o.expected_revenue ?? o.opportunity_amount)}
                        </td>
                        <td className="op-col-status op-cell-clip">
                          <span className="op-status-pill" style={{ "--pill-fg": fg, "--pill-bg": bg }}>{o.status || "—"}</span>
                        </td>
                        <td className="op-col-act" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                          <div className="op-actions-cell">
                            <button
                              type="button"
                              className="op-act op-act-view"
                              title="View"
                              onClick={() => void openViewOpp(o)}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            </button>
                            <button
                              type="button"
                              className="op-act op-act-edit"
                              title="Edit"
                              onClick={() => setEditOpp(oppForEdit(o))}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button
                              type="button"
                              className="op-act op-act-del"
                              title="Delete"
                              onClick={() => requestDeleteOpp(o)}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                            </button>
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
                  page={listPage}
                  totalPages={listTotalPages}
                  total={total}
                  pageSize={pageSize}
                  onPageChange={setListPage}
                />
              </div>
            )}
            </>
          )}
        </Card>
      </div>

      {/* ── CREATE MODAL ── */}
      {showForm && (
        <SalesDetailModal title="New Opportunity" wide onClose={() => { setShowForm(false); setForm(initForm); setFormErrors({}); }}>
          <OppForm form={form} onChange={handleCreateFieldChange} errors={formErrors}
            options={options} activeTab={activeTab} setActiveTab={setActiveTab} isNew />
          <ModalFooter>
            <button type="button" className="pm-btn pm-btn-ghost op-btn-ghost" onClick={() => { setShowForm(false); setForm(initForm); setFormErrors({}); }}>Cancel</button>
            <button type="button" className="pm-btn pm-btn-primary op-btn-primary" onClick={saveOpp} disabled={saving}>
              {saving ? "Saving…" : "Save Opportunity"}
            </button>
          </ModalFooter>
        </SalesDetailModal>
      )}

      {/* ── EDIT MODAL ── */}
      {editOpp && (
        <SalesDetailModal title="Edit Opportunity" wide onClose={() => { setEditOpp(null); setEditFormErrors({}); }}>
          <OppForm form={editOpp} onChange={(e) => setEditOpp({ ...editOpp, [e.target.name]: e.target.value })}
            options={options} activeTab={activeTab} setActiveTab={setActiveTab} errors={editFormErrors} />
          <ModalFooter>
            <button type="button" className="pm-btn pm-btn-ghost op-btn-ghost" onClick={() => { setEditOpp(null); setEditFormErrors({}); }}>Cancel</button>
            <button type="button" className="pm-btn pm-btn-primary op-btn-primary" onClick={updateOpp} disabled={saving}>
              {saving ? "Updating…" : "Update"}
            </button>
          </ModalFooter>
        </SalesDetailModal>
      )}

      {/* ── VIEW MODAL ── */}
      {viewOpp && (() => {
        const viewBusy = stageBusy === viewOpp.name;
        const handleOpenQuotations = () => {
          if (!itemMasterVerified(viewOpp, { loading: viewOppDetailLoading })) {
            showToast(
              "Product is not in Item Master. Complete Product Development before using this quotation.",
              "warn",
            );
          }
          closeViewOpp();
          navigate("/sales/quotations");
        };
        return (
          <SalesDetailModal title="Opportunity Details" onClose={closeViewOpp} wide opportunity>
            {viewOppDetailLoading ? (
              <div className="op-view-loading" role="status" aria-live="polite">
                <SalesPageLoader />
                <p className="op-view-loading__text">Verifying product in Item Master…</p>
              </div>
            ) : (
              <>
                <OppView opp={viewOpp} />
                <OppWorkflowPanel
                  opp={viewOpp}
                  busy={viewBusy}
                  wonFlow={wonFlowState[viewOpp.name]}
                  onCreateQuotation={createQuotationFromOpp}
                  onRequestDev={requestProductDevForOpp}
                  onSyncFromLead={syncOpportunityFromLead}
                  onCreateSalesOrder={createSalesOrderForOpp}
                  onGenerateInvoice={generateInvoiceForOpp}
                  onRecordPayment={recordPaymentForOpp}
                  onViewQuotation={handleOpenQuotations}
                />
                <ModalFooter>
                  <button type="button" className="pm-btn pm-btn-ghost op-btn-ghost" onClick={closeViewOpp}>Close</button>
                  <button
                    type="button"
                    className="pm-btn pm-btn-primary op-btn-primary"
                    onClick={() => {
                      setEditOpp(oppForEdit(viewOpp));
                      setEditFormErrors({});
                      closeViewOpp();
                    }}
                  >
                    Edit
                  </button>
                </ModalFooter>
              </>
            )}
          </SalesDetailModal>
        );
      })()}

      <ConfirmDeleteModal
        target={pendingDelete}
        title="Delete Opportunity"
        confirmLabel="Delete"
        loading={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDeleteOpp}
      />
    </>
  );
}

/* ─── Opportunity Form ───────────────────────────────────────── */
function linkedLeadId(form, isNew) {
  if (isNew) return form.lead || "";
  return form.party_name_id || form.party_name || form.lead || "";
}

function OppForm({ form, onChange, options, activeTab, setActiveTab, isNew, errors = {} }) {
  const tabs = [{ id: "basic", label: "Deal Info" }, { id: "contact", label: "Contact" }];
  const leadId = linkedLeadId(form, isNew);
  const inpClass = (key) => `op-input${errors[key] ? " op-input--invalid" : ""}`;
  const reqOnCreate = Boolean(isNew);

  const setField = (name, value) => {
    onChange({ target: { name, value } });
  };

  const onEmailChange = (value) => {
    const trimmed = value.trimStart();
    if (trimmed && /^\d+$/.test(trimmed)) return;
    setField("contact_email", value);
  };

  const onPhoneChange = (value) => {
    setField("contact_mobile", value.replace(/\D/g, "").slice(0, 10));
  };

  return (
    <div>
      <div className="op-tabs">
        {tabs.map(t => (
          <button key={t.id} className={`op-tab ${activeTab === t.id ? "op-tab-active" : ""}`}
            type="button" onClick={() => setActiveTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="op-form-stack">
        {activeTab === "basic" && <>
          <div className="op-form-grid">
            <F label="Opportunity ID" half>
              <input
                className="op-input op-input--readonly"
                value={isNew ? "" : (form.name || "")}
                readOnly
                disabled
                placeholder="Auto-generated on save"
                title="Assigned automatically when the opportunity is saved"
              />
            </F>
            <F label="Lead ID" half>
              <input
                className="op-input op-input--readonly"
                value={leadId}
                readOnly
                disabled
                placeholder={isNew ? "Select a lead below" : "—"}
                title="Links this opportunity to the selected lead"
              />
            </F>
          </div>
          {isNew ? (
            <div className="op-form-grid">
              <F label="Link to Lead" half req error={errors.lead}>
                <select name="lead" value={form.lead || ""} onChange={onChange} className={inpClass("lead")}>
                  <option value="">Select a lead</option>
                  {(options.leads || []).map((l) => (
                    <option key={l.name} value={l.name}>
                      {l.label} — {l.name}
                    </option>
                  ))}
                </select>
              </F>
              <F label="Opportunity Owner" half req error={errors.opportunity_owner}>
                <select name="opportunity_owner" value={form.opportunity_owner || ""} onChange={onChange} className={inpClass("opportunity_owner")}>
                  <option value="">Select owner</option>
                  {(options.users || []).map((u) => (
                    <option key={u.name} value={u.name}>
                      {u.label} ({u.name})
                    </option>
                  ))}
                </select>
              </F>
            </div>
          ) : (
            <F label="Opportunity Owner" error={errors.opportunity_owner}>
              <select name="opportunity_owner" value={form.opportunity_owner || ""} onChange={onChange} className={inpClass("opportunity_owner")}>
                <option value="">Select owner</option>
                {(options.users || []).map((u) => (
                  <option key={u.name} value={u.name}>
                    {u.label} ({u.name})
                  </option>
                ))}
              </select>
            </F>
          )}
          <F label="Opportunity Title" req={reqOnCreate} error={errors.opportunity_name}>
            <input name="opportunity_name" type="text" value={form.opportunity_name || ""} onChange={onChange} placeholder="e.g. Enterprise SaaS Deal" className={inpClass("opportunity_name")} />
          </F>
          <div className="op-form-grid">
            <F label="Expected Revenue (₹)" req={reqOnCreate} error={errors.expected_revenue}>
              <input name="expected_revenue" type="number" min="0" value={form.expected_revenue || ""} onChange={onChange} placeholder="0" className={inpClass("expected_revenue")} />
            </F>
            <F label="Probability (%)" req={reqOnCreate} error={errors.probability}>
              <input name="probability" type="number" min="0" max="100" value={form.probability || ""} onChange={onChange} placeholder="50" className={inpClass("probability")} />
            </F>
          </div>
          <div className="op-form-grid">
            <F label="Sales Stage" req={reqOnCreate} error={errors.stage}>
              <select name="stage" value={form.stage || ""} onChange={onChange} className={inpClass("stage")}>
                <option value="">Select stage</option>
                {options.stage.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </F>
            <F label="Expected Close Date" req={reqOnCreate} error={errors.close_date}>
              <input name="close_date" type="date" value={form.close_date || ""} onChange={onChange} className={inpClass("close_date")} />
            </F>
          </div>
          <div className="op-form-grid">
            <F label="Lead Source" req={reqOnCreate} error={errors.source}>
              <select name="source" value={form.source || ""} onChange={onChange} className={inpClass("source")}>
                <option value="">Select source</option>
                {options.source.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </F>
            {!isNew && (
              <F label="Status">
                <select name="status" value={form.status || ""} onChange={onChange} className="op-input">
                  <option value="">Select status</option>
                  {options.status.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </F>
            )}
          </div>
          <div className="op-form-grid">
            <F label="Product" req={reqOnCreate} half error={errors.product_code}>
              <select
                name="product_code"
                value={form.product_code || ""}
                onChange={onChange}
                className={inpClass("product_code")}
              >
                <option value="">— Select product —</option>
                {(options.products || []).map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name} ({item.code})
                  </option>
                ))}
              </select>
            </F>
            <F label="Quantity" req={reqOnCreate} half error={errors.quantity}>
              <input
                name="quantity"
                type="number"
                min="0"
                step="any"
                value={form.quantity ?? ""}
                onChange={onChange}
                placeholder="e.g. 100"
                className={inpClass("quantity")}
              />
            </F>
          </div>
          <F label="Notes">
            <textarea name="notes" value={form.notes || ""} onChange={onChange} placeholder="Add notes…" className="op-input op-textarea" rows={3} />
          </F>
        </>}
        {activeTab === "contact" && <>
          <F label="Contact Email" req={reqOnCreate} error={errors.contact_email}>
            <input
              type="email"
              value={form.contact_email || ""}
              onChange={(e) => onEmailChange(e.target.value)}
              placeholder="email@example.com"
              autoComplete="email"
              inputMode="email"
              className={inpClass("contact_email")}
            />
          </F>
          <F label="Contact Mobile" req={reqOnCreate} error={errors.contact_mobile}>
            <div className={`op-phone-field${errors.contact_mobile ? " op-phone-field--invalid" : ""}`}>
              <span className="op-phone-prefix" aria-hidden>{MOBILE_PREFIX}</span>
              <input
                className={`op-input op-input--phone${errors.contact_mobile ? " op-input--invalid" : ""}`}
                type="tel"
                value={extractPhoneDigits(form.contact_mobile)}
                onChange={(e) => onPhoneChange(e.target.value)}
                placeholder="9876543210"
                inputMode="numeric"
                maxLength={10}
                autoComplete="tel-national"
                aria-label="Mobile number without country code"
              />
            </div>
          </F>
        </>}
      </div>
    </div>
  );
}

/* ─── Opportunity View ───────────────────────────────────────── */
function opportunityIsWon(opp) {
  const status = (opp?.status || "").trim();
  const stage = pipelineStageForActions(opportunityStageRaw(opp));
  return status === "Won" || stage === "Closed Won";
}

function OppWorkflowPanel({
  opp,
  busy,
  wonFlow,
  onCreateQuotation,
  onRequestDev,
  onSyncFromLead,
  onCreateSalesOrder,
  onGenerateInvoice,
  onRecordPayment,
  onViewQuotation,
}) {
  if (!opp) return null;
  const exists = itemMasterVerified(opp);
  const devStatus = opp.product_dev_status || "";
  const devStatusLabel = productDevStatusLabel(opp);
  const linkedQuotation = opp.linked_quotation || "";
  const quotationSubmitted = Boolean(opp.linked_quotation_submitted || opp.can_create_sales_order);
  const isWon = opportunityIsWon(opp);
  const isLost = (opp.status || "") === "Lost" || pipelineStageForActions(opportunityStageRaw(opp)) === "Closed Lost";
  const effectiveProduct = String(
    opp.effective_product_code || opp.product_code || opp.product_request || "",
  ).trim();
  const missingProduct = !effectiveProduct;

  return (
    <div className="op-workflow" role="region" aria-label="Opportunity sales workflow">
      <p className="op-workflow-label">Sales workflow</p>
      <div className="op-workflow-badges">
        {devStatusLabel ? (
          <span className="op-workflow-badge">Product dev: {devStatusLabel}</span>
        ) : null}
        {devStatus === "Approved" && opp.pd_approved_item_code ? (
          <span className="op-workflow-badge op-workflow-badge--ok">
            Item Master: {opp.pd_approved_item_code}
          </span>
        ) : null}
        {linkedQuotation ? (
          <span
            className={`op-workflow-badge ${
              quotationSubmitted && exists
                ? "op-workflow-badge--ok"
                : quotationSubmitted
                  ? "op-workflow-badge--warn"
                  : ""
            }`}
          >
            Quotation: {linkedQuotation}
            {quotationSubmitted
              ? (exists ? "" : " · item missing")
              : " · pending"}
          </span>
        ) : null}
        {wonFlow?.salesOrder ? (
          <span className="op-workflow-badge op-workflow-badge--ok">SO: {wonFlow.salesOrder}</span>
        ) : null}
      </div>
      {effectiveProduct && !exists ? (
        <div className="op-workflow-inline" role="status">
          <span className="op-workflow-inline-msg">Item is not in master.</span>
          {opp.can_request_product_dev ? (
            <button
              type="button"
              className="pm-btn pm-btn-sm pm-btn-primary"
              disabled={busy}
              onClick={() => onRequestDev(opp)}
            >
              {busy ? "Working…" : "Request Product Development"}
            </button>
          ) : null}
        </div>
      ) : null}
      {devStatus === "Approved" && opp.can_create_quotation && !linkedQuotation ? (
        <div className="op-alert-banner op-alert-banner--success" role="status">
          <div>
            <strong>Product development approved</strong>
            <span> — Now you can create a quotation for this opportunity.</span>
          </div>
          <button
            type="button"
            className="pm-btn pm-btn-sm pm-btn-primary"
            disabled={busy}
            onClick={() => onCreateQuotation(opp)}
          >
            {busy ? "Working…" : "Create Quotation"}
          </button>
        </div>
      ) : null}
      {!isLost && (
        <div className="op-workflow-btns">
          {missingProduct && (opp.party_name_id || opp.party_name) ? (
            <>
              <p className="op-workflow-hint">
                Product was not copied from the lead. Sync it to enable Product Development.
              </p>
              <button
                type="button"
                className="pm-btn pm-btn-primary op-btn-primary"
                disabled={busy}
                onClick={() => onSyncFromLead?.(opp)}
              >
                {busy ? "Syncing…" : "Sync product from Lead"}
              </button>
            </>
          ) : null}
          {opp.can_create_quotation && !linkedQuotation && devStatus !== "Approved" ? (
            <button type="button" className="pm-btn pm-btn-primary op-btn-primary" disabled={busy} onClick={() => onCreateQuotation(opp)}>
              {busy ? "Working…" : "Create Quotation"}
            </button>
          ) : null}
          {isWon && !wonFlow?.salesOrder && quotationSubmitted ? (
            <button type="button" className="pm-btn pm-btn-primary op-btn-primary" disabled={busy} onClick={() => onCreateSalesOrder(opp)}>
              Create Sales Order
            </button>
          ) : null}
          {isWon && !wonFlow?.salesOrder && !quotationSubmitted ? (
            <p className="op-workflow-hint">
              {linkedQuotation
                ? "Submit the linked quotation for approval before creating a Sales Order."
                : "Create and approve a quotation before creating a Sales Order."}
            </p>
          ) : null}
          {isWon && wonFlow?.salesOrder && !wonFlow?.invoice ? (
            <button type="button" className="pm-btn pm-btn-ghost op-btn-ghost" disabled={busy} onClick={() => onGenerateInvoice(opp)}>
              Generate Invoice
            </button>
          ) : null}
          {isWon && wonFlow?.invoice ? (
            <>
              <button type="button" className="pm-btn pm-btn-ghost op-btn-ghost" disabled={busy} onClick={() => onRecordPayment(opp, "Partial Payment")}>
                Record Partial Payment
              </button>
              <button type="button" className="pm-btn pm-btn-primary op-btn-primary" disabled={busy} onClick={() => onRecordPayment(opp, "Full Payment")}>
                Record Full Payment
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function oppDisplayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  return value;
}

function OppViewFieldGrid({ fields }) {
  return (
    <div className="op-view-grid">
      {fields.map(({ label, value, docId, full }) => (
        <div key={label} className={`op-view-field${full ? " op-view-field--full" : ""}`}>
          <div className="op-view-field-label">{label}</div>
          <div className="op-view-field-val">
            {docId && value && value !== "—" ? (
              <SalesDocumentId id={value} className="op-view-doc-id" />
            ) : (
              value
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function OppView({ opp }) {
  const salesStage = opp.sales_stage || opp.stage || "";
  const stageStyle = stagePillStyle(salesStage);
  const [fg, bg] = STATUS_PILL[opp.status] || [C.sub, C.surface2];
  const closeDate = String(opp.expected_closing || opp.close_date || "").trim();
  const proposedDelivery = opp.pd_option_delivery_date
    ? String(opp.pd_option_delivery_date).slice(0, 10)
    : "";

  const leadRelationId =
    (opp.opportunity_from || "Lead") === "Lead"
      ? (opp.party_name_id || opp.party_name)
      : "";

  const linkedQuotationDisplay = opp.linked_quotation_display || opp.linked_quotation;
  const dealFields = [
    { label: "Lead ID", value: oppDisplayValue(leadRelationId), docId: Boolean(leadRelationId) },
    { label: "Lead Name", value: oppDisplayValue(opp.party_label) },
    { label: "Opportunity Owner", value: oppDisplayValue(opp.opportunity_owner_label || opp.opportunity_owner) },
    { label: "Source", value: oppDisplayValue(opp.source_display || opp.source) },
    {
      label: "Linked Quotation",
      value: linkedQuotationDisplay ? linkedQuotationDisplay : "Not created yet",
      docId: Boolean(opp.linked_quotation),
      full: !linkedQuotationDisplay,
    },
  ];

  const productFields = [
    { label: "Product", value: oppDisplayValue(opp.product_label || opp.effective_product_code || opp.product_code || opp.product_request) },
    {
      label: "Quantity",
      value: opp.quantity != null && opp.quantity !== "" ? opp.quantity : "—",
    },
    ...(proposedDelivery
      ? [{ label: "Proposed Delivery", value: proposedDelivery }]
      : []),
    ...opportunityItemMasterFields(opp),
  ];
  const inItemMaster = Boolean(opp.product_verification?.item_exists);

  const contactFields = [
    { label: "Contact Email", value: oppDisplayValue(opp.contact_email) },
    { label: "Contact Mobile", value: oppDisplayValue(opp.contact_mobile) },
  ];

  return (
    <div className="op-view">
      <div className="op-view-hero">
        <div className="op-view-hero-main">
          <div className="op-view-hero-text">
            <p className="op-view-hero-eyebrow">Opportunity</p>
            <div className="op-view-title">{opp.opportunity_name || opp.name}</div>
          </div>
          <SalesDocumentId id={opp.name} className="op-view-hero-id" />
        </div>
        <div className="op-view-badges">
          {salesStage ? (
            <span
              className="op-view-badge"
              style={{ "--pill-fg": stageStyle.color, "--pill-bg": stageStyle.bg, "--pill-bd": `${stageStyle.color}44` }}
              title={salesStage}
            >
              {stageDisplayLabel(salesStage)}
            </span>
          ) : null}
          {opp.status ? (
            <span className="op-view-badge" style={{ "--pill-fg": fg, "--pill-bg": bg, "--pill-bd": `${fg}44` }}>
              {opp.status}
            </span>
          ) : null}
        </div>
        <div className={`op-view-hero-stats${closeDate ? "" : " op-view-hero-stats--two"}`}>
          <div className="op-view-stat">
            <span className="op-view-stat-label">Revenue</span>
            <span className="op-view-stat-val">
              {opp.expected_revenue != null && opp.expected_revenue !== "" ? fmt(opp.expected_revenue) : "—"}
            </span>
          </div>
          <div className="op-view-stat">
            <span className="op-view-stat-label">Probability</span>
            <span className="op-view-stat-val">{opp.probability ?? 0}%</span>
          </div>
          {closeDate ? (
            <div className="op-view-stat">
              <span className="op-view-stat-label">Close date</span>
              <span className="op-view-stat-val">{closeDate}</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="op-view-section">
        <p className="op-view-section-label">Deal details</p>
        <OppViewFieldGrid fields={dealFields} />
      </div>

      <div className="op-view-section">
        <div className="op-view-section-head">
          <p className="op-view-section-label">Product</p>
          {inItemMaster ? (
            <span className="op-view-master-pill">In Item Master</span>
          ) : null}
        </div>
        <OppViewFieldGrid fields={productFields} />
      </div>

      <div className="op-view-section">
        <p className="op-view-section-label">Contact</p>
        <OppViewFieldGrid fields={contactFields} />
      </div>

      {String(opp.notes || "").trim() ? (
        <div className="op-view-notes">
          <div className="op-view-notes-label">Notes</div>
          <p className="op-view-notes-text">{opp.notes}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ─── Small helpers ──────────────────────────────────────────── */
const F = ({ label, half, req, error, children }) => (
  <div className={`op-field${half ? " op-field--half" : ""}`}>
    <label className="op-field-lbl">
      {label}
      {req ? <span className="op-field-req"> *</span> : null}
    </label>
    {children}
    {error ? <span className="op-field-error" role="alert">{error}</span> : null}
  </div>
);

const ModalFooter = SalesModalFooter;

/* ─── Inline styles for spinner ─────────────────────────────── */
const S = {
  spinner: { width: 36, height: 36, border: `3px solid ${C.border}`, borderTop: `3px solid ${C.indigo}`, borderRadius: "50%", animation: "spin .8s linear infinite" },
};

/* ─── CSS ─────────────────────────────────────────────────────── */
