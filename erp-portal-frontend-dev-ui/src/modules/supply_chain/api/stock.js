import { scCallGet } from "./scCall.js";

const METHOD = "supply_chain_app.api.stock";

export async function listStock(params = {}) {
  const data = await scCallGet(`${METHOD}.list_stock`, params, { silent: true });
  return data?.stock || [];
}

export async function getItemStock(itemCode, params = {}) {
  return scCallGet(
    `${METHOD}.get_item_stock`,
    { item_code: itemCode, ...params },
    { silent: true },
  );
}

export async function getItemsStockBatch(itemCodes) {
  const data = await scCallGet(
    `${METHOD}.get_items_stock_batch`,
    { item_codes: JSON.stringify(itemCodes) },
    { silent: true },
  );
  return data?.items || {};
}
