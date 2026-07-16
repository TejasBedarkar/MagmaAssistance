import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuth as usePortalAuth } from "../../../common/context/AuthContext.jsx";
import { dashboard } from "../api/dashboard.js";
import { resolveManufacturingRole } from "../manufacturingNav.js";
import { ROLES } from "../constants/roles.js";

const ManufacturingSessionContext = createContext(null);

const EMPTY_LOOKUPS = {
  workstations: [],
  shifts: [],
  qc_templates: [],
  operators: [],
};

export function ManufacturingSessionProvider({ children }) {
  const { user, roles, loading: portalLoading } = usePortalAuth();
  const [lookups, setLookups] = useState(EMPTY_LOOKUPS);
  const [role, setRole] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!user) {
      setRole(null);
      setLookups(EMPTY_LOOKUPS);
      setSessionLoading(false);
      setError(null);
      return;
    }

    setSessionLoading(true);
    setError(null);
    try {
      const data = await dashboard.getLookups();
      const resolvedRole = data?.current_role || resolveManufacturingRole(roles);
      setRole(resolvedRole);
      setLookups({
        workstations: data.workstations || [],
        shifts: data.shifts || [],
        qc_templates: data.qc_templates || [],
        operators: data.operators || [],
      });
    } catch (err) {
      setError(err.message || "Failed to load manufacturing lookups");
      setRole(resolveManufacturingRole(roles));
      setLookups(EMPTY_LOOKUPS);
    } finally {
      setSessionLoading(false);
    }
  }, [user, roles]);

  useEffect(() => {
    if (portalLoading) return;
    reload();
  }, [portalLoading, reload]);

  const hasRole = useCallback(
    (...allowed) => {
      if (!role) return false;
      return allowed.includes(role) || role === ROLES.SYSTEM_MANAGER;
    },
    [role]
  );

  const value = useMemo(
    () => ({
      user,
      role,
      lookups,
      loading: portalLoading || sessionLoading,
      error,
      reload,
      hasRole,
      isAuthenticated: !!user && user !== "Guest",
    }),
    [user, role, lookups, portalLoading, sessionLoading, error, reload, hasRole]
  );

  return (
    <ManufacturingSessionContext.Provider value={value}>
      {children}
    </ManufacturingSessionContext.Provider>
  );
}

export function useManufacturingSession() {
  const ctx = useContext(ManufacturingSessionContext);
  if (!ctx) {
    throw new Error("useManufacturingSession must be used within ManufacturingSessionProvider");
  }
  return ctx;
}
