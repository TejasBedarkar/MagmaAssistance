import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { dashboard, tasks } from "../api/index.js";
import { useAuth } from "../../../common/context/AuthContext.jsx";
import { PAGES } from "../../../common/constants/branding.js";
import ListPagination from "../../../common/components/ListPagination.jsx";
import { PortalBusyButtonContent } from "../../../common/components/PortalSpinner.jsx";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import ProjectPageLoader from "../components/ProjectPageLoader.jsx";
import MyDayTaskCard from "../components/MyDayTaskCard.jsx";
import { PROJECT_LIST_PAGE_SIZE } from "../components/ProjectDataTable.jsx";
import {
  MY_DAY_SECTIONS,
  filterTasks,
  flattenSections,
  projectOptionsFromSections,
} from "../utils/myDayUtils.js";

/** First section (priority order) that has tasks — used for initial accordion open. */
function firstSectionWithTasks(counts) {
  for (const { key } of MY_DAY_SECTIONS) {
    if ((counts?.[key] ?? 0) > 0) return key;
  }
  return null;
}

export default function MyDay() {
  const { user: currentUser } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [actionId, setActionId] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [viewMode, setViewMode] = useState("sections");
  const hideEmpty = true;
  /** Accordion: only one section expanded at a time (null = all collapsed). */
  const [expandedSection, setExpandedSection] = useState(null);
  const [accordionInitialized, setAccordionInitialized] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    setLoading(true);
    try {
      const d = await dashboard.getMyDayTasks();
      setData(d);
      setUpdatedAt(new Date().toLocaleString());
    } catch (e) {
      setErr(e.message || "Failed to load My Day");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sections = data?.sections || {};
  const counts = data?.counts || {};
  const total = data?.total ?? 0;

  const projectOptions = useMemo(() => projectOptionsFromSections(sections), [sections]);

  const filteredSections = useMemo(() => {
    const out = {};
    for (const { key } of MY_DAY_SECTIONS) {
      out[key] = filterTasks(sections[key] || [], { search, project: projectFilter });
    }
    return out;
  }, [sections, search, projectFilter]);

  const filteredCounts = useMemo(() => {
    const c = {};
    for (const { key } of MY_DAY_SECTIONS) {
      c[key] = (filteredSections[key] || []).length;
    }
    return c;
  }, [filteredSections]);

  const filteredTotal = useMemo(
    () => Object.values(filteredCounts).reduce((n, v) => n + v, 0),
    [filteredCounts]
  );

  const overdueDueCount = useMemo(() => {
    let n = 0;
    for (const { key } of MY_DAY_SECTIONS) {
      for (const t of filteredSections[key] || []) {
        if ((t.days_overdue ?? 0) > 0) n += 1;
      }
    }
    return n;
  }, [filteredSections]);

  useEffect(() => {
    if (!data || accordionInitialized || viewMode !== "sections") return;
    setExpandedSection(firstSectionWithTasks(data.counts));
    setAccordionInitialized(true);
  }, [data, accordionInitialized, viewMode]);

  const flatList = useMemo(() => {
    const rows = flattenSections(filteredSections, filteredCounts);
    return filterTasks(rows, { search: "", project: "" });
  }, [filteredSections, filteredCounts]);

  const {
    page: listPage,
    setPage: setListPage,
    totalPages: listTotalPages,
    pageRows: listPageRows,
    total: listTotal,
    resetPage: resetListPage,
  } = usePagedRows(flatList, PROJECT_LIST_PAGE_SIZE);

  useEffect(() => {
    resetListPage();
  }, [search, projectFilter, viewMode, resetListPage]);

  async function onStatus(taskName, status) {
    setActionId(taskName);
    setErr("");
    try {
      await tasks.updateStatus(taskName, status);
      await load();
    } catch (e) {
      setErr(e.message || "Could not update status");
    } finally {
      setActionId("");
    }
  }

  async function onMarkDevDone(taskName) {
    setActionId(taskName);
    setErr("");
    try {
      await tasks.markDevDone(taskName);
      await load();
    } catch (e) {
      setErr(e.message || "Could not hand over to QA");
    } finally {
      setActionId("");
    }
  }

  function openSection(key) {
    setExpandedSection(key);
    requestAnimationFrame(() => {
      document.getElementById(`my-day-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function toggleSection(key) {
    setExpandedSection((prev) => (prev === key ? null : key));
  }

  const kpiItems = [
    { key: "total", label: "Assigned", value: filteredTotal, tone: "default" },
    { key: "overdue", label: "Overdue", value: overdueDueCount, tone: "danger" },
    { key: "due_today", label: "Due today", value: filteredCounts.due_today ?? 0, tone: "warn" },
    { key: "reopened", label: "Reopened", value: filteredCounts.reopened ?? 0, tone: "warn" },
    { key: "in_progress", label: "In progress", value: filteredCounts.in_progress ?? 0, tone: "info" },
    { key: "qa_testing", label: "QA testing", value: filteredCounts.qa_testing ?? 0, tone: "warn" },
    { key: "qa_approved", label: "QA approved", value: filteredCounts.qa_approved ?? 0, tone: "success" },
    { key: "blocked", label: "Blocked", value: filteredCounts.blocked ?? 0, tone: "warn" },
  ];

  return (
    <div className="pm-page pm-my-day">
      <div className="pm-my-day__hero">
        <div className="pm-my-day__hero-text">
          <h2 className="pm-page-title">{PAGES.myDay.title}</h2>
          <p className="pm-page-desc">{PAGES.myDay.description}</p>
        </div>
        <div className="pm-my-day__toolbar">
          {updatedAt ? <span className="pm-my-day__updated">Updated {updatedAt}</span> : null}
          <button type="button" className="pm-btn" onClick={load} disabled={loading} aria-busy={loading}>
            <PortalBusyButtonContent busy={loading} busyLabel="Refreshing…" idleLabel="Refresh" spinnerSize="xs" />
          </button>
          <Link to="/tasks" className="pm-btn" style={{ textDecoration: "none" }}>
            All tasks
          </Link>
          <Link to="/timesheets/new" className="pm-btn pm-btn-primary" style={{ textDecoration: "none" }}>
            Log time
          </Link>
        </div>
      </div>

      {err ? <div className="pm-error-banner">{err}</div> : null}

      <div className="pm-my-day__kpi-strip" role="group" aria-label="Work summary">
        {kpiItems.map((k) => (
          <button
            key={k.key}
            type="button"
            className={`pm-my-day-kpi${expandedSection === k.key ? " pm-my-day-kpi--active" : ""}`}
            onClick={() => (k.key === "total" ? null : openSection(k.key))}
            disabled={k.key === "total"}
            title={k.key === "total" ? "Total assigned tasks on My Day" : `Jump to ${k.label}`}
          >
            <span className={`pm-my-day-kpi__value pm-my-day-kpi__value--${k.tone}`}>{k.value}</span>
            <span className="pm-my-day-kpi__label">{k.label}</span>
          </button>
        ))}
      </div>

      <div className="pm-my-day__controls">
        <input
          type="search"
          className="pm-my-day__search"
          placeholder="Search task or program…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search tasks"
        />
        <select
          className="pm-my-day__select"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          aria-label="Filter by program"
        >
          <option value="">All programs</option>
          {projectOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="pm-my-day__view-tabs" role="tablist" aria-label="View mode">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "sections"}
            className={`pm-my-day__view-tab${viewMode === "sections" ? " pm-my-day__view-tab--active" : ""}`}
            onClick={() => setViewMode("sections")}
          >
            Sections
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "list"}
            className={`pm-my-day__view-tab${viewMode === "list" ? " pm-my-day__view-tab--active" : ""}`}
            onClick={() => setViewMode("list")}
          >
            Priority list
          </button>
        </div>
      </div>

      {loading && !data ? (
        <ProjectPageLoader message="Loading your workbench…" />
      ) : filteredTotal === 0 ? (
        <div className="pm-my-day__all-clear">
          <h3>{total === 0 ? "You’re all caught up" : "No tasks match your filters"}</h3>
          <p>
            {total === 0
              ? data?.has_pm_assignments === false
                ? "No tasks are assigned to you yet. Your program manager will assign work — you will see items here once tasks are linked to you."
                : "No open assignments right now. Log time on completed work or check the full task list."
              : "Try clearing search or program filter to see more items."}
          </p>
          <div className="pm-toolbar" style={{ justifyContent: "center" }}>
            {total > 0 && (search || projectFilter) ? (
              <button
                type="button"
                className="pm-btn"
                onClick={() => {
                  setSearch("");
                  setProjectFilter("");
                }}
              >
                Clear filters
              </button>
            ) : null}
            <Link to="/timesheets/new" className="pm-btn pm-btn-primary" style={{ textDecoration: "none" }}>
              Log time
            </Link>
            <Link to="/tasks" className="pm-btn" style={{ textDecoration: "none" }}>
              Browse tasks
            </Link>
          </div>
        </div>
      ) : viewMode === "list" ? (
        <div className="pm-my-day__list-view">
          {listPageRows.map((t) => (
            <div key={t.name}>
              <span className="pm-my-day-list-badge">{t.sectionLabel}</span>
              <MyDayTaskCard
                task={t}
                sectionKey={t.sectionKey}
                currentUser={currentUser}
                busy={actionId === t.name}
                onStatus={onStatus}
                onMarkDevDone={onMarkDevDone}
              />
            </div>
          ))}
          <ListPagination
            page={listPage}
            totalPages={listTotalPages}
            total={listTotal}
            pageSize={PROJECT_LIST_PAGE_SIZE}
            onPageChange={setListPage}
          />
        </div>
      ) : (
        MY_DAY_SECTIONS.map(({ key, label, tone, desc }) => {
          const items = filteredSections[key] || [];
          const count = filteredCounts[key] ?? 0;
          if (hideEmpty && count === 0 && expandedSection !== key) return null;
          const isExpanded = expandedSection === key;
          return (
            <section
              key={key}
              id={`my-day-${key}`}
              className={`pm-my-day__section${isExpanded ? " pm-my-day__section--expanded" : " pm-my-day__section--collapsed"}`}
            >
              <button
                type="button"
                className="pm-my-day__section-toggle"
                onClick={() => toggleSection(key)}
                aria-expanded={isExpanded}
              >
                <div>
                  <div className="pm-my-day__section-title-wrap">
                    <h3 className="pm-my-day__section-title">{label}</h3>
                    <span className={`pm-my-day__count pm-my-day__count--${tone}`}>{count}</span>
                  </div>
                  <p className="pm-my-day__section-desc">{desc}</p>
                </div>
                <span className="pm-my-day__section-meta">
                  <span className="pm-my-day__chevron" aria-hidden="true">
                    ▼
                  </span>
                </span>
              </button>
              {isExpanded ? (
                <div className="pm-my-day__section-body">
                  {items.length === 0 ? (
                    <p className="pm-my-day__empty">No tasks in this group.</p>
                  ) : (
                    items.map((t) => (
                      <MyDayTaskCard
                        key={t.name}
                        task={t}
                        sectionKey={key}
                        currentUser={currentUser}
                        busy={actionId === t.name}
                        onStatus={onStatus}
                        onMarkDevDone={onMarkDevDone}
                      />
                    ))
                  )}
                </div>
              ) : null}
            </section>
          );
        })
      )}
    </div>
  );
}
