import { mfgCall as call } from './mfgCall';

const NS = 'manufacturing_operations.api.notifications';

export const notifications = {
  list: (limit = 20) => call(`${NS}.get_my_notifications`, { limit }, { silent: true }),
  markRead: (name) => call(`${NS}.mark_read`, { name }),
  markAllRead: () => call(`${NS}.mark_all_read`),
};
