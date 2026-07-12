import { useCallback, useEffect, useMemo, useState } from 'react';
import usePagedRows from '../../../common/hooks/usePagedRows.js';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, CheckCircle2, Package, Plus, Truck,
} from '@/icons/mfgIcons.js';
import MfgKpiStat from '@/components/MfgKpiStat';
import { dispatch } from '@/api';
import DispatchCreateModal from '@/components/DispatchCreateModal';
import DispatchNotePanel from '@/components/DispatchNotePanel';
import PODUploadModal from '@/components/PODUploadModal';
import { PageLoader } from '@/components/MfgPageLoader';
import { EmptyState } from '@/components/MfgEmptyState';
import { PriorityBadge, StatusBadge } from '@/components/StatusBadge';
import {
  MfgButton,
  MfgListPagination,
  MfgPage,
  MfgPageHeader,
  MfgRowLink,
  MfgSearchField,
  MfgSegmentTabs,
  MfgTableCard,
  MfgTd,
  MfgTh,
  MfgTableHead,
  MfgToolbar,
} from '@/components/MfgPageLayout.jsx';
import { fmtDate } from '@/utils/format';
import { mfgPath } from '../paths.js';

const TABS = [
  { id: 'ready', label: 'Ready Queue' },
  { id: 'active', label: 'Active Notes' },
  { id: 'transit', label: 'In Transit' },
  { id: 'done', label: 'Delivered' },
];

const PAGE_SIZE = 25;

const ACTIVE_STATUSES = [
  'Packing Pending',
  'Packed',
  'Dispatch Note Created',
  'Logistics Booked',
];

export default function DispatchPage() {
  const [tab, setTab] = useState('ready');
  const [summary, setSummary] = useState(null);
  const [pending, setPending] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [createFor, setCreateFor] = useState(null);
  const [podTarget, setPodTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sum, queue, list] = await Promise.all([
        dispatch.summary(),
        dispatch.getPending(),
        dispatch.list({ search: search || undefined }),
      ]);
      setSummary(sum || {});
      setPending(queue || []);
      setNotes(list || []);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const activeNotes = useMemo(
    () => notes.filter((n) => ACTIVE_STATUSES.includes(n.status)),
    [notes],
  );
  const transitNotes = useMemo(
    () => notes.filter((n) => n.status === 'Dispatched'),
    [notes],
  );
  const doneNotes = useMemo(
    () => notes.filter((n) => ['POD Received', 'Closed'].includes(n.status)),
    [notes],
  );

  const filteredPending = useMemo(() => {
    if (!search.trim()) return pending;
    const q = search.toLowerCase();
    return pending.filter(
      (w) => w.name.toLowerCase().includes(q)
        || w.customer?.toLowerCase().includes(q)
        || w.item_code?.toLowerCase().includes(q),
    );
  }, [pending, search]);

  const tabRows = useMemo(() => {
    if (tab === 'ready') return filteredPending;
    if (tab === 'active') return activeNotes;
    if (tab === 'transit') return transitNotes;
    if (tab === 'done') return doneNotes;
    return [];
  }, [tab, filteredPending, activeNotes, transitNotes, doneNotes]);

  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(tabRows, PAGE_SIZE);

  useEffect(() => {
    resetPage();
  }, [tab, search, resetPage]);

  if (loading && !summary) return <PageLoader />;

  return (
    <MfgPage>
      <MfgPageHeader
        title="Dispatch Center"
        subtitle="Outbound logistics — pack, dispatch, and confirm delivery"
      />

      <div className="mfg-kpi-stats mfg-kpi-stats--5">
        <MfgKpiStat label="Ready to Dispatch" value={summary?.ready_to_dispatch ?? 0} tone="orange" icon={Truck} />
        <MfgKpiStat label="Packing / Booking" value={summary?.packing_in_progress ?? 0} tone="blue" icon={Package} />
        <MfgKpiStat label="In Transit" value={summary?.in_transit ?? 0} tone="purple" icon={Activity} />
        <MfgKpiStat label="Delivered Today" value={summary?.delivered_today ?? 0} tone="green" icon={CheckCircle2} />
        <MfgKpiStat label="Overdue In Transit" value={summary?.overdue_in_transit ?? 0} tone="red" icon={AlertTriangle} />
      </div>

      <MfgToolbar>
        <MfgSearchField
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetPage();
          }}
          placeholder="Search WO, customer, vehicle…"
        />
        <MfgSegmentTabs
          tabs={TABS}
          active={tab}
          onChange={(id) => {
            setTab(id);
            resetPage();
          }}
        />
      </MfgToolbar>

      {tab === 'ready' && (
        tabRows.length === 0 ? (
          <EmptyState icon={Truck} title="No work orders ready for dispatch" />
        ) : (
          <MfgTableCard>
            <table>
              <MfgTableHead>
                <MfgTh>Work Order</MfgTh>
                <MfgTh>Customer</MfgTh>
                <MfgTh>Item</MfgTh>
                <MfgTh>Qty</MfgTh>
                <MfgTh>Due</MfgTh>
                <MfgTh>Priority</MfgTh>
                <MfgTh align="right">Action</MfgTh>
              </MfgTableHead>
              <tbody>
                {pageRows.map((w) => (
                  <tr key={w.name}>
                    <MfgTd>
                      <MfgRowLink to={mfgPath(`/work-orders/${w.name}`)} mono>{w.name}</MfgRowLink>
                    </MfgTd>
                    <MfgTd>{w.customer}</MfgTd>
                    <MfgTd>{w.item_code}</MfgTd>
                    <MfgTd>{w.qty}</MfgTd>
                    <MfgTd>{fmtDate(w.expected_delivery_date)}</MfgTd>
                    <MfgTd><PriorityBadge priority={w.priority} /></MfgTd>
                    <MfgTd align="right">
                      <MfgButton size="sm" onClick={() => setCreateFor(w)}>
                        <Plus size={16} /> Create Note
                      </MfgButton>
                    </MfgTd>
                  </tr>
                ))}
              </tbody>
            </table>
          </MfgTableCard>
        )
      )}

      {tab === 'active' && (
        tabRows.length === 0 ? (
          <EmptyState icon={Activity} title="No active dispatch notes" />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {pageRows.map((n) => (
              <div key={n.name}>
                <p className="text-xs text-steel-500 mb-1">
                  <Link to={mfgPath(`/work-orders/${n.work_order}`)} className="text-accent-blue hover:underline">
                    {n.work_order}
                  </Link>
                  {' · '}{n.customer_name}
                </p>
                <DispatchNotePanel
                  note={n}
                  onUpdated={load}
                  onUploadPod={(note) => setPodTarget({ workOrder: note.work_order, note })}
                />
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'transit' && (
        tabRows.length === 0 ? (
          <EmptyState icon={Truck} title="Nothing in transit" />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {pageRows.map((n) => (
              <div key={n.name}>
                <DispatchNotePanel
                  note={n}
                  onUpdated={load}
                  onUploadPod={(note) => setPodTarget({ workOrder: note.work_order, note })}
                />
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'done' && (
        tabRows.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="No delivered dispatches yet" />
        ) : (
          <MfgTableCard>
            <table>
              <MfgTableHead>
                <MfgTh>Note</MfgTh>
                <MfgTh>Work Order</MfgTh>
                <MfgTh>Customer</MfgTh>
                <MfgTh>Vehicle</MfgTh>
                <MfgTh>Status</MfgTh>
                <MfgTh>Delivery Note</MfgTh>
              </MfgTableHead>
              <tbody>
                {pageRows.map((n) => (
                  <tr key={n.name}>
                    <MfgTd className="mfg-row-link--mono">{n.name}</MfgTd>
                    <MfgTd>
                      <MfgRowLink to={mfgPath(`/work-orders/${n.work_order}`)} mono>
                        {n.work_order}
                      </MfgRowLink>
                    </MfgTd>
                    <MfgTd>{n.customer_name || '—'}</MfgTd>
                    <MfgTd>{n.vehicle_no || '—'}</MfgTd>
                    <MfgTd><StatusBadge status={n.status} /></MfgTd>
                    <MfgTd>
                      {(n.dn_status === 'Created' || n.delivery_note_ref) ? (
                        <span className="mfg-dispatch-card__invoiced">
                          DN ✓{n.delivery_note_ref ? ` ${n.delivery_note_ref}` : ''}
                        </span>
                      ) : '—'}
                    </MfgTd>
                  </tr>
                ))}
              </tbody>
            </table>
          </MfgTableCard>
        )
      )}

      {tabRows.length > 0 ? (
        <MfgListPagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      ) : null}

      <DispatchCreateModal
        open={!!createFor}
        onClose={() => setCreateFor(null)}
        workOrder={createFor?.name}
        workOrderHint={createFor ? ` · ${createFor.customer} · ${createFor.item_code} × ${createFor.qty}` : ''}
        onCreated={load}
      />

      <PODUploadModal
        open={!!podTarget}
        onClose={() => setPodTarget(null)}
        workOrder={podTarget?.workOrder}
        defaultDispatchNote={podTarget?.note?.name}
        dispatchNotes={podTarget ? [podTarget.note] : notes}
        onUploaded={load}
      />
    </MfgPage>
  );
}
