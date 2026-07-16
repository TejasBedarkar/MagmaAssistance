import { mfgCall as call } from './mfgCall';

const NS = 'manufacturing_operations.api.reports';

export const reports = {
  closure: (workOrder) => call(`${NS}.closure_report`, { work_order: workOrder }),
  production: (from, to) =>
    call(`${NS}.production_summary`, { from_date: from, to_date: to }),
  qc: (from, to) => call(`${NS}.qc_report`, { from_date: from, to_date: to }),
  delivery: (from, to) =>
    call(`${NS}.delivery_performance`, { from_date: from, to_date: to }),
  maintenance: (from, to) =>
    call(`${NS}.maintenance_report`, { from_date: from, to_date: to }),
};
