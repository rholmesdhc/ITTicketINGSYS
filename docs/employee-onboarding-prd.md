# PRD: Employee IT Onboarding Workflow

**Status:** Draft for review
**Author:** Drafted with Claude Code, from a design discussion
**Last updated:** 2026-09-11

## Origin and dependencies

Unlike the Asset Manager PRD (grounded in an external product review) or
the Knowledge Base PRD (grounded in an architecture evaluation), this one
comes straight out of a design conversation - there's no external
reference product being mapped here, just this org's actual gap. It does
lean on two other in-flight pieces of work, though: hardware issuance in
this PRD's v1.1 (§5.2) assumes the **Employee Equipment Request module**
(sketched in the platform review, not yet PRD'd) and the **Asset
Manager's** check-in/check-out phase both exist - v1 itself doesn't
depend on either.

## 1. Context and Problem

There's no structured onboarding tracking anywhere in this app today. New-
hire IT setup - Entra account, workstation, EHR/application access - happens
ad hoc: some mix of tickets, verbal follow-up, and things that quietly
fall through the cracks. The individual pieces exist informally (user
provisioning, asset check-out once that module ships, one-off tickets for
setup requests), but nothing ties them together into "is this new hire
actually fully set up," and nothing gives technicians a repeatable,
role-based template so setup isn't reinvented - or partially forgotten -
for every single new hire.

For a healthcare org specifically, "who had EHR access, from when to
when" is a real compliance question this app currently has no way to
answer at all.

## 2. Goals

- One place to see "is this new hire fully onboarded" - a checklist, not
  a scattered set of tickets, emails, and a spreadsheet somewhere.
- Role/department templates so setup is consistent - a tech setting up a
  new nurse doesn't have to remember from scratch that EHR access is
  needed; a billing clerk's template simply doesn't include it.
- Real integration with what already exists or is already planned, not a
  parallel tracking system: hardware issuance flows through Equipment
  Request/Asset checkout once those exist; application access gets
  verified against actual Entra group membership, not just a checkbox
  someone can forget to actually action.
- A timestamped, auditable record - who set up what, when - as a
  compliance asset for a healthcare org, not just an ops convenience.
- Lay groundwork offboarding (the mirror workflow) can reuse later
  without a redesign, even though building offboarding itself is out of
  scope for v1 (see §6.5).

## 3. Non-Goals (v1)

- Anything HR-owned: I-9/paperwork, benefits enrollment, orientation
  scheduling, payroll setup. Hard line - **IT-controlled steps only**
  (accounts, hardware, application/EHR access, badge access *if* IT
  actually provisions that here - see Open Question 3).
- Offboarding itself - the data model should accommodate it later, but
  the actual offboarding workflow is not being built in v1.
- Automating Entra account **creation**. Creating the account is (today)
  a manual admin action in the Azure portal; v1 tracks/checklists that
  step, it doesn't call Graph to create the account itself. Automating
  the creation is a possible Later item (§5.3), not v1 or v1.1.
- A generic project/task-management tool. Scoped to the onboarding use
  case specifically, not a Trello-style board for arbitrary checklists.

## 4. Personas

- **IT Admin/Technician**: creates a case when notified of a new hire,
  works the checklist, marks steps complete, fulfills hardware/access
  requests.
- **Manager/HR** (indirect in v1): the actual trigger - "we have a new
  hire starting Monday" - but doesn't need a login of their own yet;
  today that's an email or conversation a technician turns into a case.
  A lightweight intake path for them directly is v1.1 (§5.2).
- **New hire**: not really a user of this feature at all in v1 - they
  can't log into this app before their Entra account exists. This is an
  internal IT tracking tool, not requester-facing like tickets or the KB.
- **AI agents**: an MCP tool surface mirroring tickets/assets - "what's
  the status of Jane Doe's onboarding," "start an onboarding case from
  the Clinical Staff template" - same shape as the existing tools.

## 5. Scope: Feature Set

### 5.1 Core (v1)

- **`OnboardingTemplate` + `OnboardingTemplateStep`** (admin-managed,
  same CRUD shape as ticket categories) - e.g. a "Clinical Staff"
  template with steps: Entra account created, workstation issued, EHR
  (NextGen) access granted, email/M365 access confirmed, badge access.
- **`OnboardingCase`**: new hire name, department, template used, start
  date, site, assigned technician, status (in progress / complete),
  created_at.
- **`OnboardingTask`**: one row per checklist step on a case, **copied**
  from the template at case-creation time - not a live pointer, matching
  this app's existing point-in-time-record philosophy (the same reason
  ticket categories don't retroactively rewrite already-filed tickets).
  Status (pending/done), completed_by, completed_at, optional note.
- **Manual completion** - a technician checks off each step by hand in
  v1; no automated verification yet (that's v1.1).
- **Case list** (open/complete) + **case detail page** (the checklist) +
  **template management** under Admin Settings, same modal pattern as
  ticket/asset categories.
- **Basic email notifications**, reusing `mailer.py` - the assigned
  technician on case creation, optionally the requesting manager once a
  case is fully complete.

### 5.2 Important (v1.1)

- **Hardware issuance auto-links to Equipment Request/Asset checkout** -
  marking a hardware step "done" really means "fulfill this Equipment
  Request," not two disconnected trackers of the same physical laptop.
  Depends on the Equipment Request module and the Asset Manager's
  checkout phase both existing.
- **Application-access verification** against real Entra group
  membership (a Graph API read) instead of a blind checkbox - a step can
  show "verified" vs. "marked done, not yet confirmed."
- **Overdue-step reminders**, reusing the existing SLA-banner visual
  pattern already on the Tickets page.
- **A lightweight intake path** for a manager/HR to request a new case
  without a full account - a simple authenticated form, or an
  email-to-case flow.

### 5.3 Later (v2+)

- **Offboarding workflow** - the mirror of this, reusing the same
  case/task shape (see §6.5 for how the schema is meant to stay open to
  this). Deliberately deferred, not forgotten.
- **Automated Entra account creation/group assignment** via Graph API -
  actually *doing* the provisioning, not just checklisting/verifying it.
- **Digital signoff** - a manager confirming onboarding is complete, not
  just IT marking its own checklist done.
- **Reporting**: average time-to-fully-onboarded, which steps most often
  run late.

## 6. Architecture

### 6.1 Backend (FastAPI, extends the existing app)

- New tables: `onboarding_templates`, `onboarding_template_steps`,
  `onboarding_cases`, `onboarding_tasks`. Alembic migrations following the
  established pattern.
- Role-gated endpoints under `/onboarding` - admin manages templates
  (mirroring `/categories`), technician+ manages cases/tasks day to day
  (mirroring how ticket updates are already gated).
- Case creation copies the chosen template's steps into real
  `OnboardingTask` rows, not a live FK - editing a template later never
  retroactively changes an in-progress case's checklist (Open Question 4
  flags the one real tradeoff this creates).

### 6.2 Frontend (Next.js, new routes alongside existing ones)

- `/onboarding` list page (open/complete cases), `/onboarding/[id]`
  detail page (the checklist), template management under Admin Settings.
- Sidebar: a single new item to start - a flyout (like Tickets/Admin
  Settings) only once this actually grows a second child (e.g. Cases vs.
  Templates); adding a flyout for a one-page v1 feature would be
  premature.

### 6.3 MCP Server (`mcp-server/`, new tools alongside existing ones)

- `list_onboarding_cases`, `get_onboarding_case`,
  `create_onboarding_case`, `complete_onboarding_task` - same
  docstring/parameter conventions and service-account auth as the
  existing ticket/asset tools.

## 7. Non-Functional Requirements

- **Auth**: same Entra ID SSO, no new role tier - admin manages
  templates, technician+ manages cases, matching how day-to-day
  ticket/asset operations are already gated.
- **Audit**: `OnboardingTask` completion records (who, when) are exactly
  the kind of immutable, timestamped record this app already commits to
  elsewhere (the Asset Manager's audit history, tickets' point-in-time
  fields) - same discipline applies here, and matters more given the
  compliance angle in §1.
- **HIPAA-adjacent posture**: no PHI in onboarding notes, same
  policy-not-technical-enforcement warning used everywhere else in this
  app.

### 6.5 Data model relationship, and staying open to offboarding

```
OnboardingTemplate (admin-managed, e.g. "Clinical Staff")
       └── OnboardingTemplateStep (e.g. "Grant NextGen access")

OnboardingCase (one per new hire)
       ├── template_id ──▶ OnboardingTemplate (which one was used)
       ├── new_hire_user_id ──▶ User (once their account exists)
       ├── assigned_tech_id ──▶ User (existing)
       └── OnboardingTask (copied from the template's steps at creation)
              ├── (v1.1) linked Equipment Request ──▶ Asset checkout
              └── (v1.1) verified_against_entra: bool
```

Offboarding (§5.3) is deliberately not built in v1, but the schema is
meant to stay cheap to extend into it - either a parallel
`OffboardingCase`/`OffboardingTask` pair reusing the same template
mechanism, or a shared table with a `direction` (onboarding/offboarding)
discriminator. Open Question 5 asks whether to decide that naming now
rather than after v1 ships and a rename gets expensive.

## 8. Success Metrics

- % of new hires with a fully-completed onboarding case within N days of
  their start date.
- Reduction in "the new hire still doesn't have X" tickets/complaints - a
  real signal that exists informally today and should visibly drop.
- Time from case creation to fully onboarded.

## 9. Open Questions (for you, before implementation planning starts)

1. Who actually triggers a case in v1 - does HR/a manager get any access
   at all, or does IT create every case manually off an email or
   conversation? Decides whether a requester-facing intake form is v1 or
   v1.1.
2. Should hardware issuance in v1 already assume Equipment Request
   exists, or is it acceptable for v1 to launch before that module does
   (deferring the link itself to v1.1, per §5.2)? A sequencing question,
   not a design one.
3. Does IT actually provision badge/physical access at Delta Health
   Center, or is that a different department entirely? Decides whether
   "badge access" belongs in the template step library at all.
4. Confirm the "copy template steps into the case at creation, not a live
   pointer" tradeoff (§6.1) is right - it matches this app's existing
   philosophy, but means an in-progress case never picks up a step added
   to its template after the fact. Acceptable, or does that scenario
   actually come up?
5. Naming: `OnboardingCase`/`OnboardingTask` now, with an offboarding
   rename/parallel table later, or design the `direction` discriminator
   in from day one (§6.5)? Cheap to decide now, not cheap after v1 ships.
