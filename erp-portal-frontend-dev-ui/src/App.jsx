import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./common/components/Layout.jsx";
import PrivateRoute from "./common/components/PrivateRoute.jsx";
import Login from "./common/pages/Login.jsx";
import UpdatePasswordPage from "./common/pages/UpdatePasswordPage.jsx";
import { ProjectRoutes } from "./modules/projects/routes.jsx";
import { SalesRoutes } from "./modules/sales/routes.jsx";
import { FinanceRoutes } from "./modules/finance/routes.jsx";
import { SupplyChainRoutes } from "./modules/supply_chain/routes.jsx";
import { ManufacturingRoutes } from "./modules/manufacturing/routes.jsx";
import UsersPage from "./common/pages/UsersPage.jsx";
import UserEditorPage from "./common/pages/users/UserEditorPage.jsx";
import SettingsPage from "./common/pages/SettingsPage.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/update-password" element={<UpdatePasswordPage />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        {ProjectRoutes()}
        {SalesRoutes()}
        {FinanceRoutes()}
        {SupplyChainRoutes()}
        {ManufacturingRoutes()}
        <Route
          path="users"
          element={
            <PrivateRoute requireAdmin>
              <UsersPage />
            </PrivateRoute>
          }
        />
        <Route
          path="users/new"
          element={
            <PrivateRoute requireAdmin>
              <UserEditorPage />
            </PrivateRoute>
          }
        />
        <Route
          path="users/:id"
          element={
            <PrivateRoute requireAdmin>
              <UserEditorPage />
            </PrivateRoute>
          }
        />
        <Route
          path="settings"
          element={
            <PrivateRoute requireAdmin>
              <SettingsPage />
            </PrivateRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
