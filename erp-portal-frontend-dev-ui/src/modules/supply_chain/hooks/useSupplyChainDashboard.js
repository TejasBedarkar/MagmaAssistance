import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDashboardFilterOptions,
  getDashboardSummary,
  MOCK_FILTER_OPTIONS,
} from "../api/dashboard.js";

function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function buildDefaultFilters() {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 30);
  return {
    date_from: toLocalDateStr(from),
    date_to: toLocalDateStr(today),
    warehouse: "",
    supplier: "",
    item_type: "",
  };
}

export default function useSupplyChainDashboard() {
  const [filters, setFilters] = useState(buildDefaultFilters);
  const [filterOptions, setFilterOptions] = useState(MOCK_FILTER_OPTIONS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState("");
  const fetchIdRef = useRef(0);

  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;
    getDashboardFilterOptions()
      .then((options) => {
        if (!cancelled) setFilterOptions(options);
      })
      .catch(() => {
        if (!cancelled) setFilterOptions(MOCK_FILTER_OPTIONS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError("");
    try {
      const summary = await getDashboardSummary(filters);
      if (fetchId !== fetchIdRef.current) return;
      setData(summary);
      setUpdated(
        new Date().toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      setError(err?.message || "Failed to load dashboard");
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = setTimeout(() => reload(), 300);
    return () => clearTimeout(timer);
  }, [filtersKey, reload]);

  const patchFilters = useCallback((patch) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const clearFilters = useCallback(() => setFilters(buildDefaultFilters()), []);

  return {
    data,
    loading,
    error,
    updated,
    reload,
    filters,
    filterOptions,
    patchFilters,
    clearFilters,
  };
}
