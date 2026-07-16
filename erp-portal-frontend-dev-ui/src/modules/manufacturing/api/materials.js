import { mfgCall as call } from './mfgCall';

const NS = 'manufacturing_operations.api.materials';

export const materials = {
  create: (payload) => call(`${NS}.create_material_check`, payload),
  getPrefill: (work_order) => call(`${NS}.get_material_check_prefill`, { work_order }),
  get: ({ name, work_order } = {}) =>
    call(`${NS}.get_material_check`, { name, work_order }),
  checkBOM: (name) => call(`${NS}.check_bom_availability`, { name }),
  shortageReport: () => call(`${NS}.get_shortage_report`),
  markReceived: (name, itemsReceived) =>
    call(`${NS}.mark_received`, { name, items_received: itemsReceived }),
  request: (name, remarks) =>
    call(`${NS}.request_materials`, { name, remarks }),
  list: (filters = {}) => call(`${NS}.list_material_checks`, filters),
};
