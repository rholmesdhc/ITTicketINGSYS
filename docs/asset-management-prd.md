# PRD: Asset Management Module (AssetTiger-Inspired)

**Status:** Draft for review
**Author:** Drafted with Claude Code, from an AssetTiger product review
**Last updated:** 2026-08-17

## Reference material

Grounded in two sources now: AssetTiger's documented feature set
([assettiger.com/features](https://www.assettiger.com/features)) and
third-party coverage
([GetApp](https://www.getapp.com/operations-management-software/a/assettiger/),
[Capterra](https://www.capterra.com/p/151021/AssetTiger/),
[SelectHub](https://www.selecthub.com/p/asset-tracking-software/assettiger/)),
plus a timestamped transcript summary you supplied for the specific demo
video ([AssetTiger Demo](https://www.youtube.com/watch?v=0sJOZ7Ws9u0)),
which superseded my earlier caveat about not having access to its actual
content. The transcript's workflow segments are treated as the authoritative
source for *what this specific product actually walks through*; the
"AI Prompts" block that accompanied it (a separate synthesized artifact from
the same tool, not the video's own content) was used only to cross-check
specific field names/types where it plausibly reflects what's on-screen
(e.g., the custom-field list in §5.1) - not copied in as requirements on its
own authority.

## 1. Context and Problem

The ticketing system already has a minimal, bare-bones asset concept - an
`Asset` model (`backend/models.py`) with just `asset_tag`, `type`, and
`location`, linked to tickets via a free-text numeric "Asset ID" field on the
ticket form (`frontend/src/app/tickets/new/page.tsx`). There's no lifecycle,
no check-in/check-out, no maintenance tracking, no depreciation, and no way
to browse or search assets at all - a technician has to already know an
asset's numeric ID to reference it.

Delta Health Center needs real IT/equipment asset tracking (workstations,
monitors, medical devices, mobile equipment) across its clinic sites, and
wants it to be a first-class part of the same system technicians already
live in for tickets, not a separate tool. AssetTiger is the reference product
for what "real" asset tracking looks like; this PRD scopes an in-house
equivalent, deeply integrated with the existing ticketing workflow and this
project's existing architecture (FastAPI + Postgres backend, Next.js
frontend, FastMCP `mcp-server`, Entra ID auth), rather than a bolt-on.

## 2. Goals

- Give techs/admins a real system of record for physical assets: what
  exists, where it is, who has it, and its full history.
- Make "file a ticket about this asset" and "see every ticket ever filed
  against this asset" a first-class, two-way link - not a numeric ID typed
  from memory.
- Support the operational lifecycle that actually drives IT work: check-out
  and date-ranged reservation, preventive maintenance scheduling,
  warranty/contract expiry alerts, and eventual disposal.
- Expose assets to AI agents two ways: as **MCP tools** (so Claude-Code-style
  conversational agents already used across this project can query/manage
  assets), and as a **documented API surface** other hosted AI services
  (Jack-style classifiers/assistants) can call into or be called from.
- Reuse this codebase's existing patterns rather than reinvent them: Alembic
  migrations, role-gated FastAPI endpoints (`RoleEnum.admin`/`technician`/
  `requester`), the Users/Settings admin-CRUD UI pattern, Entra ID auth.

## 3. Non-Goals (v1)

- Barcode label **printing** hardware integration (label sheet layout
  templates) - scanning/lookup, and scanner-input during entry, are in
  scope; physical label printing workflows are a fast-follow.
- Multi-organization/multi-tenant support - this app serves one
  organization (Delta Health Center); AssetTiger's "manage multiple
  entities from one login" is not relevant here.
- Full general-ledger financial integration (depreciation is tracked and
  reported, not posted to an external accounting system).
- Native mobile app - the existing frontend is a responsive web app
  (confirmed mobile-friendly ticket cards already exist for the dashboard);
  a dedicated iOS/Android app is out of scope for v1, though the scanning
  workflow should work fine from a phone browser's camera.
- Drag-and-drop custom event-form builder (see §5.3) - AssetTiger's own
  demo treats this as an advanced/later configuration step, and it's a
  meaningfully large feature (a form builder) on its own.

## 4. Personas

- **Requester**: rarely interacts with assets directly beyond seeing "this
  ticket is about Asset #1044 (Dell OptiPlex, Cleveland clinic)" on their
  own tickets.
- **Technician**: the primary user - looks up assets, checks them in/out,
  reserves equipment, logs maintenance, scans tags during an audit walk,
  files/resolves tickets against a specific asset.
- **Admin**: everything a technician can do, plus manages sites/locations,
  categories, custom fields, depreciation/fund settings, user provisioning,
  and financial/contract reports.
- **AI agents** (new persona class for this module): both the MCP-connected
  conversational agents already in use, and hosted services like Jack's
  classifier - consumers of asset data and, potentially, contributors to it
  (e.g., an agent that suggests an asset's condition/category from a
  photo, mirroring how Jack currently classifies ticket priority from
  text).

### 4.1 A note on AssetTiger's own role model, and a deliberate deviation

The video shows AssetTiger's native RBAC as three tiers - **Admin, Manager,
Viewer** - with a very granular permission matrix underneath (add/edit/
delete assets, check-in/out, reserve, configure event forms, view
depreciation reports, manage security groups, independently toggleable).
This app already has its own three-tier model - **admin, technician,
requester** - used consistently across tickets, users, and settings today.
Rather than bolt on a second, parallel permission system, this PRD maps
asset permissions onto the *existing* roles (admin = full control including
category/site/depreciation config; technician = day-to-day operations -
check-in/out, reserve, log maintenance; requester = view-only, scoped to
assets linked to their own tickets). This is a real scope reduction versus
AssetTiger's granular per-action toggles (no equivalent of a "Manager" tier
that can reserve but not delete, for instance) - flagged as Open Question 1,
since it's the biggest structural deviation from the reference product in
this whole PRD.

## 5. Scope: Feature Set

Mapped from AssetTiger's documented capabilities and the demo's actual
workflow order (timestamps from the transcript in parentheses), grouped by
priority.

### 5.1 Core (v1)

- **Global/company setup** *(2:16-4:34)*: a one-time admin setup step -
  organization name, address, currency, timezone, branding. Small, but
  real - the video treats this as the actual first thing an admin does.
- **Site & Location hierarchy** *(4:34-7:44)*: two-level structure - Sites
  (top-level campuses/properties, mapping directly onto the existing
  `ClinicSite` model) containing Locations (rooms/storage areas within a
  site - genuinely new, `ClinicSite` today has no sub-location concept).
- **Category management** *(7:44-9:12)*: ships with sensible default
  categories; admin can remove unneeded defaults and add custom ones (the
  video's own example: splitting out "Phones" and "Chargers"). Same
  admin-CRUD shape already built for ticket categories this session -
  reused, not reinvented.
- **Typed custom fields per category** *(9:12-11:04)*: `Asset Tag ID` and
  `Description` are required primary fields on every asset; beyond that,
  admins define custom fields **with real types** - text, date, currency,
  URL, single-select/dropdown - not just freeform strings. This is a
  meaningful refinement over "just a JSON blob": the *definitions* (name,
  type, required) are structured and admin-managed per category; the
  *values* on each asset are stored as a flexible blob keyed to those
  definitions (see §6.1) - typed enough for correct UI rendering and basic
  validation, without a schema migration every time an admin adds a field.
- **Asset records**: tag/description (required), category, status (in use
  / in stock / checked out / reserved / in maintenance / disposed), site +
  location, assigned-to user, typed custom field values, photo attachment
  (stock or custom image).
- **Manual + scanner-assisted entry** *(15:22-20:11)*: add one asset at a
  time via a form, with a barcode/QR scanner able to populate the Asset Tag
  ID field directly (not just used later for lookup - the video shows
  scanner input as a first-class *data entry* method, not only a
  check-out/lookup convenience).
- **Full audit history per asset**: every check-in/out/reservation, field
  change, maintenance event, and status transition, immutable and
  timestamped - same "point-in-time record, not a live pointer" philosophy
  already used for ticket categories in this app.
- **Check-in / check-out to a person** *(25:27-31:03)*: assign to a staff
  member with an optional due date; overdue items surfaced the same way
  overdue tickets already are on the dashboard (reusing the existing
  SLA-banner visual pattern).
- **Barcode/QR lookup**: generate a code per asset, scan via phone camera
  (web `getUserMedia`, no native app needed) to pull up or check out an
  asset.
- **Ticket integration**: replace the free-text "Asset ID" number field on
  the ticket form with a real searchable asset picker (same
  `EmployeeEmailSelect`-style typeahead component already used for
  "Affected Employee"); an asset's detail page shows every ticket ever
  filed against it, not just the reverse link that exists today.
- **Search & filtering**: by category, site, location, status, assigned
  user - mirroring the dashboard's existing quick-filter-tabs +
  column-filter pattern.

### 5.2 Important (v1.1)

- **Calendar reservations** *(25:27-31:03)*: distinct from simple
  checkout-with-a-due-date - book an asset for a future date range,
  checked against existing reservations for conflicts before confirming
  (return an error with the next available date on conflict, rather than
  double-booking). Genuinely different logic from "who has this right now,"
  worth its own v1.1 slot rather than folding into basic checkout.
- **Straight-line depreciation** *(11:04-15:22)*: the video shows this as
  a core activated module, not an edge case - pulled forward from a general
  "depreciation" bucket into v1.1 specifically for the straight-line
  method; other methods stay in Later (§5.3).
- **Fund/grant tracking** *(11:04-15:22)*: a simple field linking an asset
  to a grant or budget code, as shown - worth confirming actual relevance
  to this org's accounting (see Open Question 4); this reads as more
  relevant to AssetTiger's nonprofit/education customer base than a
  healthcare clinic's IT department, but it's cheap to include as an
  optional field if wanted.
- **Recurring maintenance scheduling**: preventive maintenance by
  date/interval, overdue maintenance on the dashboard, maintenance history
  log (date, technician, work performed, cost).
- **Warranty & contract tracking**: expiry alerts (30/60/90 days out),
  reusing the existing email-notification infrastructure
  (`backend/mailer.py`/`notifications.py`).
- **Bulk import with header mapping** *(20:11-25:27)*: CSV/spreadsheet
  import with an explicit column-mapping step (match legacy headers like
  `TAG_NUM`/`ITEM_NAME`/`BOUGHT_ON` to platform fields) and an import
  **preview** before committing - richer than a fixed-template import;
  same broad category as the existing `seed_users.py` CSV pattern, but
  with mapping/preview added since source spreadsheets won't already match
  this schema.
- **Lightweight audit-cycle reminders**: scheduling *when* a site's next
  physical audit is due (a reminder, surfaced on the dashboard) - distinct
  from and simpler than full walk-and-scan reconciliation, which stays in
  Later (§5.3).
- **Reporting**: a fixed set of report types (not AssetTiger's 80+, an
  MVP subset) - asset list by site/category, check-out/reservation history,
  maintenance due/overdue, warranty expiry - exportable to CSV, matching
  the CSV export already on the dashboard.

### 5.3 Later (v2+)

- Declining-balance/sum-of-years-digits depreciation methods (beyond the
  v1.1 straight-line).
- Full audit/reconciliation mode (physically walk a site scanning tags,
  get a found/missing/moved report) - the scheduling/reminder half moves
  to v1.1 above; this is the heavier "actually perform and reconcile the
  walk" half.
- Multi-asset bundling/kits *(11:04-15:22)*: group several assets into one
  logical unit (e.g., a laptop + charger + bag checked out as one item) -
  a structurally distinct feature (composite assets), not a small add-on.
- Custom event-form builder *(31:03-38:01)*: drag-and-drop configuration
  of check-out/maintenance forms, including making specific fields
  mandatory and requiring a digital signature to complete an event. Real
  AssetTiger capability, but a full form builder is a large feature on its
  own - deferred rather than under-built into v1.
- Inventory-style stock-quantity tracking (consumables, not just
  serialized assets) - genuinely different data model from one-asset-one-
  record tracking, worth scoping separately when it's actually needed.
- Insurance policy tracking.

## 6. Architecture

Follows this repo's existing three-service shape - not a new system, a new
module inside the existing one.

### 6.1 Backend (FastAPI, extends the existing app)

- Promote `Asset` from its current 3-column stub to a real model: category
  (FK to a new `AssetCategory` table, same non-FK-on-tickets philosophy
  categories already use), status, site (`clinic_site_id` FK, reusing
  `ClinicSite`) + a new `location_id` FK for the sub-site Location level,
  assigned-to (`user_id` FK, reusing `User`), photo URL, and custom field
  **values** as a JSON column keyed to the category's field definitions.
- New tables: `asset_categories`, `asset_locations` (child of
  `clinic_sites`), `asset_category_field_defs` (name, type, required -
  the *typed* custom-field definitions from §5.1; type is an enum:
  text/date/currency/url/select, with a JSON options list for select
  types), `asset_maintenance_events`, `asset_checkout_history`,
  `asset_reservations` (v1.1), `asset_warranties`/`asset_contracts`
  (v1.1).
- New Alembic migrations for each, following the established pattern
  (self-contained, literal seed data for default categories where
  relevant).
- Role-gated CRUD endpoints under `/assets`, mirroring the exact
  admin-gating pattern already used for `/categories` and `/users` (admin
  for category/site/location/field-definition management; technician+ for
  check-in/out/reservations/maintenance-logging, matching how ticket
  updates are already technician+-gated) - see §4.1 for the RBAC mapping
  decision this rests on.
- `GET /assets/{id}` includes its linked tickets (reverse of the existing
  `Ticket.asset_id` relationship) so the asset detail page can show full
  ticket history without a second round-trip.

### 6.2 Frontend (Next.js, new routes alongside existing ones)

- `/assets` - list/search page, same table+filter shell as the dashboard.
- `/assets/[id]` - detail page: info, typed custom fields rendered by
  their actual type (date picker display, currency formatting, clickable
  URL), full audit history, linked tickets, check-in/out/reserve action,
  maintenance log - visually consistent with the existing `/tickets/[id]`
  detail page.
- `/assets/new` - manual entry form with scanner-input support for the
  Asset Tag ID field (camera-based barcode/QR read populating the field
  directly, per §5.1).
- Admin-only site/location/category/custom-field management under
  `/settings` (alongside the categories CRUD just built for tickets - same
  modal pattern, same file).
- Barcode/QR scan flow: a camera-capture component (new), and generated
  code images per asset (a lightweight barcode-generation library, no new
  backend infra needed - codes just encode the asset's id/tag).
- Ticket form's asset field becomes a real picker component instead of a
  bare number input.

### 6.3 MCP Server (`mcp-server/`, new tools alongside existing ticket tools)

New tools, following the exact shape/docstring conventions the existing
`create_ticket`/`list_tickets` tools already use (explicit enum-like
parameter docs, plain-string returns summarizing the result):

- `list_assets` (filter by category/site/location/status/assigned-user)
- `get_asset` (full detail + linked tickets, by id or tag)
- `create_asset`
- `checkout_asset` / `checkin_asset` / `reserve_asset` (v1.1)
- `log_maintenance`
- `search_assets` (free-text, for "find me the asset that..." style
  agent queries)

Authenticated the same way the ticket tools already are - the existing
`claudeclawos`/`ithdsupport_agent` service accounts (technician role),
same Entra client-credentials flow (`entra_auth.validate_service_token`).
No new auth mechanism needed.

### 6.4 AI Agent Integration

Two distinct integration shapes, matching the two kinds of AI agent already
active in this project:

1. **Conversational agents (MCP)** - covered by 6.3 above. A technician (or
   Claude Code itself) can ask "what's the status of asset tag DHC-1044"
   or "reserve the laptop cart for Cleveland clinic next Tuesday" in
   natural language.
2. **Hosted AI services (Jack-style)** - a documented, versioned REST
   contract (`POST /assets/{id}/classify` or similar) that an external
   service can call to *contribute* structured data back, mirroring
   exactly how `backend/triage.py` calls out to Jack's classifier today,
   but inverted - this module would be the one *exposing* an endpoint for
   an external agent to call, e.g. "here's a photo of an asset, tell me
   its likely category and condition" as an intake-time assist. Given the
   real, live lesson from the triage integration this session (a
   same-machine-only SSH tunnel was needed because the office network
   silently blocks direct cross-VM traffic), **network reachability
   between this app and any external AI service needs to be planned and
   tested early**, not assumed - don't repeat discovering that constraint
   after the integration is otherwise built.

### 6.5 Data model relationship to what already exists

```
ClinicSite ──┬── User (existing)
             ├── AssetLocation (new - sub-site rooms/storage areas)
             └── Asset (extends existing 3-column stub)
                    ├── AssetCategory (new - same non-FK-on-history philosophy as ticket categories)
                    │      └── AssetCategoryFieldDef (new - typed custom field definitions)
                    ├── AssetMaintenanceEvent (new)
                    ├── AssetCheckoutHistory (new)
                    ├── AssetReservation (new, v1.1 - distinct from simple checkout)
                    ├── AssetWarranty/Contract (new, v1.1)
                    └── Ticket (existing relationship, asset_id FK - already there today)
```

## 7. Non-Functional Requirements

- **Auth**: reuse Entra ID SSO end-to-end (both human login and the MCP
  service-account flow) - no new auth system, and no new RBAC tier beyond
  the existing three roles (see §4.1).
- **Audit trail**: immutable, matching AssetTiger's own "activity log with
  timestamp/IP/changed values" - this app already has the discipline (see
  `technician_note`/`resolution` point-in-time fields); asset history needs
  the same treatment, append-only.
- **HIPAA-adjacent posture**: this app already carries a PHI warning on
  ticket descriptions; asset records for medical equipment should avoid
  any patient-identifying custom fields by policy, not by technical
  enforcement (matching how PHI is currently handled - a warning, not a
  filter).
- **Performance**: no different from the existing ticket-heavy dashboard -
  same pagination/filtering patterns are sufficient at this org's scale
  (hundreds, not tens of thousands, of assets).

## 8. Success Metrics

- Every new IT asset purchase gets a record within a week of receipt
  (adoption proxy).
- % of tickets filed with a real linked asset (vs. none) increases
  meaningfully from today's free-text-optional baseline.
- Time to locate "who has this laptop right now" drops from
  ask-around-and-check-a-spreadsheet to a single search.

## 9. Open Questions (for you, before implementation planning starts)

1. **RBAC mapping** (§4.1): comfortable collapsing AssetTiger's native
   Admin/Manager/Viewer + granular-permission model onto this app's
   existing three roles, with technicians getting full day-to-day asset
   operations? Or is a finer-grained tier (e.g., someone who can reserve
   but not delete) actually needed here?
2. Barcode/QR: buy pre-printed tags (like AssetTiger's own tag shop) or
   print in-house on a label printer you already have?
3. Should "Jack" (or a similar hosted AI service) play any role in the
   *intake* flow specifically - e.g., photo-based auto-categorization when
   an admin adds a new asset - or is AI integration here scoped to
   query/lookup only for v1?
4. **Fund/grant tracking** (§5.2): does linking assets to a grant/budget
   code actually map to how Delta Health Center tracks equipment
   spending, or is this an AssetTiger feature aimed at a different
   customer base (schools/nonprofits) that isn't worth building here?
5. Confirm the typed-custom-field-definitions-plus-JSON-values approach
   (§6.1) is the right tradeoff - structured enough for correct UI
   rendering and basic validation, without a migration per new field, but
   still less rigid/queryable than dedicated columns per field.
6. Digital signature capture on checkout (part of the deferred
   custom-event-form-builder, §5.3) - worth calling out now in case it's
   actually a near-term compliance need rather than a "later" nice-to-have.
