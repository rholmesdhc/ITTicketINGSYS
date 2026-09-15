# PRD: Knowledge Base Module

**Status:** Draft for review
**Author:** Drafted with Claude Code, from a two-option architecture evaluation
**Last updated:** 2026-09-11

## Reference material

Two directions were evaluated before writing this: a conventional
vector-database/RAG approach, and Andrej Karpathy's "LLM Wiki" pattern
(published as a gist, April 2026), specifically as reference-implemented
at [ScrapingArt/Karpathy-LLM-Wiki-Stack](https://github.com/ScrapingArt/Karpathy-LLM-Wiki-Stack).
That repo is a community-authored blueprint of Karpathy's pattern, not
code he wrote himself - it stores knowledge as agent-curated, git-tracked
markdown pages (not embeddings), retrieved by keyword search and direct
file reads at small scale, with vector similarity added only as a search
layer once a corpus outgrows keyword matching. This PRD adopts that
*pattern* - compounding, source-linked, human-reviewed knowledge - not
that repo's own tooling (Obsidian, `qmd`), which this app has no reason to
depend on when it already has Postgres, admin-CRUD conventions, and an MCP
server to build on instead.

## 1. Context and Problem

There is no self-service or knowledge-reuse path in this app today. The
new-ticket form's `ISSUE_TEMPLATES` quick-start buttons are the closest
thing to it - they *file* a ticket faster, they don't *resolve* one.
Meanwhile, every resolved ticket already has a `resolution` field - a
technician's real, human-written account of how an issue was actually
fixed. That's genuine institutional knowledge, and today it's write-once:
scattered across individual ticket rows, unsearchable as a body of
knowledge, and re-derived from scratch the next time someone hits the same
NextGen login issue or printer driver problem.

A vector-database RAG approach was the default assumption going in, but
doesn't fit this org's actual shape well: a helpdesk KB for one
healthcare IT department is realistically dozens to low hundreds of
articles, not the scale semantic search over embeddings is built for -
and RAG's core failure mode (re-deriving understanding from raw chunks on
every query, never consolidating) is exactly wrong for turning "500
resolved tickets" into "40 actually-useful articles." The wiki pattern's
ingest-and-synthesize workflow fits that job directly, and can bootstrap
from data this app already has, through the same MCP agent infrastructure
already used for tickets - no new embedding pipeline, no new required
external AI dependency for retrieval.

## 2. Goals

- Real self-service for requesters: surface a likely-relevant article
  before or at ticket creation, so some issues never need a ticket at all.
- A searchable, living record for technicians instead of re-solving the
  same issue or hunting through old tickets for how it was handled before.
- Turn resolved tickets into an asset, not a dead end - an agent-assisted
  draft step proposes articles *from* resolutions, since a separate manual
  authoring process nobody has time for was never going to get written.
- Stay small and low-ops: no required external AI dependency for search
  (Postgres full-text is enough at this scale), no new infrastructure
  (pgvector, an embedding pipeline) unless and until real usage proves
  keyword search isn't enough.
- Reuse this codebase's own conventions: the admin-CRUD shape already
  built for ticket categories, role-gated FastAPI endpoints, the MCP
  server's existing tool conventions, and `triage.py`'s external-AI-call
  pattern for the optional intake-time suggestion.

## 3. Non-Goals (v1)

- Vector/embedding-based semantic search - deliberately deferred, not
  ruled out. Postgres full-text search (`tsvector`/GIN) covers the
  realistic v1 corpus size; see Open Question 4 for when this would need
  revisiting sooner.
- A general company-wide wiki (HR policy, unrelated departments) - scoped
  to IT/EHR/equipment support knowledge, matching this app's own scope.
- Public/unauthenticated access - stays behind the same Entra ID auth
  every other feature lives behind. No separate public help-center site.
- Automatic, unreviewed publishing. An agent can draft or suggest an
  article; nothing goes live without a technician/admin approving it -
  the same "the classifier proposes, a human confirms" precedent
  `priority_needs_review` already established for ticket priority.
- Adopting the Karpathy-Wiki-Stack repo's own tooling (Obsidian vault,
  `qmd`, its lint/contradiction-detection machinery) wholesale. Borrowing
  the pattern, not the stack - this app already has its own DB and
  admin-CRUD conventions to build on.

## 4. Personas

- **Requester**: sees a suggested article while filing a ticket (v1.1) or
  searches the KB directly (v1); may self-resolve without ever filing, or
  files anyway with the article linked for context.
- **Technician**: the primary author/curator - reviews AI-drafted articles
  sourced from resolved tickets, edits and approves them, searches the KB
  directly when working a new ticket.
- **Admin**: manages KB categories (reusing the ticket-category admin-CRUD
  pattern), can archive or merge articles, oversees the draft review queue.
- **AI agents**: two roles, mirroring the Asset Manager PRD's own split -
  (1) MCP-connected agents that search/read the KB as a tool, and (2) the
  ingest assistant that drafts a candidate article from a resolved
  ticket's resolution field, the same shape of integration as
  `triage.py`'s classifier call, not a new kind of AI dependency.

## 5. Scope: Feature Set

### 5.1 Core (v1)

- **`KnowledgeArticle` model**: title, body (markdown), category (FK),
  status (draft / published / archived), `source_ticket_id` (nullable FK
  back to the ticket a draft was generated from, for provenance),
  created_by / updated_by, timestamps.
- **Full-text search**: a `tsvector` column + GIN index over title+body -
  no new infrastructure, matches this app's Postgres-only stack today.
- **Admin/technician CRUD UI** for articles - same list-plus-modal-edit
  shape as the ticket-categories admin CRUD already shipped.
- **Manual authoring from day one** - a technician can write an article
  directly, no AI involved. The AI ingest path (5.2) is an accelerant on
  top of this, not a prerequisite for the KB to exist at all.
- **KB search page** + a lightweight "Did this help?" (yes/no, optional
  free-text) prompt on each article - the simplest possible feedback
  signal, and reusable later for the CSAT idea already on the enhancement
  backlog.
- **Ticket-form integration**: as a requester types a title/description,
  a debounced full-text search against `KnowledgeArticle` surfaces likely
  matches inline - same UX shape as the duplicate-ticket-detection warning
  already on that form. No AI call needed for this baseline version, just
  search.

### 5.2 Important (v1.1)

- **AI-assisted ingest**: an MCP tool (or an admin-triggered action) reads
  a resolved ticket's `resolution`/`technician_note` and drafts a
  candidate `KnowledgeArticle`, landing in a review queue as `draft` -
  never auto-published, matching the `priority_needs_review` precedent.
- **AI-suggested article at intake**: the same call `triage.py` already
  makes at ticket creation (or a sibling call) also returns a candidate
  article id, shown to the requester before they submit - this is
  enhancement #18 from the earlier platform review, scoped properly here.
- **Duplicate/merge detection for articles themselves** - multiple drafts
  about the same underlying issue, generated from different resolved
  tickets, flagged for a human to merge rather than auto-merged.
- **Basic reporting**: which articles get viewed/helpful-voted most, which
  KB searches return nothing - a direct signal for what to write next.

### 5.3 Later (v2+)

- **Vector/semantic search layer** (pgvector, or an external service) -
  the explicit escalation path if full-text search quality genuinely
  stops being good enough as the corpus grows. Not rejected, just not
  started without real evidence it's needed - see Open Question 4.
- **Full "lint" pass** (contradiction detection, staleness flags across
  articles) - the more elaborate half of the Karpathy pattern; a v1 KB of
  dozens of articles doesn't need this yet.
- Versioned article history / diff view.
- Multi-language articles.

## 6. Architecture

### 6.1 Backend (FastAPI, extends the existing app)

- New `knowledge_articles` table + Alembic migration. Category storage is
  an open question (§9.1) - either a `kind` discriminator on the existing
  `Category` table, or a dedicated `KnowledgeCategory` table.
- Generated `tsvector` column + GIN index for search.
- Role-gated CRUD under `/kb`, mirroring `/categories`'s admin-gating
  pattern (admin for category management; technician+ for article
  authoring, pending Open Question 3).
- `GET /kb/search?q=` - full-text search, used by both the ticket form's
  inline suggestions and a dedicated KB search page.

### 6.2 Frontend (Next.js, new routes alongside existing ones)

- `/kb` list/search page, `/kb/[id]` article view.
- Admin CRUD for KB categories under Settings, same modal pattern as
  ticket categories.
- New-ticket form: inline suggested-articles panel as the requester
  types, reusing the existing debounced-duplicate-check pattern already
  on that form.
- Sidebar: a Knowledge Base entry - placement (flyout child vs. its own
  top-level item) is Open Question 2.

### 6.3 MCP Server (`mcp-server/`, new tools alongside existing ticket tools)

- `search_kb`, `get_article` (v1), `draft_article_from_ticket` (v1.1) -
  same docstring/parameter conventions as the existing `create_ticket`/
  `list_tickets` tools, same service-account auth (no new auth mechanism).

### 6.4 AI Agent Integration

Two integration points, both extending the existing `triage.py` pattern
rather than introducing a new one:

1. **Ingest-time (v1.1)**: resolved ticket -> candidate article draft,
   the same external-call shape `triage.py` already uses for priority
   classification, applied to a different field.
2. **Intake-time (v1.1)**: the same call `triage.py` makes at ticket
   creation also returns a candidate KB article id alongside the priority
   assessment - one round-trip, not two.

## 7. Non-Functional Requirements

- **Auth**: same Entra ID SSO end-to-end, no new role/permission tier.
- **No new required external AI dependency for v1** - search is pure
  Postgres. v1.1's AI features degrade to "no suggestion shown" if the
  classifier is unreachable, matching `triage.py`'s own P3-fallback
  precedent rather than failing the request.
- **HIPAA-adjacent posture**: articles must never contain PHI - same
  policy-not-technical-enforcement warning already used for ticket
  descriptions, not a new filter.

## 8. Success Metrics

- % of new tickets where a suggested article was shown and the requester
  self-resolved without filing (once v1.1 ships).
- Number of resolved tickets successfully converted into a published
  article, vs. still sitting unrefined.
- KB searches returning zero results, trending down as the corpus grows.

## 9. Open Questions (for you, before implementation planning starts)

1. Reuse the existing `Category` table with a `kind` discriminator
   (ticket vs. KB), or a separate `KnowledgeCategory` table? Reuse means
   less duplication; separate is cleaner if the two ever diverge (KB
   categories nesting, say, where ticket categories don't).
2. Sidebar placement - a flyout child under an existing item, or a new
   top-level "Knowledge Base" entry alongside Dashboard/Tickets/Admin
   Settings?
3. Who can author articles directly - technician+ (matching ticket-update
   permission), or admin-only until the v1.1 review-queue workflow exists
   to backstop lower-trust authors?
4. Confirm Postgres full-text search is the right v1 call over starting
   with pgvector - is there already a chunk of legacy content (a vendor
   PDF dump, an old wiki export) that would need importing at a scale
   where keyword search struggles from day one, rather than growing into
   that problem over time?
5. Should "Did this help?" feedback (§5.1) feed anything automated (e.g.
   auto-flag an article for review below some helpfulness threshold), or
   stay a pure signal for a human to act on?
