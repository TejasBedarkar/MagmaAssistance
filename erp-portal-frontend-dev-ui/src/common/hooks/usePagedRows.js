import { useMemo, useState } from "react";

/** Client-side pagination for filtered list rows. */
export default function usePagedRows(rows, pageSize = 25) {
  const [page, setPage] = useState(1);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(page, totalPages);

  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, safePage, pageSize]);

  function goToPage(next) {
    setPage(Math.min(Math.max(1, next), totalPages));
  }

  function resetPage() {
    setPage(1);
  }

  return {
    page: safePage,
    setPage: goToPage,
    totalPages,
    pageRows,
    total,
    pageSize,
    resetPage,
  };
}
