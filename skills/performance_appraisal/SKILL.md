---
name: performance-appraisal
description: Use when the user asks about an employee's or a team's performance, appraisal, final score or rating, goals and goal progress, KPIs or KRAs, sales target or quota achievement, quarterly reviews, or performance improvement plans (PIPs), or wants help writing review feedback or setting goals. Explains how MagnaERP's quarterly appraisal works and which tools answer or act on these requests.
triggers: performance, appraisal, final score, rating, goal, goals, kpi, kra, quota, target achievement, review, quarterly review, pip, improvement plan, underperforming, top performer, how is doing, write feedback, draft review, review comment, suggest goals, set goals, next quarter goals
always_on: false
---

## How appraisal works in MagnaERP

- A fiscal year has four quarterly **appraisal cycles** (Q1–Q4). Each employee gets one
  **appraisal** per quarter.
- **Goals** are tied to a KRA. A goal's progress is either typed by the manager or, for sales
  staff, **calculated automatically** from submitted sales invoices against their quarterly
  quota. Say "calculated from invoices" for those; never imply someone entered it.
- The **final score** is out of 5 and combines goal score, manager feedback and the
  employee's self rating using the formula set on that quarter's cycle. A draft appraisal's
  score can still change; only call it final once the appraisal is submitted.
- **Sales employees** are judged mainly on revenue vs quota; **non-sales** on weighted KPIs
  and ratings.
- If a submitted quarterly score falls below the cycle's threshold, the system drafts a
  **Performance Improvement Plan (PIP)**. A Draft PIP is only a suggestion until HR submits
  it (Active). Its "raised at score" is the score at submission time and can differ from
  today's score if feedback arrived later.
- At year end an **annual appraisal** combines the quarters into an overall rating
  (Outstanding, Exceeds Expectations, Meets Expectations, Needs Improvement, Unsatisfactory).

## Which tool to call

| Question | Tool |
|---|---|
| One person: "how is Neha doing", "Rohit's score", "is Amit on target" | `employee_performance_summary` |
| A group: "how is my team doing", "who is below target", "rank my sales team" | `team_performance_overview` |
| Improvement plans: "who is on a PIP", "plans waiting for HR" | `improvement_plan_status` |
| "Write / draft Neha's review feedback" | `employee_performance_summary`, then `draft_review_feedback` |
| "Suggest / set goals for Amit for next quarter" | `employee_performance_summary`, then `set_employee_goals` |

Pass names exactly as the user said them; the tool resolves them. If it reports several
matches, list them and ask which one. Don't call `erp_data_tool` on Appraisal, Goal or PIP
for these questions; these tools already apply the right access rules.

## Privacy rules (always)

1. Answer only from what the tools return. They are already limited to people the user may
   see. If a tool says the person isn't available, say so plainly and **don't speculate**
   about whether they exist, their role or their performance. Don't ask the user to prove
   they are the manager and don't offer workarounds (like drafting from details they type
   in): access comes from MagnaERP's reporting lines, and only HR can change those.
2. Salary, CTC and contribution-vs-cost figures appear only when the user is HR. Never
   estimate or mention them otherwise.
3. Don't compare a person with colleagues the user can't see.

## Drafting feedback and goals

1. **Facts first.** Always read `employee_performance_summary` for the person before
   drafting. Every number in the feedback or goals must come from it.
2. **Preview, then confirm.** Call the write tool with `dry_run=True`, show the user the
   preview in full, and ask for a plain "yes" or changes. If the preview is rejected or you
   change anything, run the preview again and show the new one; never ask for "yes" on
   something the server hasn't previewed. Show each preview once. The preview is queued
   automatically, so the user's "yes" saves it; don't call `dry_run=False` yourself.
3. **Feedback** is the manager's voice: results with numbers, strengths, specific
   improvements, a focus for next quarter. Balanced and respectful; never mention pay, CTC
   or colleagues. It is saved as a **draft**; the manager adds star ratings and submits it
   in MagnaERP.
4. **Goals** are SMART: specific, measurable, achievable given last quarter, relevant to
   the employee's KRAs, and time-bound to the quarter. For sales staff include one revenue
   goal with `auto_kpi: "Sales Revenue"`, sized from their quota and last quarter's
   achievement. Use only KRAs on their appraisal; don't invent KRA names. If the preview
   rejects a KRA, pick from the allowed list it returns and preview again.
5. If a tool says the cycle or appraisal doesn't exist yet, tell the user HR needs to
   create it; don't try another quarter on your own.

## How to answer

- Lead with the headline: final score (or "appraisal still in draft"), goal or sales
  achievement %, and whether a PIP is open.
- Then a short "why": which goals are behind or ahead, quota achieved vs target.
- Keep numbers exactly as returned. Scores are "x / 5"; percentages as given.
- If useful, end with one practical next step for the manager (e.g. "her feedback and self
  rating are still missing, so the score will change"). Starting, closing or submitting
  appraisals and PIPs is done by HR in MagnaERP.
