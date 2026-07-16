import { mfgCall, mfgCallGet } from './mfgCall';

const MFG_NS = 'manufacturing_operations.api.product_requirement';
const SALES_NS = 'sales_app.api.opportunity';

export const productRequirement = {
  listPending: (limit = 50) => mfgCall(`${MFG_NS}.list_pending`, { limit }),
  get: (name) => mfgCallGet(`${SALES_NS}.get_opportunity`, { name }),
  saveReview: (opportunityId, fields) =>
    mfgCall(`${SALES_NS}.save_product_dev_review`, {
      opportunity_id: opportunityId,
      ...fields,
    }),
  approve: (opportunityId) =>
    mfgCall(`${SALES_NS}.approve_product_development`, { opportunity_id: opportunityId }),
  reject: (opportunityId) =>
    mfgCall(`${SALES_NS}.reject_product_development`, { opportunity_id: opportunityId }),
};
