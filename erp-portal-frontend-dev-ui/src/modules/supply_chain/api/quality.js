import { scCall, scCallGet } from "./scCall.js";

const METHOD = "supply_chain_app.api.quality";

export async function getQcChecklistForItem(itemCode) {
  return scCallGet(`${METHOD}.get_qc_checklist_for_item`, { item_code: itemCode }, { silent: true });
}

export async function defineInspectionParameters(itemCode, parameters) {
  return scCall(`${METHOD}.define_inspection_parameters`, {
    item_code: itemCode,
    parameters: JSON.stringify(parameters),
  });
}

export async function recordGrnInspection(grnId, payload) {
  return scCall(`${METHOD}.record_grn_inspection`, {
    grn_id: grnId,
    items: JSON.stringify(payload.items || []),
    inspection_date: payload.inspection_date,
    inspected_by: payload.inspected_by,
  });
}

export async function updateInspectionStatus(grnId, inspectionStatus) {
  return scCall(`${METHOD}.update_inspection_status`, {
    grn_id: grnId,
    inspection_status: inspectionStatus,
  });
}

export async function putawayGrn(grnId, strategy = "FIFO") {
  return scCall(`${METHOD}.putaway_grn`, { grn_id: grnId, strategy });
}

export async function createCapa(payload) {
  return scCall(`${METHOD}.create_capa`, {
    ...payload,
    corrective_actions: JSON.stringify(payload.corrective_actions || []),
    preventive_actions: JSON.stringify(payload.preventive_actions || []),
  });
}
