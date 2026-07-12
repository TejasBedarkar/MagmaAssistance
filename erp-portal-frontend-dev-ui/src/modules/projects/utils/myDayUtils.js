export const MY_DAY_SECTIONS = [
  {
    key: "overdue",
    label: "Overdue",
    tone: "danger",
    desc: "Past due — resolve or update commitment",
  },
  {
    key: "due_today",
    label: "Due today",
    tone: "warn",
    desc: "Finish before end of day",
  },
  {
    key: "reopened",
    label: "Reopened",
    tone: "warn",
    desc: "Program manager reopened — press Start to resume development",
  },
  {
    key: "blocked",
    label: "Blocked",
    tone: "warn",
    desc: "Blocked by program manager — waiting on decision or external input",
  },
  {
    key: "qa_testing",
    label: "QA testing",
    tone: "warn",
    desc: "Ready for or in QA review",
  },
  {
    key: "qa_approved",
    label: "QA approved",
    tone: "success",
    desc: "Awaiting program manager closure",
  },
  {
    key: "rework",
    label: "Rework",
    tone: "warn",
    desc: "Fix issues and resume development",
  },
  {
    key: "in_progress",
    label: "In progress",
    tone: "info",
    desc: "Active work in flight",
  },
  {
    key: "open",
    label: "Open",
    tone: "default",
    desc: "Not started yet",
  },
];

export function formatDue(due) {
  if (!due) return "—";
  try {
    return new Date(due).toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  } catch {
    return due;
  }
}

export function relativeDueLabel(due, sectionKey) {
  if (!due) return "No due date";
  if (sectionKey === "overdue") return "Past due";
  if (sectionKey === "due_today") return "Due today";
  if (sectionKey === "reopened") return "Reopened";
  try {
    const d = new Date(due);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    const diff = Math.round((d - today) / 86400000);
    if (diff === 1) return "Due tomorrow";
    if (diff > 1) return `Due in ${diff} days`;
    if (diff < -1) return `${Math.abs(diff)} days overdue`;
    return formatDue(due);
  } catch {
    return formatDue(due);
  }
}

export function priorityTone(priority) {
  const p = String(priority || "").toLowerCase();
  if (p === "urgent" || p === "high") return "danger";
  if (p === "medium") return "warn";
  return "default";
}

export function statusTone(status) {
  const s = String(status || "").toLowerCase();
  if (s === "completed") return "success";
  if (s === "cancelled" || s === "overdue" || s === "blocked") return "danger";
  if (s === "in progress") return "info";
  if (s === "dev done" || s === "qa testing" || s === "rework") return "warn";
  if (s === "qa approved") return "success";
  return "default";
}

export function urgencyRank(sectionKey) {
  const order = {
    overdue: 0,
    due_today: 1,
    reopened: 2,
    blocked: 3,
    qa_testing: 4,
    qa_approved: 5,
    rework: 6,
    in_progress: 7,
    open: 8,
  };
  return order[sectionKey] ?? 9;
}

export function flattenSections(sections, counts) {
  const rows = [];
  for (const { key, label, tone } of MY_DAY_SECTIONS) {
    for (const task of sections[key] || []) {
      rows.push({ ...task, sectionKey: key, sectionLabel: label, sectionTone: tone });
    }
  }
  rows.sort((a, b) => {
    const ra = urgencyRank(a.sectionKey);
    const rb = urgencyRank(b.sectionKey);
    if (ra !== rb) return ra - rb;
    const da = a.due_date || "9999";
    const db = b.due_date || "9999";
    return da.localeCompare(db);
  });
  return rows;
}

export function filterTasks(tasks, { search, project }) {
  const q = (search || "").trim().toLowerCase();
  return tasks.filter((t) => {
    if (project && t.project !== project) return false;
    if (!q) return true;
    const hay = `${t.task_title || ""} ${t.project_name || ""} ${t.name || ""} ${t.status || ""}`.toLowerCase();
    return hay.includes(q);
  });
}

export function projectOptionsFromSections(sections) {
  const map = new Map();
  for (const list of Object.values(sections || {})) {
    for (const t of list || []) {
      if (t.project && !map.has(t.project)) {
        map.set(t.project, t.project_name || t.project);
      }
    }
  }
  return [...map.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
