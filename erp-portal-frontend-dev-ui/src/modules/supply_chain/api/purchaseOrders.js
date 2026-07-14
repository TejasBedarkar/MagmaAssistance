import { scCall, scCallGet } from "./scCall.js";

const METHOD = "supply_chain_app.api.purchase_order";

export async function listPurchaseOrders(params = {}) {
  const data = await scCallGet(`${METHOD}.list_purchase_orders`, params, { silent: true });
  return data?.purchase_orders || [];
}

export async function getPurchaseOrder(name) {
  return scCallGet(`${METHOD}.get_purchase_order`, { name }, { silent: true });
}

export async function getPurchaseOrderFormOptions() {
  return scCallGet(`${METHOD}.get_purchase_order_form_options`, {}, { silent: true });
}

export async function createPurchaseOrder(payload) {
  const body = { ...payload };
  if (body.items != null && typeof body.items !== "string") {
    body.items = JSON.stringify(body.items);
  }
  return scCall(`${METHOD}.create_purchase_order`, body);
}

export async function submitPurchaseOrder(name) {
  return scCall(`${METHOD}.submit_purchase_order`, { name });
}

export async function createPurchaseOrderFromMaterialRequest(payload) {
  return scCall(`${METHOD}.create_purchase_order_from_material_request`, payload);
}
