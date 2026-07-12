import { scCall, scCallGet } from "./scCall.js";

const METHOD = "supply_chain_app.api.mrp";

function itemsJson(items) {
  return JSON.stringify(items || []);
}

export async function explodeDemand(items, maxDepth = 5) {
  return scCallGet(`${METHOD}.explode_demand_api`, {
    items: itemsJson(items),
    max_depth: maxDepth,
  }, { silent: true });
}

export async function computeShortages(items, maxDepth = 5) {
  return scCallGet(`${METHOD}.compute_shortages_api`, {
    items: itemsJson(items),
    max_depth: maxDepth,
  }, { silent: true });
}

export async function suggestMaterialRequest(items, maxDepth = 5) {
  return scCallGet(`${METHOD}.suggest_material_request_api`, {
    items: itemsJson(items),
    max_depth: maxDepth,
  }, { silent: true });
}

export async function createMaterialRequestFromDemand(payload = {}) {
  return scCall(`${METHOD}.create_material_request_from_demand`, {
    ...payload,
    items: itemsJson(payload.items),
  });
}

export async function suggestPoFromMaterialRequest(materialRequest) {
  return scCallGet(`${METHOD}.suggest_po_from_material_request`, {
    material_request: materialRequest,
  }, { silent: true });
}
