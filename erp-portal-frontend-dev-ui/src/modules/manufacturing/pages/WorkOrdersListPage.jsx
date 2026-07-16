import { useEffect, useMemo, useState } from 'react';
import { Plus, ClipboardList } from '@/icons/mfgIcons.js';
import { workOrders } from '@/api';
import { PageLoader } from '@/components/MfgPageLoader';
import { EmptyState } from '@/components/MfgEmptyState';
import { StatusBadge, PriorityBadge } from '@/components/StatusBadge';
import { fmtDate, fmtPct, fmtCurrency } from '@/utils/format';
import { ROLES, RoleGate, useAuth } from '@/hooks/manufacturingAuth';
import usePagedRows from '../../../common/hooks/usePagedRows.js';
import {
  MfgLinkButton,
  MfgListPagination,
  MfgPage,
  MfgPageHeader,
  MfgRowLink,
  MfgSearchField,
  MfgTableCard,
  MfgTd,
  MfgTh,
  MfgTableHead,
  MfgToolbar,
} from '@/components/MfgPageLayout.jsx';
import { mfgPath } from '../paths.js';

const PAGE_SIZE = 25;

const ALL_STATUSES = [
  '', 'Received', 'Under Review', 'Material Pending', 'Scheduled', 'In Production',
  'QC Pending', 'Ready for Dispatch', 'Dispatched', 'Delivered', 'Closed',
];

const QC_STATUSES = ['', 'QC Pending', 'Ready for Dispatch'];

export default function WorkOrdersListPage() {
  const { role } = useAuth();
  const isQcInspector = role === ROLES.QC_INSPECTOR;
  const statuses = isQcInspector ? QC_STATUSES : ALL_STATUSES;

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    setLoading(true);
    const filters = {};
    if (statusFilter) filters.status = statusFilter;
    workOrders.list(filters)
      .then(setList)
      .finally(() => setLoading(false));
  }, [statusFilter]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((w) =>
      [w.name, w.customer, w.item_code].some((f) =>
        (f || '').toLowerCase().includes(needle)
      )
    );
  }, [list, q]);

  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(filtered, PAGE_SIZE);

  function onSearchChange(e) {
    setQ(e.target.value);
    resetPage();
  }

  function onStatusChange(e) {
    setStatusFilter(e.target.value);
    resetPage();
  }

  return (
    <MfgPage>
      <MfgPageHeader
        title="Work Orders"
        subtitle={
          isQcInspector
            ? `${filtered.length} QC order${filtered.length === 1 ? '' : 's'} awaiting inspection`
            : `${filtered.length} of ${list.length} orders`
        }
        actions={(
          <RoleGate allow={[ROLES.PRODUCTION_HEAD]}>
            <MfgLinkButton to={mfgPath('/work-orders/new')}>
              <Plus size={16} /> New Work Order
            </MfgLinkButton>
          </RoleGate>
        )}
      />

      <MfgToolbar className="mfg-toolbar--list">
        <MfgSearchField
          value={q}
          onChange={onSearchChange}
          placeholder="Search by ID, customer, item…"
        />
        <select
          value={statusFilter}
          onChange={onStatusChange}
          className="input mfg-toolbar__select"
          aria-label="Filter by status"
        >
          {statuses.map((s) => (
            <option key={s} value={s}>{s || (isQcInspector ? 'All QC orders' : 'All Statuses')}</option>
          ))}
        </select>
      </MfgToolbar>

      <MfgTableCard>
        {loading ? (
          <PageLoader />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No work orders"
            description={
              q || statusFilter
                ? 'Try adjusting your filters.'
                : isQcInspector
                  ? 'No work orders are waiting for QC right now.'
                  : 'No orders yet.'
            }
          />
        ) : (
          <>
            <table>
              <MfgTableHead>
                <MfgTh>Work Order</MfgTh>
                <MfgTh>Customer</MfgTh>
                <MfgTh>Item</MfgTh>
                <MfgTh>Qty</MfgTh>
                <MfgTh>Priority</MfgTh>
                <MfgTh>Due</MfgTh>
                <MfgTh>Sales Order</MfgTh>
                <MfgTh>Total Amount</MfgTh>
                <MfgTh>Progress</MfgTh>
                <MfgTh>Status</MfgTh>
              </MfgTableHead>
              <tbody>
                {pageRows.map((w) => (
                  <tr key={w.name}>
                    <MfgTd>
                      <MfgRowLink to={mfgPath(`/work-orders/${w.name}`)} mono>
                        {w.name}
                      </MfgRowLink>
                    </MfgTd>
                    <MfgTd>{w.customer}</MfgTd>
                    <MfgTd>{w.item_code}</MfgTd>
                    <MfgTd>{w.qty}</MfgTd>
                    <MfgTd><PriorityBadge priority={w.priority} /></MfgTd>
                    <MfgTd>{fmtDate(w.expected_delivery_date)}</MfgTd>
                    <MfgTd className="mfg-td-mono">
                      {w.sales_order || w.custom_sales_order || '—'}
                    </MfgTd>
                    <MfgTd className="mfg-td-amount">
                      {fmtCurrency(w.total_amount, w.currency)}
                    </MfgTd>
                    <MfgTd>
                      <div className="mfg-progress">
                        <div className="mfg-progress__track">
                          <div
                            className="mfg-progress__fill"
                            style={{ width: `${Math.min(100, w.progress || 0)}%` }}
                          />
                        </div>
                        <span className="mfg-progress__label">{fmtPct(w.progress || 0)}</span>
                      </div>
                    </MfgTd>
                    <MfgTd><StatusBadge status={w.status} /></MfgTd>
                  </tr>
                ))}
              </tbody>
            </table>
            <MfgListPagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          </>
        )}
      </MfgTableCard>
    </MfgPage>
  );
}
