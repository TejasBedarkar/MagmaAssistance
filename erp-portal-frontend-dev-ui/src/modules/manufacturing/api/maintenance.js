import { mfgCall as call, mfgCallGet as callGet } from './mfgCall';

const NS = 'manufacturing_operations.api.maintenance';

export const maintenance = {
  reportBreakdown: (p) => call(`${NS}.report_breakdown`, p),
  assign: (name, technician) => call(`${NS}.assign_ticket`, { name, technician }),
  startRepair: (name) => call(`${NS}.start_repair`, { name }),
  resolve: (name, resolution_notes) => call(`${NS}.resolve_ticket`, { name, resolution_notes }),
  close: (name, resolution_notes, extra = {}) =>
    call(`${NS}.close_ticket`, { name, resolution_notes, ...extra }),
  reopen: (name, note) => call(`${NS}.reopen_ticket`, { name, note }),
  delete: (name) => call(`${NS}.delete_ticket`, { name }),
  markFunctional: (name) => call(`${NS}.mark_machine_functional`, { name }),
  list: (filters = {}) => callGet(`${NS}.list_tickets`, filters),
  get: (name) => callGet(`${NS}.get_ticket`, { name }),
  summary: () => callGet(`${NS}.maintenance_summary`),
  listSchedules: (workstation) => callGet(`${NS}.list_schedules`, { workstation }),
  createSchedule: (p) => call(`${NS}.create_schedule`, p),
  updateSchedule: (name, p) => call(`${NS}.update_schedule`, { name, ...p }),
  deleteSchedule: (name) => call(`${NS}.delete_schedule`, { name }),
  addSpare: (ticket, item_code, required_qty, warehouse) =>
    call(`${NS}.add_spare_to_ticket`, { ticket, item_code, required_qty, warehouse }),
  issueSpares: (ticket) => call(`${NS}.issue_spares_for_ticket`, { ticket }),
  createPrForSpare: (ticket, item_code) =>
    call(`${NS}.create_pr_for_spare`, { ticket, item_code }),
  updateLabor: (ticket, labor_hours, labor_rate) =>
    call(`${NS}.update_ticket_labor`, { ticket, labor_hours, labor_rate }),
  getAddSpareOptions: (ticket) =>
    callGet(`${NS}.get_add_spare_options`, ticket ? { ticket } : {}),
  getSpareStockHint: (item_code, warehouse, qty) =>
    callGet(`${NS}.get_spare_stock_hint`, { item_code, warehouse, qty }),
};
