import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardList } from '@/icons/mfgIcons.js';
import { capacityCommitment } from '@/api';
import { PageLoader } from '@/components/MfgPageLoader';
import { EmptyState } from '@/components/MfgEmptyState';
import CapacityCommitmentPanel from '@/components/CapacityCommitmentPanel';
import {
  MfgListPagination,
  MfgPage,
  MfgPageHeader,
  MfgSearchField,
  MfgTableCard,
  MfgTd,
  MfgTh,
  MfgTableHead,
  MfgToolbar,
} from '@/components/MfgPageLayout.jsx';
import { fmtDateTime } from '@/utils/format';

const PAGE_SIZE = 15;

function capacityBadge(row) {
  if (row.capacity_available === true) {
    return <span className="mfg-cap-commit-badge mfg-cap-commit-badge--ok">Available</span>;
  }
  if (row.capacity_available === false) {
    return <span className="mfg-cap-commit-badge mfg-cap-commit-badge--warn">Tight</span>;
  }
  if (!row.line_count) {
    return <span className="mfg-cap-commit-badge mfg-cap-commit-badge--warn">No items</span>;
  }
  return <span className="mfg-cap-commit-badge mfg-cap-commit-badge--warn">Needs setup</span>;
}

export default function CapacityCommitmentPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = String(searchParams.get('open') || '').trim();
  const [items, setItems] = useState([]);
  const [canCommit, setCanCommit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(openId);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await capacityCommitment.list(50);
      setItems(data?.items || []);
      setCanCommit(Boolean(data?.can_commit));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (openId) setSelected(openId);
  }, [openId]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((row) =>
      [row.quotation, row.customer, row.item_summary].some((v) =>
        (v || '').toLowerCase().includes(needle),
      ),
    );
  }, [items, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const selectRow = (quotation) => {
    setSelected(quotation);
    const next = new URLSearchParams(searchParams);
    if (quotation) next.set('open', quotation);
    else next.delete('open');
    setSearchParams(next, { replace: true });
  };

  const onCommitted = async () => {
    const data = await capacityCommitment.list(50);
    const nextItems = data?.items || [];
    setItems(nextItems);
    if (selected && !nextItems.some((i) => i.quotation === selected)) {
      selectRow('');
    }
  };

  return (
    <MfgPage>
      <MfgPageHeader
        title="Capacity commitments"
        subtitle={
          canCommit
            ? `${items.length} quotation${items.length === 1 ? '' : 's'} awaiting tight-capacity commit`
            : 'View quotations awaiting production capacity (commit requires Production Head)'
        }
        actions={(
          <button
            type="button"
            className="pm-btn pm-btn-ghost pm-btn-sm"
            disabled={loading}
            onClick={() => load()}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      />

      <div className="mfg-npr-layout">
        <div className="mfg-npr-layout__list">
          <MfgToolbar className="mfg-toolbar--list">
            <MfgSearchField
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder="Search quotation, customer, items…"
            />
          </MfgToolbar>

          <MfgTableCard>
            {loading ? (
              <PageLoader label="Loading quotations…" />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="No quotations awaiting capacity"
                description={
                  openId
                    ? `Quotation ${openId} is not in the tight-capacity queue. Use the panel on the right if it was opened from a link, or ensure the Sales quotation is Awaiting Production with capacity marked Short.`
                    : 'When Sales moves a quotation to Awaiting Production and capacity is tight, it appears here for Production Head commitment.'
                }
              />
            ) : (
              <>
                <table>
                  <MfgTableHead>
                    <MfgTh>Quotation</MfgTh>
                    <MfgTh>Customer</MfgTh>
                    <MfgTh>Items</MfgTh>
                    <MfgTh>Capacity</MfgTh>
                    <MfgTh>Updated</MfgTh>
                  </MfgTableHead>
                  <tbody>
                    {pageRows.map((row) => (
                      <tr
                        key={row.quotation}
                        className={selected === row.quotation ? 'mfg-npr-row--active' : ''}
                        onClick={() => selectRow(row.quotation)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') selectRow(row.quotation);
                        }}
                      >
                        <MfgTd className="mfg-row-link--mono">{row.quotation}</MfgTd>
                        <MfgTd>{row.customer || 'Customer missing'}</MfgTd>
                        <MfgTd className="mfg-td-muted">{row.item_summary || 'Item data missing'}</MfgTd>
                        <MfgTd>{capacityBadge(row)}</MfgTd>
                        <MfgTd className="mfg-td-muted">{fmtDateTime(row.modified)}</MfgTd>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <MfgListPagination
                  page={page}
                  totalPages={totalPages}
                  total={filtered.length}
                  pageSize={PAGE_SIZE}
                  onPageChange={setPage}
                />
              </>
            )}
          </MfgTableCard>
        </div>

        <div className="mfg-npr-layout__detail">
          <CapacityCommitmentPanel
            quotation={selected}
            onCommitted={onCommitted}
            onClose={selected ? () => selectRow('') : undefined}
          />
        </div>
      </div>
    </MfgPage>
  );
}
