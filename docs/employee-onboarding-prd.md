# Employee IT Onboarding Workflow

**Status:** Shipped (v1)
**Last updated:** 2026-09-15

## Origin

The original draft of this doc (template/case-driven, IT-triggered, no HR
login) was superseded before implementation by a much more specific,
detailed spec the user provided directly: an HR Assistant ("Kim")
submitting new-hire batches through the portal, real named staff/systems
(Davis Hayes, Jamari Griffin, Margaret McGaugh, Okta/NextGen/Dexis/
FastAttach), a 3-table schema, and an in-portal Stage 1 credential-handoff
generator. This doc reflects what was actually built from that spec, not
the earlier draft.

Three architectural decisions were resolved with the user before writing
any code (see git history around 2026-09-15):

1. **Kim's access**: a new `hr` role (`models.RoleEnum.hr`), not admin or
   technician reuse - scoped to onboarding only, no ticket-queue or admin
   settings access. Ticket visibility (`_OWN_TICKETS_ONLY_ROLES` in
   `main.py`) treats `hr` the same as `requester`: sees only tickets they
   personally filed (their onboarding batches' master/child tickets), not
   the full queue.
2. **Temp password storage**: never persisted. `POST
   /onboarding/candidates/{id}/complete-stage1` generates one, returns it
   once in the response body (`schemas.OnboardingStage1Result`), and it's
   gone - no `temp_password` column exists on `onboarding_candidates`.
3. **Notification routing**: config-driven via a new admin-managed
   `OnboardingNotificationRecipient` table (Settings page →
   "Onboarding Notifications"), not hardcoded names in Python - a staffing
   change never needs a code deploy.

## What shipped

### Data model (`backend/models.py`, all Integer PKs - **not** UUID as the
original spec sketched, to match this app's existing convention throughout)

- `OnboardingJobTitle` - admin-managed (Settings page), same CRUD shape as
  `Category`. Drives the new-request form's Position dropdown and
  auto-fills Department (still editable).
- `OnboardingNotificationRecipient` - admin-managed routing rows: which
  `trigger` (`batch_submitted` / `stage1_complete`), optional `department`
  filter (null = always), name/email, and `cc` (To vs CC).
- `OnboardingBatch` - one HR submission. `submitted_by_user_id`, `status`
  (submitted/in_progress/completed/cancelled, auto-advances to `completed`
  once every candidate reaches `ready`), and `master_ticket_id` linking to
  a real `Ticket` row (`[BATCH-YYYY-MM-DD] ...`) so it's visible in the
  existing ticket queue/reporting.
- `OnboardingCandidate` - one per new hire. Name/title/department/site/
  start date/rehire/workstation type, Dental-only conditional fields
  (`requires_dexis`, `requires_fastattach`, `workstation_suite` - `NULL`,
  not `False`, for non-Dental candidates), `assigned_email` (set by Stage
  1 completion), `stage` (derived, see below), and `child_ticket_id`
  linking to its own `Ticket` row.
- `OnboardingTask` - one row per checklist step, **not admin-templated**
  (a deliberate scope cut from the original draft's `OnboardingTemplate`
  idea - this version's stages are fixed and named to real systems, so a
  configurable template wasn't worth the complexity for v1). Fixed set per
  candidate, built in `main.py`'s `_build_default_onboarding_tasks`:
  1. **Stage 1** - "Windows Domain, Server Access, Email & Okta Created"
     (`IT_INFRASTRUCTURE`, unblocked immediately, `triggers_stage1_handoff`).
  2. **Stage 2** - "NextGen EHR Account Creation" (`EHR_ADMIN`); Dental
     candidates also get "Dexis Imaging Access Setup" and/or "FastAttach
     Access Setup" (`IT_INFRASTRUCTURE`) if those were requested. All
     blocked until Stage 1 completes.
  3. **Stage 3** - "Clinical/Role Training" (`CLINICAL_TRAINER`) or
     "Dental Clinical Training" (`DENTAL_TRAINER`) for Dental. Blocked
     until every Stage 2 task for that candidate completes.

  `candidate.stage` (`it_identity` → `ehr_provisioning` →
  `clinical_training` → `ready`) is **recomputed from task status**
  (`_recompute_candidate_stage`), never hand-set - it can't drift out of
  sync with the actual checklist.

### Backend endpoints (`backend/main.py`)

- `GET/POST/PATCH/DELETE /onboarding/job-titles` - GET open to any
  authenticated role (the form needs it), mutations admin-only.
- `GET/POST/DELETE /onboarding/notification-recipients` - admin-only.
- `POST /onboarding/batches` (hr/admin) - creates the master ticket, one
  child ticket + task set per candidate, and fires `batch_submitted`
  notifications (see below).
- `GET /onboarding/batches` / `GET /onboarding/batches/{id}` - hr sees only
  their own (404, not 403, for someone else's - same pattern as ticket
  visibility elsewhere in this app); technician/admin see all.
- `GET /onboarding/tasks` (technician/admin, filters: `assigned_role`,
  `status`, `mine`) - a cross-batch work queue, surfaced on the
  `/onboarding` list page.
- `PATCH /onboarding/tasks/{id}` (technician/admin) - status/assignment;
  refuses a blocked task (400) and refuses the Stage 1 identity task (400,
  points at the endpoint below instead); auto-unblocks the next stage when
  its gating tasks all complete.
- `POST /onboarding/candidates/{id}/complete-stage1` (technician/admin) -
  the "Complete Stage 1 & Notify Stakeholders" action: completes the
  identity task, generates `{firstinitial}{lastname}@<domain>` (collision-
  checked against existing users and other candidates) plus a random temp
  password, unblocks Stage 2, fires `stage1_complete` notifications, and
  returns the password once. Idempotent-guarded (400 if already done).

Notifications reuse the existing `mailer.py`/`notifications.py`
infrastructure (Graph API / SMTP / simulate-log fallback, `BackgroundTasks`
so a slow send never blocks the request). `_send_onboarding_notifications`
queries recipients matching the trigger and (department IS NULL OR
department IN batch's departments) **once per event**, not once per
department - an earlier draft of this double-emailed department-agnostic
recipients when a batch had multiple departments, caught before shipping.

**Deliberate deviation from the spec's draft**: the `stage1_complete`
email to downstream teams (Paychex/NextGen operators) does **not** include
the temp password - only the assigned email/name/start date. Those teams
need to know the identity exists, not the AD credential; emailing a
password in plaintext would undercut the "never persist it" decision by
just relocating the exposure to an inbox instead.

### Frontend (`frontend/src/app/onboarding/`)

- `/onboarding` - batch list (hr: own; technician/admin: all, plus an
  actionable task queue) with a "+ New Onboarding Request" button
  (hr/admin).
- `/onboarding/new` - Single Hire / Batch Submission toggle, Position
  dropdown (datalist, backed by `OnboardingJobTitle`) auto-filling
  Department, and the Dental-conditional block (Dexis checked by default,
  FastAttach unchecked, Suite/Workstation field) that only renders when
  Department = Dental.
- `/onboarding/[id]` - batch detail: per-candidate task checklists, a
  status `<select>` for ordinary tasks, and the "Complete Stage 1 & Notify
  Stakeholders" button in place of the select for the identity task -
  clicking it shows a one-time modal with the generated email + temp
  password and a copy button, explicitly warned as shown-once/not-stored.
- Sidebar: a new "🧑‍💼 Onboarding" item, visible to hr/technician/admin
  only (not plain requesters - this isn't a self-service feature the way
  Tickets is).
- Settings page: "Onboarding Job Titles" and "Onboarding Notifications"
  CRUD sections, same modal pattern as Ticket Categories.
- `users/page.tsx`: `hr` added to both role dropdowns (inline role editor
  and the create/edit user modal).

### Migration

`b7b2b788e585_add_employee_onboarding_tables_and_hr_.py` - adds `hr` to
the existing `roleenum` Postgres type via `ALTER TYPE ... ADD VALUE`
inside an `autocommit_block()` (same requirement as any enum-type change
outside a fresh `CREATE TYPE`), plus the 5 new tables. Downgrade explicitly
drops the 4 new enum types `op.drop_table` leaves orphaned (confirmed via
a real upgrade→downgrade→upgrade round-trip - the first attempt failed
with "type already exists" until this was added) and documents that `hr`
itself can't be cleanly removed from `roleenum` on downgrade (Postgres has
no `DROP VALUE`).

## Verified

- Full upgrade → downgrade → upgrade migration round-trip.
- `tsc --noEmit` and `next build` clean.
- Browser: hr login → role-gated sidebar (Onboarding visible, Admin
  Settings hidden) → new-request form rendering, including the Dental
  conditional block defaulting correctly.
- API-level, end-to-end: submitted a 2-candidate batch (one Dental with
  Dexis only, one Administrative) as hr → correct master/child tickets,
  correct per-candidate task sets, correct blocking → completed Stage 1 as
  a technician → correct generated email (`yroach@...`), password returned
  once and confirmed absent from the DB row → completed Stage 2/3 tasks →
  confirmed the blocked-task guard (400) before its gate is satisfied →
  confirmed stage auto-advanced through all 4 states → confirmed the batch
  auto-completed once both candidates reached `ready` → confirmed hr's
  batch list is scoped to their own submissions only.

## Known gaps / left for later

- **Notification recipients need real data entered.** 6 of the 8 people
  named in the original spec (Davis Hayes, Jamari Griffin, Margaret
  McGaugh, Shanika Kimber, Barbara Flore, Dr. Inge Ford) already exist as
  real users in this system and were seeded as default recipients using
  their real on-file emails. Two could **not** be safely resolved and were
  deliberately left out rather than guessed: "Candace" (Paychex/NextGen CC)
  matches two different existing users, and no "Kimberly Crout" exists in
  the system at all. Add these via Settings → Onboarding Notifications.
- No admin UI to reorder/preview the fixed Stage 1/2/3 task template - it's
  code (`_build_default_onboarding_tasks`), not data. Revisit if a second
  department-specific variant is needed beyond Dental.
- `OnboardingCandidate.clinic_site_id` accepts any existing clinic site;
  no validation ties it to where the chosen job title is actually offered.
- No MCP tool surface yet (the original draft's §6.3 - `list_onboarding_batches`
  etc. - wasn't built this pass).
