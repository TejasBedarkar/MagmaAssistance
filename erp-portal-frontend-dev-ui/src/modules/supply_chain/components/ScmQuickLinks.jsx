import { Link } from "react-router-dom";

/** Cross-module / related page links in SCM page headers. */
export default function ScmQuickLinks({ links = [] }) {
  if (!links.length) return null;
  return (
    <div className="scm-page-header-links">
      {links.map(({ to, label }) => (
        <Link key={to} to={to} className="scm-btn-ghost">
          {label}
        </Link>
      ))}
    </div>
  );
}
