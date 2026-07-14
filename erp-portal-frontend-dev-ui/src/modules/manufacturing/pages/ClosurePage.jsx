import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import usePagedRows from '../../../common/hooks/usePagedRows.js';
import { MfgListPagination } from '@/components/MfgPageLayout.jsx';
import { FileCheck } from '@/icons/mfgIcons.js';
import { closure } from '@/api';
import { PageLoader } from '@/components/MfgPageLoader';
import { EmptyState } from '@/components/MfgEmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { fmtDate } from '@/utils/format';
import { mfgPath } from '../paths.js';

const PAGE_SIZE = 25;

export default function ClosurePage() {
  const [pods, setPods] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    closure.listPods().then(setPods).finally(() => setLoading(false));
  }, []);

  const { page, setPage, totalPages, pageRows, total } = usePagedRows(pods, PAGE_SIZE);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-steel-900">Closure & POD</h2>
        <p className="text-sm text-steel-500">Proof of Delivery and work order closure</p>
      </div>

      {loading ? <PageLoader /> :
        pods.length === 0 ? (
          <EmptyState icon={FileCheck} title="No PODs yet" />
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-steel-50 text-xs uppercase tracking-wider text-steel-500">
                <tr>
                  <th className="px-5 py-3 text-left">POD</th>
                  <th className="px-5 py-3 text-left">Work Order</th>
                  <th className="px-5 py-3 text-left">Dispatch Note</th>
                  <th className="px-5 py-3 text-left">Received By</th>
                  <th className="px-5 py-3 text-left">Date</th>
                  <th className="px-5 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => (
                  <tr key={p.name} className="border-t border-steel-100 hover:bg-steel-50">
                    <td className="px-5 py-3 font-mono text-xs">{p.name}</td>
                    <td className="px-5 py-3">
                      <Link to={mfgPath(`/work-orders/${p.work_order}`)} className="text-accent-blue hover:underline">
                        {p.work_order}
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs">{p.dispatch_note}</td>
                    <td className="px-5 py-3">{p.received_by}</td>
                    <td className="px-5 py-3">{fmtDate(p.received_date)}</td>
                    <td className="px-5 py-3"><StatusBadge status={p.delivery_status} /></td>
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
          </div>
        )}
    </div>
  );
}
