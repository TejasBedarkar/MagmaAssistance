import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  apiLogin,
  apiLogout,
  callMethodGet,
  setCsrfToken,
} from "../api/client.js";

const AuthContext = createContext(null);

const ADMIN_ROLES = new Set(["Administrator", "System Manager"]);

function resolveIsAdministrator(msg) {
  if (msg.is_administrator != null) return !!msg.is_administrator;
  if (msg.user === "Administrator") return true;
  const roles = msg.roles || [];
  return roles.some((r) => ADMIN_ROLES.has(r));
}

export function AuthProvider({ children, siteOrigin }) {
  const [user, setUser] = useState(null);
  const [fullName, setFullName] = useState("");
  const [roles, setRoles] = useState([]);
  const [isManager, setIsManager] = useState(false);
  const [isAdministrator, setIsAdministrator] = useState(false);
  const [isProgramManager, setIsProgramManager] = useState(false);
  const [isDeveloper, setIsDeveloper] = useState(false);
  const [isTester, setIsTester] = useState(false);
  const [isBusinessAnalyst, setIsBusinessAnalyst] = useState(false);
  const [isDeliveryMember, setIsDeliveryMember] = useState(false);
  const [hasPmAssignments, setHasPmAssignments] = useState(false);
  const [designation, setDesignation] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [department, setDepartment] = useState("");
  const [company, setCompany] = useState("");
  const [canEditBudget, setCanEditBudget] = useState(false);
  const [canEditStartDate, setCanEditStartDate] = useState(false);
  const [canDeleteProject, setCanDeleteProject] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshSession = useCallback(async () => {
    setError("");
    try {
      const msg = await callMethodGet("project_management.api.get_session_info");
      setUser(msg.user);
      setFullName(msg.full_name || msg.user);
      setRoles(msg.roles || []);
      const manager = !!msg.is_manager;
      setIsManager(manager);
      setIsAdministrator(resolveIsAdministrator(msg));
      setIsProgramManager(!!msg.is_program_manager);
      setIsDeveloper(!!msg.is_developer);
      setIsTester(!!msg.is_tester);
      setIsBusinessAnalyst(!!msg.is_business_analyst);
      setIsDeliveryMember(!!msg.is_delivery_member);
      setHasPmAssignments(!!msg.has_pm_assignments);
      setDesignation(msg.designation || "");
      setEmployeeId(msg.employee_id || "");
      setDepartment(msg.department || "");
      setCompany(msg.company || "");
      setCanEditBudget(!!msg.can_edit_budget);
      setCanEditStartDate(!!msg.can_edit_start_date);
      setCanDeleteProject(!!msg.can_delete_project);
      if (msg.csrf_token) setCsrfToken(msg.csrf_token);
      return msg;
    } catch (e) {
      setUser(null);
      setFullName("");
      setRoles([]);
      setIsManager(false);
      setIsAdministrator(false);
      setIsProgramManager(false);
      setIsDeveloper(false);
      setIsTester(false);
      setIsBusinessAnalyst(false);
      setIsDeliveryMember(false);
      setHasPmAssignments(false);
      setDesignation("");
      setEmployeeId("");
      setDepartment("");
      setCompany("");
      setCanEditBudget(false);
      setCanEditStartDate(false);
      setCanDeleteProject(false);
      setCsrfToken(null);
      return null;
    }
  }, []);

  useEffect(() => {
    if (siteOrigin && typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.info("[erp-portal] VITE_SITE_ORIGIN:", siteOrigin);
    }
  }, [siteOrigin]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const session = await refreshSession();
      if (!cancelled) setLoading(false);
      if (!session && !cancelled) setUser(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSession]);

  const login = useCallback(
    async (usr, pwd) => {
      setError("");
      await apiLogin(usr, pwd);
      const session = await refreshSession();
      if (!session) throw new Error("Session could not be established.");
      return session;
    },
    [refreshSession]
  );

  const logout = useCallback(async () => {
    setError("");
    try {
      await apiLogout();
    } finally {
      setUser(null);
      setFullName("");
      setRoles([]);
      setIsManager(false);
      setIsAdministrator(false);
      setIsProgramManager(false);
      setIsDeveloper(false);
      setIsTester(false);
      setIsBusinessAnalyst(false);
      setIsDeliveryMember(false);
      setHasPmAssignments(false);
      setDesignation("");
      setEmployeeId("");
      setDepartment("");
      setCompany("");
      setCanEditBudget(false);
      setCanEditStartDate(false);
      setCanDeleteProject(false);
      setCsrfToken(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      fullName,
      roles,
      isManager,
      isAdministrator,
      isProgramManager,
      isDeveloper,
      isTester,
      isBusinessAnalyst,
      isDeliveryMember,
      hasPmAssignments,
      designation,
      employeeId,
      department,
      company,
      canEditBudget,
      canEditStartDate,
      canDeleteProject,
      loading,
      error,
      setError,
      login,
      logout,
      refreshSession,
    }),
    [
      user,
      fullName,
      roles,
      isManager,
      isAdministrator,
      isProgramManager,
      isDeveloper,
      isTester,
      isBusinessAnalyst,
      isDeliveryMember,
      hasPmAssignments,
      designation,
      employeeId,
      department,
      company,
      canEditBudget,
      canEditStartDate,
      canDeleteProject,
      loading,
      error,
      login,
      logout,
      refreshSession,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
