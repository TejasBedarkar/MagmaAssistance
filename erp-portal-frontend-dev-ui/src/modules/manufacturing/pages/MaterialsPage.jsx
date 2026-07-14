import { useEffect, useMemo, useState } from 'react';
import usePagedRows from '../../../common/hooks/usePagedRows.js';
import { Eye, Package } from '@/icons/mfgIcons.js';
import { materials } from '@/api';
import { useAuth, ROLES } from '@/hooks/manufacturingAuth';
import { PageLoader } from '@/components/MfgPageLoader';
import { EmptyState } from '@/components/MfgEmptyState';
import { PriorityBadge, StatusBadge } from '@/components/StatusBadge';
import MaterialCheckPanel from '@/components/MaterialCheckPanel';
import Modal, { MfgModalCloseFooter } from '@/components/Modal';
import { fmtDate } from '@/utils/format';
import {
  MfgButton,
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

const STATUSES = ['', 'Pending', 'Shortage', 'Ready', 'Requested'];

export default function MaterialsPage() {
  const { hasRole } = useAuth();
  const canVerify = hasRole(ROLES.PRODUCTION_HEAD);
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCheck, setSelectedCheck] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');

  const load = () => {
    setLoading(true);
    const filters = {};
    if (statusFilter) filters.status = statusFilter;
    materials.list(filters)
      .then(setChecks)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [statusFilter]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return checks;
    return checks.filter((c) =>
      [c.name, c.work_order, c.item_name, c.customer, c.priority, c.status].some((f) =>
        (f || '').toLowerCase().includes(needle)
      )
    );
  }, [checks, q]);

  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(filtered, PAGE_SIZE);

  function onSearchChange(e) {
    setQ(e.target.value);
    resetPage();
  }

  function onStatusChange(e) {
    setStatusFilter(e.target.value);
    resetPage();
  }

  const actionLabel = canVerify ? 'Review & Verify' : 'View Items';

  return (
    <MfgPage>
      <MfgPageHeader
        title="Material Checks"
        subtitle={
          loading
            ? 'BOM verification and shortage tracking'
            : `${filtered.length} of ${checks.length} checks`
        }
      />

      <MfgToolbar className="mfg-toolbar--list">
        <MfgSearchField
          value={q}
          onChange={onSearchChange}
          placeholder="Search by check ID, customer, item, or work order…"
        />
        <select
          value={statusFilter}
          onChange={onStatusChange}
          className="input mfg-toolbar__select"
          aria-label="Filter by status"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s || 'All Statuses'}</option>
          ))}
        </select>
      </MfgToolbar>

      <MfgTableCard>
        {loading ? (
          <PageLoader />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No material checks"
            description={q || statusFilter ? 'Try adjusting your filters.' : 'No checks yet.'}
          />
        ) : (
          <>
            <table>
              <MfgTableHead>
                <MfgTh>Check</MfgTh>
                <MfgTh>Customer</MfgTh>
                <MfgTh>Item</MfgTh>
                <MfgTh>Work Order</MfgTh>
                <MfgTh>Priority</MfgTh>
                <MfgTh>Due</MfgTh>
                <MfgTh>Status</MfgTh>
                <MfgTh align="right">Actions</MfgTh>
              </MfgTableHead>
              <tbody>
                {pageRows.map((c) => (
                  <tr key={c.name}>
                    <MfgTd className="mfg-row-link--mono">{c.name}</MfgTd>
                    <MfgTd>{c.customer || '—'}</MfgTd>
                    <MfgTd className="mfg-materials-table__item">{c.item_name || '—'}</MfgTd>
                    <MfgTd>
                      <MfgRowLink to={mfgPath(`/work-orders/${c.work_order}`)} mono>
                        {c.work_order}
                      </MfgRowLink>
                    </MfgTd>
                    <MfgTd><PriorityBadge priority={c.priority} /></MfgTd>
                    <MfgTd>{fmtDate(c.due_date)}</MfgTd>
                    <MfgTd><StatusBadge status={c.status} /></MfgTd>
                    <MfgTd align="right">
                      <div className="mfg-table-actions">
                        <MfgButton
                          variant={canVerify ? 'primary' : 'secondary'}
                          size="sm"
                          onClick={() => setSelectedCheck(c.name)}
                        >
                          <Eye size={16} aria-hidden />
                          {actionLabel}
                        </MfgButton>
                      </div>
                    </MfgTd>
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

      <Modal
        open={!!selectedCheck}
        onClose={() => setSelectedCheck(null)}
        title="Material Check Details"
        size="lg"
        footer={<MfgModalCloseFooter onClose={() => setSelectedCheck(null)} />}
      >
        {selectedCheck && (
          <MaterialCheckPanel
            materialCheckName={selectedCheck}
            onUpdated={load}
            compact
            embedded
          />
        )}
      </Modal>
    </MfgPage>
  );
}
