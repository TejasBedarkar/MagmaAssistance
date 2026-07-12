import { scCall, scCallGet } from "./scCall.js";

const METHOD = "supply_chain_app.api.reservation";

export async function listReservations(params = {}) {
  const data = await scCallGet(`${METHOD}.list_reservations_api`, params, { silent: true });
  return data?.reservations || data?.items || [];
}

export async function getReservationSummary(params = {}) {
  return scCallGet(`${METHOD}.get_reservation_summary_api`, params, { silent: true });
}

export async function reserveForMaterialRequest(materialRequest, warehouse) {
  return scCall(`${METHOD}.reserve_for_material_request_api`, {
    material_request: materialRequest,
    warehouse,
  });
}

export async function releaseReservation(payload) {
  return scCall(`${METHOD}.release_reservation_api`, payload);
}
