import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Open a document detail panel when ?mr= / ?po= / ?grn= is present in the URL.
 */
export default function useScmDocDeepLink(paramName, rows, openRow) {
  const [searchParams, setSearchParams] = useSearchParams();
  const handled = useRef(false);

  useEffect(() => {
    const docName = searchParams.get(paramName);
    if (!docName || handled.current) return;

    const row = rows.find((r) => r.name === docName);
    if (row) {
      handled.current = true;
      openRow(row);
      const next = new URLSearchParams(searchParams);
      next.delete(paramName);
      setSearchParams(next, { replace: true });
      return;
    }

    handled.current = true;
    openRow({ name: docName });
    const next = new URLSearchParams(searchParams);
    next.delete(paramName);
    setSearchParams(next, { replace: true });
  }, [paramName, rows, searchParams, setSearchParams, openRow]);
}
