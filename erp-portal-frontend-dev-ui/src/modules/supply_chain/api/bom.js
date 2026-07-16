import { scCall, scCallGet } from "./scCall.js";

const METHOD = "supply_chain_app.api.bom";

export async function listBoms(params = {}) {
  const data = await scCallGet(`${METHOD}.list_boms`, params, { silent: true });
  return data?.boms || [];
}

export async function getBom(name) {
  return scCallGet(`${METHOD}.get_bom`, { bom_name: name }, { silent: true });
}

export async function explodeBomForItem(itemCode, qty = 1) {
  return scCallGet(
    `${METHOD}.explode_bom_for_item`,
    { item_code: itemCode, qty },
    { silent: true },
  );
}

export async function createBom(payload) {
  return scCall(`${METHOD}.create_bom`, payload);
}

export async function updateBom(bomName, payload) {
  return scCall(`${METHOD}.update_bom`, { bom_name: bomName, ...payload });
}
