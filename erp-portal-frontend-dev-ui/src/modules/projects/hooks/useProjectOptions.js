import { useEffect, useMemo, useState } from "react";
import { getList } from "../../../common/api/client.js";

/** Project dropdown options for list filters. */
export default function useProjectOptions() {
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getList("PM Project", {
          fields: ["name", "project_name"],
          order_by: "project_name asc",
          limit_page_length: 500,
        });
        if (!cancelled) setProjects(data);
      } catch {
        if (!cancelled) setProjects([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(
    () => [
      { value: "", label: "All projects" },
      ...projects.map((p) => ({
        value: p.name,
        label: p.project_name || p.name,
      })),
    ],
    [projects]
  );

  return { projects, options };
}
