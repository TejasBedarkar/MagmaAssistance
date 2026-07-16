import { mfgCall as call } from './mfgCall';

const NS = 'manufacturing_operations.api.workstations';

export const workstations = {
  list: (filters = {}) => call(`${NS}.list_workstations`, filters),
  create: (payload) => call(`${NS}.create_workstation`, payload),
  update: (name, payload) => call(`${NS}.update_workstation`, { name, ...payload }),
  setActive: (name, isActive) => call(`${NS}.set_workstation_active`, { name, is_active: isActive ? 1 : 0 }),
  remove: (name) => call(`${NS}.delete_workstation`, { name }),
  utilization: (targetDate) => call(`${NS}.workstation_utilization`, { target_date: targetDate }),
  metrics: (name) => call(`${NS}.get_workstation_metrics`, { name }),
  suggestAlternative: (workstation) => call(`${NS}.suggest_alternative`, { workstation }),
};
