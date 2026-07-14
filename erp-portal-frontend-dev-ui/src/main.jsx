import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import ErrorBoundary from "./common/components/ErrorBoundary.jsx";
import { AuthProvider } from "./common/context/AuthContext.jsx";
import "./common/styles/global.css";
import "./common/styles/portalSpinner.css";
import "./common/styles/adminUsers.css";

const origin = import.meta.env.VITE_SITE_ORIGIN || "";
const basename = import.meta.env.VITE_ROUTER_BASENAME || "/";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <ErrorBoundary>
        <AuthProvider siteOrigin={origin}>
          <App />
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
