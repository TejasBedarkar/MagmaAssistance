import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getDoc } from "../../../common/api/client.js";
import ProjectPageLoader from "../components/ProjectPageLoader.jsx";
import ProjectDeliveryHub from "../components/ProjectDeliveryHub.jsx";
import useProjectAuth from "../hooks/useProjectAuth.js";

export default function ProjectDeliveryPage() {
  const { id } = useParams();
  const { isManager } = useProjectAuth();
  const backTo = isManager ? `/projects/${id}` : "/team";
  const backLabel = isManager ? "Program details" : "Team";
  const [projectName, setProjectName] = useState("");
  const [status, setStatus] = useState("Draft");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setErr("");
      setLoading(true);
      try {
        const doc = await getDoc("PM Project", id);
        if (!cancelled) {
          setProjectName(doc.project_name || id);
          setStatus(doc.status || "Draft");
        }
      } catch (e) {
        if (!cancelled) setErr(e.message || "Could not load program");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="pm-page pm-form-page">
        <ProjectPageLoader message="Loading delivery plan…" />
      </div>
    );
  }

  if (err) {
    return (
      <div className="pm-page pm-form-page">
        <Link to={backTo} className="pm-back-link">
          ← {backLabel}
        </Link>
        <div className="pm-error-banner">{err}</div>
      </div>
    );
  }

  return (
    <div className="pm-page pm-delivery-page pm-delivery-page--full">
      <header className="pm-delivery-page__head">
        <Link to={backTo} className="pm-back-link">
          ← {backLabel}
        </Link>
        <div className="pm-delivery-page__title-row">
          <h1 className="pm-delivery-page__title">Delivery plan</h1>
          <span className="pm-delivery-page__program">{projectName}</span>
        </div>
        <p className="pm-delivery-page__desc">
          {isManager
            ? "Plan milestones and tasks for this program. Program setup and approval stay on the program page."
            : "View milestones and tasks assigned to you on this program."}
        </p>
      </header>

      <ProjectDeliveryHub projectId={id} projectStatus={status} layout="page" showSubmitCta={false} />
    </div>
  );
}
