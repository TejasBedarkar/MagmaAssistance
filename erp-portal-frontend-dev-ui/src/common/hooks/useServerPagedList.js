import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Server-driven pagination — fetchPage(page, pageSize) must return
 * { rows, total, page, page_size, total_pages }.
 */
export default function useServerPagedList({ fetchPage, pageSize = 25, deps = [], enabled = true }) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const depKey = useMemo(() => JSON.stringify(deps), [deps]);

  useEffect(() => {
    setPage(1);
  }, [depKey]);

  const load = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setErr("");
    setLoading(true);
    try {
      const data = await fetchPage(page, pageSize);
      const nextTotalPages = Math.max(1, Number(data?.total_pages) || 1);
      const nextPage = Math.min(page, nextTotalPages);
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setTotal(Number(data?.total) || 0);
      setTotalPages(nextTotalPages);
      if (nextPage !== page) {
        setPage(nextPage);
      }
    } catch (e) {
      setErr(e.message || "Failed to load");
      setRows([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [enabled, fetchPage, page, pageSize]);

  useEffect(() => {
    load();
  }, [load, depKey]);

  function goToPage(next) {
    setPage(Math.min(Math.max(1, next), totalPages));
  }

  return {
    page,
    setPage: goToPage,
    rows,
    total,
    totalPages,
    pageSize,
    loading,
    err,
    reload: load,
  };
}
