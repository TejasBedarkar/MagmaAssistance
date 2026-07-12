import { mfgCall as call } from './mfgCall';

const NS = 'manufacturing_operations.api.production';

export const production = {
  // Schedules
  createSchedule: (payload) => call(`${NS}.create_schedule`, payload),
  listSchedules: (filters = {}) => call(`${NS}.list_schedules`, filters),

  // Job Cards
  createJobCard: (payload) => call(`${NS}.create_job_card`, payload),
  startJob: (name) => call(`${NS}.start_job`, { name }),
  pauseJob: (name, reason) => call(`${NS}.pause_job`, { name, reason }),
  resumeJob: (name) => call(`${NS}.resume_job`, { name }),
  updateJobQty: (name, actualQty, scrapQty = 0) =>
    call(`${NS}.update_job_qty`, {
      name,
      actual_qty: actualQty,
      scrap_qty: scrapQty,
    }),
  completeJob: (name, actualQty, scrapQty = 0, remarks, materials) =>
    call(`${NS}.complete_job`, {
      name,
      actual_qty: actualQty,
      scrap_qty: scrapQty,
      remarks,
      materials,
    }),
  getPlannedMaterials: (jobCard) =>
    call(`${NS}.get_planned_materials`, { job_card: jobCard }, { silent: true }),
  recordConsumption: (jobCard, materials) =>
    call(`${NS}.record_consumption`, { job_card: jobCard, materials }),
  returnUnused: (jobCard, itemCode, qty) =>
    call(`${NS}.return_unused`, {
      job_card: jobCard,
      item_code: itemCode,
      qty,
    }),
  reassignJob: (name, newWorkstation, newOperator, reason) =>
    call(`${NS}.reassign_job`, {
      name,
      new_workstation: newWorkstation,
      new_operator: newOperator,
      reason,
    }),
  listMyJobs: (status) => call(`${NS}.list_my_jobs`, { status }),
  listTeamJobs: (status) => call(`${NS}.list_team_jobs`, { status }),
  getJobCard: (name) => call(`${NS}.get_job_card`, { name }),
  listPendingExcess: () => call(`${NS}.list_pending_excess_approvals`),
  getExcessDetail: (jobCard) =>
    call(`${NS}.get_excess_approval_detail`, { job_card: jobCard }),
  approveExcess: (jobCard, payload) =>
    call(`${NS}.approve_excess_consumption`, { job_card: jobCard, ...payload }),
  rejectExcess: (jobCard, reason) =>
    call(`${NS}.reject_excess_consumption`, {
      job_card: jobCard,
      capa_rejection_reason: reason,
    }),
};
