---
name: long-task-progress-tracking
description: Use whenever the current request is one step of a longer multi-turn workflow -- filling in a record field by field, moving through the Lead to Opportunity to Quotation to Sales Order pipeline, an onboarding flow, or any conversation that has already gone several turns deep on the same task. Keeps facts grounded in real tool results instead of the model's memory of "how the conversation felt".
triggers: continue, next step, what's next, still working on, going back, follow up, ongoing task, multi step, pipeline
always_on: false
---

## Why this skill exists

The longer a task runs across turns, the easier it is to start
"remembering" things that were never actually confirmed -- a record ID
that was proposed but not created, a field value from three turns ago
that was actually corrected later, a step that was discussed but never
executed. That drift is what produces confident, wrong answers. The fix
is not "try harder to remember" -- it's to stop trusting recall for
anything load-bearing and check instead.

## Ground rules for this turn

1. **Before saying anything happened, find the tool result that proves
   it.** If you're about to say a record "was created", "was updated",
   "was sent", or "is set to X", that claim must trace back to an
   actual tool_result already in this conversation -- a real ID coming
   back from a create, or a list/get call that just confirmed it. If
   you can't point to that result, don't state it as fact: either say
   plainly that you're not sure it went through, or call a read-only
   tool (`erp_data_tool` with `operation='list'`/`'get'`) to check
   before answering. This holds even if the conversation clearly
   *intended* for it to happen.

2. **Never reuse an ID you're not certain is real.** If a Task,
   Project, Lead, etc. ID hasn't appeared verbatim in a tool result in
   this conversation, do not type it into a tool call from memory --
   look it up again instead. A plausible-looking ID is not the same as
   a confirmed one, and using one that was never actually returned
   silently corrupts the rest of the workflow.

3. **State where you are before moving forward.** When continuing a
   multi-step flow, open with a one-line grounding statement of what's
   actually been confirmed so far and what hasn't, e.g.:
   `Confirmed so far: Lead LEAD-00050 created. Not yet done: Project, Tasks, client email.`
   This is cheap, keeps you and the user aligned on real state (not
   assumed state), and makes it immediately obvious if either of you
   has drifted from what actually happened.

4. **One step at a time, still.** Don't chain multiple creates/updates
   together to "catch up" a long-running flow in one shot just because
   the conversation has gone on a while -- each write still needs its
   own confirmation gate, same as turn one.

5. **A long conversation is a reason to re-verify, not a reason to
   summarize from feel.** If several turns have passed since a fact was
   established and it matters for the current step, a quick
   `erp_data_tool` `list`/`get` call is cheap insurance against acting
   on something that was since changed, corrected, or never actually
   went through.
