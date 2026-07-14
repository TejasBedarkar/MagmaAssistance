import { scCall, scCallGet } from "./scCall.js";

const METHOD = "supply_chain_app.api.suppliers";

export async function listSuppliers(params = {}) {
  const data = await scCallGet(`${METHOD}.list_suppliers`, params, { silent: true });
  return data?.suppliers || [];
}

export async function getSupplier(name) {
  return scCallGet(`${METHOD}.get_supplier`, { name }, { silent: true });
}

export async function createSupplier(payload) {
  return scCall(`${METHOD}.create_supplier`, payload);
}

export async function recommendVendorsForMaterialRequest(materialRequest, limit = 5) {
  return scCallGet(
    `${METHOD}.recommend_vendors_for_material_request`,
    { material_request: materialRequest, limit },
    { silent: true },
  );
}
