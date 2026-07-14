import "./theme/financeModule.css";
import React from "react";
import { Route } from "react-router-dom";
import FinanceModuleShell from "./components/FinanceModuleShell.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import SalesOrderPage from "./pages/SalesOrderPage.jsx";
import { DeliveryNotePage, PurchaseReceiptPage } from "./pages/DocumentChainPages.jsx";
import EwayBillPage from "./pages/EwayBillPage.jsx";
import SalesInvoice from "./pages/SalesInvoice.jsx";
import CustomerAging from "./pages/CustomerAging.jsx";
import PurchaseOrderPage from "./pages/PurchaseOrderPage.jsx";
import PurchaseInvoice from "./pages/PurchaseInvoice.jsx";
import SupplierAging from "./pages/SupplierAging.jsx";
import BankReconciliation from "./pages/BankReconciliation.jsx";
import PaymentEntry from "./pages/PaymentEntry.jsx";
import JournalEntry from "./pages/JournalEntry.jsx";
import ChartOfAccounts from "./pages/ChartOfAccounts.jsx";
import GeneralLedger from "./pages/GeneralLedger.jsx";
import TrialBalance from "./pages/TrialBalance.jsx";
import ProfitLoss from "./pages/ProfitLoss.jsx";
import BalanceSheet from "./pages/BalanceSheet.jsx";
import CashFlow from "./pages/CashFlow.jsx";
import IndiaCompliance from "./pages/IndiaCompliance.jsx";
import BudgetView from "./pages/BudgetView.jsx";
import AssetView from "./pages/AssetView.jsx";
import CompanySetup from "./pages/CompanySetup.jsx";
import PendingApprovals from "./pages/PendingApprovals.jsx";
import CreditNote from "./pages/CreditNote.jsx";

/** Finance module routes — UI here; API is finance_app on bench. */
export function FinanceRoutes() {
  return (
    <Route path="finance" element={<FinanceModuleShell />}>
      <Route index element={<Dashboard />} />
      <Route path="sales-orders" element={<SalesOrderPage />} />
      <Route path="delivery-notes" element={<DeliveryNotePage />} />
      <Route path="eway-bills" element={<EwayBillPage />} />
      <Route path="sales-invoices" element={<SalesInvoice />} />
      <Route path="credit-notes" element={<CreditNote />} />
      <Route path="customer-aging" element={<CustomerAging />} />
      <Route path="purchase-orders" element={<PurchaseOrderPage />} />
      <Route path="purchase-receipts" element={<PurchaseReceiptPage />} />
      <Route path="purchase-invoices" element={<PurchaseInvoice />} />
      <Route path="supplier-aging" element={<SupplierAging />} />
      <Route path="bank-reconciliation" element={<BankReconciliation />} />
      <Route path="payment-entries" element={<PaymentEntry />} />
      <Route path="pending-approvals" element={<PendingApprovals />} />
      <Route path="journal-entries" element={<JournalEntry />} />
      <Route path="chart-of-accounts" element={<ChartOfAccounts />} />
      <Route path="general-ledger" element={<GeneralLedger />} />
      <Route path="trial-balance" element={<TrialBalance />} />
      <Route path="profit-and-loss" element={<ProfitLoss />} />
      <Route path="balance-sheet" element={<BalanceSheet />} />
      <Route path="cash-flow" element={<CashFlow />} />
      <Route path="gst-tds" element={<IndiaCompliance />} />
      <Route path="budget" element={<BudgetView />} />
      <Route path="fixed-assets" element={<AssetView />} />
      <Route path="company-setup" element={<CompanySetup />} />
    </Route>
  );
}
