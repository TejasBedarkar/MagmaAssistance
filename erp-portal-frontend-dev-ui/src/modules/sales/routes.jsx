import "./portalSidebar.js";
import "./theme/salesModule.css";
import React from "react";
import { Route } from "react-router-dom";
import SalesModuleShell from "./components/SalesModuleShell.jsx";
import Dashboard from "./pages/administrator/Dashboard.jsx";
import Lead from "./pages/administrator/Lead.jsx";
import Opportunity from "./pages/administrator/Opportunity.jsx";
import Pipeline from "./pages/administrator/Pipeline.jsx";
import Customers from "./pages/administrator/Customers.jsx";
import Quotation from "./pages/administrator/Quotation.jsx";
import SalesOrder from "./pages/administrator/SalesOrder.jsx";
import SalesList from "./pages/administrator/SalesList.jsx";
import PendingApprovals from "./pages/administrator/PendingApprovals.jsx";
import AuditLogs from "./pages/administrator/AuditLogs.jsx";
import Returns from "./pages/administrator/Returns.jsx";
import RoleRouteGuard from "./components/RoleRouteGuard.jsx";
import { SALES_ROLES, SALES_USER_ROLES, SALES_MANAGER_ROLES, SALES_PIPELINE_ROLES } from "./lib/roles.js";

/** Sales module routes — UI lives here; API is sales_app on bench. */
export function SalesRoutes() {
  return (
    <Route path="sales" element={<SalesModuleShell />}>
      <Route index element={<RoleRouteGuard allow={SALES_ROLES}><Dashboard /></RoleRouteGuard>} />
      <Route path="leads" element={<RoleRouteGuard allow={SALES_USER_ROLES}><Lead /></RoleRouteGuard>} />
      <Route path="opportunities" element={<RoleRouteGuard allow={SALES_USER_ROLES}><Opportunity /></RoleRouteGuard>} />
      <Route path="pipeline" element={<RoleRouteGuard allow={SALES_PIPELINE_ROLES}><Pipeline /></RoleRouteGuard>} />
      <Route path="customers" element={<RoleRouteGuard allow={SALES_ROLES}><Customers /></RoleRouteGuard>} />
      <Route path="list" element={<RoleRouteGuard allow={SALES_USER_ROLES}><SalesList /></RoleRouteGuard>} />
      <Route path="quotations" element={<RoleRouteGuard allow={SALES_ROLES}><Quotation /></RoleRouteGuard>} />
      <Route path="pending-approvals" element={<RoleRouteGuard allow={SALES_MANAGER_ROLES}><PendingApprovals /></RoleRouteGuard>} />
      <Route path="orders" element={<RoleRouteGuard allow={SALES_ROLES}><SalesOrder /></RoleRouteGuard>} />
      <Route path="returns" element={<RoleRouteGuard allow={SALES_ROLES}><Returns /></RoleRouteGuard>} />
      <Route path="audit-logs" element={<RoleRouteGuard allow={SALES_ROLES}><AuditLogs /></RoleRouteGuard>} />
    </Route>
  );
}
