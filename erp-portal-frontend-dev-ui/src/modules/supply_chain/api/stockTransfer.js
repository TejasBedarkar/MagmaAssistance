import { scCall, scCallGet } from "./scCall.js";

const METHOD = "supply_chain_app.api.stock_transfer";

export async function listStockTransfers(params = {}) {
  const data = await scCallGet(`${METHOD}.list_stock_transfers`, params, { silent: true });
  return data?.stock_transfers || [];
}

export async function getStockTransfer(name) {
  return scCallGet(`${METHOD}.get_stock_transfer`, { name }, { silent: true });
}

export async function getStockTransferFormOptions() {
  return scCallGet(`${METHOD}.get_stock_transfer_form_options`, {}, { silent: true });
}

export async function createStockTransfer(payload) {
  return scCall(`${METHOD}.create_stock_transfer`, {
    ...payload,
    items: JSON.stringify(payload.items || []),
    validate_stock: payload.validate_stock ?? 1,
  });
}

export async function submitStockTransfer(name) {
  return scCall(`${METHOD}.submit_stock_transfer`, { name });
}

export async function checkStockTransferAvailability(fromWarehouse, items) {
  return scCallGet(`${METHOD}.check_stock_transfer_availability`, {
    from_warehouse: fromWarehouse,
    items: JSON.stringify(items || []),
  }, { silent: true });
}

export async function cancelStockTransfer(name) {
  return scCall(`${METHOD}.cancel_stock_transfer`, { name });
}
