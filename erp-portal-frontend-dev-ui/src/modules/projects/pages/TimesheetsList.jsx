import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { timesheets } from "../api/index.js";
import ListFilters from "../../../common/components/ListFilters.jsx";
import ListPagination from "../../../common/components/ListPagination.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import useServerPagedList from "../../../common/hooks/useServerPagedList.js";
import useProjectOptions from "../hooks/useProjectOptions.js";
import { PortalBusyButtonContent } from "../../../common/components/PortalSpinner.jsx";
import ProjectPageLoader from "../components/ProjectPageLoader.jsx";
import useProjectAuth from "../hooks/useProjectAuth.js";
import { PROJECT_LIST_PAGE_SIZE } from "../components/ProjectDataTable.jsx";

const MANAGER_FILTERS = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending approval" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];

export default function TimesheetsList() {
  const { isManager } = useProjectAuth();
  const { options: projectOptions } = useProjectOptions();
  const [managerFilter, setManagerFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("");
  const [actionId, setActionId] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [localErr, setLocalErr] = useState("");

  const fetchPage = useCallback(
    (page, pageSize) =>
      timesheets.listPage({
        page,
        pageSize,
        statusFilter: isManager ? managerFilter : "all",
        project: projectFilter,
      }),
    [isManager, managerFilter, projectFilter]
  );

  const { page, setPage, rows, total, totalPages, loading, err, reload } = useServerPagedList({
    fetchPage,
    pageSize: PROJECT_LIST_PAGE_SIZE,
    deps: [managerFilter, projectFilter, reloadToken, isManager],
  });

  const showBulk = isManager && managerFilter === "pending";
  const pageRows = rows;

  const pendingOnPage = useMemo(
    () => pageRows.filter((r) => r.status === "Submitted"),
    [pageRows]
  );
  const allPendingSelected =
    pendingOnPage.length > 0 && pendingOnPage.every((r) => selected.has(r.name));

  useEffect(() => {
    setSelected(new Set());
  }, [managerFilter, projectFilter, page]);

  useEffect(() => {
    if (!isManager) {
      setPendingCount(0);
      return;
    }
    let cancelled = false;
    timesheets
      .listPage({ page: 1, pageSize: 1, statusFilter: "pending", project: projectFilter })
      .then((data) => {
        if (!cancelled) setPendingCount(data?.total || 0);
      })
      .catch(() => {
        if (!cancelled) setPendingCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [isManager, projectFilter, reloadToken]);

  function bumpReload() {
    setReloadToken((n) => n + 1);
    reload();
  }

  function toggleRow(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPendingSelected) {
        pendingOnPage.forEach((r) => next.delete(r.name));
      } else {
        pendingOnPage.forEach((r) => next.add(r.name));
      }
      return next;
    });
  }

  async function bulkAction(action) {
    const names = [...selected];
    if (!names.length) return;
    const verb = action === "Approved" ? "approve" : "reject";
    if (!window.confirm(`${verb} ${names.length} selected timesheet(s)?`)) return;
    setBulkBusy(true);
    try {
      const res = await timesheets.approveBulk(names, action);
      const failed = res?.failed || [];
      const ok = res?.succeeded?.length || 0;
      if (failed.length) {
        throw new Error(
          `${ok} updated. ${failed.length} failed: ${failed
            .slice(0, 3)
            .map((f) => f.name)
            .join(", ")}${failed.length > 3 ? "…" : ""}`
        );
      }
      setSelected(new Set());
      bumpReload();
    } catch (e) {
      setLocalErr(e.message || "Bulk action failed");
    } finally {
      setBulkBusy(false);
    }
  }

  const bannerErr = localErr || err;

  async function quickAction(timesheetName, action) {
    setActionId(timesheetName);
    setLocalErr("");
    try {
      await timesheets.approve(timesheetName, action);
      bumpReload();
    } catch (e) {
      setLocalErr(e.message || "Action failed");
    } finally {
      setActionId("");
    }
  }

  return (
    <div className="pm-page">
      {!isManager ? (
        <div className="pm-page-actions">
          <Link to="/timesheets/new" className="pm-btn pm-btn-primary" style={{ textDecoration: "none" }}>
            Log time
          </Link>
        </div>
      ) : null}

      {isManager ? (
        <div className="pm-filter-tabs" role="tablist" aria-label="Timesheet filters">
          {MANAGER_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={managerFilter === f.id}
              className={`pm-filter-tab${managerFilter === f.id ? " pm-filter-tab--active" : ""}`}
              onClick={() => setManagerFilter(f.id)}
            >
              {f.label}
              {f.id === "pending" && pendingCount > 0 ? ` (${pendingCount})` : ""}
            </button>
          ))}
        </div>
      ) : null}

      {showBulk && selected.size > 0 ? (
        <div className="pm-bulk-bar" role="toolbar" aria-label="Bulk timesheet actions">
          <span className="pm-bulk-bar__count">{selected.size} selected</span>
          <button
            type="button"
            className="pm-btn pm-btn-primary"
            disabled={bulkBusy}
            onClick={() => bulkAction("Approved")}
            aria-busy={bulkBusy}
          >
            <PortalBusyButtonContent busy={bulkBusy} busyLabel="Approving…" idleLabel="Approve selected" />
          </button>
          <button type="button" className="pm-btn" disabled={bulkBusy} onClick={() => bulkAction("Rejected")} aria-busy={bulkBusy}>
            <PortalBusyButtonContent busy={bulkBusy} busyLabel="Rejecting…" idleLabel="Reject selected" />
          </button>
          <button
            type="button"
            className="pm-btn pm-btn-ghost"
            disabled={bulkBusy}
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      ) : null}

      {bannerErr ? <div className="pm-error-banner">{bannerErr}</div> : null}
      <div className="pm-card">
        <ListFilters
          projectValue={projectFilter}
          projectOptions={projectOptions}
          onProjectChange={setProjectFilter}
        />
        {loading ? (
          <ProjectPageLoader message="Loading timesheets…" />
        ) : (
          <>
            <div className="pm-table-wrap">
              <table className="pm-table">
                <thead>
                  <tr>
                    {showBulk ? (
                      <th className="pm-table__check-col">
                        <input
                          type="checkbox"
                          aria-label="Select all pending on this page"
                          checked={allPendingSelected}
                          disabled={!pendingOnPage.length || bulkBusy}
                          onChange={toggleAllOnPage}
                        />
                      </th>
                    ) : null}
                    <th>Project</th>
                    <th>Task</th>
                    <th>Date</th>
                    <th>Hours</th>
                    <th>Status</th>
                    {isManager ? <th>Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={(isManager ? 6 : 5) + (showBulk ? 1 : 0)} className="pm-empty">
                        {isManager && managerFilter === "pending"
                          ? "No timesheets pending approval. Use Pending approval when team members submit entries."
                          : "No timesheets match filters"}
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((r) => {
                      const busy = actionId === r.name;
                      return (
                        <tr key={r.name}>
                          {showBulk ? (
                            <td className="pm-table__check-col">
                              {r.status === "Submitted" ? (
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${r.name}`}
                                  checked={selected.has(r.name)}
                                  disabled={bulkBusy}
                                  onChange={() => toggleRow(r.name)}
                                />
                              ) : null}
                            </td>
                          ) : null}
                          <td>
                            <Link to={`/timesheets/${r.name}`} title={r.project}>
                              {r.project_name || r.project}
                            </Link>
                          </td>
                          <td title={r.task}>{r.task_title || r.task}</td>
                          <td>{r.date || "—"}</td>
                          <td>{r.hours}</td>
                          <td>
                            <StatusPill>{r.status}</StatusPill>
                          </td>
                          {isManager ? (
                            <td>
                              {r.status === "Submitted" ? (
                                <div className="pm-table-actions">
                                  <button
                                    type="button"
                                    className="pm-btn pm-btn-primary"
                                    disabled={busy}
                                    onClick={() => quickAction(r.name, "Approved")}
                                    aria-busy={busy}
                                  >
                                    <PortalBusyButtonContent busy={busy} busyLabel="Approving…" idleLabel="Approve" spinnerSize="xs" />
                                  </button>
                                  <button
                                    type="button"
                                    className="pm-btn"
                                    disabled={busy}
                                    onClick={() => quickAction(r.name, "Rejected")}
                                    aria-busy={busy}
                                  >
                                    <PortalBusyButtonContent busy={busy} busyLabel="Rejecting…" idleLabel="Reject" spinnerSize="xs" />
                                  </button>
                                </div>
                              ) : (
                                <Link to={`/timesheets/${r.name}`} className="pm-btn pm-btn-ghost">
                                  Open
                                </Link>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <ListPagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={PROJECT_LIST_PAGE_SIZE}
              onPageChange={setPage}
            />
          </>
        )}
      </div>
    </div>
  );
}
