import { mfgCall as call } from './mfgCall';

const NS = 'manufacturing_operations.api.closure';

export const closure = {
  uploadPod: (payload) => call(`${NS}.upload_pod`, payload),
  getPodContext: (workOrder) => call(`${NS}.get_pod_context`, { work_order: workOrder }),
  closeWorkOrder: (name, closureRemarks) =>
    call(`${NS}.close_work_order`, {
      name,
      closure_remarks: closureRemarks,
    }),
  getReport: (workOrder) =>
    call(`${NS}.get_closure_report`, { work_order: workOrder }),
  listPods: (deliveryStatus) =>
    call(`${NS}.list_pods`, { delivery_status: deliveryStatus }),
};
