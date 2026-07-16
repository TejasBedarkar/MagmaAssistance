import { scCallGet } from "./scCall.js";

const METHOD = "supply_chain_app.api.warehouses";

export async function listWarehouses(params = {}) {
  const data = await scCallGet(`${METHOD}.list_warehouses`, params, { silent: true });
  return data?.warehouses || [];
}

export async function getWarehouse(name) {
  return scCallGet(`${METHOD}.get_warehouse`, { name }, { silent: true });
}

export async function getBinDetails(warehouseId, itemCode) {
  return scCallGet(
    `${METHOD}.get_bin_details`,
    { warehouse_id: warehouseId, item_code: itemCode || undefined },
    { silent: true },
  );
}

export async function listWarehouseLocations(warehouseId, limit = 100) {
  const data = await scCallGet(
    `${METHOD}.list_warehouse_locations`,
    { warehouse_id: warehouseId, limit },
    { silent: true },
  );
  return data?.locations || [];
}

export async function allocateBinsForPutaway(warehouseId, itemCode, qty, strategy = "FIFO") {
  return scCall(`${METHOD}.allocate_bins_for_putaway`, {
    warehouse_id: warehouseId,
    item_code: itemCode,
    qty,
    strategy,
  });
}
