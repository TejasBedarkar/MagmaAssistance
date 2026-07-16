import { mfgCall as call } from './mfgCall';

const NS = 'manufacturing_operations.api.dashboard';

export const dashboard = {
  getMyDashboard: () => call(`${NS}.get_my_dashboard`),
  productionHead: () => call(`${NS}.production_head_kpi`),
  supervisor: () => call(`${NS}.supervisor_view`),
  operator: () => call(`${NS}.operator_jobs`),
  qc: () => call(`${NS}.qc_pending`),
  storeKeeper: () => call(`${NS}.store_keeper_alerts`),
  dispatch: () => call(`${NS}.dispatch_pending`),
  getLookups: () => call(`${NS}.get_lookup_data`),
};
