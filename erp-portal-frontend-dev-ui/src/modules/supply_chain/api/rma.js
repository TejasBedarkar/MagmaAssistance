import { scCall, scCallGet } from "./scCall.js";

const METHOD = "supply_chain_app.api.rma";

function itemsJson(items) {
  return JSON.stringify(items || []);
}

export async function listReturnRequests(params = {}) {
  const data = await scCallGet(`${METHOD}.list_return_requests`, params, { silent: true });
  return data?.return_requests || [];
}

export async function getReturnRequest(rmaId) {
  return scCallGet(`${METHOD}.get_return_request`, { rma_id: rmaId }, { silent: true });
}

export async function createReturnRequest(payload = {}) {
  return scCall(`${METHOD}.create_return_request`, {
    ...payload,
    items: itemsJson(payload.items),
  });
}

export async function inspectReturn(rmaId, payload = {}) {
  return scCall(`${METHOD}.inspect_return`, {
    rma_id: rmaId,
    ...payload,
  });
}

export async function receiveReturnToWarehouse(rmaId, warehouse, submitStockEntry = 1) {
  return scCall(`${METHOD}.receive_return_to_warehouse`, {
    rma_id: rmaId,
    warehouse,
    submit_stock_entry: submitStockEntry,
  });
}

export async function processRmaRepair(rmaId, repairNotes) {
  return scCall(`${METHOD}.process_rma_repair`, {
    rma_id: rmaId,
    repair_notes: repairNotes,
  });
}

export async function completeRma(rmaId, warehouse) {
  return scCall(`${METHOD}.complete_rma`, {
    rma_id: rmaId,
    warehouse,
  });
}

export async function processRmaReplacement(rmaId, replacementSoId) {
  return scCall(`${METHOD}.process_rma_replacement`, {
    rma_id: rmaId,
    replacement_so_id: replacementSoId,
  });
}

export async function issueCreditNote(rmaId, amount, remarks) {
  return scCall(`${METHOD}.issue_credit_note`, {
    rma_id: rmaId,
    amount,
    remarks,
  });
}
