import { useCallback, useEffect, useState } from "react";

/**
 * Generic list loader for SCM pages.
 * @param {() => Promise<any[]>} fetchFn — returns array of rows
 * @param {unknown[]} deps — refetch when these change
 */
export default function useScmList(fetchFn, deps = []) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchFn();
      setRows(Array.isArray(data) ? data : []);
      setUpdated(
        new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
      );
    } catch (err) {
      setError(err?.message || "Failed to load data.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    reload();
  }, [reload]);

  return { rows, loading, error, updated, reload };
}
