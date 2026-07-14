import { mfgCall } from './mfgCall';

const NS = 'manufacturing_operations.api.capacity_commitment';

export const capacityCommitment = {
  list: (limit = 50) =>
    mfgCall(`${NS}.list_quotations_awaiting_production_commit`, { limit }),
  getDetail: (name) =>
    mfgCall(`${NS}.get_quotation_capacity_commitment_detail`, { name }),
  commit: (payload) =>
    mfgCall(`${NS}.commit_quotation_production_capacity`, payload),
};
