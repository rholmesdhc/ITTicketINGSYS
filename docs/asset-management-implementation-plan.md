# Implementation Plan: Asset Management Module

**Status:** Draft for review
**Companion to:** [`asset-management-prd.md`](./asset-management-prd.md)
**Last updated:** 2026-08-17

Sequenced to ship value early (a technician can look up and check out a real
asset well before reservations or depreciation exist), while respecting real
dependencies (you can't build a typed custom field UI before the field
*definitions* model exists; you can't build reservation conflict-checking
before checkout exists). Complexity tags (S/M/L) are relative sizing, not
calendar estimates - useful for prioritizing within a phase, not for
scheduling against a deadline.

Includes one phase (0.5) that isn't asset-specific - a platform-navigation
change motivated by Asset Management but broader than it, since the goal
stated for this whole project is IT Operations generally ("tickets,
assets, and other apps in the future"), not a one-off feature.

## Phase 0 - Decisions & Setup (blocking, do first)

The PRD's six open questions aren't just review comments - several of them
change what gets built in Phase 1+, so answering them isn't optional
groundwork, it's a real dependency.

| Decision | Blocks |
|---|---|
| RBAC mapping (existing 3 roles vs. a finer tier) | Every role-gate in every later phase |
| Barcode/QR: pre-printed tags vs. in-house label printing | Phase 4 scope (whether a print-layout feature is needed at all) |
| Jack/hosted-AI role in intake flow | Whether Phase 9 exists at all for v1, or is purely speculative |
| Fund/grant tracking relevance to this org | Whether it's in Phase 7 or cut entirely |
| Typed-field-defs + JSON-values approach, confirmed | Phase 1's schema design |
| Digital signature capture - near-term or truly later | Whether any signature-capture groundwork belongs in Phase 5's checkout flow, even if the full form-builder (Phase 8) doesn't |

**Also in Phase 0** (technical, not product, decisions):
- Barcode/QR generation library (frontend) and camera-scan library
  (`getUserMedia`-based - confirm target browsers/devices actually support
  it reliably; this is the one piece of the whole plan with real
  device/browser-compatibility risk worth spiking before committing to it
  in Phase 4).
- Confirm `ClinicSite` can safely gain a child `AssetLocation` table without
  touching its existing use by `User.clinic_site_id` - it can (additive,
  no existing FK changes), but worth a quick read of every current
  `ClinicSite` reference before Phase 1 to make sure nothing assumes it's
  a flat, childless table.

**Exit criteria:** all six PRD open questions have an answer; barcode
library and camera-scan approach chosen (or spiked).

## Phase 0.5 - Platform Shell: App Switcher Navigation (Frontend, S)

Not asset-specific. Do this before or alongside Phase 2, not after Asset
Management ships - it's a prerequisite for the *shell* Phase 2's UI gets
built into, not a follow-on cleanup task.

**Why now:** the current header (`dashboard/page.tsx`, `settings/page.tsx`,
and every other authenticated page) is a flat, hardcoded link row scoped
entirely to tickets - a title, conditional admin-only links, theme toggle,
logout. That's fine for one app. Bolting an `/assets` section onto it and
restructuring the nav *after* Asset Management ships means migrating every
page's header twice instead of once. This project's own stated goal - "IT
Operations" generally, tickets and assets and other apps to come - means
the nav needs to be built for N modules from the start, not retrofitted
after the second one arrives.

- **App switcher**: a dropdown in the header, next to the logo, listing
  the functional areas the current role can access - Tickets, Assets (once
  Phase 2+ exists), and room for what's next. An "Automations"/"AI Agents"
  app - surfacing Jack's classifier status, MCP tool activity, the
  triage-fallback rate - is a plausible near-future addition given how
  central that integration has already been to this project; the switcher
  should be built assuming more entries arrive, not just these two.
- **Account/admin menu stays separate, not nested inside either app**:
  Settings, User Management, Theme, Logout are cross-cutting - Settings
  already manages ticket categories today and will manage asset
  categories/locations/field-defs per Phase 2, so it can't sensibly live
  "inside" one app's own menu.
- **Role-scoped app list**: resolved from the same role already used for
  every other permission check in this app (no new role/permission
  concept) - requester sees Tickets only for now; technician/admin see
  both, and later, whatever else gets added.
- **Pattern choice**: a header dropdown, not a persistent sidebar -
  proportionate at 2 apps. A sidebar is the natural next evolution once
  the app count grows past roughly 4-5; migrating from a header switcher
  to a sidebar later doesn't require changing how individual pages are
  built, only the chrome around them, so this isn't a decision that locks
  in future pain.
- **Surfaces a small, worthwhile refactor**: the header is currently
  duplicated inline across six pages (`dashboard`, `tickets/new`,
  `tickets/[id]`, `users`, `settings`, plus `login`'s own simpler
  unauthenticated version). This phase is the natural point to extract a
  single shared header component instead of adding a seventh copy of the
  switcher markup - not scope creep, just not deferring an already-overdue
  cleanup any further.

**Exit criteria:** every authenticated page uses one shared header
component with the app switcher and account menu; switching between
Tickets and (once built) Assets preserves login state and doesn't
needlessly reload the app shell.

## Phase 1 - Data Model Foundation (Backend, S-M)

Everything else depends on this. No user-facing surface yet.

- Alembic migrations, in order: `asset_categories` (seeded with sensible
  defaults - mirrors how ticket categories were seeded), `asset_locations`
  (child of `clinic_sites`), `asset_category_field_defs` (name, type enum,
  required, options-for-select), extend `assets` (category FK, status enum,
  location FK, assigned-to FK, photo URL, custom field values JSON column).
- SQLAlchemy models for all of the above (`backend/models.py`), following
  the existing `Category`/`ClinicSite` shape - simple, no FK-on-history
  surprises.
- No new tables for maintenance/checkout/reservations/warranties yet -
  those are Phase 5/7, kept out of Phase 1 so the initial migration set
  stays reviewable.

**Exit criteria:** `alembic upgrade head` runs clean locally; every new
table exists with the right columns/constraints; no application code
depends on this yet (verified by migrating and just inspecting the schema).

## Phase 2 - Core CRUD + Admin UI (Backend + Frontend, M)

- Backend: role-gated CRUD endpoints - `/asset-categories`,
  `/asset-locations`, `/asset-category-field-defs`, `/assets` (create,
  list with filters, get-by-id, update) - admin-gated for
  category/location/field-def management, technician+ for asset
  create/update, matching the RBAC mapping locked in Phase 0.
- Frontend: admin management UI for sites→locations, categories, and
  per-category field definitions under `/settings` (same modal
  list-plus-edit pattern as the ticket-categories CRUD already shipped).
- Frontend: `/assets` list/search page (table + filters: category, site,
  location, status, assigned user) and `/assets/new` manual-entry form
  (typed fields rendered per their definition - date picker, currency
  input, URL field, select dropdown), `/assets/[id]` detail page showing
  everything entered so far. No scanning, no check-in/out, no history yet
  - just CRUD.

**Exit criteria:** an admin can define a category with custom fields, and a
technician can create/search/view an asset using them, end-to-end through
the UI - no backend-only verification, this phase isn't done until it's
usable.

## Phase 3 - Ticket Integration (Backend + Frontend, S)

- Replace the ticket form's free-text numeric "Asset ID" input with a real
  searchable picker (reusing the `EmployeeEmailSelect` typeahead pattern).
- `GET /assets/{id}` returns linked tickets (the existing `Ticket.asset_id`
  relationship, just newly surfaced) - render on the asset detail page.
- No changes needed to the `Ticket`/`asset_id` schema itself - it already
  exists; this phase is purely about making the existing link usable
  instead of requiring a technician to already know a numeric ID.

**Exit criteria:** filing a ticket lets you search-and-pick a real asset by
name/tag instead of typing a number; that asset's detail page shows the
ticket.

## Phase 4 - Scanning & Barcode/QR (Frontend, M)

Depends on Phase 0's library/device spike.

- Generate a barcode/QR image per asset (encodes id/tag), shown on the
  asset detail page.
- Camera-capture component: scan-to-lookup (jump straight to an asset's
  detail page) and scan-to-populate (fill the Asset Tag ID field during
  entry on `/assets/new`, per the PRD's §5.1 finding that the demo uses
  scanning as a data-entry method, not just lookup).
- No native app - browser camera access only, per the PRD's non-goals.

**Exit criteria:** scanning a generated code on a phone browser both looks
up an existing asset and can populate a new one's tag field.

## Phase 5 - Lifecycle: Check-In/Check-Out + Audit History (Backend + Frontend, M)

- New `asset_checkout_history` table; status transitions
  (in stock ↔ checked out ↔ in maintenance ↔ disposed).
- Check out to a staff member with an optional due date; check back in.
  Overdue items surfaced on the dashboard, reusing the existing SLA-banner
  pattern.
- Full immutable audit log per asset (every check-in/out, status change,
  field edit) rendered on the detail page - this is the "point-in-time
  history" piece the PRD calls out as a core requirement, not an
  afterthought, so it lands in this phase rather than being bolted on
  later.
- If Phase 0 flagged digital-signature capture as a near-term need: a
  minimal signature-on-checkout capture (not the full form builder from
  Phase 8) belongs here. Otherwise, skip - full form customization stays
  in Phase 8.

**Exit criteria:** a technician can check an asset out to themselves or a
coworker, see it go overdue on the dashboard if not returned, check it back
in, and see the complete history on the asset's page.

## Phase 6 - MCP Server Tools (M)

Thin wrappers over the Phase 2/3/5 REST endpoints, same shape as the
existing ticket tools - can start as soon as those endpoints are stable,
doesn't block on Phase 4/7/8/9.

- `list_assets`, `get_asset`, `create_asset`, `checkout_asset`,
  `checkin_asset`, `search_assets` - same auth (existing service accounts,
  Entra client-credentials flow), same docstring/parameter conventions as
  `create_ticket`/`list_tickets`.
- `reserve_asset` added once Phase 7's reservation model exists.

**Exit criteria:** the same MCP smoke test pattern already used for ticket
tools - create/query/check-out an asset via an MCP-connected agent
end-to-end.

## Phase 7 - v1.1 Operational Depth (Backend + Frontend, L)

Independent sub-features - can be sequenced in any order relative to each
other based on actual priority once Phase 0-6 ship, listed here roughly in
the order the demo introduces them:

- **Reservations**: `asset_reservations` table, date-range booking with
  conflict detection against existing reservations, error response
  including next-available-date on conflict (matches the PRD's §6.4
  reservation-logic description).
- **Maintenance scheduling**: `asset_maintenance_events` table, recurring
  schedule by date/interval, overdue maintenance on the dashboard,
  history log (technician, work performed, cost).
- **Warranty/contract tracking**: expiry alerts at 30/60/90 days via the
  existing `mailer.py`/`notifications.py` infrastructure - no new
  notification system needed.
- **Bulk import**: CSV/spreadsheet upload with column-mapping UI (source
  headers → platform fields) and an import preview step before commit -
  richer than a fixed-template importer, per the demo's actual workflow.
- **Straight-line depreciation**: calculated field per asset (needs
  purchase date + cost + useful-life, already captured as typed custom
  fields in Phase 1/2 - this phase adds the calculation and reporting, not
  new data collection).
- **Fund/grant tracking**: a field linking an asset to a grant/budget code
  - only if Phase 0 confirmed it's actually relevant to this org.
- **Audit-cycle reminders**: scheduling *when* a site's next physical audit
  is due, surfaced as a dashboard reminder (lighter than Phase 8's full
  walk-and-reconcile mode).
- **Reporting**: fixed MVP report set (asset list, check-out/reservation
  history, maintenance due/overdue, warranty expiry), CSV export - reusing
  the dashboard's existing export pattern.

**Exit criteria:** each sub-feature ships and is verified independently;
this phase doesn't have a single "done" gate the way earlier phases do.

## Phase 8 - v2+ / Later (Backend + Frontend, L, not currently scheduled)

Explicitly deferred per the PRD - listed here for completeness and so
nothing gets silently forgotten, not because it's next in line:

- Full audit/reconciliation mode (physical walk, scan, found/missing/moved
  report).
- Multi-asset bundling/kits (composite assets checked out as one unit).
- Custom event-form builder (drag-and-drop, mandatory-field rules, digital
  signatures beyond whatever minimal capture Phase 5 might have added).
- Declining-balance/sum-of-years-digits depreciation methods.
- Inventory-style stock-quantity tracking (consumables) - different data
  model from serialized one-asset-one-record tracking, deliberately scoped
  separately rather than forced into the existing `Asset` model.
- Insurance policy tracking.

## Phase 9 - Hosted AI Agent Integration (varies, contingent)

Only proceeds if Phase 0 confirms Jack (or a similar service) has an actual
intake-time role. Two parts, and they don't have to happen together:

1. **Reachability spike** (do this *early*, even before the rest of Phase 9
   is prioritized) - the triage integration this session only discovered
   the office-network-blocks-cross-VM-traffic constraint fairly late,
   after most of the feature was otherwise built. Test whether this app's
   backend can reach (or be reached by) whatever AI service would consume
   this contract, before designing around an assumption.
2. **The actual contract**: a versioned `POST /assets/{id}/classify`-style
   endpoint (or the reverse - this app calling out, mirroring
   `backend/triage.py`'s existing pattern) for photo-based
   category/condition suggestions at intake time.

**Exit criteria:** a real end-to-end call succeeds against the actual
external service, not just a mocked/local test - this integration's whole
risk profile is network reachability, so the verification has to prove
that, not assume it.

## Suggested sequencing at a glance

```
Phase 0 (decisions) ──▶ Phase 1 (data model) ──▶ Phase 2 (core CRUD/UI) ──┬──▶ Phase 3 (ticket integration)
              │                                                          ├──▶ Phase 4 (scanning)
              └──▶ Phase 0.5 (app switcher) ─────────────────────────────┼──▶ Phase 5 (checkout/history) ──▶ Phase 7 (v1.1 depth)
                   (can start as soon as Phase 0 closes -                └──▶ Phase 6 (MCP tools, ongoing alongside 3-5)
                    doesn't depend on Phase 1's schema at all)

Phase 8 (later) - unscheduled, informed by real usage after v1/v1.1 ship
Phase 9 (AI integration) - reachability spike can run anytime after Phase 0; the rest is contingent on that decision
```

Phases 3, 4, and 5 can run in parallel once Phase 2 lands, if there's more
than one person working this - they touch different parts of the frontend
and don't block each other. Phase 6 (MCP) is naturally parallel work
throughout, since it never blocks the human-facing UI. Phase 0.5 is the
most independent phase in the plan - it touches existing pages, not new
asset ones, so it can genuinely happen in parallel with Phase 1's backend
work rather than waiting on it.
