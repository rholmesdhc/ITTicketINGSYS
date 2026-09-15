# TODO

A running backlog of open items - not tied to a specific release, just
things to come back to. Newest additions go at the bottom of each
section; check an item off (`- [x]`) rather than deleting it once it
ships, so there's a record of when/why.

## Open

- [ ] Remove the User Management page (`/users`, and its card on Admin
      Settings). Worth deciding alongside the Azure AD RBAC review below -
      role is already resolved from Entra security group membership on
      every login (`entra_auth.resolve_role_from_groups`), so this page's
      manual role/clinic-site editing may be redundant with (or
      conflicting with) that as the actual source of truth. Confirm
      before removing, not just delete outright.
- [ ] Review security groups in Azure AD for RBAC - audit
      `ITHelpdesk-Admins`/`ITHelpdesk-Technicians` (and whoever falls
      through to `requester`) against who should actually hold each role
      today.
- [ ] Create the `hr` role's Entra security group (Assigned membership,
      not Dynamic) and add the authorized HR staff (Kim Crout, presumably
      others) - the app-side support already shipped with the onboarding
      feature (`entra_auth.ENTRA_HR_GROUP_ID`, `docker-compose.uat.yml`'s
      pass-through) but the group itself doesn't exist yet, so anyone
      without it falls through to `requester` on login. Once created, its
      Object ID needs to land in `backend/.env` locally AND in the `.env`
      next to `docker-compose.uat.yml` on the UAT VM itself (same place
      `ENTRA_ADMIN_GROUP_ID`/`ENTRA_TECH_GROUP_ID`'s real values already
      live - not in this repo).
- [ ] General mobile web UI pass - the sidebar/dashboard/tickets pages got
      real mobile-responsive work (collapsible drawer, stacked cards,
      etc.), but the rest of the app hasn't had a dedicated mobile review.
- [ ] `TicketUpdate.status` and `.priority` aren't validated - an invalid
      value for either (e.g. `{"status": "banana"}`) hits the Postgres
      enum column unvalidated and 500s instead of cleanly 422ing. Found
      while adding validation for the new `intake_channel` field (below);
      fixing status/priority the same way (a `field_validator` against
      the real enum values) is a clean, contained fix, just out of scope
      of that change.
- [ ] Implement the Knowledge Base module - PRD drafted at
      `docs/knowledge-base-prd.md` (wiki/agent-curated pattern, Postgres
      full-text search for v1, no vector DB/embedding pipeline yet).
      5 open questions in that doc need answers before an implementation
      plan gets written, same two-step process Asset Management went
      through.
- [ ] "Affected Employee" picker (`EmployeeEmailSelect.tsx`, used on new-
      ticket and elsewhere) only searches this app's own `users` table via
      `GET /users/directory` - people who've never logged into the portal
      and haven't been manually added on the Users page simply don't show
      up, even though they're real DHC staff in Entra. This is exactly the
      phone-intake/in-person scenario the intake_channel field was built
      for: a tech takes a call from someone who's never touched the
      portal and can't pick them as the affected employee at all. Fix:
      when the local directory search comes up empty (or maybe always, as
      a merged result), fall back to a live Microsoft Graph `/users`
      search - same app-only Graph pattern already used for
      `mailer.py`'s Graph send path, just a `GET /users?$search=` call
      instead of `POST .../sendMail`.

      Resolved design: picking a Graph result JIT-provisions a local
      `User` row on the spot (so the ticket has a real `affected_user_id`
      to point at), defaulted to `role="requester"` - the same safe floor
      `resolve_role_from_groups` already falls back to on a failed/empty
      group lookup. Deliberately NOT resolving their real role via a live
      group-membership lookup at creation time (`GET /users/{id}/memberOf`
      would need `GroupMember.Read.All` as an application permission -
      separate consent/config from this app's existing delegated scopes -
      just to save one login cycle before the default self-corrects
      anyway). The stub row's `entra_object_id` IS set immediately from
      the Graph search result, though - `login_with_entra` already matches
      on `entra_object_id` before falling back to email, so this person's
      real role gets resolved correctly the moment they actually log in,
      no stale `requester` role left behind. Known accepted tradeoff: this
      creates a permanent `User` row for someone the moment they're
      mentioned, even if they never actually log into the portal (e.g. a
      contractor referenced once) - same minor data-hygiene cost either
      way, not worth solving up front.
- [ ] Ticket provenance isn't visible enough. Two gaps in one: (1) a new
      ticket doesn't show anything for how it came in until a technician
      manually sets `intake_channel` on the detail page - there's no
      indication on a fresh ticket that it's even unset. (2) for a
      self-filed ticket (`intake_channel` null - see models.Ticket's
      docstring, null means "requester filed this online themselves"),
      there's currently no positive statement of that at all, just an
      absence - should instead explicitly read something like "Created
      via the Portal by <requester name>" using the ticket's own
      `requester` relationship (already loaded, already shown elsewhere on
      the detail page), not leave it blank. Likely a single always-visible
      "How this ticket came in" line on the ticket detail page (not
      Technician-Actions-only) that reads the requester's name + "via the
      Portal" when `intake_channel` is null, or the Call/Email/In Person
      label when it's set - rather than two different UI treatments for
      the same underlying field.
- [ ] Position/Title on the onboarding request form (`onboarding/new/page.tsx`)
      needs to be free-text. Checked the current code first: it's already
      an `<input list="job-titles-...">` combobox (a `<datalist>` of
      `OnboardingJobTitle` rows for suggestions, not a locked `<select>`),
      and `schemas.OnboardingCandidateCreate.job_title` has no validator
      restricting it to an existing title either - so typing an arbitrary
      value should already go through end-to-end today. If it isn't
      behaving that way in practice, the real bug is probably the
      datalist combobox not *reading* as free-text (inconsistent/limited
      rendering across browsers, especially mobile Safari - iOS doesn't
      support `<datalist>` suggestion popups the way desktop Chrome does)
      rather than an actual server-side restriction. Reproduce first
      (which browser/device, and does the typed value actually save) before
      assuming this needs a dropdown-to-textbox conversion - it may
      instead need swapping the datalist combobox for a plain text input
      plus a separate autocomplete UI, which is a different fix.
- [ ] Onboarding hardware/account tracking needs to get more granular -
      two related but separate changes:
      1. **Intake form**: "Hardware & Workstation Need" is currently a
         single-select dropdown (`onboarding/new/page.tsx`'s
         `WORKSTATION_TYPES`, backed by `OnboardingCandidate.workstation_type`,
         one String column) - one candidate can only pick one of Dedicated
         Desktop/Laptop/Shared Workstation. Needs to become checkboxes
         instead, so a candidate can need more than one thing at once (a
         laptop AND a cell phone, say), and needs mobile device options
         added that don't exist at all today: tablet, cell phone. This is
         a real schema change, not just a UI tweak - `workstation_type`
         being a single column can't hold multiple selections, so it
         becomes something like a JSON/array column (mirrors how
         `User.ui_preferences` already stores a flexible JSON blob) or a
         separate `OnboardingCandidateHardware` join table if these ever
         need their own status (ordered/issued) later.
      2. **Task checklist**: the fixed Stage 1 task "Windows Domain,
         Server Access, Email & Okta Created" and Stage 2's "NextGen EHR
         Account Creation" (`main.py`'s `_build_default_onboarding_tasks`)
         are each one bundled checkbox today. Break these into separate,
         individually-checkable items - at minimum a distinct "Windows/AD
         login account created" and a "NextGen PM login account created"
         (PM = Practice Management, apparently a distinct NextGen login
         from the general EHR/clinical access already tracked) - so
         progress on one system doesn't silently imply the other is done
         too. Note `triggers_stage1_handoff` currently lives on the single
         bundled Windows/Okta/email task specifically (it's what the
         "Complete Stage 1 & Notify Stakeholders" button keys off) -
         splitting that task needs a decision on which of the resulting
         checkboxes (all of them? a specific one?) actually triggers that
         handoff.

## Done

- [x] Implement the Employee IT Onboarding Workflow - shipped 2026-09-15.
      Superseded the earlier template-driven draft with a much more
      specific HR-initiated spec (see `docs/employee-onboarding-prd.md`
      for the full reconciliation): new `hr` role for Kim, batch new-hire
      submission form with Dental-conditional fields, master/child
      tickets, a fixed Stage 1→2→3 task checklist per candidate, an
      in-portal "Complete Stage 1 & Notify Stakeholders" action that
      generates a suggested email + one-time temp password (never
      persisted), and config-driven notification routing (Settings →
      Onboarding Notifications) instead of hardcoded recipients. Verified
      end-to-end via a real 2-candidate batch through the actual API.
      **Follow-up**: 2 of the 8 people named in the original spec
      ("Candace" - ambiguous, two matches; "Kimberly Crout" - no match)
      couldn't be safely resolved to real accounts and still need to be
      added manually via Settings → Onboarding Notifications.

- [x] Add a "+ New Ticket" button to the Tickets page itself, next to the
      "Jump to ticket #..." search box - shipped 2026-09-14, next to the
      jump-to-ticket box as requested. No `data-tour` id on it, since the
      onboarding tour's "Filing a Ticket" step already spotlights the
      sidebar's own Tickets item, which stays mounted on every page.
- [x] Fix sidebar flyout submenus being hard to select an item on -
      shipped 2026-09-14. `FlyoutNavItem` (components/Sidebar.tsx) now
      delays closing 250ms on mouseleave, cancelled on re-entering either
      the trigger or the flyout, instead of closing instantly. Verified
      with a real diagonal mouse path through the dead zone between the
      trigger and a lower flyout item, ending in an actual click that
      lands correctly.
- [x] Capture how a ticket request came in - shipped 2026-09-14, on the
      ticket detail page's Technician Actions section (not the new-ticket
      form as originally scoped above - a technician setting this after
      the fact, or while triaging, fits better than cluttering the intake
      form). New `intake_channel` field on `Ticket` (call/email/in_person,
      null = online/self-filed), staff-only via the existing PATCH
      /tickets/{id}. Found and fixed a real gap along the way: an invalid
      value 500'd instead of cleanly 422ing (added a Pydantic validator -
      the same gap exists for status/priority, logged separately above
      since fixing those was out of scope here).
