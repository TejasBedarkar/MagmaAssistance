import { mfgCall as call } from './mfgCall';

const NS = 'manufacturing_operations.api.work_orders';

export const workOrders = {
  list: (filters = {}) => call(`${NS}.list_work_orders`, filters),
  get: (name) => call(`${NS}.get_work_order`, { name }),
  create: (payload) => call(`${NS}.create_work_order`, payload),
  updateStatus: (name, newStatus, reason, options) =>
    call(`${NS}.update_status`, { name, new_status: newStatus, reason }, options),
  getProgress: (name) => call(`${NS}.get_progress`, { name }),
  getSummary: () => call(`${NS}.get_summary`),
  getAllowedTransitions: (name) =>
    call(`${NS}.get_allowed_transitions`, { name }),
  remove: (name) => call(`${NS}.delete_work_order`, { name }),
  acknowledgeReview: (name) => call(`${NS}.acknowledge_supervisor_review`, { name }),
  listComments: (workOrder) => call(`${NS}.list_work_order_comments`, { work_order: workOrder }),
  addComment: (workOrder, commentText) =>
    call(`${NS}.add_work_order_comment`, { work_order: workOrder, comment_text: commentText }),
};
