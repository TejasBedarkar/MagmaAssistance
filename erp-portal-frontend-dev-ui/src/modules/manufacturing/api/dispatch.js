import { mfgCall as call } from './mfgCall';

const NS = 'manufacturing_operations.api.dispatch';

export const dispatch = {
  create: (payload) => call(`${NS}.create_dispatch_note`, payload),
  get: (name) => call(`${NS}.get_dispatch_note`, { name }),
  updateLogistics: (name, payload) =>
    call(`${NS}.update_dispatch_logistics`, { name, ...payload }),
  advance: (name, packingChecks) =>
    call(`${NS}.advance_dispatch_status`, { name, packing_checks: packingChecks }),
  getPackingChecklist: () => call(`${NS}.get_packing_checklist`),
  getCreateDefaults: (workOrder) =>
    call(`${NS}.get_dispatch_create_defaults`, { work_order: workOrder }),
  validateQC: (workOrder) =>
    call(`${NS}.validate_qc`, { work_order: workOrder }),
  markDispatched: (name) => call(`${NS}.mark_dispatched`, { name }),
  markDelivered: (name) => call(`${NS}.mark_delivered`, { name }),
  list: (filters = {}) => call(`${NS}.list_dispatch_notes`, filters),
  summary: () => call(`${NS}.get_dispatch_summary`),
  getPending: () => call(`${NS}.get_pending_dispatch`),
  listForWorkOrder: (workOrder) =>
    call(`${NS}.list_dispatch_notes_for_work_order`, { work_order: workOrder }),
  getPickList: (dispatchNote) =>
    call(`${NS}.get_dispatch_pick_list`, { dispatch_note: dispatchNote }),
};
