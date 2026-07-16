import { scCall, scCallGet } from "./scCall.js";

const METHOD = "supply_chain_app.api.products";

export async function listProducts(params = {}) {
  const data = await scCallGet(`${METHOD}.get_list`, params, { silent: true });
  return (data?.items || []).map((row) => ({
    ...row,
    item_type: row.item_type || row.custom_item_type || "",
  }));
}

export async function getProduct(itemCode) {
  return scCallGet(`${METHOD}.get`, { item_code: itemCode }, { silent: true });
}

export async function createProduct(payload) {
  return scCall(`${METHOD}.create`, payload);
}

export async function updateProduct(itemCode, payload) {
  return scCall(`${METHOD}.update`, { item_code: itemCode, ...payload });
}

export async function disableProduct(itemCode, reason) {
  return scCall(`${METHOD}.disable`, { item_code: itemCode, reason });
}
