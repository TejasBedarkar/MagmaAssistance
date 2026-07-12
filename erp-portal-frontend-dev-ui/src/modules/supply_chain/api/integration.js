import { scCallGet, scCall } from "./scCall.js";

const METHOD = "supply_chain_app.api.integration";

/** Check material availability — same numbers Sales/MFG use via SCM stock batch. */
export async function checkMaterialAvailability(itemCode, qty = 1, warehouse) {
  return scCallGet(
    `${METHOD}.check_material_availability`,
    { item_code: itemCode, qty, warehouse: warehouse || undefined },
    { silent: true },
  );
}

/** Deep links to Sales, MFG, Finance portal pages for cross-module navigation. */
export async function getScmPortalLinks(doctype, name) {
  return scCallGet(
    `${METHOD}.get_scm_portal_links`,
    { doctype: doctype || undefined, name: name || undefined },
    { silent: true },
  );
}

/** Item Master verification for Sales Opportunity (Phase A). */
export async function verifyItemForSales(itemCode) {
  return scCallGet(`${METHOD}.verify_item_for_sales`, { item_code: itemCode }, { silent: true });
}

/** SCM portal: Sales opportunities pending Item Master verification (Phase A). */
export async function listSalesOpportunityVerifications(search, limit = 50) {
  return scCallGet(
    `${METHOD}.list_sales_opportunity_verifications`,
    { search: search || undefined, limit },
    { silent: true },
  );
}

/** SCM portal: opportunity + Item Master verification detail (Phase A). */
export async function getOpportunityVerificationForScm(opportunityId, productCode) {
  return scCallGet(
    `${METHOD}.get_opportunity_verification_for_scm`,
    {
      opportunity_id: opportunityId || undefined,
      product_code: productCode || undefined,
    },
    { silent: true },
  );
}

/** Phase B: supplier availability for shortage items (Sales quotation planning). */
export async function getSupplierAvailabilityForItems(items, limit = 3) {
  return scCallGet(
    `${METHOD}.get_supplier_availability_for_items`,
    { items: JSON.stringify(items), limit },
    { silent: true },
  );
}

/** SCM portal: Sales quotation material planning detail (Phase B). */
export async function getSalesQuotationMaterialPlanning(quotationName, materialRequest) {
  return scCallGet(
    `${METHOD}.get_sales_quotation_material_planning`,
    {
      quotation_name: quotationName || undefined,
      material_request: materialRequest || undefined,
    },
    { silent: true },
  );
}

/** SCM portal: open Sales quotations with material shortages (Phase B). */
export async function listSalesQuotationMaterialPlanning(search, limit = 25) {
  return scCallGet(
    `${METHOD}.list_sales_quotation_material_planning`,
    { search: search || undefined, limit },
    { silent: true },
  );
}

/** Phase C: SCM plant capacity for Sales quotation. */
export async function getPlantCapacityForQuotation(quotationName, fulfilmentPlant, requiredQty) {
  return scCallGet(
    `${METHOD}.get_plant_capacity_for_quotation`,
    {
      quotation_name: quotationName || undefined,
      fulfilment_plant: fulfilmentPlant || undefined,
      required_qty: requiredQty || undefined,
    },
    { silent: true },
  );
}

/** SCM portal: Sales quotation capacity planning detail (Phase C). */
export async function getSalesQuotationCapacityPlanning(quotationName) {
  return scCallGet(
    `${METHOD}.get_sales_quotation_capacity_planning`,
    { quotation_name: quotationName || undefined },
    { silent: true },
  );
}

/** SCM portal: Sales quotations awaiting capacity commitment (Phase C). */
export async function listSalesQuotationsAwaitingCapacity(search, limit = 25, fulfilmentPlant) {
  return scCallGet(
    `${METHOD}.list_sales_quotations_awaiting_capacity`,
    {
      search: search || undefined,
      limit,
      fulfilment_plant: fulfilmentPlant || undefined,
    },
    { silent: true },
  );
}

/** SCM/Sales: fulfilment plant options from SCM Plant master (Phase C). */
export async function listFulfilmentPlantsForSales(search, limit = 100) {
  return scCallGet(
    `${METHOD}.list_fulfilment_plants_for_sales`,
    { search: search || undefined, limit },
    { silent: true },
  );
}

/** Book SCM plant capacity for a Sales quotation. */
export async function bookPlantCapacityForQuotation(quotationName, fulfilmentPlant, requiredQty, allowOverbook = false) {
  return scCall(
    `${METHOD}.book_plant_capacity_for_quotation`,
    {
      quotation_name: quotationName || undefined,
      fulfilment_plant: fulfilmentPlant || undefined,
      required_qty: requiredQty || undefined,
      allow_overbook: allowOverbook ? 1 : 0,
    },
  );
}

/** Release SCM plant capacity for a Sales quotation. */
export async function releasePlantCapacityForQuotation(quotationName) {
  return scCall(`${METHOD}.release_plant_capacity_for_quotation`, {
    quotation_name: quotationName || undefined,
  });
}

/** SCM portal: active plant capacity bookings. */
export async function listPlantCapacityBookings(plantCode, limit = 50) {
  return scCallGet(
    `${METHOD}.list_plant_capacity_bookings`,
    { plant_code: plantCode || undefined, limit },
    { silent: true },
  );
}

/** SCM portal: Sales Order reservation detail (Phase D). */
export async function getSalesOrderReservationPlanning(salesOrderName) {
  return scCallGet(
    `${METHOD}.get_sales_order_reservation_planning`,
    { sales_order_name: salesOrderName || undefined },
    { silent: true },
  );
}

/** SCM portal: Sales Orders awaiting SCM stock block (Phase D). */
export async function listSalesOrdersPendingReservation(search, limit = 25) {
  return scCallGet(
    `${METHOD}.list_sales_orders_pending_reservation`,
    { search: search || undefined, limit },
    { silent: true },
  );
}

/** SCM portal: Sales Order dispatch / delivery readiness (Phase E). */
export async function getSalesOrderDispatchPlanning(salesOrderName) {
  return scCallGet(
    `${METHOD}.get_sales_order_dispatch_planning`,
    { sales_order_name: salesOrderName || undefined },
    { silent: true },
  );
}

/** SCM portal: Sales Orders ready for Delivery Note (Phase E). */
export async function listSalesOrdersReadyForDispatch(search, limit = 25) {
  return scCallGet(
    `${METHOD}.list_sales_orders_ready_for_dispatch`,
    { search: search || undefined, limit },
    { silent: true },
  );
}

/** SCM portal: Sales Orders awaiting FG / inventory for dispatch (Phase E). */
export async function listSalesOrdersAwaitingFgReceipt(search, limit = 25) {
  return scCallGet(
    `${METHOD}.list_sales_orders_awaiting_fg_receipt`,
    { search: search || undefined, limit },
    { silent: true },
  );
}
