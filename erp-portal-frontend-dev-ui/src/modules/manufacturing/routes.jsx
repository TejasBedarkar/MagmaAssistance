import React from "react";
import { Route } from "react-router-dom";
import ManufacturingProviders from "./ManufacturingProviders.jsx";
import ManufacturingModuleShell from "./ManufacturingModuleShell.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import WorkOrdersListPage from "./pages/WorkOrdersListPage.jsx";
import WorkOrderDetailPage from "./pages/WorkOrderDetailPage.jsx";
import WorkOrderCreatePage from "./pages/WorkOrderCreatePage.jsx";
import CapacityPage from "./pages/CapacityPage.jsx";
import CapacityCommitmentPage from "./pages/CapacityCommitmentPage.jsx";
import MaterialsPage from "./pages/MaterialsPage.jsx";
import ProductionPage from "./pages/ProductionPage.jsx";
import MaintenancePage from "./pages/MaintenancePage.jsx";
import QualityPage from "./pages/QualityPage.jsx";
import DispatchPage from "./pages/DispatchPage.jsx";
import ClosurePage from "./pages/ClosurePage.jsx";
import ReportsPage from "./pages/ReportsPage.jsx";
import WorkstationsPage from "./pages/WorkstationsPage.jsx";
import QCTemplatesPage from "./pages/QCTemplatesPage.jsx";
import NewProductRequirementPage from "./pages/NewProductRequirementPage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";

/**
 * Manufacturing under portal Layout — same sidebar as other modules (Screenshot 1 style).
 * Real pages in pm-main; no separate manufacturing AppLayout sidebar.
 */
export function ManufacturingRoutes() {
  return (
    <Route path="manufacturing" element={<ManufacturingProviders />}>
      <Route element={<ManufacturingModuleShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="work-orders">
          <Route index element={<WorkOrdersListPage />} />
          <Route path="new" element={<WorkOrderCreatePage />} />
          <Route path=":name" element={<WorkOrderDetailPage />} />
        </Route>
        <Route path="capacity" element={<CapacityPage />} />
        <Route path="capacity-commitments" element={<CapacityCommitmentPage />} />
        <Route path="new-product-requirement" element={<NewProductRequirementPage />} />
        <Route path="materials" element={<MaterialsPage />} />
        <Route path="production" element={<ProductionPage />} />
        <Route path="maintenance" element={<MaintenancePage />} />
        <Route path="quality" element={<QualityPage />} />
        <Route path="qc-templates" element={<QCTemplatesPage />} />
        <Route path="workstations" element={<WorkstationsPage />} />
        <Route path="dispatch" element={<DispatchPage />} />
        <Route path="closure" element={<ClosurePage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Route>
  );
}
