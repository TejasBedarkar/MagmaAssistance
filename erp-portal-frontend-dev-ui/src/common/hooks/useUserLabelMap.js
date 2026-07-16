import { useEffect, useState } from "react";
import { callMethodGet } from "../api/client.js";

/** Map user id (email) → display label from get_assignable_users. */
export default function useUserLabelMap() {
  const [labelMap, setLabelMap] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await callMethodGet("project_management.api.get_assignable_users");
        if (cancelled) return;
        const map = {};
        for (const u of list || []) {
          map[u.name] = u.full_name || u.name;
        }
        setLabelMap(map);
      } catch {
        if (!cancelled) setLabelMap({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function labelFor(userId) {
    if (!userId) return "—";
    return labelMap[userId] || userId;
  }

  return { labelMap, labelFor, loading };
}
