const OPEN_MR_STATUSES = new Set([
  "Pending",
  "Partially Ordered",
  "Partially Received",
  "Submitted",
]);

function matchesItemType(itemCode, itemType) {
  if (!itemType) return true;
  const code = String(itemCode || "").toUpperCase();
  if (itemType === "RM") return code.startsWith("RM");
  if (itemType === "FG") return code.startsWith("FG");
  return true;
}

function inDateRange(dateStr, from, to) {
  if (!dateStr) return true;
  if (from && dateStr < from) return false;
  if (to && dateStr > to) return false;
  return true;
}

function rowMatchesWarehouse(row, warehouse) {
  if (!warehouse) return true;
  return row.warehouse === warehouse || String(row.detail || "").includes(warehouse);
}

function rowMatchesSupplier(row, supplier) {
  if (!supplier) return true;
  return (
    row.supplier === supplier ||
    String(row.detail || "").includes(supplier) ||
    String(row.source || "").includes(supplier)
  );
}

function hasDimensionFilter(filters) {
  return Boolean(filters.warehouse || filters.supplier || filters.item_type);
}

function scaleCount(total, filteredLen, baseLen) {
  if (!baseLen) return 0;
  if (filteredLen === baseLen) return total;
  return Math.max(0, Math.round((total * filteredLen) / baseLen));
}

function buildMrStatusBreakdown(rows) {
  const counts = {};
  for (const row of rows) {
    const status = row.status || "Unknown";
    counts[status] = (counts[status] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => a.status.localeCompare(b.status));
}

/** Client-side filter for mock / offline dashboard data. */
export function applyDashboardFilters(summary, filters = {}) {
  if (!summary) return summary;

  const { date_from, date_to, warehouse, supplier, item_type } = filters;
  const baseAlerts = summary.low_stock_alerts || [];
  const baseMrs = summary.recent_material_requests || [];

  const low_stock_alerts = baseAlerts.filter((row) => {
    if (!rowMatchesWarehouse(row, warehouse)) return false;
    if (!matchesItemType(row.item_code, item_type)) return false;
    return true;
  });

  const recent_material_requests = baseMrs.filter((row) => {
    if (!inDateRange(row.date, date_from, date_to)) return false;
    if (row.warehouse && warehouse && row.warehouse !== warehouse) return false;
    if (row.item_code && !matchesItemType(row.item_code, item_type)) return false;
    if (!rowMatchesSupplier(row, supplier)) return false;
    return true;
  });

  const availability_requests = (summary.availability_requests || []).filter((row) => {
    if (!matchesItemType(row.item_code, item_type)) return false;
    if (row.warehouse && warehouse && row.warehouse !== warehouse) return false;
    return true;
  });

  const recent_activity = (summary.recent_activity || []).filter((row) => {
    if (!inDateRange(row.date, date_from, date_to)) return false;
    if (!rowMatchesWarehouse(row, warehouse)) return false;
    if (!rowMatchesSupplier(row, supplier)) return false;
    return true;
  });

  const openMrFromRows = recent_material_requests.filter((row) =>
    OPEN_MR_STATUSES.has(row.status),
  ).length;

  const alertRatio =
    baseAlerts.length > 0 ? low_stock_alerts.length / baseAlerts.length : 1;
  const scoped = hasDimensionFilter(filters);
  const baseKpis = summary.kpis || {};

  const open_material_requests = scoped
    ? openMrFromRows || scaleCount(baseKpis.open_material_requests, low_stock_alerts.length, baseAlerts.length)
    : openMrFromRows || baseKpis.open_material_requests;

  const pending_purchase_orders = scoped
    ? scaleCount(baseKpis.pending_purchase_orders, low_stock_alerts.length, baseAlerts.length)
    : baseKpis.pending_purchase_orders;

  const pending_grns = scoped
    ? scaleCount(baseKpis.pending_grns, low_stock_alerts.length, baseAlerts.length)
    : baseKpis.pending_grns;

  const pending_inspections = scoped
    ? scaleCount(baseKpis.pending_inspections, low_stock_alerts.length, baseAlerts.length)
    : baseKpis.pending_inspections;

  const procurement_pipeline = (summary.procurement_pipeline || []).map((stage) => {
    if (stage.stage === "MR open") {
      return { ...stage, count: open_material_requests };
    }
    if (stage.stage === "PO issued") {
      return { ...stage, count: pending_purchase_orders };
    }
    if (stage.stage === "Awaiting GRN") {
      return { ...stage, count: pending_grns };
    }
    if (stage.stage === "Inspection") {
      return { ...stage, count: pending_inspections };
    }
    return stage;
  });

  const mr_status_breakdown = scoped
    ? buildMrStatusBreakdown(recent_material_requests)
    : summary.mr_status_breakdown || [];

  const stock_value_trend = scoped
    ? (summary.stock_value_trend || []).map((point) => ({
        ...point,
        value: Math.round((point.value || 0) * alertRatio),
      }))
    : summary.stock_value_trend || [];

  return {
    ...summary,
    kpis: {
      ...baseKpis,
      items_below_reorder: low_stock_alerts.length,
      low_stock_count: low_stock_alerts.length,
      open_material_requests,
      pending_purchase_orders,
      open_purchase_orders: pending_purchase_orders,
      pending_grns,
      pending_inspections,
      pending_grns_to_inspect: pending_grns + pending_inspections,
      availability_requests: availability_requests.length,
      total_stock_value: scoped
        ? Math.round((baseKpis.total_stock_value || 0) * alertRatio)
        : baseKpis.total_stock_value,
      locked_reservations_kg: scoped
        ? Math.round((baseKpis.locked_reservations_kg || 0) * alertRatio)
        : baseKpis.locked_reservations_kg,
    },
    low_stock_alerts,
    recent_material_requests,
    availability_requests,
    recent_activity,
    procurement_pipeline,
    mr_status_breakdown,
    stock_value_trend,
  };
}
