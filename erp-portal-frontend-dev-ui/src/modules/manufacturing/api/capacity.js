import { mfgCall as call } from './mfgCall';

const NS = 'manufacturing_operations.api.capacity';

export const capacity = {
  createPlan: (payload, options) => call(`${NS}.create_capacity_plan`, payload, options),
  createDefaultWorkstation: (payload = {}) =>
    call(`${NS}.create_default_workstation`, payload),
  checkConflicts: (workstation, start, end, exclude) =>
    call(`${NS}.check_conflicts`, {
      workstation,
      start_datetime: start,
      end_datetime: end,
      exclude,
    }),
  checkCapacityForQuotation: (payload) =>
    call(`${NS}.check_capacity_for_quotation`, payload),
  getAvailability: (date) =>
    call(`${NS}.get_workstation_availability`, { date }),
  list: (filters = {}) => call(`${NS}.list_capacity_plans`, filters),
  approve: (name) => call(`${NS}.approve_capacity_plan`, { name }),
  suggestNextSlot: (payload, options) =>
    call(`${NS}.suggest_next_available_slot`, payload, options),
};
