import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import AppBrand from "../components/AppBrand.jsx";
import { apiTestPasswordStrength, apiUpdatePassword } from "../api/client.js";
import "../styles/login.css";

export default function UpdatePasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const key = searchParams.get("key") || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [policyOk, setPolicyOk] = useState(true);
  const [policyHint, setPolicyHint] = useState("");

  const passwordsMatch = useMemo(
    () => newPassword.length > 0 && newPassword === confirmPassword,
    [newPassword, confirmPassword]
  );

  const canSubmit = Boolean(key && passwordsMatch && newPassword.length >= 8 && policyOk && !busy);

  useEffect(() => {
    document.body.classList.add("pm-route-login");
    return () => document.body.classList.remove("pm-route-login");
  }, []);

  useEffect(() => {
    if (!newPassword || !key) {
      setPolicyOk(true);
      setPolicyHint("");
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      try {
        const result = await apiTestPasswordStrength(newPassword, key);
        const passed = result?.feedback?.password_policy_validation_passed !== false;
        setPolicyOk(passed);
        setPolicyHint(
          result?.feedback?.suggestions?.[0] ||
            result?.feedback?.warning ||
            (passed ? "" : "Use at least 8 characters with letters, numbers, and symbols.")
        );
      } catch {
        setPolicyOk(true);
        setPolicyHint("");
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [newPassword, key]);

  async function onSubmit(e) {
    e.preventDefault();
    if (!key) {
      setErr("This password link is invalid or has expired.");
      return;
    }
    if (!passwordsMatch) {
      setErr("Passwords do not match.");
      return;
    }

    setErr("");
    setBusy(true);
    try {
      await apiUpdatePassword({ key, newPassword, logoutAllSessions: 1 });
      setDone(true);
      window.setTimeout(() => navigate("/login", { replace: true }), 2000);
    } catch (ex) {
      setErr(ex.message || "Could not update password. Try again or request a new link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pm-login-page">
      <div className="pm-login-page__glow pm-login-page__glow--left" aria-hidden="true" />
      <div className="pm-login-page__glow pm-login-page__glow--right" aria-hidden="true" />

      <div className="pm-login-wrap">
        <div className="pm-login-card">
          <header className="pm-login-header">
            <AppBrand variant="login" />
          </header>

          {!key ? (
            <div className="pm-login-form">
              <div className="pm-login-form__intro">
                <h1 className="pm-login-form__title">Invalid link</h1>
                <p className="pm-login-form__sub">
                  This link is missing, already used, or expired. Request a new one from your administrator.
                </p>
              </div>
              <Link to="/login" className="pm-btn pm-btn-primary pm-login-submit pm-login-submit--link">
                Back to sign in
              </Link>
            </div>
          ) : done ? (
            <div className="pm-login-form">
              <div className="pm-login-form__intro">
                <h1 className="pm-login-form__title">Password saved</h1>
                <p className="pm-login-form__sub">Your account is ready. Redirecting to sign in…</p>
              </div>
              <div className="pm-login-success-banner" role="status">
                You can now sign in with your new password.
              </div>
              <Link to="/login" className="pm-btn pm-btn-primary pm-login-submit pm-login-submit--link">
                Continue to sign in
              </Link>
            </div>
          ) : (
            <form className="pm-login-form" onSubmit={onSubmit}>
              <div className="pm-login-form__intro">
                <h1 className="pm-login-form__title">Set your password</h1>
                <p className="pm-login-form__sub">
                  Choose a secure password to activate your account.
                </p>
              </div>

              {err ? <div className="pm-error-banner pm-login-form__error">{err}</div> : null}

              <div className="pm-field pm-login-field--pwd">
                <label className="pm-label" htmlFor="new-password">
                  New password
                </label>
                <input
                  id="new-password"
                  className="pm-input pm-login-input"
                  type={showPwd ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Enter password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  disabled={busy}
                  autoFocus
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

              {policyHint ? (
                <p className={`pm-login-form__hint${policyOk ? "" : " pm-login-form__hint--error"}`}>
                  {policyHint}
                </p>
              ) : null}

              <div className="pm-field">
                <label className="pm-label" htmlFor="confirm-password">
                  Confirm password
                </label>
                <input
                  id="confirm-password"
                  className="pm-input pm-login-input"
                  type={showPwd ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={busy}
                />
              </div>

              {confirmPassword && !passwordsMatch ? (
                <p className="pm-login-form__hint pm-login-form__hint--error">Passwords do not match.</p>
              ) : null}

              <button type="submit" className="pm-btn pm-btn-primary pm-login-submit" disabled={!canSubmit}>
                {busy ? "Saving…" : "Save password"}
              </button>

              <p className="pm-login-forgot">
                <Link to="/login" className="pm-login-link-btn">
                  Back to sign in
                </Link>
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
