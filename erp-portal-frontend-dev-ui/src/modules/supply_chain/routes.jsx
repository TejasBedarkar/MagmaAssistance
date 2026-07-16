import React from "react";
import { Navigate, Route } from "react-router-dom";
import SupplyChainModuleShell from "./components/SupplyChainModuleShell.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import ProductsPage from "./pages/ProductsPage.jsx";
import BomPage from "./pages/BomPage.jsx";
import WarehousesPage from "./pages/WarehousesPage.jsx";
import SuppliersPage from "./pages/SuppliersPage.jsx";
import StockPage from "./pages/StockPage.jsx";
import StockTransferPage from "./pages/StockTransferPage.jsx";
import MaterialRequestsPage from "./pages/MaterialRequestsPage.jsx";
import PurchaseOrdersPage from "./pages/PurchaseOrdersPage.jsx";
import PlantMasterPage from "./pages/PlantMasterPage.jsx";
import CapacityPlanningPage from "./pages/CapacityPlanningPage.jsx";
import GrnPage from "./pages/GrnPage.jsx";
import RfqPage from "./pages/RfqPage.jsx";
import ReservationsPage from "./pages/ReservationsPage.jsx";
import MrpPage from "./pages/MrpPage.jsx";
import RmaPage from "./pages/RmaPage.jsx";

/** Supply Chain module — all pages wired to supply_chain_app APIs via scCall. */
export function SupplyChainRoutes() {
  return (
    <Route path="supply-chain" element={<SupplyChainModuleShell />}>
      <Route index element={<DashboardPage />} />
      <Route path="products" element={<ProductsPage />} />
      <Route path="bom" element={<BomPage />} />
      <Route path="warehouses" element={<WarehousesPage />} />
      <Route path="suppliers" element={<SuppliersPage />} />
      <Route path="inventory" element={<StockPage />} />
      <Route path="stock-transfer" element={<StockTransferPage />} />
      <Route path="material-requests" element={<MaterialRequestsPage />} />
      <Route path="rfq" element={<RfqPage />} />
      <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
      <Route path="grn" element={<GrnPage />} />
      <Route path="plant" element={<PlantMasterPage />} />
      <Route path="capacity-planning" element={<CapacityPlanningPage />} />
      <Route path="mrp" element={<MrpPage />} />
      <Route path="reservations" element={<ReservationsPage />} />
      <Route path="rma" element={<RmaPage />} />
      <Route path="*" element={<Navigate to="/supply-chain" replace />} />
    </Route>
  );
}
