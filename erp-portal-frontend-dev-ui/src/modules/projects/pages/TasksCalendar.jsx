import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ListFilters from "../../../common/components/ListFilters.jsx";
import ListPagination from "../../../common/components/ListPagination.jsx";
import CalendarEventItem from "../components/CalendarEventItem.jsx";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import useProjectOptions from "../hooks/useProjectOptions.js";
import useTasksData from "../hooks/useTasksData.js";
import ProjectPageLoader from "../components/ProjectPageLoader.jsx";
import { PROJECT_LIST_PAGE_SIZE } from "../components/ProjectDataTable.jsx";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(n) {
  return String(n).padStart(2, "0");
}

function toYmd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

function shortWeekday(date) {
  return new Date(date).toLocaleDateString(undefined, { weekday: "short" });
}

function parseYmd(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    const local = new Date(y, mo, d);
    local.setHours(0, 0, 0, 0);
    return local;
  }
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function startOfDay(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, amount) {
  const d = new Date(date);
  d.setDate(d.getDate() + amount);
  return d;
}

function formatRangeYmd(date) {
  const d = parseYmd(date);
  return d ? toYmd(d) : "—";
}

function diffDaysInclusive(start, end) {
  const one = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.floor((startOfDay(end).getTime() - startOfDay(start).getTime()) / one) + 1);
}

/** Build 6-week grid cells for the month view (includes leading/trailing days). */
function buildCalendarCells(year, month) {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const start = new Date(year, month, 1 - startOffset);
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({
      date: d,
      ymd: toYmd(d),
      inMonth: d.getMonth() === month,
    });
  }
  return cells;
}

export default function TasksCalendar() {
  const { options: projectOptions } = useProjectOptions();
  const { tasks, loading, err } = useTasksData();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [projectFilter, setProjectFilter] = useState("");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState("calendar");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (!t.due_date) return false;
      if (projectFilter && t.project !== projectFilter) return false;
      if (q) {
        const hay = `${t.task_title || ""} ${t.project_name || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, projectFilter, search]);

  const filteredInMonth = useMemo(() => {
    const monthStart = toYmd(new Date(cursor.year, cursor.month, 1));
    const monthEnd = toYmd(new Date(cursor.year, cursor.month + 1, 0));
    return filtered.filter((t) => {
      const due = String(t.due_date || "");
      return due >= monthStart && due <= monthEnd;
    });
  }, [filtered, cursor.year, cursor.month]);

  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(
    filteredInMonth,
    PROJECT_LIST_PAGE_SIZE
  );

  useEffect(() => {
    resetPage();
  }, [projectFilter, search, cursor.year, cursor.month, viewMode, resetPage]);

  const byDate = useMemo(() => {
    const map = {};
    for (const t of pageRows) {
      if (!map[t.due_date]) map[t.due_date] = [];
      map[t.due_date].push(t);
    }
    return map;
  }, [pageRows]);

  const todayYmd = toYmd(new Date());

  const timelineWindow = useMemo(() => {
    const start = new Date(cursor.year, cursor.month, 1);
    const end = new Date(cursor.year, cursor.month + 1, 0);
    const days = [];
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      days.push(new Date(d));
    }
    return { start, end, days };
  }, [cursor.year, cursor.month]);

  const timelineRows = useMemo(() => {
    const rows = pageRows
      .map((task) => {
        const due = parseYmd(task.due_date);
        if (!due) return null;
        const plannedStart = parseYmd(task.start_date || task.planned_start_date || task.created_on);
        const barStart = plannedStart || due;
        let endSource = due;
        if (endSource < barStart) {
          endSource = barStart;
        }

        const start = barStart < timelineWindow.start ? timelineWindow.start : barStart;
        const end = endSource > timelineWindow.end ? timelineWindow.end : endSource;
        if (end < timelineWindow.start || start > timelineWindow.end) return null;
        const offsetDays = diffDaysInclusive(timelineWindow.start, start) - 1;
        const spanDays = diffDaysInclusive(start, end);
        const totalDays = timelineWindow.days.length;
        return {
          ...task,
          timelineStart: barStart,
          timelineEnd: endSource,
          offsetPct: (offsetDays / totalDays) * 100,
          widthPct: (spanDays / totalDays) * 100,
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(a.due_date || "").localeCompare(String(b.due_date || "")));
    return rows;
  }, [pageRows, timelineWindow]);

  const timelineTodayOffsetPct = useMemo(() => {
    const now = new Date();
    if (now < timelineWindow.start || now > timelineWindow.end) return null;
    const offsetDays = diffDaysInclusive(timelineWindow.start, now) - 1;
    return (offsetDays / timelineWindow.days.length) * 100;
  }, [timelineWindow]);

  const cells = useMemo(
    () => buildCalendarCells(cursor.year, cursor.month),
    [cursor.year, cursor.month]
  );

  function prevMonth() {
    setCursor((c) => {
      const m = c.month - 1;
      if (m < 0) return { year: c.year - 1, month: 11 };
      return { year: c.year, month: m };
    });
  }

  function nextMonth() {
    setCursor((c) => {
      const m = c.month + 1;
      if (m > 11) return { year: c.year + 1, month: 0 };
      return { year: c.year, month: m };
    });
  }

  function goToday() {
    const now = new Date();
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
  }

  return (
    <div>
      {err ? <div className="pm-error-banner">{err}</div> : null}
      <div className="pm-card">
        <ListFilters
          projectValue={projectFilter}
          projectOptions={projectOptions}
          onProjectChange={setProjectFilter}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search tasks with due dates…"
        />
        <div className="pm-calendar-toolbar">
          <div className="pm-calendar-toolbar__nav">
            <button
              type="button"
              className="pm-calendar-toolbar__btn"
              onClick={prevMonth}
              aria-label="Previous month"
            >
              ‹
            </button>
            <button
              type="button"
              className="pm-calendar-toolbar__btn"
              onClick={nextMonth}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
          <h3 className="pm-calendar-toolbar__title">{monthLabel(cursor.year, cursor.month)}</h3>
          <button type="button" className="pm-calendar-toolbar__today" onClick={goToday}>
            Today
          </button>
        </div>
        <div className="pm-calendar-view-toggle" role="tablist" aria-label="Calendar view selector">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "calendar"}
            className={`pm-calendar-view-toggle__btn${viewMode === "calendar" ? " is-active" : ""}`}
            onClick={() => setViewMode("calendar")}
          >
            Calendar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "timeline"}
            className={`pm-calendar-view-toggle__btn${viewMode === "timeline" ? " is-active" : ""}`}
            onClick={() => setViewMode("timeline")}
          >
            Timeline
          </button>
        </div>
        {loading ? (
          <ProjectPageLoader
            message={viewMode === "timeline" ? "Loading timeline…" : "Loading calendar…"}
          />
        ) : filteredInMonth.length === 0 ? (
          <div className="pm-calendar-empty">
            <p className="pm-calendar-empty__title">No due tasks for this view.</p>
            <p className="pm-calendar-empty__desc">
              Try changing project filters, search text, or move to another month.
            </p>
          </div>
        ) : viewMode === "timeline" ? (
          <div
            className="pm-timeline"
            style={{ "--pm-timeline-days": timelineWindow.days.length }}
          >
            <div className="pm-timeline__scroll">
              <div className="pm-timeline__axis">
                <div className="pm-timeline__axis-meta" />
                <div className="pm-timeline__axis-track">
                  {timelineWindow.days.map((day) => (
                    <div key={toYmd(day)} className="pm-timeline__tick">
                      <span className="pm-timeline__tick-label">{day.getDate()}</span>
                      {day.getDate() === 1 || day.getDay() === 1 ? (
                        <span className="pm-timeline__tick-sub">{shortWeekday(day)}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
              <div className="pm-timeline__rows">
                {timelineRows.length === 0 ? (
                  <p className="pm-timeline__empty">No tasks with due dates fall inside this month timeline.</p>
                ) : (
                  timelineRows.map((task) => (
                    <div key={task.name} className="pm-timeline__row">
                      <div className="pm-timeline__meta">
                        <Link to={`/tasks/${task.name}`} className="pm-timeline__title">
                          {task.task_title || task.name}
                        </Link>
                        <span className="pm-timeline__sub">{task.project_name || task.project || "—"}</span>
                        <div className="pm-timeline__meta-foot">
                          <span className="pm-timeline__status">{task.status || "Open"}</span>
                        </div>
                      </div>
                      <div className="pm-timeline__track">
                        {timelineTodayOffsetPct != null ? (
                          <span
                            className="pm-timeline__today-line"
                            style={{ left: `${timelineTodayOffsetPct}%` }}
                            aria-hidden
                          />
                        ) : null}
                        <Link
                          to={`/tasks/${task.name}`}
                          className={`pm-timeline__bar pm-timeline__bar--${String(task.status || "open")
                            .replace(/\s+/g, "-")
                            .toLowerCase()}`}
                          style={{ left: `${task.offsetPct}%`, width: `${Math.max(task.widthPct, 2)}%` }}
                          title={`${task.task_title || task.name} · Due ${task.due_date || "—"}`}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="pm-calendar">
            <div className="pm-calendar__weekdays">
              {WEEKDAYS.map((d) => (
                <div key={d} className="pm-calendar__weekday">
                  {d}
                </div>
              ))}
            </div>
            <div className="pm-calendar__grid">
              {cells.map((cell) => {
                const dayTasks = byDate[cell.ymd] || [];
                const isToday = cell.ymd === todayYmd;
                return (
                  <div
                    key={cell.ymd}
                    className={`pm-calendar__day${cell.inMonth ? "" : " pm-calendar__day--muted"}${isToday ? " pm-calendar__day--today" : ""}`}
                  >
                    <div className="pm-calendar__day-num">{cell.date.getDate()}</div>
                    <ul className="pm-calendar__events">
                      {dayTasks.slice(0, 4).map((t) => (
                        <CalendarEventItem key={t.name} task={t} />
                      ))}
                      {dayTasks.length > 4 ? (
                        <li className="pm-calendar__more">+{dayTasks.length - 4} more</li>
                      ) : null}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {!loading && filteredInMonth.length > 0 ? (
          <ListPagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PROJECT_LIST_PAGE_SIZE}
            onPageChange={setPage}
          />
        ) : null}
        <p className="pm-calendar-footnote">
          Tasks appear on their due date in the selected month. Hover an event for details; tasks without a due date are hidden.
        </p>
      </div>
    </div>
  );
}
