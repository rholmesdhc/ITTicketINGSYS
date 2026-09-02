"use client";
import { useEffect, useState } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { API_BASE_URL, isUnauthorized, updateUserPreferences } from "@/lib/api";
import { isOverdue } from "@/lib/ticketSla";
import OnboardingWizard from "@/components/OnboardingWizard";
import Sidebar from "@/components/Sidebar";
import { useTheme } from "@/components/ThemeProvider";
import { useTicketsFeed } from "@/hooks/useTicketsFeed";

// Item 20: shape-matched placeholders for the first load, instead of a
// blank flash while KPI cards/charts wait on the initial fetch. Trimmed to
// just the KPI-row + chart-row shapes now that the table lives on its own
// page (see tickets/page.tsx for its own skeleton).
function DashboardSkeleton() {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 animate-pulse">
            <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-24 mb-3" />
            <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-16" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {[0, 1, 2].map(i => (
          <div key={i} className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 animate-pulse">
            <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-32 mb-4" />
            <div className="h-64 bg-slate-100 dark:bg-slate-700 rounded" />
          </div>
        ))}
      </div>
    </>
  );
}

// Lightweight collapse toggle for a dashboard group - deliberately just a
// header row, not a bordered card wrapper like the Resolved Tickets section
// on the Tickets page, since the KPI/chart cards it sits above are already
// individually carded and a card-around-cards would look nested/heavy.
function CollapsibleSectionHeader({ title, expanded, onToggle }: { title: string; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{title}</h3>
      <button
        onClick={onToggle}
        className="text-xs font-semibold text-medical-blue dark:text-medical-accent hover:text-medical-dark dark:hover:text-medical-light cursor-pointer"
      >
        {expanded ? "▲ Collapse" : "▼ Expand"}
      </button>
    </div>
  );
}

// Small "what does this number mean" tooltip, sat next to a KPI card's
// title. Pure CSS (a scoped `group/tip`, not JS state) - a tooltip has no
// interactive content inside it to worry about losing on close, unlike the
// sidebar's flyout submenus, so the simpler hover/focus-only technique is
// the right tool here rather than reaching for the same click-driven
// pattern that flyout needed. group-focus-within (not just group-hover),
// so it's reachable by keyboard, not just a mouse. No `title` attribute -
// same reason the sidebar's flyout items don't carry one: it would pop a
// second, native OS tooltip right on top of this custom one.
function MetricInfo({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group/tip align-middle ml-1.5">
      <button
        type="button"
        aria-label="What this metric means"
        className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] normal-case font-bold leading-none border border-slate-300 dark:border-slate-500 text-slate-400 dark:text-slate-400 hover:border-medical-blue hover:text-medical-blue dark:hover:border-medical-accent dark:hover:text-medical-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-accent focus-visible:outline-offset-1 cursor-help"
      >
        i
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full mt-2 z-20 w-56 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-xs font-normal normal-case tracking-normal leading-relaxed p-2.5 shadow-lg opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible group-focus-within/tip:opacity-100 group-focus-within/tip:visible transition-opacity"
      >
        {text}
      </span>
    </span>
  );
}

export default function Dashboard() {
  const { resolvedTheme } = useTheme();
  const gridStroke = resolvedTheme === "dark" ? "#334155" : "#e2e8f0";
  const cursorFill = resolvedTheme === "dark" ? "#1e293b" : "#f1f5f9";
  const { tickets, directoryMap, allTechnicians, role, userId, isInitialLoading } = useTicketsFeed();

  // Collapsible dashboard groups (tester-requested) - default open/closed
  // matches pre-persistence behavior; overridden by the user's saved
  // preference once GET /users/me/preferences resolves (see the effect
  // below). Plain setKpiExpanded/etc (not these toggle* wrappers) is still
  // used for applying that fetched value, since that's not a user action
  // and shouldn't re-save what was just loaded.
  const [kpiExpanded, setKpiExpanded] = useState(true);
  const [workloadChartsExpanded, setWorkloadChartsExpanded] = useState(true);
  // User-draggable Key Metrics card order (see the drag handlers and
  // kpiCardDefs below). null - not yet loaded, or the user's never dragged
  // anything - means "use each role's default order" rather than an empty
  // array, which would render zero cards.
  const [kpiCardOrder, setKpiCardOrder] = useState<string[] | null>(null);
  const [draggedKpiCardId, setDraggedKpiCardId] = useState<string | null>(null);
  // Ids the user has explicitly removed - separate from kpiCardOrder above
  // so a removed card keeps its place in line and comes back where it was
  // (not appended at the end) if the user re-adds it later.
  const [kpiHiddenCardIds, setKpiHiddenCardIds] = useState<string[]>([]);
  const [kpiAddMenuOpen, setKpiAddMenuOpen] = useState(false);
  // Plain reads of current state (not functional updaters) are fine here -
  // these are simple click handlers, not rapid/batched updates, and
  // keeping the updateUserPreferences side effect out of the updater
  // callback avoids it double-firing under React Strict Mode's
  // double-invocation of updater functions.
  const toggleKpiExpanded = () => {
    const next = !kpiExpanded;
    setKpiExpanded(next);
    updateUserPreferences({ dashboard_kpi_expanded: next });
  };
  const toggleWorkloadChartsExpanded = () => {
    const next = !workloadChartsExpanded;
    setWorkloadChartsExpanded(next);
    updateUserPreferences({ dashboard_workload_charts_expanded: next });
  };

  // Onboarding wizard: shown automatically once per account (tracked by
  // userId, not just "ever seen on this browser" - a shared machine with
  // multiple accounts should still onboard each one), replayable anytime
  // via the sidebar's Help button.
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  useEffect(() => {
    if (userId && !localStorage.getItem(`onboarding_seen_${userId}`)) {
      setIsWizardOpen(true);
    }
  }, [userId]);

  // Saved collapse-group / KPI-layout preferences (see lib/api.ts's
  // updateUserPreferences) - applies over today's hardcoded defaults only
  // for keys that are actually present, so a user who's never touched a
  // given toggle still gets the normal default. Uses the plain setters, not
  // the toggle* wrappers, since loading a saved value isn't a user action
  // and shouldn't immediately re-save it.
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    fetch(`${API_BASE_URL}/users/me/preferences`, {
      headers: { "Authorization": `Bearer ${token}` }
    })
      .then(res => {
        if (isUnauthorized(res)) return null;
        return res.ok ? res.json() : null;
      })
      .then(data => {
        const prefs = data?.preferences;
        if (!prefs) return;
        if (typeof prefs.dashboard_kpi_expanded === "boolean") setKpiExpanded(prefs.dashboard_kpi_expanded);
        if (typeof prefs.dashboard_workload_charts_expanded === "boolean") setWorkloadChartsExpanded(prefs.dashboard_workload_charts_expanded);
        // Stored as an array of card ids (e.g. ["open","total","high_priority","resolved"]),
        // not the cards themselves - see effectiveKpiOrder below for how a
        // stale/partial saved order is reconciled against each role's
        // actual current card set.
        if (Array.isArray(prefs.dashboard_kpi_card_order)) setKpiCardOrder(prefs.dashboard_kpi_card_order);
        if (Array.isArray(prefs.dashboard_kpi_hidden_cards)) setKpiHiddenCardIds(prefs.dashboard_kpi_hidden_cards);
      })
      .catch(() => {});
  }, []);

  const handleCloseWizard = () => {
    setIsWizardOpen(false);
    if (userId) localStorage.setItem(`onboarding_seen_${userId}`, "1");
  };

  const isAdminOrTech = role === "admin" || role === "technician";

  // --- KPI Calculations ---
  const totalTickets = tickets.length;
  const openTickets = tickets.filter((t: any) => t.status === "open").length;
  const highPriorityTickets = tickets.filter((t: any) => t.priority === "P1" || t.priority === "P2").length;
  const resolvedTickets = tickets.filter((t: any) => t.status === "resolved").length;
  const overdueTickets = tickets.filter((t: any) => isOverdue(t));

  // Requester-only figures: their own active count (open + in_progress,
  // not just "open") and how long resolution has actually taken for them -
  // an org-wide trend arrow means nothing when someone's only filed a
  // couple of tickets, but "usually resolved in 2 days" tells them what to
  // expect.
  const myActiveTickets = tickets.filter((t: any) => t.status !== "resolved").length;
  const avgResolutionDays = (() => {
    const resolved = tickets.filter((t: any) => t.status === "resolved");
    if (resolved.length === 0) return null;
    const totalMs = resolved.reduce((sum: number, t: any) => sum + (new Date(t.updated_at).getTime() - new Date(t.created_at).getTime()), 0);
    return totalMs / resolved.length / (24 * 60 * 60 * 1000);
  })();

  // --- Trend deltas (item 13): "this week" vs "the week before" counted by
  // when each ticket hit the date field that matters for that card. There's
  // no history table, so this measures activity volume (creations/updates
  // in each 7-day window), not a literal "open count as of 7 days ago" -
  // the closest honest signal available from the fields the API returns.
  const weekOverWeek = (subset: any[], dateField: "created_at" | "updated_at") => {
    const now = Date.now();
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
    let thisWeek = 0, lastWeek = 0;
    subset.forEach((t) => {
      const d = new Date(t[dateField]).getTime();
      if (d > now - oneWeekMs) thisWeek++;
      else if (d > now - 2 * oneWeekMs) lastWeek++;
    });
    return thisWeek - lastWeek;
  };

  const totalTrend = weekOverWeek(tickets, "created_at");
  const openTrend = weekOverWeek(tickets.filter((t: any) => t.status === "open"), "created_at");
  const highPriorityTrend = weekOverWeek(tickets.filter((t: any) => t.priority === "P1" || t.priority === "P2"), "created_at");
  const resolvedTrend = weekOverWeek(tickets.filter((t: any) => t.status === "resolved"), "updated_at");

  // goodDirection: which sign of the delta should read as "good" (green).
  const renderTrend = (delta: number, goodDirection: "up" | "down" | "neutral") => {
    if (delta === 0) return <span className="text-xs text-slate-400 mt-1 block">No change vs last week</span>;
    const isUp = delta > 0;
    const isGood = goodDirection === "neutral" ? null : (goodDirection === "up") === isUp;
    const color = isGood === null ? "text-slate-500" : isGood ? "text-emerald-600" : "text-red-600";
    return (
      <span className={`text-xs font-semibold mt-1 block ${color}`}>
        {isUp ? "▲" : "▼"} {Math.abs(delta)} vs last week
      </span>
    );
  };

  // --- Chart Data Calculations ---
  const statusCounts = tickets.reduce((acc: any, ticket: any) => {
    acc[ticket.status] = (acc[ticket.status] || 0) + 1;
    return acc;
  }, {});

  const statusData = [
    { name: 'Open', value: statusCounts['open'] || 0, color: '#f59e0b' },
    { name: 'In Progress', value: statusCounts['in_progress'] || 0, color: '#3b82f6' },
    { name: 'Resolved', value: statusCounts['resolved'] || 0, color: '#10b981' },
  ].filter(item => item.value > 0);

  const categoryCounts = tickets.reduce((acc: any, ticket: any) => {
    acc[ticket.category] = (acc[ticket.category] || 0) + 1;
    return acc;
  }, {});

  const categoryData = Object.keys(categoryCounts).map(key => ({
    name: key,
    count: categoryCounts[key]
  }));

  // "Tickets by Technician" chart - grouped by tech_id (not the display
  // label) so counts stay correct even if two technicians happen to share
  // a first name; the label itself is chosen below, first-name-only (e.g.
  // "Rod", "Davis", "Jamari" - enough to recognize your own team at a
  // glance on a bar chart, unlike the old "Tech 5" placeholder), with a
  // last-initial appended only on an actual collision between two
  // different technicians so their bars stay distinguishable.
  const techIdCounts = tickets.reduce((acc: Record<string, number>, ticket: any) => {
    const key = ticket.tech_id != null ? String(ticket.tech_id) : 'unassigned';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const techFirstNameTally = Object.keys(techIdCounts)
    .filter(key => key !== 'unassigned')
    .reduce((acc: Record<string, number>, key) => {
      const emp = directoryMap.get(Number(key));
      const first = emp?.first_name || emp?.email || `Tech ${key}`;
      acc[first] = (acc[first] || 0) + 1;
      return acc;
    }, {});

  const techData = Object.keys(techIdCounts).map(key => {
    let label = 'Unassigned';
    if (key !== 'unassigned') {
      const emp = directoryMap.get(Number(key));
      const first = emp?.first_name || emp?.email || `Tech ${key}`;
      label = (emp?.first_name && emp?.last_name && techFirstNameTally[first] > 1)
        ? `${first} ${emp.last_name[0]}.`
        : first;
    }
    return { name: label, count: techIdCounts[key] };
  });

  // "Currently open" ops snapshot (item: reference dashboard shared by the
  // user) - deliberately a *different* slice than the charts above, which
  // cover all-time totals regardless of status. "Open" here means "not yet
  // resolved" (open + in_progress combined), not the single literal "open"
  // status - a ticket someone's actively working shouldn't disappear from
  // these the moment a tech picks it up.
  const openTicketsList = tickets.filter((t: any) => t.status !== 'resolved');

  const openCategoryCounts = openTicketsList.reduce((acc: any, ticket: any) => {
    acc[ticket.category] = (acc[ticket.category] || 0) + 1;
    return acc;
  }, {});
  const openCategoryData = Object.keys(openCategoryCounts).map(key => ({
    name: key,
    count: openCategoryCounts[key]
  }));

  const openPriorityCounts = openTicketsList.reduce((acc: any, ticket: any) => {
    acc[ticket.priority] = (acc[ticket.priority] || 0) + 1;
    return acc;
  }, {});
  // Fixed P1-P4 order (not object-key/insertion order) - matches how
  // PRIORITY_RANK already orders priority everywhere else (lib/ticketSla.ts).
  const openPriorityData = ["P1", "P2", "P3", "P4"]
    .map(p => ({ name: p, count: openPriorityCounts[p] || 0 }))
    .filter(d => d.count > 0);

  const resolvedLast30Days = tickets.filter((t: any) =>
    t.status === 'resolved' &&
    new Date(t.updated_at).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000
  ).length;

  // Item 14: active (non-resolved) ticket count per technician, including
  // techs with zero so a manager can see who has room, not just who's busy.
  const OVERLOAD_THRESHOLD = 5;
  const workload = allTechnicians
    .map(tech => {
      const count = tickets.filter((t: any) => t.status !== "resolved" && t.tech_id === tech.id).length;
      return { ...tech, count };
    })
    .sort((a, b) => b.count - a.count);

  // Key Metrics cards, keyed by a stable id (not tied to display order or
  // wording) so they can be dragged into any order and that choice
  // survives a reload. Two separate default lists - staff and requesters
  // see entirely different cards - so a saved order from one role simply
  // has no effect on ids the other role doesn't have (see effectiveKpiOrder).
  const kpiCardClass = "bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700";
  const kpiCardDefs: { id: string; title: string; className: string; node: React.ReactNode }[] = isAdminOrTech ? [
    {
      id: "open",
      title: "Open Tickets",
      className: kpiCardClass,
      node: (<>
        <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase">
          Open Tickets
          <MetricInfo text="Tickets currently in the Open status - not yet started or in progress." />
        </h3>
        <p className="text-3xl font-bold text-amber-500 dark:text-amber-400 mt-2">{openTickets}</p>
        {renderTrend(openTrend, "down")}
      </>),
    },
    {
      id: "high_priority",
      title: "High Priority (P1/P2)",
      className: kpiCardClass,
      node: (<>
        <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase">
          High Priority (P1/P2)
          <MetricInfo text="Tickets marked P1 (critical patient-care impact) or P2 (major disruption), regardless of status - the most urgent items in the queue." />
        </h3>
        <p className="text-3xl font-bold text-red-500 dark:text-red-400 mt-2">{highPriorityTickets}</p>
        {renderTrend(highPriorityTrend, "down")}
      </>),
    },
    {
      id: "total",
      title: "Total Tickets",
      className: kpiCardClass,
      node: (<>
        <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase">
          Total Tickets
          <MetricInfo text="Every ticket ever filed, regardless of status. The trend compares tickets created this week to last week." />
        </h3>
        <p className="text-3xl font-bold text-slate-800 dark:text-slate-100 mt-2">{totalTickets}</p>
        {renderTrend(totalTrend, "neutral")}
      </>),
    },
    {
      id: "resolved",
      title: "Resolved",
      className: kpiCardClass,
      node: (<>
        <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase">
          Resolved
          <MetricInfo text="Tickets marked Resolved. The trend compares tickets resolved this week to last week." />
        </h3>
        <p className="text-3xl font-bold text-emerald-500 dark:text-emerald-400 mt-2">{resolvedTickets}</p>
        {renderTrend(resolvedTrend, "up")}
      </>),
    },
  ] : [
    {
      id: "my_open",
      title: "My Open Tickets",
      className: kpiCardClass,
      node: (<>
        <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase">
          My Open Tickets
          <MetricInfo text="Your own tickets that aren't resolved yet - either Open or In Progress." />
        </h3>
        <p className="text-3xl font-bold text-amber-500 dark:text-amber-400 mt-2">{myActiveTickets}</p>
        {renderTrend(openTrend, "down")}
      </>),
    },
    {
      id: "overdue",
      title: "Overdue",
      className: `bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border ${overdueTickets.length > 0 ? "border-red-300 dark:border-red-800" : "border-slate-200 dark:border-slate-700"}`,
      node: (<>
        <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase">
          Overdue
          <MetricInfo text="Your tickets that have passed their SLA deadline without being resolved." />
        </h3>
        <p className={`text-3xl font-bold mt-2 ${overdueTickets.length > 0 ? "text-red-500 dark:text-red-400" : "text-slate-800 dark:text-slate-100"}`}>{overdueTickets.length}</p>
        <span className="text-xs text-slate-400 dark:text-slate-500 mt-1 block">
          {overdueTickets.length > 0 ? "Past their SLA deadline" : "Nothing past deadline"}
        </span>
      </>),
    },
    {
      id: "resolved",
      title: "Resolved",
      className: kpiCardClass,
      node: (<>
        <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase">
          Resolved
          <MetricInfo text="Your tickets marked Resolved. Shows your average time to resolution once you have at least one." />
        </h3>
        <p className="text-3xl font-bold text-emerald-500 dark:text-emerald-400 mt-2">{resolvedTickets}</p>
        {avgResolutionDays != null ? (
          <span className="text-xs text-slate-400 dark:text-slate-500 mt-1 block">
            Avg. {avgResolutionDays < 1 ? "under a day" : `${avgResolutionDays.toFixed(1)} days`} to resolve
          </span>
        ) : renderTrend(resolvedTrend, "up")}
      </>),
    },
  ];

  const kpiDefaultOrder = kpiCardDefs.map(c => c.id);
  // A saved order wins for any id it recognizes; anything it doesn't - a
  // card added since the user last reordered, or the user's whole
  // never-touched default - is appended in its normal default position
  // instead of silently disappearing.
  const effectiveKpiOrder = kpiCardOrder
    ? [...kpiCardOrder.filter(id => kpiDefaultOrder.includes(id)), ...kpiDefaultOrder.filter(id => !kpiCardOrder!.includes(id))]
    : kpiDefaultOrder;

  // Add/remove: kept as a separate hidden-ids list rather than dropping
  // removed cards out of kpiCardOrder entirely, so a re-added card comes
  // back to its old spot in the order instead of jumping to the end. Any
  // hidden id that's no longer a valid card for this role (stale saved
  // pref, or a role change) is silently ignored via the effectiveKpiOrder
  // filter below rather than erroring.
  const visibleKpiOrder = effectiveKpiOrder.filter(id => !kpiHiddenCardIds.includes(id));
  const hiddenKpiCards = effectiveKpiOrder.filter(id => kpiHiddenCardIds.includes(id));

  const handleRemoveKpiCard = (id: string) => {
    // Always leave at least one card visible - an empty Key Metrics section
    // would look broken, not "intentionally hidden."
    if (visibleKpiOrder.length <= 1) return;
    const next = [...kpiHiddenCardIds, id];
    setKpiHiddenCardIds(next);
    updateUserPreferences({ dashboard_kpi_hidden_cards: next });
  };
  const handleAddKpiCard = (id: string) => {
    const next = kpiHiddenCardIds.filter(hiddenId => hiddenId !== id);
    setKpiHiddenCardIds(next);
    updateUserPreferences({ dashboard_kpi_hidden_cards: next });
    setKpiAddMenuOpen(false);
  };

  // Plain HTML5 drag-and-drop (no extra library) - drop reorders by moving
  // the dragged card to sit where the drop target currently is, then saves
  // immediately via the same fire-and-forget preference save the collapse
  // toggles use above.
  const handleKpiDragStart = (id: string) => (e: React.DragEvent) => {
    setDraggedKpiCardId(id);
    e.dataTransfer.effectAllowed = "move";
  };
  const handleKpiDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // required for onDrop to fire at all
    e.dataTransfer.dropEffect = "move";
  };
  const handleKpiDrop = (targetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = draggedKpiCardId;
    setDraggedKpiCardId(null);
    if (!draggedId || draggedId === targetId) return;
    const from = effectiveKpiOrder.indexOf(draggedId);
    const to = effectiveKpiOrder.indexOf(targetId);
    if (from === -1 || to === -1) return;
    const next = [...effectiveKpiOrder];
    next.splice(from, 1);
    next.splice(to, 0, draggedId);
    setKpiCardOrder(next);
    updateUserPreferences({ dashboard_kpi_card_order: next });
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex">
      <Sidebar role={role} onHelpClick={() => setIsWizardOpen(true)} />

      <div className="flex-1 flex flex-col min-w-0 pt-14 md:pt-0">
        <OnboardingWizard isOpen={isWizardOpen} onClose={handleCloseWizard} role={role} />

        <main className="max-w-[100rem] mx-auto p-10 w-full flex-1">
          <h2 className="text-3xl font-semibold text-slate-800 dark:text-slate-100 mb-8">Dashboard</h2>

          {isInitialLoading ? (
            <DashboardSkeleton />
          ) : (
            <>
              {/* KPI Summary Cards - technicians/admins get the full ops
                  snapshot; requesters get a smaller, personal-tracking view
                  instead (org-wide totals and priority mix mean nothing about
                  their own couple of tickets). Collapsible as a group
                  (tester-requested) - individually collapsing each card would
                  be more fiddly than useful for 3-4 small numbers. */}
              <div className="mb-8">
                <CollapsibleSectionHeader title="Key Metrics" expanded={kpiExpanded} onToggle={() => toggleKpiExpanded()} />
                {kpiExpanded && (
                  <>
                    <div className="flex items-center justify-between mb-3 -mt-2">
                      <p className="text-xs text-slate-400 dark:text-slate-500">Drag a card to reorder, or remove/add cards - your layout is saved automatically.</p>
                      {hiddenKpiCards.length > 0 && (
                        <div className="relative">
                          <button
                            onClick={() => setKpiAddMenuOpen(v => !v)}
                            className="text-xs font-semibold text-medical-blue dark:text-medical-accent hover:underline cursor-pointer whitespace-nowrap"
                          >
                            + Add card
                          </button>
                          {kpiAddMenuOpen && (
                            <>
                              {/* Invisible click-outside backdrop - simplest way to close
                                  the menu on an outside click without a ref/effect. */}
                              <div className="fixed inset-0 z-10" onClick={() => setKpiAddMenuOpen(false)} />
                              <div className="absolute right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-20 py-1 min-w-[180px]">
                                {hiddenKpiCards.map(id => {
                                  const card = kpiCardDefs.find(c => c.id === id);
                                  return (
                                    <button
                                      key={id}
                                      onClick={() => handleAddKpiCard(id)}
                                      className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                                    >
                                      + {card?.title ?? id}
                                    </button>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <div
                      data-tour="kpi-cards"
                      className={`grid grid-cols-1 gap-6 ${
                        { 1: "md:grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" }[Math.min(visibleKpiOrder.length, 4)] || "md:grid-cols-4"
                      }`}
                    >
                      {visibleKpiOrder.map(id => {
                        const card = kpiCardDefs.find(c => c.id === id);
                        if (!card) return null;
                        return (
                          <div
                            key={id}
                            draggable
                            onDragStart={handleKpiDragStart(id)}
                            onDragOver={handleKpiDragOver}
                            onDrop={handleKpiDrop(id)}
                            onDragEnd={() => setDraggedKpiCardId(null)}
                            title="Drag to reorder"
                            className={`${card.className} relative cursor-grab active:cursor-grabbing transition-opacity ${draggedKpiCardId === id ? "opacity-40" : ""}`}
                          >
                            {visibleKpiOrder.length > 1 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleRemoveKpiCard(id); }}
                                title="Remove this card"
                                aria-label={`Remove ${card.title} card`}
                                className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center rounded text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/30 cursor-pointer text-sm leading-none"
                              >
                                ✕
                              </button>
                            )}
                            {card.node}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Technician Workload (item 14) + charts, grouped under one
                  collapse toggle (tester-requested) - both are staff-only
                  org-wide breakdowns that don't mean much against a
                  requester's own handful of tickets, so the whole group
                  stays gated on isAdminOrTech same as before. */}
              {isAdminOrTech && (workload.length > 0 || tickets.length > 0) && (
                <div className="mb-8">
                  <CollapsibleSectionHeader title="Workload & Analytics" expanded={workloadChartsExpanded} onToggle={() => toggleWorkloadChartsExpanded()} />
                  {workloadChartsExpanded && (
                    <>
                      {workload.length > 0 && (
                        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 mb-6">
                          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">Technician Workload</h3>
                          <div className="flex flex-wrap gap-4">
                            {workload.map(tech => {
                              const overloaded = tech.count >= OVERLOAD_THRESHOLD;
                              return (
                                <div
                                  key={tech.id}
                                  className={`flex-1 min-w-[160px] p-4 rounded-lg border ${overloaded ? "bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-800" : "bg-slate-50 dark:bg-slate-700 border-slate-200 dark:border-slate-600"}`}
                                >
                                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate" title={tech.label}>{tech.label}</div>
                                  <div className={`text-2xl font-bold mt-1 ${overloaded ? "text-red-600 dark:text-red-400" : "text-slate-800 dark:text-slate-100"}`}>{tech.count}</div>
                                  <div className="text-xs text-slate-500 dark:text-slate-400">active ticket{tech.count === 1 ? "" : "s"}</div>
                                  {overloaded && <div className="text-[10px] font-bold uppercase text-red-600 dark:text-red-400 mt-1">⚠ Overloaded</div>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {tickets.length > 0 && (
                        <>
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">Tickets by Status</h3>
                              <div className="h-64 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                  <PieChart>
                                    <Pie
                                      data={statusData}
                                      cx="50%"
                                      cy="50%"
                                      innerRadius={60}
                                      outerRadius={80}
                                      paddingAngle={5}
                                      dataKey="value"
                                    >
                                      {statusData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                      ))}
                                    </Pie>
                                    <RechartsTooltip contentStyle={resolvedTheme === "dark" ? { backgroundColor: "#1e293b", border: "1px solid #334155", color: "#f1f5f9" } : undefined} />
                                    <Legend wrapperStyle={resolvedTheme === "dark" ? { color: "#cbd5e1" } : undefined} />
                                  </PieChart>
                                </ResponsiveContainer>
                              </div>
                            </div>

                            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">Tickets by Category</h3>
                              <div className="h-64 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={categoryData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: resolvedTheme === "dark" ? "#94a3b8" : "#475569" }} />
                                    <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: resolvedTheme === "dark" ? "#94a3b8" : "#475569" }} />
                                    <RechartsTooltip
                                      cursor={{ fill: cursorFill }}
                                      contentStyle={resolvedTheme === "dark" ? { backgroundColor: "#1e293b", border: "1px solid #334155", color: "#f1f5f9" } : undefined}
                                    />
                                    <Bar dataKey="count" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                            </div>

                            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">Tickets by Technician</h3>
                              <div className="h-64 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={techData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: resolvedTheme === "dark" ? "#94a3b8" : "#475569" }} />
                                    <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: resolvedTheme === "dark" ? "#94a3b8" : "#475569" }} />
                                    <RechartsTooltip
                                      cursor={{ fill: cursorFill }}
                                      contentStyle={resolvedTheme === "dark" ? { backgroundColor: "#1e293b", border: "1px solid #334155", color: "#f1f5f9" } : undefined}
                                    />
                                    <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                            </div>
                          </div>

                          {/* "Currently open" snapshot (item: reference dashboard shared
                              by the user) - a deliberately different slice than the row
                              above (all-time totals, any status) - labeled separately so
                              "Category" appearing twice doesn't read as a duplicate. */}
                          <h3 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mt-6 mb-3">Currently Open</h3>
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">Open Tickets by Category</h3>
                              <div className="h-64 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={openCategoryData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: resolvedTheme === "dark" ? "#94a3b8" : "#475569" }} />
                                    <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: resolvedTheme === "dark" ? "#94a3b8" : "#475569" }} />
                                    <RechartsTooltip
                                      cursor={{ fill: cursorFill }}
                                      contentStyle={resolvedTheme === "dark" ? { backgroundColor: "#1e293b", border: "1px solid #334155", color: "#f1f5f9" } : undefined}
                                    />
                                    <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                            </div>

                            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">Open Tickets by Priority</h3>
                              <div className="h-64 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={openPriorityData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: resolvedTheme === "dark" ? "#94a3b8" : "#475569" }} />
                                    <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: resolvedTheme === "dark" ? "#94a3b8" : "#475569" }} />
                                    <RechartsTooltip
                                      cursor={{ fill: cursorFill }}
                                      contentStyle={resolvedTheme === "dark" ? { backgroundColor: "#1e293b", border: "1px solid #334155", color: "#f1f5f9" } : undefined}
                                    />
                                    <Bar dataKey="count" fill="#ef4444" radius={[4, 4, 0, 0]} />
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                            </div>

                            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col justify-center">
                              <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase">Resolved (Last 30 Days)</h3>
                              <p className="text-4xl font-bold text-emerald-500 dark:text-emerald-400 mt-3">{resolvedLast30Days}</p>
                              <span className="text-xs text-slate-400 dark:text-slate-500 mt-2 block">Tickets marked resolved in the past 30 days</span>
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
