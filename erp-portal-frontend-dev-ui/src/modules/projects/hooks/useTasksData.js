import { useCallback, useEffect, useState } from "react";
import { tasks as tasksApi } from "../api/index.js";

/** Load PM Tasks for list / board / calendar via portal API (one shape, one permission path). */
export default function useTasksData() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    setLoading(true);
    try {
      const data = await tasksApi.list();
      setTasks(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e.message || "Failed to load tasks");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { tasks, loading, err, reload: load, setErr };
}
