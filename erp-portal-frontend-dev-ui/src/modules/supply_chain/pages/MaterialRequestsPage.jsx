import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle, ClipboardList, GitBranch, XCircle } from "lucide-react";
import toast from "react-hot-toast";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import useDebouncedValue from "../hooks/useDebouncedValue.js";
import useScmList from "../hooks/useScmList.js";
import useScmDocDeepLink from "../hooks/useScmDocDeepLink.js";
import {
  cancelMaterialRequest,
  createMaterialRequest,
  getMaterialRequest,
  listMaterialRequests,
  submitMaterialRequest,
} from "../api/materialRequests.js";
import { listProducts } from "../api/products.js";
import { listWarehouses } from "../api/warehouses.js";
import {
  getSalesQuotationMaterialPlanning,
  listSalesQuotationMaterialPlanning,
} from "../api/integration.js";
import {
  getProcurementTimelineForQuotation,
  setQuotationMaterialArrival,
} from "../api/procurementTimeline.js";
import { getQuotationMaterialCheck } from "../api/materialCheck.js";
import ScmPageHeader from "../components/ScmPageHeader.jsx";
import ScmListFilters from "../components/ScmListFilters.jsx";
import ScmDataTable from "../components/ScmDataTable.jsx";
import ScmKpiCard from "../components/ScmKpiCard.jsx";
import ScmPageKpiGrid from "../components/ScmPageKpiGrid.jsx";
import ScmPanel from "../components/ScmPanel.jsx";
import ScmQuickLinks from "../components/ScmQuickLinks.jsx";
import ScmStatusBadge from "../components/ScmStatusBadge.jsx";
import ScmModal from "../components/ScmModal.jsx";
import ScmCreatePoModal from "../components/ScmCreatePoModal.jsx";
import { ScmDetailField } from "../components/ScmDetailPanel.jsx";
import { parseSourceLink } from "../utils/docLinks.js";
import { mrSourceLabel } from "../utils/fieldHelpers.js";
import { countWhere } from "../utils/scmPageHelpers.js";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "Pending", label: "Pending" },
  { value: "Partially Ordered", label: "Partially Ordered" },
  { value: "Ordered", label: "Ordered" },
  { value: "Received", label: "Received" },
];

const OPEN_STATUSES = new Set(["Pending", "Partially Ordered"]);
const CLOSED_STATUSES = new Set(["Cancelled", "Stopped"]);

const PROCUREMENT_SOURCE_LABELS = {
  stock_available: "In stock",
  stores_arrival: "Stores arrival date",
  po_schedule: "PO schedule",
  mr_schedule: "MR schedule",
  default_lead_time: "Default / supplier lead time",
};

function procurementSourceLabel(source, sourceLabel) {
  if (sourceLabel) return sourceLabel;
  return PROCUREMENT_SOURCE_LABELS[source] || (source || "").replace(/_/g, " ");
}

function toDateInputValue(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function formatDisplayDate(value) {
  const input = toDateInputValue(value);
  if (!input) return "—";
  const [year, month, day] = input.split("-");
  return `${day}-${month}-${year}`;
}

function formatRackLocations(locations) {
  if (!locations?.length) return "—";
  return locations
    .map((loc) => {
      const place = loc.plant || loc.warehouse || "—";
      const rack = loc.rack || "—";
      const bin = loc.bin || "—";
      const qty = loc.qty != null ? ` (${loc.qty})` : "";
      return `${place}: ${rack}/${bin}${qty}`;
    })
    .join("; ");
}

function ProcurementFlowSteps({ flow, currentMr }) {
  const materialRequests = flow?.material_requests || [];
  const rfqs = flow?.rfqs || [];
  const purchaseOrders = flow?.purchase_orders || [];
  const grns = flow?.grns || [];

  const steps = [
    {
      key: "mr",
      label: "MR",
      names: materialRequests,
      linkPrefix: "/supply-chain/material-requests?mr=",
      current: currentMr,
      done: Boolean(currentMr && materialRequests.includes(currentMr)) || materialRequests.length > 0,
    },
    {
      key: "rfq",
      label: "RFQ",
      names: rfqs,
      linkPrefix: "/supply-chain/rfq?rfq=",
      done: rfqs.length > 0,
    },
    {
      key: "po",
      label: "PO",
      names: purchaseOrders,
      linkPrefix: "/supply-chain/purchase-orders?po=",
      done: purchaseOrders.length > 0,
    },
    {
      key: "grn",
      label: "GRN",
      names: grns,
      linkPrefix: "/supply-chain/grn?grn=",
      done: grns.length > 0,
    },
  ];

  return (
    <div className="scm-procurement-flow" aria-label="Procurement flow MR to GRN">
      {steps.map((step, index) => (
        <div key={step.key} className="scm-procurement-flow__group">
          {index > 0 ? <span className="scm-procurement-flow__arrow" aria-hidden="true">→</span> : null}
          <div
            className={`scm-procurement-flow-step${
              step.done ? " scm-procurement-flow-step--done" : ""
            }`}
          >
            <span className="scm-procurement-flow-step__label">{step.label}</span>
            {step.names.length ? (
              <span className="scm-procurement-flow-step__links">
                {step.names.map((name) => (
                  <Link
                    key={name}
                    to={`${step.linkPrefix}${encodeURIComponent(name)}`}
                    className="scm-link-btn--sm"
                  >
                    {name}
                  </Link>
                ))}
              </span>
            ) : step.current ? (
              <span className="scm-procurement-flow-step__current">{step.current}</span>
            ) : (
              <span className="scm-procurement-flow-step__pending">Pending</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function hasExternalSource(row) {
  const dt = row?.source_doctype || row?.custom_source_doctype || "";
  if (dt && dt !== "Manual") return true;
  const label = mrSourceLabel(row);
  return label !== "Manual";
}

const EMPTY_LINE = { item_code: "", qty: 1, warehouse: "" };

export default function MaterialRequestsPage() {
  const [searchParams] = useSearchParams();
  const sourceFilter = searchParams.get("source") || "";
  const sourceNameFilter = searchParams.get("source_name") || "";

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showPoForm, setShowPoForm] = useState(false);
  const [line, setLine] = useState(EMPTY_LINE);
  const [warehouses, setWarehouses] = useState([]);
  const [productOpts, setProductOpts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);
  const [salesPlanning, setSalesPlanning] = useState(null);
  const [salesPlanningLoading, setSalesPlanningLoading] = useState(false);
  const [salesPlanningRows, setSalesPlanningRows] = useState([]);
  const [showAwaitingStockList, setShowAwaitingStockList] = useState(false);
  const [awaitingStockLoading, setAwaitingStockLoading] = useState(false);
  const [awaitingStockCount, setAwaitingStockCount] = useState(null);
  const [procurementTimeline, setProcurementTimeline] = useState(null);
  const [arrivalForm, setArrivalForm] = useState({
    material_arrival_date: "",
    material_arrival_warehouse: "",
    expected_receipt_date: "",
  });
  const [savingArrival, setSavingArrival] = useState(false);
  const [materialCheck, setMaterialCheck] = useState(null);

  const isSalesQuotationSource = sourceFilter === "Sales Quotation";

  const { rows, loading, error, updated, reload } = useScmList(
    () =>
      listMaterialRequests({
        search: debouncedSearch || undefined,
        status: status || undefined,
        source_doctype: sourceFilter || undefined,
        source_name: sourceNameFilter || undefined,
        limit: 200,
      }),
    [debouncedSearch, status, sourceFilter, sourceNameFilter],
  );

  const kpis = useMemo(
    () => ({
      open: countWhere(rows, (r) => OPEN_STATUSES.has(r.status)),
      ordered: countWhere(rows, (r) => r.status === "Ordered"),
      cancelled: countWhere(rows, (r) => CLOSED_STATUSES.has(r.status)),
      withSource: countWhere(rows, hasExternalSource),
    }),
    [rows],
  );
  const defaultWarehouseName = useMemo(() => {
    const preferred = warehouses.find((w) => (w.name || "").toLowerCase().includes("stores - md"));
    return preferred?.name || warehouses[0]?.name || "";
  }, [warehouses]);

  const filtered = useMemo(() => rows, [rows]);
  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(filtered, 25);

  const openRow = useCallback(async (row) => {
    setSelected(row.name);
    setDetail(null);
    setLoadingDetail(true);
    try {
      setDetail(await getMaterialRequest(row.name));
    } catch {
      toast.error("Could not load material request.");
      setSelected(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const closeModal = useCallback(() => {
    setDetail(null);
    setSelected(null);
    setLoadingDetail(false);
  }, []);

  useScmDocDeepLink("mr", rows, openRow);

  useEffect(() => {
    if (!isSalesQuotationSource || !sourceNameFilter) {
      setSalesPlanning(null);
      setProcurementTimeline(null);
      setMaterialCheck(null);
      return undefined;
    }
    let cancelled = false;
    setSalesPlanningLoading(true);
    Promise.all([
      getSalesQuotationMaterialPlanning(sourceNameFilter),
      getProcurementTimelineForQuotation(sourceNameFilter),
      getQuotationMaterialCheck(null, null, sourceNameFilter),
    ])
      .then(([planning, timeline, check]) => {
        if (cancelled) return;
        setSalesPlanning(planning);
        setProcurementTimeline(timeline);
        setMaterialCheck(check);
        const stores = planning?.stores_timeline || {};
        const suggestedArrival =
          stores.material_arrival_date ||
          timeline?.material_arrival_date ||
          planning?.procurement_timeline?.material_arrival_date ||
          "";
        setArrivalForm({
          material_arrival_date: toDateInputValue(stores.material_arrival_date || suggestedArrival),
          material_arrival_warehouse: stores.material_arrival_warehouse || "",
          expected_receipt_date: toDateInputValue(stores.expected_receipt_date),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setSalesPlanning(null);
          setProcurementTimeline(null);
          setMaterialCheck(null);
        }
      })
      .finally(() => {
        if (!cancelled) setSalesPlanningLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isSalesQuotationSource, sourceNameFilter]);

  const refreshSalesPlanning = useCallback(async () => {
    if (!sourceNameFilter) return;
    try {
      const [planning, timeline] = await Promise.all([
        getSalesQuotationMaterialPlanning(sourceNameFilter),
        getProcurementTimelineForQuotation(sourceNameFilter),
      ]);
      setSalesPlanning(planning);
      setProcurementTimeline(timeline);
    } catch {
      toast.error("Could not refresh procurement timeline.");
    }
  }, [sourceNameFilter]);

  const saveMaterialArrival = async (e) => {
    e.preventDefault();
    if (!sourceNameFilter) return;
    setSavingArrival(true);
    try {
      await setQuotationMaterialArrival({
        quotationName: sourceNameFilter,
        materialArrivalDate: arrivalForm.material_arrival_date || undefined,
        materialArrivalWarehouse: arrivalForm.material_arrival_warehouse || undefined,
        expectedReceiptDate: arrivalForm.expected_receipt_date || undefined,
      });
      toast.success("Material arrival timeline saved.");
      await refreshSalesPlanning();
    } catch (err) {
      toast.error(err?.message || "Could not save material arrival.");
    } finally {
      setSavingArrival(false);
    }
  };

  const loadAwaitingStockList = useCallback(async () => {
    setAwaitingStockLoading(true);
    try {
      const data = await listSalesQuotationMaterialPlanning(undefined, 50);
      const rows = data?.rows || [];
      setSalesPlanningRows(rows);
      setAwaitingStockCount(data?.count ?? rows.length);
    } catch {
      setSalesPlanningRows([]);
      toast.error("Could not load quotations awaiting stock.");
    } finally {
      setAwaitingStockLoading(false);
    }
  }, []);

  const openAwaitingStockList = useCallback(() => {
    setShowAwaitingStockList(true);
    loadAwaitingStockList();
  }, [loadAwaitingStockList]);

  useEffect(() => {
    if (isSalesQuotationSource && sourceNameFilter) {
      setAwaitingStockCount(null);
      return undefined;
    }
    let cancelled = false;
    listSalesQuotationMaterialPlanning(undefined, 1)
      .then((data) => {
        if (!cancelled) setAwaitingStockCount(data?.count ?? (data?.rows || []).length);
      })
      .catch(() => {
        if (!cancelled) setAwaitingStockCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [isSalesQuotationSource, sourceNameFilter]);

  useEffect(() => {
    let cancelled = false;
    listWarehouses()
      .then((rows) => {
        if (cancelled) return;
        const active = (rows || []).filter((w) => !w.disabled);
        setWarehouses(active);
        const preferred = active.find((w) => (w.name || "").toLowerCase().includes("stores - md"));
        if (preferred) {
          setLine((prev) => (prev.warehouse ? prev : { ...prev, warehouse: preferred.name }));
        }
      })
      .catch(() => {
        if (!cancelled) setWarehouses([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showForm) return undefined;
    let cancelled = false;
    setLoadingProducts(true);
    listProducts({ item_type: "RM", limit: 200 })
      .then((rows) => {
        if (cancelled) return;
        setProductOpts(rows);
        if (rows.length && !line.item_code) {
          setLine((prev) => ({ ...prev, item_code: rows[0].item_code }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProductOpts([]);
          toast.error("Could not load products for MR.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingProducts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showForm]);

  const closeCreateModal = useCallback(() => {
    setShowForm(false);
    setLine({ ...EMPTY_LINE, warehouse: defaultWarehouseName });
  }, [defaultWarehouseName]);

  const submitCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createMaterialRequest({
        items: [line],
        material_request_type: "Purchase",
        source_doctype: "Manual",
        source_name: "Portal",
      });
      toast.success("Material request created.");
      setShowForm(false);
      setLine(EMPTY_LINE);
      reload();
    } catch (err) {
      toast.error(err?.message || "Create failed.");
    } finally {
      setSaving(false);
    }
  };

  const refreshDetail = async () => {
    if (!detail?.name) return;
    try {
      setDetail(await getMaterialRequest(detail.name));
      reload();
    } catch {
      toast.error("Could not refresh material request.");
    }
  };

  const submitMr = async () => {
    if (!detail?.name) return;
    setActing(true);
    try {
      const result = await submitMaterialRequest(detail.name);
      setDetail(result.material_request || result);
      toast.success("Material request submitted.");
      reload();
    } catch (err) {
      toast.error(err?.message || "Submit failed.");
    } finally {
      setActing(false);
    }
  };

  const cancelMr = async () => {
    if (!detail?.name) return;
    setActing(true);
    try {
      const result = await cancelMaterialRequest(detail.name);
      setDetail(result.material_request || result);
      toast.success("Material request cancelled.");
      reload();
    } catch (err) {
      toast.error(err?.message || "Cancel failed.");
    } finally {
      setActing(false);
    }
  };

  const canCreatePo =
    detail &&
    detail.docstatus === 1 &&
    !["Cancelled", "Received", "Stopped"].includes(detail.status) &&
    Number(detail.per_ordered || 0) < 100;

  const columns = [
    { key: "name", header: "MR #", className: "scm-table__cell--link" },
    { key: "transaction_date", header: "Date" },
    {
      key: "source",
      header: "Source",
      render: (r) => {
        const text = mrSourceLabel(r);
        const link = parseSourceLink(text);
        return link ? (
          <Link to={link.to} className="scm-link-btn--sm">
            {link.label}
          </Link>
        ) : (
          text
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <ScmStatusBadge status={r.status} />,
    },
    { key: "company", header: "Company" },
  ];

  return (
    <div className="scm-page scm-material-requests-page">
      <ScmPageHeader
        title="Material Requests"
        subtitle="Shortages from Sales, Manufacturing, and manual entry"
        updated={updated}
        loading={loading}
        actions={
          <>
            <ScmQuickLinks
              links={[
                { to: "/supply-chain/mrp", label: "MRP" },
                { to: "/supply-chain/rfq", label: "RFQ" },
                { to: "/supply-chain/purchase-orders", label: "PO" },
                { to: "/supply-chain/reservations", label: "Reservations" },
              ]}
            />
            <button type="button" className="scm-btn-ghost" onClick={reload} disabled={loading}>
              Refresh
            </button>
          </>
        }
      />

      <ScmPageKpiGrid>
        <ScmKpiCard
          label="Open MRs"
          value={kpis.open}
          sub="Pending or partially ordered"
          tone="warn"
          icon={<ClipboardList size={16} />}
        />
        <ScmKpiCard
          label="Ordered"
          value={kpis.ordered}
          sub="Fully ordered to PO"
          icon={<CheckCircle size={16} />}
        />
        <ScmKpiCard
          label="Cancelled / stopped"
          value={kpis.cancelled}
          sub="No further procurement"
          tone={kpis.cancelled > 0 ? "danger" : "default"}
          icon={<XCircle size={16} />}
        />
        <ScmKpiCard
          label="With source"
          value={kpis.withSource}
          sub="Linked from Sales, MFG, or MRP"
          icon={<GitBranch size={16} />}
        />
      </ScmPageKpiGrid>

      <ScmPanel
        title="Raise material need"
        subtitle="Manual purchase MR — next step is RFQ or PO"
        className="scm-material-requests-action-panel"
      >
        <div className="scm-page-action-form">
          <button
            type="button"
            className="scm-btn-primary scm-reservations-action-btn"
            onClick={() => {
              setLine((prev) => ({ ...EMPTY_LINE, warehouse: prev.warehouse || defaultWarehouseName }));
              setShowForm(true);
            }}
          >
            New MR
          </button>
          {!isSalesQuotationSource || !sourceNameFilter ? (
            <button
              type="button"
              className="scm-btn-ghost scm-awaiting-stock-btn"
              onClick={openAwaitingStockList}
            >
              Sales quotations awaiting stock
              {awaitingStockCount != null && awaitingStockCount > 0 ? ` (${awaitingStockCount})` : ""}
            </button>
          ) : null}
        </div>
        <p className="scm-page-hint scm-page-hint--muted">
          MRs from Sales quotations or MFG checks appear automatically in the list.
        </p>
      </ScmPanel>

      {sourceFilter || sourceNameFilter ? (
        <div className="scm-mock-notice" style={{ marginBottom: "0.75rem" }}>
          Filtered by source: {[sourceFilter, sourceNameFilter].filter(Boolean).join(" · ")}
          {" "}
          <Link to="/supply-chain/material-requests" className="scm-link-btn--sm">Clear filter</Link>
        </div>
      ) : null}

      {isSalesQuotationSource && sourceNameFilter ? (
        <ScmPanel
          title="Sales quotation — material planning"
          subtitle={`Procurement timeline for ${sourceNameFilter}`}
          className="scm-sales-quotation-planning-panel"
        >
          {salesPlanningLoading ? (
            <p className="scm-page-hint scm-page-hint--muted">Loading quotation material planning…</p>
          ) : salesPlanning ? (
            <div className="scm-sales-planning-detail scm-procurement-planning-detail">
              <div className="scm-procurement-planning-header">
                <div>
                  <p className="scm-procurement-planning-title">
                    <strong>{salesPlanning.quotation}</strong>
                    {salesPlanning.party_name ? ` · ${salesPlanning.party_name}` : ""}
                  </p>
                  <p className="scm-page-hint scm-page-hint--muted">
                    {salesPlanning.materials_available
                      ? "All materials available in stock"
                      : `${salesPlanning.shortage_count || 0} material shortage(s)`}
                  </p>
                </div>
                <Link
                  to={salesPlanning.sales_portal_url || `/sales/quotations?q=${encodeURIComponent(sourceNameFilter)}`}
                  className="scm-btn-ghost scm-procurement-planning-sales-link"
                >
                  Open in Sales portal
                </Link>
              </div>

              {procurementTimeline ? (
                <div className="scm-procurement-planning-kpis">
                  <ScmKpiCard
                    label="Procurement days"
                    value={procurementTimeline.procurement_days ?? "—"}
                    sub={procurementSourceLabel(
                      procurementTimeline.source,
                      procurementTimeline.source_label || salesPlanning.procurement_timeline?.source_label,
                    )}
                    tone={salesPlanning.materials_available ? "default" : "warn"}
                  />
                  <ScmKpiCard
                    label="Tentative arrival"
                    value={formatDisplayDate(procurementTimeline.material_arrival_date)}
                    sub={procurementTimeline.formula || "Estimated material arrival"}
                  />
                  <ScmKpiCard
                    label="Linked MR"
                    value={(salesPlanning.material_requests || [])[0] || "—"}
                    sub={
                      (salesPlanning.purchase_orders || []).length
                        ? `PO: ${(salesPlanning.purchase_orders || []).join(", ")}`
                        : "No PO yet"
                    }
                  />
                </div>
              ) : null}

              {(salesPlanning.procurement_flow ||
                (salesPlanning.material_requests || []).length ||
                (salesPlanning.purchase_orders || []).length) ? (
                <>
                  <p className="scm-form-label">Section 4 — Procurement flow</p>
                  <ProcurementFlowSteps flow={salesPlanning.procurement_flow || {
                    material_requests: salesPlanning.material_requests || [],
                    purchase_orders: salesPlanning.purchase_orders || [],
                  }} />
                </>
              ) : null}

              {materialCheck?.decision ? (
                <div
                  className={`scm-material-check-decision scm-material-check-decision--${
                    materialCheck.materials_available ? "ok" : "warn"
                  }`}
                >
                  <strong>Section {materialCheck.decision.next_section}</strong>
                  <span>{materialCheck.decision.next_section_label}</span>
                </div>
              ) : null}

              {(materialCheck?.bom_requirements || []).length ? (
                <>
                  <p className="scm-form-label">BOM material requirements (Section 3.0)</p>
                  <div className="scm-table-scroll">
                    <table className="scm-data-table scm-material-check-table">
                      <thead>
                        <tr>
                          <th>Material</th>
                          <th>Required</th>
                          <th>Available</th>
                          <th>Rack / bin</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(materialCheck.bom_requirements || []).map((row) => (
                          <tr key={row.item_code}>
                            <td>{row.item_code}</td>
                            <td>{row.required_qty}</td>
                            <td>{row.available_qty}</td>
                            <td className="scm-table__cell--muted">{formatRackLocations(row.stock_locations)}</td>
                            <td>{row.enough_now ? "OK" : "Short"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}

              {(materialCheck?.plant_checks || []).length ? (
                <>
                  <p className="scm-form-label">Plant material check</p>
                  <div className="scm-table-scroll">
                    <table className="scm-data-table scm-material-check-table">
                      <thead>
                        <tr>
                          <th>Plant</th>
                          <th>Warehouses</th>
                          <th>Shortages</th>
                          <th>Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(materialCheck.plant_checks || []).map((row) => (
                          <tr key={row.plant}>
                            <td>{row.plant_name || row.plant}</td>
                            <td>{(row.warehouses || []).join(", ") || "—"}</td>
                            <td>{row.shortage_count ?? 0}</td>
                            <td>{row.materials_available ? "Available" : "Short"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}

              <div className="scm-detail-grid scm-procurement-planning-grid">
                {(salesPlanning.material_requests || []).map((mr) => (
                  <ScmDetailField
                    key={mr}
                    label="Material request"
                    value={
                      <Link
                        to={`/supply-chain/material-requests?mr=${encodeURIComponent(mr)}`}
                        className="scm-link-btn--sm"
                      >
                        {mr}
                      </Link>
                    }
                  />
                ))}
                {(salesPlanning.purchase_orders || []).map((po) => (
                  <ScmDetailField
                    key={po}
                    label="Purchase order"
                    value={
                      <Link
                        to={`/supply-chain/purchase-orders?po=${encodeURIComponent(po)}`}
                        className="scm-link-btn--sm"
                      >
                        {po}
                      </Link>
                    }
                  />
                ))}
                {salesPlanning.stores_timeline?.material_arrival_warehouse ? (
                  <ScmDetailField
                    label="Stores warehouse"
                    value={salesPlanning.stores_timeline.material_arrival_warehouse}
                  />
                ) : null}
              </div>

              {(salesPlanning.shortages || []).length ? (
                <>
                  <p className="scm-form-label">Shortages</p>
                  <ul className="scm-sales-planning-suppliers scm-procurement-shortage-list">
                    {(salesPlanning.shortages || []).slice(0, 8).map((row) => (
                      <li key={`${row.item_code}-${row.type || "item"}`}>
                        <strong>{row.item_code}</strong>
                        {row.type === "component" ? " (BOM component)" : ""}
                        {" — need "}
                        {Number(row.missing_qty || row.required_qty || 0)}
                        {row.available_qty != null ? `, have ${Number(row.available_qty)}` : ""}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              {(salesPlanning.supplier_availability || []).length ? (
                <>
                  <p className="scm-form-label">Suggested suppliers</p>
                  <ul className="scm-sales-planning-suppliers">
                    {salesPlanning.supplier_availability.map((row) => (
                      <li key={row.item_code}>
                        <strong>{row.item_code}</strong>
                        {(row.suppliers || []).length
                          ? ` — ${(row.suppliers || []).slice(0, 2).map((s) => s.supplier_name || s.supplier).join(", ")}`
                          : " — no supplier history"}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              {!salesPlanning.materials_available ? (
                <form className="scm-procurement-arrival-form" onSubmit={saveMaterialArrival}>
                  <p className="scm-form-label">Stores — material arrival timeline</p>
                  <p className="scm-page-hint scm-page-hint--muted">
                    Save a committed arrival date to override MR/PO estimates on the linked quotation.
                  </p>
                  <div className="scm-procurement-arrival-fields">
                    <label className="scm-form-field scm-form-field--grow">
                      <span className="scm-form-label">Material arrival date</span>
                      <input
                        type="date"
                        className="scm-input"
                        value={arrivalForm.material_arrival_date}
                        onChange={(ev) =>
                          setArrivalForm((prev) => ({
                            ...prev,
                            material_arrival_date: ev.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="scm-form-field scm-form-field--grow">
                      <span className="scm-form-label">Warehouse</span>
                      <input
                        type="text"
                        className="scm-input"
                        placeholder="e.g. Stores - Main"
                        value={arrivalForm.material_arrival_warehouse}
                        onChange={(ev) =>
                          setArrivalForm((prev) => ({
                            ...prev,
                            material_arrival_warehouse: ev.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="scm-form-field scm-form-field--grow">
                      <span className="scm-form-label">Expected receipt (optional)</span>
                      <input
                        type="date"
                        className="scm-input"
                        value={arrivalForm.expected_receipt_date}
                        onChange={(ev) =>
                          setArrivalForm((prev) => ({
                            ...prev,
                            expected_receipt_date: ev.target.value,
                          }))
                        }
                      />
                    </label>
                    <button type="submit" className="scm-btn-primary" disabled={savingArrival}>
                      {savingArrival ? "Saving…" : "Save arrival timeline"}
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          ) : (
            <p className="scm-page-hint scm-page-hint--muted">Could not load Sales quotation planning.</p>
          )}
        </ScmPanel>
      ) : null}

      <ScmListFilters
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          resetPage();
        }}
        searchPlaceholder="Search MR…"
        selectLabel="Status"
        selectValue={status}
        selectOptions={STATUS_OPTIONS}
        onSelectChange={(v) => {
          setStatus(v);
          resetPage();
        }}
      />

      {error ? <div className="scm-error-banner">{error}</div> : null}

      <ScmDataTable
        columns={columns}
        rows={pageRows}
        loading={loading}
        emptyIcon={ClipboardList}
        emptyTitle="No material requests"
        emptyDescription="MRs from Sales quotations or MFG checks appear here."
        getRowKey={(r) => r.name}
        activeKey={selected}
        onRowClick={openRow}
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={25}
        onPageChange={setPage}
      />

      <ScmModal
        open={Boolean(selected)}
        title={detail?.name || selected || "Material Request"}
        subtitle={detail?.status || "Loading…"}
        wide
        onClose={closeModal}
        footer={
          detail && !loadingDetail ? (
            <>
              <button type="button" className="scm-btn-ghost" onClick={closeModal}>
                Close
              </button>
              {detail.docstatus === 0 ? (
                <button type="button" className="scm-btn-primary" disabled={acting} onClick={submitMr}>
                  Submit MR
                </button>
              ) : null}
              {detail.docstatus === 1 && detail.status !== "Cancelled" ? (
                <button type="button" className="scm-btn-ghost" disabled={acting} onClick={cancelMr}>
                  Cancel MR
                </button>
              ) : null}
              {canCreatePo ? (
                <button type="button" className="scm-btn-primary" disabled={acting} onClick={() => setShowPoForm(true)}>
                  Create PO
                </button>
              ) : null}
              {detail.docstatus === 1 ? (
                <Link
                  to={`/supply-chain/rfq?mr=${encodeURIComponent(detail.name)}`}
                  className="scm-btn-ghost"
                  onClick={closeModal}
                >
                  Create RFQ
                </Link>
              ) : null}
            </>
          ) : (
            <button type="button" className="scm-btn-ghost" onClick={closeModal}>
              Close
            </button>
          )
        }
      >
        {loadingDetail ? (
          <p className="scm-modal-loading">Loading material request…</p>
        ) : detail ? (
          <>
            <ProcurementFlowSteps flow={detail.procurement_flow} currentMr={detail.name} />
            <div className="scm-detail-grid">
              <ScmDetailField label="Type" value={detail.material_request_type} />
              <ScmDetailField label="Date" value={detail.transaction_date} />
              <ScmDetailField label="Schedule" value={detail.schedule_date} />
              <ScmDetailField label="Company" value={detail.company} />
              <ScmDetailField label="Source" value={mrSourceLabel(detail)} />
              <ScmDetailField label="Status" value={detail.status} />
            </div>
            <div className="scm-table-scroll">
              <table className="scm-table">
                <thead>
                  <tr className="scm-table__row">
                    {["Item", "Qty", "Ordered", "Received"].map((h) => (
                      <th key={h} className="scm-table__head">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(detail.items || []).map((item) => (
                    <tr key={item.item_code} className="scm-table__row">
                      <td className="scm-table__cell scm-table__cell--strong">{item.item_code}</td>
                      <td className="scm-table__cell">{item.qty}</td>
                      <td className="scm-table__cell">{item.ordered_qty}</td>
                      <td className="scm-table__cell">{item.received_qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="scm-modal-loading">Could not load material request.</p>
        )}
      </ScmModal>

      <ScmModal
        open={showForm}
        title="Create material request"
        subtitle="Purchase type — links to PO next"
        onClose={closeCreateModal}
        footer={
          <>
            <button type="button" className="scm-btn-ghost" onClick={closeCreateModal} disabled={saving}>
              Cancel
            </button>
            <button type="submit" form="scm-create-mr-form" className="scm-btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Create MR"}
            </button>
          </>
        }
      >
        <form id="scm-create-mr-form" onSubmit={submitCreate}>
          <div className="scm-form-grid">
            <label className="scm-form-field">
              <span className="scm-form-label">Item (RM)</span>
              <select
                className="scm-input"
                value={line.item_code}
                onChange={(e) => setLine((l) => ({ ...l, item_code: e.target.value }))}
                required
                disabled={loadingProducts || !productOpts.length}
              >
                <option value="">
                  {loadingProducts ? "Loading products…" : "Select raw material…"}
                </option>
                {productOpts.map((p) => (
                  <option key={p.item_code} value={p.item_code}>
                    {p.item_code} — {p.item_name || p.item_code}
                  </option>
                ))}
              </select>
            </label>
            <label className="scm-form-field">
              <span className="scm-form-label">Quantity</span>
              <input
                type="number"
                min="1"
                className="scm-input"
                value={line.qty}
                onChange={(e) => setLine((l) => ({ ...l, qty: Number(e.target.value) }))}
                required
              />
            </label>
            <label className="scm-form-field">
              <span className="scm-form-label">Warehouse</span>
              <select
                className="scm-input"
                value={line.warehouse}
                onChange={(e) => setLine((l) => ({ ...l, warehouse: e.target.value }))}
                required
              >
                <option value="">Select warehouse…</option>
                {warehouses.map((w) => (
                  <option key={w.name} value={w.name}>
                    {w.warehouse_name || w.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!loadingProducts && !productOpts.length ? (
            <p className="scm-page-hint scm-page-hint--muted">
              No raw materials found.{" "}
              <Link to="/supply-chain/products" className="scm-link-btn--sm">
                Create RM in Products
              </Link>{" "}
              first.
            </p>
          ) : null}
        </form>
      </ScmModal>

      <ScmModal
        open={showAwaitingStockList}
        title="Sales quotations awaiting stock"
        subtitle="Open quotations with material shortages"
        wide
        onClose={() => setShowAwaitingStockList(false)}
        footer={
          <button type="button" className="scm-btn-ghost" onClick={() => setShowAwaitingStockList(false)}>
            Close
          </button>
        }
      >
        {awaitingStockLoading ? (
          <p className="scm-modal-loading">Loading quotations…</p>
        ) : salesPlanningRows.length ? (
          <ul className="scm-sales-planning-list scm-procurement-quotation-list">
            {salesPlanningRows.map((row) => (
              <li key={row.quotation} className="scm-procurement-quotation-list__item">
                <Link
                  to={`/supply-chain/material-requests?source=${encodeURIComponent("Sales Quotation")}&source_name=${encodeURIComponent(row.quotation)}`}
                  className="scm-link-btn--sm scm-procurement-quotation-list__id"
                  onClick={() => setShowAwaitingStockList(false)}
                >
                  {row.quotation}
                </Link>
                <span className="scm-procurement-quotation-list__meta">
                  {row.party_name ? `${row.party_name} · ` : ""}
                  {row.shortage_count ? `${row.shortage_count} shortage(s) · ` : ""}
                  <strong>{row.procurement_days ?? "—"} days</strong>
                  {row.source_label || row.source
                    ? ` · ${procurementSourceLabel(row.source, row.source_label)}`
                    : ""}
                  {row.material_arrival_date ? ` · arrival ${formatDisplayDate(row.material_arrival_date)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="scm-page-hint scm-page-hint--muted">No quotations awaiting stock.</p>
        )}
      </ScmModal>

      <ScmCreatePoModal
        open={showPoForm}
        materialRequest={detail}
        onClose={() => setShowPoForm(false)}
        onCreated={() => {
          setShowPoForm(false);
          refreshDetail();
        }}
      />
    </div>
  );
}
