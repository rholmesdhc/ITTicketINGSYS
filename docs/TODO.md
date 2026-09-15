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
- [ ] Implement the Employee IT Onboarding Workflow - PRD drafted at
      `docs/employee-onboarding-prd.md` (template-driven checklist per
      new hire, not a special ticket type). v1 stands alone; v1.1 links
      hardware steps to Equipment Request/Asset checkout and verifies
      access against real Entra group membership. 5 open questions in
      that doc need answers before an implementation plan gets written.

## Done

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
