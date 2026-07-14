import { scCall, scCallGet } from "./scCall.js";

const METHOD = "supply_chain_app.api.material_request";

export async function listMaterialRequests(params = {}) {
  const data = await scCallGet(`${METHOD}.list_material_requests`, params, { silent: true });
  return data?.material_requests || [];
}

export async function getMaterialRequest(name) {
  return scCallGet(`${METHOD}.get_material_request`, { name }, { silent: true });
}

export async function createMaterialRequest(payload) {
  return scCall(`${METHOD}.create_material_request`, payload);
}

export async function submitMaterialRequest(name) {
  return scCall(`${METHOD}.submit_material_request`, { name });
}

export async function cancelMaterialRequest(name) {
  return scCall(`${METHOD}.cancel_material_request`, { name });
}
