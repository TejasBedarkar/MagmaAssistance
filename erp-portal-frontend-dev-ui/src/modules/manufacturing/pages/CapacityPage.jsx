import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import usePagedRows from '../../../common/hooks/usePagedRows.js';
import { MfgListPagination } from '@/components/MfgPageLayout.jsx';
import { CalendarDays } from '@/icons/mfgIcons.js';
import { capacity } from '@/api';
import { PageLoader } from '@/components/MfgPageLoader';
import { EmptyState } from '@/components/MfgEmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { fmtDateTime } from '@/utils/format';
import { mfgPath } from '../paths.js';

const PAGE_SIZE = 25;

export default function CapacityPage() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    capacity.list().then(setPlans).finally(() => setLoading(false));
  }, []);

  const { page, setPage, totalPages, pageRows, total } = usePagedRows(plans, PAGE_SIZE);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-steel-900">Capacity Planning</h2>
        <p className="text-sm text-steel-500">Workstation allocation and conflict detection</p>
      </div>

      {loading ? <PageLoader /> :
        plans.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No capacity plans yet" />
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-steel-50 text-xs uppercase tracking-wider text-steel-500">
                <tr>
                  <th className="px-5 py-3 text-left">Plan</th>
                  <th className="px-5 py-3 text-left">Work Order</th>
                  <th className="px-5 py-3 text-left">Workstation</th>
                  <th className="px-5 py-3 text-left">Start</th>
                  <th className="px-5 py-3 text-left">End</th>
                  <th className="px-5 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => {
                  const displayStatus = p.has_conflict ? 'Conflict' : p.status;
                  return (
                  <tr key={p.name} className="border-t border-steel-100 hover:bg-steel-50">
                    <td className="px-5 py-3 font-mono text-xs">{p.name}</td>
                    <td className="px-5 py-3">
                      <Link to={mfgPath(`/work-orders/${p.work_order}`)} className="text-accent-blue hover:underline">
                        {p.work_order}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-steel-600">
                      {p.workstation_names || '—'}
                    </td>
                    <td className="px-5 py-3">{fmtDateTime(p.planned_start)}</td>
                    <td className="px-5 py-3">{fmtDateTime(p.planned_end)}</td>
                    <td className="px-5 py-3"><StatusBadge status={displayStatus} /></td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            <MfgListPagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          </div>
        )}
    </div>
  );
}
