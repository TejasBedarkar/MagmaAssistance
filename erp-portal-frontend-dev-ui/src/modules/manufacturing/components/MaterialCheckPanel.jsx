import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Package } from '@/icons/mfgIcons.js';
import toast from 'react-hot-toast';
import { materials } from '@/api';
import { useAuth, ROLES } from '@/hooks/manufacturingAuth';
import { PageLoader } from '@/components/MfgPageLoader';
import { StatusBadge } from '@/components/StatusBadge';
import { MfgButton } from '@/components/MfgPageLayout.jsx';
import { fmtDateTime } from '@/utils/format';

export default function MaterialCheckPanel({
  materialCheckName,
  workOrder,
  onUpdated,
  compact = false,
  embedded = false,
  compactHeader = false,
}) {
  const { hasRole } = useAuth();
  const canVerify = hasRole(ROLES.PRODUCTION_HEAD);
  const isStoreKeeper = hasRole(ROLES.STORE_KEEPER);
  const [mc, setMc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(async () => {
    if (!materialCheckName && !workOrder) {
      setMc(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await materials.get({
        name: materialCheckName,
        work_order: workOrder,
      });
      setMc(data);
    } catch {
      setMc(null);
    } finally {
      setLoading(false);
    }
  }, [materialCheckName, workOrder]);

  useEffect(() => {
    load();
  }, [load]);

  const verify = async () => {
    if (!mc?.name) return;
    setVerifying(true);
    try {
      const result = await materials.checkBOM(mc.name);
      if (result.has_shortage) {
        toast.error('Shortage detected — some items are insufficient');
      } else {
        toast.success('All materials verified and available');
      }
      await load();
      onUpdated?.();
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    if (compact || embedded) {
      return <p className="mfg-mc-loading">Loading material check…</p>;
    }
    return <PageLoader label="Loading material check…" />;
  }
  if (!mc) return null;

  const canRunVerify = canVerify && ['Pending', 'Shortage'].includes(mc.status);

  const content = (
    <div className={embedded ? 'mfg-mc-panel' : undefined}>
      <div className={`mfg-mc-panel__head${embedded ? ' mfg-mc-panel__head--modal' : ''}${compactHeader ? ' mfg-mc-panel__head--detail' : ''}`}>
        <div className="mfg-mc-panel__meta">
          <p className="mfg-mc-panel__label">Material Check</p>
          <div className="mfg-mc-panel__id-row">
            <p className="mfg-mc-panel__id">{mc.name}</p>
            {!compactHeader && !embedded && <StatusBadge status={mc.status} />}
            {embedded && <StatusBadge status={mc.status} />}
          </div>
          {mc.submitted_by && (
            <p className="mfg-mc-panel__sub">Submitted by {mc.submitted_by}</p>
          )}
          {mc.checked_by && (
            <p className="mfg-mc-panel__sub">
              Verified by {mc.checked_by}
              {mc.checked_date ? ` · ${fmtDateTime(mc.checked_date)}` : ''}
            </p>
          )}
        </div>
        <div className="mfg-mc-panel__aside">
          {compactHeader && <StatusBadge status={mc.status} />}
          {canRunVerify && (
            <MfgButton size="sm" onClick={verify} disabled={verifying}>
              <CheckCircle2 size={16} />
              {verifying ? 'Verifying…' : mc.status === 'Shortage' ? 'Re-verify BOM' : 'Verify BOM'}
            </MfgButton>
          )}
        </div>
      </div>

      {mc.items?.length === 0 ? (
        <p className="mfg-mc-empty">
          <Package size={16} aria-hidden /> No items added yet
        </p>
      ) : (
        <div className="mfg-mc-table-wrap">
          <table className="mfg-mc-table">
            <thead>
              <tr>
                <th className="mfg-mc-table__item">Item Code</th>
                <th className="mfg-mc-table__num">Required</th>
                <th className="mfg-mc-table__num">Available</th>
                <th className="mfg-mc-table__num">Shortage</th>
                <th className="mfg-mc-table__status">Line Status</th>
              </tr>
            </thead>
            <tbody>
              {mc.items.map((item) => (
                <tr key={item.item_code}>
                  <td className="mfg-mc-table__item">{item.item_code}</td>
                  <td className="mfg-mc-table__num">{item.required_qty}</td>
                  <td className="mfg-mc-table__num">{item.available_qty}</td>
                  <td className={`mfg-mc-table__num ${item.shortage_qty > 0 ? 'mfg-mc-table__short' : ''}`}>
                    {item.shortage_qty > 0 ? item.shortage_qty : '—'}
                  </td>
                  <td className="mfg-mc-table__status">
                    <StatusBadge status={item.status || (item.shortage_qty > 0 ? 'Short' : 'Available')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mc.status === 'Pending' && isStoreKeeper && (
        <p className="mfg-mc-notice mfg-mc-notice--info">
          Items submitted — awaiting Production Head verification.
        </p>
      )}
      {mc.status === 'Pending' && canVerify && (
        <p className="mfg-mc-notice mfg-mc-notice--info">
          Review store quantities below, then click Verify BOM to approve or flag shortages.
        </p>
      )}
      {mc.status === 'Ready' && (
        <p className="mfg-mc-notice mfg-mc-notice--success">
          All BOM items verified — Production Head can move the work order to Material Pending.
        </p>
      )}
      {mc.status === 'Shortage' && (
        <p className="mfg-mc-notice mfg-mc-notice--warn">
          Shortage detected. Update stock in Frappe Desk or adjust available qty, then re-verify.
        </p>
      )}
    </div>
  );

  if (embedded) return content;

  return <div className="card p-5">{content}</div>;
}
