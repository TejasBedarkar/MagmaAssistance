import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package } from '@/icons/mfgIcons.js';
import { productRequirement } from '@/api';
import { PageLoader } from '@/components/MfgPageLoader';
import { EmptyState } from '@/components/MfgEmptyState';
import ProductRequirementReviewPanel from '@/components/ProductRequirementReviewPanel';
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

export default function NewProductRequirementPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = String(searchParams.get('open') || '').trim();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(openId);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await productRequirement.listPending(50);
      setItems(data?.items || []);
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
      [row.opportunity, row.product, row.party].some((v) =>
        (v || '').toLowerCase().includes(needle),
      ),
    );
  }, [items, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const selectRow = (opportunity) => {
    setSelected(opportunity);
    const next = new URLSearchParams(searchParams);
    if (opportunity) next.set('open', opportunity);
    else next.delete('open');
    setSearchParams(next, { replace: true });
  };

  const onReviewUpdated = async () => {
    const data = await productRequirement.listPending(50);
    const nextItems = data?.items || [];
    setItems(nextItems);
    if (selected && !nextItems.some((i) => i.opportunity === selected)) {
      selectRow('');
    }
  };

  return (
    <MfgPage>
      <MfgPageHeader
        title="New Product Requirement"
        subtitle="Review Sales product-development requests and complete the manufacturing feasibility checklist"
      />

      <div className="mfg-npr-layout">
        <div className="mfg-npr-layout__list">
          <MfgToolbar className="mfg-toolbar--list">
            <MfgSearchField
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder="Search opportunity, product, customer…"
            />
          </MfgToolbar>

          <MfgTableCard>
            {loading ? (
              <PageLoader label="Loading pending requirements…" />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={Package}
                title="No pending product requirements"
                description="When Sales requests Product Development, opportunities appear here for manufacturing review."
              />
            ) : (
              <>
                <table>
                  <MfgTableHead>
                    <MfgTh>Opportunity</MfgTh>
                    <MfgTh>Product</MfgTh>
                    <MfgTh>Customer</MfgTh>
                    <MfgTh>Updated</MfgTh>
                  </MfgTableHead>
                  <tbody>
                    {pageRows.map((row) => (
                      <tr
                        key={row.opportunity}
                        className={selected === row.opportunity ? 'mfg-npr-row--active' : ''}
                        onClick={() => selectRow(row.opportunity)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') selectRow(row.opportunity);
                        }}
                      >
                        <MfgTd className="mfg-row-link--mono">{row.opportunity}</MfgTd>
                        <MfgTd>{row.product || '—'}</MfgTd>
                        <MfgTd>{row.party || '—'}</MfgTd>
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
          <ProductRequirementReviewPanel
            opportunityId={selected}
            onUpdated={onReviewUpdated}
            onClose={selected ? () => selectRow('') : undefined}
          />
        </div>
      </div>
    </MfgPage>
  );
}
