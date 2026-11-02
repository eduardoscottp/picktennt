# Picktennt Linear Guide (for agents)

Workspace: **Idddeas** · Team: **Idddeas (IDD)**

## 1. Structure

### Projects (one per platform)

| Project | Scope |
|---|---|
| `Picktennt Web` | Pages, user flows, and browser dashboards (Next.js). |
| `Picktennt Android` | Android app and Wear OS scoreboard. |
| `Picktennt iOS` | iPhone app, Apple Watch app, App Store compliance. |
| `Picktennt Backend` | Supabase: schema, migrations, RLS, auth, edge functions, integrations (DUPR, Google OAuth). |

Rule: every issue belongs to **exactly one project**. If a feature needs changes on two platforms, split it into one issue per platform. If it needs new data, create the Backend issue first and link it as a blocker.

### Labels (exactly one type label per issue)

| Label | Use when |
|---|---|
| `Design` | Screens, flows, or visual decisions must be made or drawn. |
| `Feature` | New functionality or a new technical capability is built. |
| `Improvement` | Something that already works should be better (UX, speed, polish). |
| `Bug` | Something that existed works incorrectly. |
| `Review` | Work that is already built must be tested, audited, or validated. |

Do not use the legacy labels that were already in the workspace for Picktennt issues.

### Statuses (development stage)

`Backlog` → `Todo` → `In Progress` → `In Review` → `Done`

`Canceled` and `Duplicate` are only for discarded work.

### Priority

- **Urgent:** breaks production or an active tournament.
- **High:** blocks another issue.
- **Medium:** planned improvement.
- **Low:** idea or nice-to-have.

## 2. Issue template

**Title:** verb + what + where. Example: `Show player ranking in the organizer dashboard`. Do not put the platform in the title; the project already shows it.

**Description** (use these headings, in this order):

```
## Goal
One or two sentences: what problem this solves and for whom.

## Scope (in)
- Concrete, verifiable things that will be done.

## Out of scope
- Things explicitly not done, to prevent extra work.

## Acceptance criteria
- [ ] Observable condition 1
- [ ] Observable condition 2

## Likely areas
Folders, screens, or tables that will be touched (if known).

## Dependencies
- Blocked by: IDD-xx (if any)
```

**Final comment** (required when moving to `In Review` or `Done`):

```
## Summary
- Done: ...
- Pending: ... (or "Nothing")
- Wins: what improved for the product, in plain language
- How to test: short steps so Eduardo can see it
```

Maximum 5 bullets per section. No logs or code in the comment.

## 3. Triage: when to split an issue

New issues start in **Triage** or **Backlog**. Split an issue into several if **any** of these is true:

- It touches more than one project.
- It has more than 6 acceptance criteria.
- It cannot be finished and tested in one work session.
- It mixes types (for example, design and feature: do `Design` first, then a linked `Feature` issue).

Typical order: `Picktennt Backend` → platform project → `Review`.

## 4. Rules for agents

1. Before starting, confirm the issue has Goal, Scope, Out of scope, and Acceptance criteria. If anything is missing, ask before coding.
2. When you start, move the issue to `In Progress`.
3. Do not expand scope. If you find extra work, create a new issue and link it; never do it silently.
4. Verify every acceptance criterion before closing. Anything not verified goes under "Pending".
5. When finished: write the final comment and move to `In Review` (if Eduardo should review) or `Done` (for docs or already-validated work).
6. Never change the project or the type label without leaving a comment explaining why.

## 5. Best practices

- **One issue = one verifiable result.** If it cannot be tested, it is not ready.
- **Write scope before coding.** "Out of scope" matters as much as "Scope (in)".
- **Backend first.** A data change blocks web and apps; create it and link it.
- **Short titles that start with a verb.** They keep the board readable.
- **Stale work:** an issue in `In Progress` with no activity for a week must be updated or moved back to `Todo`.
- **Duplicates:** mark them `Duplicate` and link the original.

## 6. Recommended views (for Eduardo)

Create these saved views in Linear (Views → New view). Agents cannot create views.

| View | Filter |
|---|---|
| Now | Status = In Progress |
| To review | Status = In Review |
| Open bugs | Label = Bug, Status is not Done or Canceled |
| Pending design | Label = Design, Status is not Done |
| Done this week | Status = Done, completed in the last 7 days |
| Per platform | Project = each of the four Picktennt projects |

Group the project views by status and sort by priority to see each platform's progress at a glance.
