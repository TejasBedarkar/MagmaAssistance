import { scCall, scCallGet } from "./scCall.js";

const METHOD = "supply_chain_app.api.grn";

export async function listGrns(params = {}) {
  const data = await scCallGet(`${METHOD}.list_grns`, params, { silent: true });
  return data?.grns || [];
}

export async function getGrn(name) {
  return scCallGet(`${METHOD}.get_grn`, { name }, { silent: true });
}

export async function createGrnFromPurchaseOrder(purchaseOrder) {
  return scCall(`${METHOD}.create_grn_from_purchase_order`, { purchase_order: purchaseOrder });
}

export async function updateInspectionStatus(name, inspectionStatus, rejectWarehouse) {
  return scCall(`${METHOD}.update_inspection_status`, {
    name,
    inspection_status: inspectionStatus,
    reject_warehouse: rejectWarehouse,
  });
}

export async function updateGrnReceipt(name, payload) {
  return scCall(`${METHOD}.update_grn_receipt`, {
    name,
    ...payload,
    lines: payload.lines ? JSON.stringify(payload.lines) : undefined,
  });
}

export async function processRejectedMaterial(name, rejectWarehouse) {
  return scCall(`${METHOD}.process_rejected_material`, {
    name,
    reject_warehouse: rejectWarehouse,
  });
}

export { recordGrnInspection, putawayGrn } from "./quality.js";
