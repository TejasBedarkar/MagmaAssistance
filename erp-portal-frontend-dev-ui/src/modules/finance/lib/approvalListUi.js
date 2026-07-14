import { APPROVAL_STATUS } from './approvalStatus.js';

function ownerIdentity(user) {
  if (!user) return '';
  if (typeof user === 'string') return user.trim();
  return (user.email || user.name || '').trim();
}

export function canShowResubmit(row, user) {
  if (!row || !user) return false;
  if (Number(row.docstatus) !== 0) return false;

  const status = row.portal_approval_status || '';
  if (
    status !== APPROVAL_STATUS.SENT_BACK &&
    status !== APPROVAL_STATUS.REJECTED
  ) {
    return false;
  }

  const owner = (row.owner || '').trim();
  const identity = ownerIdentity(user);
  return owner && identity && owner === identity;
}

export function approvalRowNote(row) {
  const reason = (row.rejection_reason || '').trim();
  if (!reason) return '';

  const status = row.portal_approval_status || '';
  if (status === APPROVAL_STATUS.SENT_BACK) {
    return `Sent back: ${reason}`;
  }
  if (status === APPROVAL_STATUS.REJECTED) {
    return `Rejected: ${reason}`;
  }
  return reason;
}
