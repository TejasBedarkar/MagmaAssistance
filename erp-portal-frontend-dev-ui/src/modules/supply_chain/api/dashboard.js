import { scCallGet } from "./scCall.js";
import { MOCK_SUMMARY, MOCK_FILTER_OPTIONS } from "./dashboard.mock.js";
import { applyDashboardFilters } from "./dashboardFilters.js";

/** Map live backend KPI keys to §3.1 dashboard fields. */
function normalizeKpis(kpis = {}) {
  const awaitingGrn = kpis.pending_grns ?? 0;
  const pendingInspection = kpis.pending_inspections ?? 0;

  return {
    items_below_reorder: kpis.items_below_reorder ?? kpis.low_stock_count ?? 0,
    low_stock_count: kpis.low_stock_count ?? kpis.items_below_reorder ?? 0,
    open_material_requests: kpis.open_material_requests ?? 0,
    pending_purchase_orders: kpis.pending_purchase_orders ?? kpis.open_purchase_orders ?? 0,
    open_purchase_orders: kpis.open_purchase_orders ?? kpis.pending_purchase_orders ?? 0,
    pending_grns: awaitingGrn,
    pending_inspections: pendingInspection,
    pending_grns_to_inspect:
      kpis.pending_grns_to_inspect ?? awaitingGrn + pendingInspection,
    total_stock_value: kpis.total_stock_value ?? 0,
    locked_reservations_kg: kpis.locked_reservations_kg ?? 0,
    availability_requests: kpis.availability_requests ?? 0,
  };
}

function pickSection(data, key, mock, useMockFallbacks) {
  if (data && data[key] !== undefined) {
    return data[key];
  }
  return useMockFallbacks ? mock[key] || [] : [];
}

/** Merge live API payload with mock fallbacks only for sections the backend omits. */
export function normalizeDashboardSummary(data, useMockFallbacks = true) {
  const mock = useMockFallbacks ? MOCK_SUMMARY : {};
  return {
    ...mock,
    ...data,
    kpis: normalizeKpis({ ...mock.kpis, ...data?.kpis }),
    low_stock_alerts: pickSection(data, "low_stock_alerts", mock, useMockFallbacks),
    recent_material_requests: pickSection(data, "recent_material_requests", mock, useMockFallbacks),
    procurement_pipeline: pickSection(data, "procurement_pipeline", mock, useMockFallbacks),
    stock_value_trend: pickSection(data, "stock_value_trend", mock, useMockFallbacks),
    mr_status_breakdown: pickSection(data, "mr_status_breakdown", mock, useMockFallbacks),
    availability_requests: pickSection(data, "availability_requests", mock, useMockFallbacks),
    recent_activity: pickSection(data, "recent_activity", mock, useMockFallbacks),
  };
}

export async function getDashboardFilterOptions() {
  const forceMock = import.meta.env.VITE_SCM_FORCE_MOCK === "true";
  if (forceMock) {
    return MOCK_FILTER_OPTIONS;
  }
  try {
    const data = await scCallGet(
      "supply_chain_app.api.dashboard.get_filter_options",
      {},
      { silent: true },
    );
    if (data?.warehouses?.length) {
      return {
        warehouses: data.warehouses,
        suppliers: data.suppliers || MOCK_FILTER_OPTIONS.suppliers,
        itemTypes: data.item_types || MOCK_FILTER_OPTIONS.itemTypes,
      };
    }
  } catch {
    /* fall through */
  }
  return MOCK_FILTER_OPTIONS;
}

export async function getDashboardSummary(filters = {}) {
  const forceMock = import.meta.env.VITE_SCM_FORCE_MOCK === "true";

  if (forceMock) {
    const filtered = applyDashboardFilters(MOCK_SUMMARY, filters);
    return { ...normalizeDashboardSummary(filtered, false), _mock: true };
  }

  try {
    const data = await scCallGet(
      "supply_chain_app.api.dashboard.get_summary",
      filters,
      { silent: true },
    );
    if (data?.kpis) {
      // Backend already applies filters — do not re-run client-side scaling on live data.
      return { ...normalizeDashboardSummary(data, true), _live: true };
    }
  } catch {
    /* use mock */
  }

  const filtered = applyDashboardFilters(MOCK_SUMMARY, filters);
  return { ...normalizeDashboardSummary(filtered, false), _mock: true };
}

export { MOCK_FILTER_OPTIONS } from "./dashboard.mock.js";
