---
name: project-task-creation-order
description: Use whenever the user wants Project Tasks created and/or assigned to someone -- onboarding a new Lead into a Project, adding tasks to an existing Project, or assigning tasks to team members. Prevents trying to assign a Task before it exists.
triggers: create project, new project, project tasks, assign task, assign tasks, onboard lead, onboard new lead, batch tasks, kickoff task, task assignment
always_on: false
---

## The rule

A Task cannot be assigned before it exists. ERPNext only hands back a
real Task `name`/ID (e.g. `TASK-0042`) once the Task has actually been
created -- there is no way to know that ID in advance, and there is no
way to assign a Task that doesn't have one yet. If you ever find
yourself about to call an assignment tool with a Task name you have not
just seen come back from a real `create` result in this conversation,
STOP -- that Task does not exist yet, or you are guessing its ID.

This matters more than it might sound: `reassign_tasks` and
`erp_data_tool` are separate tool calls, and a single AIMessage's tool
calls are all decided by you before any of them run and return a
result. You cannot create a Task and assign it correctly in the same
round of separate tool calls, because you won't have the real ID yet
when you decide the assignment call's arguments.

## Planning: distribute tasks, then resolve employees, before you assign

Before you ever call a composite tool, work out *what* you're assigning
and *who* you're assigning it to -- in that order. **Do this yourself.**
The `dry_run=True` preview (see Confirmation gate below) is where the
user reviews and corrects your draft -- it is not a reason to ask them
upfront for the task list or the names of employees. Only stop and ask
first if step 1 or step 2 below genuinely has nothing to work from.

1. **Decide the task distribution first.** Once you have a real
   Project (see below), derive the tasks from whatever you already
   have:
   - If the user says "based on the description" (or similar) and you
     have the Project's `description` field from the `get`/`list`
     result you already fetched, break *that* description down into a
     sensible set of tasks (`subject`, optional
     `description`/`priority`/`due_date`) yourself. Do not ask the user
     to repeat or re-supply information that's already sitting in the
     Project record you fetched.
   - If the Project record has no `description` and the user hasn't
     given you one either, that's the one case where there's nothing to
     derive from -- ask the user what the tasks should be.
2. **Then resolve real employees automatically.** Don't ask the user to
   name team members and don't guess a name, email, or username into
   `assigned_to`. **Never write down an employee name you have not just
   seen come back from a real `list`/`search` result in this
   conversation** -- this is the exact same rule as the Task-ID rule
   above, just applied to people. Concretely:
   - Before you draft a single task with an assignee, call the
     employee-lookup operation (e.g. `erp_data_tool` `list` against the
     Employee/User doctype, or whatever employee-lookup tool this
     system exposes) and get back the real, current list of employees.
   - Build your task-to-employee matching **only** from names on that
     list. If you invent a plausible-sounding name that isn't on the
     list (e.g. "Rahul Sharma" when no such employee exists), the
     assignment call will fail downstream and you'll end up looping
     back to ask the user for names anyway -- which defeats the point
     of deciding it yourself. Fetching the list first is what makes
     "decide yourself" actually work in one pass.
   - Filter by role/department if the task or project description
     implies one; otherwise distribute reasonably across the fetched
     list.
   - Only ask the user if the fetched list is empty, or if the task
     genuinely needs a skill/role no one on the list plausibly has.

## Handling partial failures from a composite tool's result

A `batch_manage_project_tasks` (or `reassign_tasks`) call can create
some tasks successfully while leaving others unassigned -- e.g. an
employee has no linked User ID, or a name matches more than one user.
When that happens:

- **Don't restart the flow.** Do not go back to asking the user for the
  full task list or the full assignee list again. Every task that
  succeeded is done; leave it alone.
- **Report per-task, specifically.** For each task that didn't fully
  assign, name the task and the exact reason (no linked User ID; or, if
  ambiguous, list the actual candidate matches the tool returned).
- **Ask only for the one missing piece.** If a name was ambiguous, ask
  for the exact email among the candidates already shown -- not a
  fresh round of "please provide names." Once the user supplies it, use
  `reassign_tasks` on just that task's real ID (already in hand from
  the batch result) rather than touching anything else.
3. **Match each task to an employee.** Pair the tasks from step 1 with
   the employees found in step 2 (by role fit, workload, or whatever
   criteria the description/user implies) so every task in your list
   has a real `assigned_to` next to it.
4. **Only then hand the finished list to a composite tool.** The
   `tasks=[...]` array you pass to `batch_manage_project_tasks` (or
   `onboard_new_lead`) should already have both `subject` and the
   resolved `assigned_to` filled in for every item -- the composite
   tool still does create -> get real Task ID -> assign internally, per
   the rule above, but the *distribution* decision (which task goes to
   which person) needs to be made by you beforehand, not left implicit,
   and not punted back to the user as a question.

## What to use instead

Do **not** hand-chain `erp_data_tool(operation='create', doctype='Task', ...)`
followed by `reassign_tasks` in the same turn and expect the ID to line
up. Use the composite tools built for exactly this, which internally do
create -> (get the real ID back) -> assign, in the correct order, with
one call:

- **Tasks going onto a Project that already exists** (including a
  Project you or the user just created this conversation, as long as
  you already have its real `name` from a tool result):
  call `batch_manage_project_tasks(project_name=..., tasks=[...])`.
  Each item in `tasks` needs `subject` and `assigned_to`; `due_date`,
  `priority`, `description` are optional.

- **The full new-client flow** (Lead -> Project -> Tasks -> client
  email, all in one go): call `onboard_new_lead(lead_name=..., tasks=[...], ...)`.
  Do not manually create the Project first and then call
  `batch_manage_project_tasks` for this case -- `onboard_new_lead`
  already does the whole chain, including the email step, and doing it
  in pieces risks the same ordering problem this skill exists to avoid.

- **Reassigning a Task that already exists** (you have its real ID or
  it's unambiguous from a `list`/`get` result already in this
  conversation): use `reassign_tasks`. Never try to set an
  `assigned_to`/`_assign` field via `erp_data_tool`'s `update` operation
  -- Task has no such writable field; assignment only ever happens
  through `frappe.desk.form.assign_to.add`, which is what
  `reassign_tasks` / `batch_manage_project_tasks` call under the hood.

## Confirmation gate

Both composite tools default to `dry_run=True`. Call once with the
default, show the user the exact preview (what will be created and who
it will be assigned to), and only call again with `dry_run=False` after
they explicitly confirm -- same write-approval rule as every other
write in this system. Do not skip straight to `dry_run=False` even if
the user's request already sounded final ("create and assign these
three tasks to Priya") -- that phrasing states intent, not approval of
the specific preview.

## Quick self-check before calling anything

1. Do I have a real Project `name`/ID from an actual tool result (not
   assumed)? If not, resolve or create the Project first.
2. Am I creating new Tasks, assigning existing ones, or both? Pick the
   one composite tool above that matches -- don't mix manual
   `erp_data_tool` creates with a separate assignment call for tasks
   that don't exist yet.
3. Have I derived the task distribution myself (from the Project's
   `description` or the user's request) and, before naming a single
   assignee, fetched the real employee list and matched only against
   names on it -- never an invented name -- for every `assigned_to`
   before building the `tasks=[...]` array?
4. If a previous batch-assign call left some tasks unassigned, am I
   resolving just those specific tasks (using the real IDs I already
   have) instead of re-asking for the whole task/assignee list?
5. Have I shown the `dry_run=True` preview and gotten an explicit "yes"
   before calling again with `dry_run=False`?