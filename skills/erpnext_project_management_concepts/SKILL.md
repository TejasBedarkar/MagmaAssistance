---
name: erpnext-project-management-concepts
description: Use when the user asks about a Project's cost, budget, profitability, billable hours, or timesheets, or wants the Project/Task/Timesheet concepts explained, or wants to stand up a new project end-to-end including time tracking. Covers how Project Cost and Project Profitability are actually computed in MagnaERP, so the assistant doesn't present an incomplete number as a finished answer.
triggers: project cost, project budget, project profitability, timesheet, timesheets, billable hours, log time, track time, budget vs actual, project report, profit margin, how much did this project cost
always_on: false
---

## The concepts, in MagnaERP's own terms

- **Project** — the central record for a piece of work. It's not just a
  task list: Quotations, Sales Orders, Delivery Notes, Sales Invoices,
  Purchase Requests, Purchase Orders and Purchase Invoices can all be
  linked to it, which is what makes MagnaERP able to report on a
  project's real budget, delivery, and profitability instead of just
  its checklist status. When creating any of those linked documents for
  work that belongs to an existing Project, link it to that Project --
  don't leave it unlinked and force someone to reconcile it by hand
  later.

- **Task** — one unit of work under a Project, assigned to a single
  resource, with its own priority, start/end dates, and optionally
  dependencies on other Tasks. (See the `project-task-creation-order`
  skill for the create-before-assign rule when actually creating
  Tasks.)

- **Timesheet** — where actual hours get logged, broken down by which
  Task/activity the time was spent on, and whether it was billable.
  Timesheets are what MagnaERP uses to compute real cost and, for
  billable work, what gets invoiced to the customer. `erp_data_tool`
  with `doctype='Timesheet'` reads/writes these like any other doctype.

- **Project Cost** — NOT a fixed number set when the Project is
  created. It's derived from actual time logged in Timesheets against
  the Project's Tasks. If the team hasn't been logging Timesheets, the
  reported cost will be understated or effectively zero -- that's a
  data-completeness problem, not evidence the project is under budget.

- **Project Profitability** — revenue recognized against the Project
  (via its linked Sales Invoices/billing) minus its Project Cost as
  defined above. It inherits the same caveat: profitability is only as
  trustworthy as the Timesheet data feeding the cost side of it.

## What this means for how you answer

- If asked for a Project's cost, budget status, or profitability, check
  whether its Tasks actually have Timesheet entries before presenting a
  number as complete. If Timesheets are sparse or missing, say so
  explicitly ("Cost data may be incomplete -- no time has been logged
  against N of this Project's Tasks") rather than reporting a clean
  figure that's silently built on missing data.
- If the user says a project "seems way under budget" or "profitability
  looks great," check Timesheet coverage before agreeing -- that
  reading is often just missing time logs, not a real result.
- Don't offer to bulk-create or backfill Timesheets on someone's behalf
  to "fix" a cost report -- time logs are a record of what an
  individual actually worked on and should come from them, not be
  invented to make a number look complete.

## Standing up a new project end-to-end

When asked to fully set up a new project (not just create one record),
this is the sequence MagnaERP's Project module is built around:

1. **Create the Project shell**: `erp_data_tool(operation='create', doctype='Project', ...)`
   with name, status, type, and any known scope details.
2. **Create and assign its Tasks**: follow the `project-task-creation-order`
   skill exactly -- use `batch_manage_project_tasks` (or `onboard_new_lead`
   for a brand-new client) rather than a manual create-then-assign chain.
3. **Time tracking happens as the work happens**: Timesheets get logged
   by each assignee as they actually do the work, not created up front.
   Mention this to the user as part of the plan ("cost/profitability
   reporting on this Project will reflect reality once the team starts
   logging time against these Tasks") rather than treating Timesheets
   as a step you complete during setup.
