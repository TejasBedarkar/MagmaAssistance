import { mfgCall as call } from './mfgCall';

const NS = 'manufacturing_operations.api.quality';

export const quality = {
  createInspection: (payload) => call(`${NS}.create_inspection`, payload),
  loadTemplate: (name, template) =>
    call(`${NS}.load_template`, { name, template }),
  submitResult: (name, params, overallResult, remarks) =>
    call(`${NS}.submit_result`, {
      name,
      params: JSON.stringify(params),
      overall_result: overallResult,
      remarks,
    }),
  deleteInspection: (name, reason) => call(`${NS}.delete_inspection`, { name, reason }),
  getInspectionDetails: (name) => call(`${NS}.get_inspection_details`, { name }),
  listPending: () => call(`${NS}.list_pending_inspections`),
  listFailed: () => call(`${NS}.list_failed_inspections`),
  listRework: (status) => call(`${NS}.list_rework_logs`, { status }),
  completeRework: (name, reworkQty, remarks) =>
    call(`${NS}.complete_rework`, {
      name,
      rework_qty: reworkQty,
      remarks,
    }),
  getTemplates: (qcStage) =>
    call(`${NS}.get_qc_templates`, { qc_stage: qcStage }),
  listTemplates: () => call(`${NS}.list_qc_templates`),
  getTemplateDetails: (name) => call(`${NS}.get_qc_template_details`, { name }),
  createTemplate: (payload) => call(`${NS}.create_qc_template`, payload),
  updateTemplate: (name, payload) => call(`${NS}.update_qc_template`, { name, ...payload }),
  duplicateTemplate: (name, newTemplateName) =>
    call(`${NS}.duplicate_qc_template`, { name, new_template_name: newTemplateName }),
  createTemplateVersion: (name) => call(`${NS}.create_qc_template_version`, { name }),
  deleteTemplate: (name) => call(`${NS}.delete_qc_template`, { name }),
  suggestTemplate: (workOrder, stage) =>
    call(`${NS}.suggest_template`, { work_order: workOrder, stage }),
  generateTemplateDraft: (workOrder, stage) =>
    call(`${NS}.generate_template_draft`, { work_order: workOrder, stage }),
};
