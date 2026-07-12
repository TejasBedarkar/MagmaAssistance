import React, { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { getPortalHomePath, portalHomeOptionsFromSession } from "../utils/portalHome.js";
import { apiResetPassword } from "../api/client.js";
import { PAGES } from "../constants/branding.js";
import AppBrand from "../components/AppBrand.jsx";
import "../styles/login.css";

export default function Login() {
  const { user, loading, login, roles, isManager, isAdministrator, isBusinessAnalyst, isDeliveryMember } =
    useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("signin");
  const [usr, setUsr] = useState("");
  const [pwd, setPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [forgotSuccess, setForgotSuccess] = useState("");

  useEffect(() => {
    document.body.classList.add("pm-route-login");
    return () => document.body.classList.remove("pm-route-login");
  }, []);

  if (loading) {
    return (
      <div className="pm-login-loading" role="status">
        <span className="pm-login-spinner" aria-hidden="true" />
        Loading session…
      </div>
    );
  }

  if (user) {
    const home = getPortalHomePath(roles, {
      isManager,
      isAdministrator,
      isBusinessAnalyst,
      isDeliveryMember,
    });
    return <Navigate to={home || "/"} replace />;
  }

  function openForgot() {
    setMode("forgot");
    setErr("");
    setForgotSuccess("");
    setPwd("");
  }

  function backToSignIn() {
    setMode("signin");
    setErr("");
    setForgotSuccess("");
  }

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const session = await login(usr.trim(), pwd);
      const home = getPortalHomePath(session.roles || [], portalHomeOptionsFromSession(session));
      navigate(home || "/", { replace: true });
    } catch (ex) {
      setErr(ex.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function onForgotSubmit(e) {
    e.preventDefault();
    const email = usr.trim();
    if (!email) {
      setErr("Enter your email or username to reset your password.");
      return;
    }
    setErr("");
    setForgotSuccess("");
    setBusy(true);
    try {
      const msg = await apiResetPassword(email);
      setForgotSuccess(
        msg ||
          "If this email is registered with us, we have sent password reset instructions to it. Please check your inbox."
      );
    } catch (ex) {
      setErr(ex.message || "Could not send reset email. Try again later.");
    } finally {
      setBusy(false);
    }
  }

  const isForgot = mode === "forgot";

  return (
    <div className="pm-login-page">
      <div className="pm-login-page__glow pm-login-page__glow--left" aria-hidden="true" />
      <div className="pm-login-page__glow pm-login-page__glow--right" aria-hidden="true" />

      <div className="pm-login-wrap">
        <div className="pm-login-card">
          <header className="pm-login-header">
            <AppBrand variant="login" />
          </header>

          {isForgot ? (
            <form className="pm-login-form" onSubmit={onForgotSubmit}>
              <div className="pm-login-form__intro">
                <h1 className="pm-login-form__title">Reset password</h1>
                <p className="pm-login-form__sub">
                  Enter your account email. We will send a link to set a new password.
                </p>
              </div>

              {err ? <div className="pm-error-banner pm-login-form__error">{err}</div> : null}
              {forgotSuccess ? (
                <div className="pm-login-success-banner" role="status">
                  {forgotSuccess}
                </div>
              ) : null}

              <div className="pm-field">
                <label className="pm-label" htmlFor="forgot-usr">
                  Email or username
                </label>
                <input
                  id="forgot-usr"
                  className="pm-input pm-login-input"
                  type="text"
                  autoComplete="username"
                  placeholder="you@company.com"
                  value={usr}
                  onChange={(e) => setUsr(e.target.value)}
                  required
                  disabled={busy}
                />
              </div>

              <button type="submit" className="pm-btn pm-btn-primary pm-login-submit" disabled={busy}>
                {busy ? "Sending…" : "Send reset link"}
              </button>

              <p className="pm-login-forgot">
                <button type="button" className="pm-login-link-btn" onClick={backToSignIn} disabled={busy}>
                  Back to sign in
                </button>
              </p>
            </form>
          ) : (
            <form className="pm-login-form" onSubmit={onSubmit}>
              <div className="pm-login-form__intro">
                <h1 className="pm-login-form__title">{PAGES.login.title}</h1>
              </div>

              {err ? <div className="pm-error-banner pm-login-form__error">{err}</div> : null}

              <div className="pm-field">
                <label className="pm-label" htmlFor="usr">
                  Email or username
                </label>
                <input
                  id="usr"
                  className="pm-input pm-login-input"
                  type="text"
                  autoComplete="username"
                  placeholder="you@company.com"
                  value={usr}
                  onChange={(e) => setUsr(e.target.value)}
                  required
                  disabled={busy}
                />
              </div>

              <div className="pm-field pm-login-field--pwd">
                <label className="pm-label" htmlFor="pwd">
                  Password
                </label>
                <input
                  id="pwd"
                  className="pm-input pm-login-input"
                  type={showPwd ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                  required
                  disabled={busy}
                />
                <button
                  type="button"
                  className="pm-login-pwd-toggle"
                  onClick={() => setShowPwd((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPwd ? "Hide password" : "Show password"}
                >
                  {showPwd ? "Hide" : "Show"}
                </button>
              </div>

              <button type="submit" className="pm-btn pm-btn-primary pm-login-submit" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </button>

              <p className="pm-login-forgot">
                <button type="button" className="pm-login-link-btn" onClick={openForgot} disabled={busy}>
                  Forgot password?
                </button>
              </p>
            </form>
          )}

          <footer className="pm-login-footer">
            <span className="pm-login-footer__secure" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </span>
            Secured session
          </footer>
        </div>
      </div>
    </div>
  );
}
