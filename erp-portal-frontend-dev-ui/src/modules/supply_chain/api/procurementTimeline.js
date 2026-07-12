import { scCallGet, scCall } from "./scCall.js";

const METHOD = "supply_chain_app.api.integration";

/** Procurement days breakdown for a Sales quotation (SCM-owned). */
export async function getProcurementTimelineForQuotation(quotationName) {
  return scCallGet(
    `${METHOD}.get_procurement_timeline_for_quotation`,
    { quotation_name: quotationName || undefined },
    { silent: true },
  );
}

/** Stores: commit material arrival date on linked Sales quotation. */
export async function setQuotationMaterialArrival({
  quotationName,
  materialArrivalDate,
  materialArrivalWarehouse,
  materialAvailableQty,
  expectedReceiptDate,
}) {
  return scCall(`${METHOD}.set_quotation_material_arrival`, {
    quotation_name: quotationName || undefined,
    material_arrival_date: materialArrivalDate || undefined,
    material_arrival_warehouse: materialArrivalWarehouse || undefined,
    material_available_qty: materialAvailableQty || undefined,
    expected_receipt_date: expectedReceiptDate || undefined,
  });
}
