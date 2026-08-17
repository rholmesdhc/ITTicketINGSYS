"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { API_BASE_URL, isUnauthorized, logout, updateUserPreferences } from "@/lib/api";
import { isOverdue, isDueWithin, formatRelativeSla, urgencyRank, PRIORITY_RANK } from "@/lib/ticketSla";
import OnboardingWizard from "@/components/OnboardingWizard";
import ThemeToggle from "@/components/ThemeToggle";
import { useTheme } from "@/components/ThemeProvider";

type Employee = { id: number; email: string | null; first_name: string | null; last_name: string | null; role: string };

type QuickTab = "all" | "mine" | "unassigned" | "overdue" | "due_today";
type SortField = "priority" | "sla" | "category" | "status" | null;

// Item 20: shape-matched placeholders for the first load, instead of a
// blank flash while KPI cards/charts/table wait on the initial fetch.
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
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="h-12 bg-slate-100 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-700" />
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="p-4 border-b border-slate-100 dark:border-slate-700 animate-pulse flex gap-4 items-center">
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded flex-1" />
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-28" />
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-20" />
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-16" />
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-24" />
          </div>
        ))}
      </div>
    </>
  );
}

// Item: visual status timeline for requesters - a 3-step stepper reads at
// a glance much better than a bare status word, and maps directly onto
// the actual backend state machine (open -> in_progress -> resolved)
// rather than inventing steps the data doesn't really track.
const STATUS_STEPS: { key: string; label: string }[] = [
  { key: "open", label: "Submitted" },
  { key: "in_progress", label: "In Progress" },
  { key: "resolved", label: "Resolved" },
];

function StatusStepper({ status }: { status: string }) {
  const currentIndex = Math.max(0, STATUS_STEPS.findIndex(s => s.key === status));
  const isResolved = status === "resolved";
  const activeColor = isResolved ? "bg-emerald-500" : "bg-medical-blue dark:bg-medical-accent";
  return (
    <div className="flex items-center gap-1" title={STATUS_STEPS[currentIndex]?.label || status}>
      {STATUS_STEPS.map((step, i) => (
        <div key={step.key} className="flex items-center">
          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${i <= currentIndex ? activeColor : "bg-slate-200 dark:bg-slate-600"}`} />
          {i < STATUS_STEPS.length - 1 && (
            <div className={`w-4 h-0.5 ${i < currentIndex ? activeColor : "bg-slate-200 dark:bg-slate-600"}`} />
          )}
        </div>
      ))}
      <span className="ml-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
        {STATUS_STEPS[currentIndex]?.label || status}
      </span>
    </div>
  );
}

// Lightweight collapse toggle for a dashboard group - deliberately just a
// header row, not a bordered card wrapper like the Resolved Tickets section
// below, since the KPI/chart cards it sits above are already individually
// carded and a card-around-cards would look nested/heavy.
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

export default function Dashboard() {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const gridStroke = resolvedTheme === "dark" ? "#334155" : "#e2e8f0";
  const cursorFill = resolvedTheme === "dark" ? "#1e293b" : "#f1f5f9";
  const [tickets, setTickets] = useState<any[]>([]);
  const [directory, setDirectory] = useState<Employee[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Triage & visibility / search & filtering state
  const [activeTab, setActiveTab] = useState<QuickTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [technicianFilter, setTechnicianFilter] = useState(""); // "" = all, "unassigned", or a tech_id string
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [resolvedExpanded, setResolvedExpanded] = useState(false);
  // Collapsible dashboard groups (tester-requested) - default open/closed
  // matches pre-persistence behavior; overridden by the user's saved
  // preference once GET /users/me/preferences resolves (see mount effect
  // below). Plain setKpiExpanded/etc (not these toggle* wrappers) is still
  // used for applying that fetched value, since that's not a user action
  // and shouldn't re-save what was just loaded.
  const [kpiExpanded, setKpiExpanded] = useState(true);
  const [workloadChartsExpanded, setWorkloadChartsExpanded] = useState(true);
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
  const toggleResolvedExpanded = () => {
    const next = !resolvedExpanded;
    setResolvedExpanded(next);
    updateUserPreferences({ dashboard_resolved_expanded: next });
  };

  // Bulk / fast actions state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkStatusValue, setBulkStatusValue] = useState("");
  const [bulkTechValue, setBulkTechValue] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  // Live data state (items 19-20)
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Onboarding wizard: shown automatically once per account (tracked by
  // userId, not just "ever seen on this browser" - a shared machine with
  // multiple accounts should still onboard each one), replayable anytime
  // via the Help button.
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.push("/login");
      return;
    }
    setRole(localStorage.getItem("role"));
    const uid = localStorage.getItem("userId");
    setUserId(uid);
    fetchTickets(token);

    if (uid && !localStorage.getItem(`onboarding_seen_${uid}`)) {
      setIsWizardOpen(true);
    }

    fetch(`${API_BASE_URL}/users/directory`, {
      headers: { "Authorization": `Bearer ${token}` }
    })
      .then(res => {
        if (isUnauthorized(res)) return [];
        return res.ok ? res.json() : [];
      })
      .then(setDirectory)
      .catch(() => setDirectory([]));

    // Saved collapse-group preferences (see lib/api.ts's
    // updateUserPreferences) - applies over today's hardcoded defaults only
    // for keys that are actually present, so a user who's never touched a
    // given toggle still gets the normal default. Uses the plain setters,
    // not the toggle* wrappers, since loading a saved value isn't a user
    // action and shouldn't immediately re-save it. Not gated behind
    // isInitialLoading - a brief flash to the saved state on first render
    // is an accepted tradeoff for a cosmetic preference (see plan).
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
        if (typeof prefs.dashboard_resolved_expanded === "boolean") setResolvedExpanded(prefs.dashboard_resolved_expanded);
      })
      .catch(() => {});
  }, [router]);

  // Item 19: poll for new/changed tickets every 30s so anything created
  // elsewhere (another tech, the MCP server) shows up without a manual
  // reload. Paused while the tab isn't visible so it's not burning
  // requests on a background tab nobody's looking at.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const token = localStorage.getItem("token");
      if (token) fetchTickets(token);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchTickets = async (token: string, opts?: { showSpinner?: boolean }) => {
    if (opts?.showSpinner) setIsRefreshing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/tickets/`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (isUnauthorized(res)) return;
      if (res.ok) {
        const data = await res.json();
        setTickets(data);
        setLastUpdated(new Date());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsInitialLoading(false);
      if (opts?.showSpinner) setIsRefreshing(false);
    }
  };

  const handleManualRefresh = () => {
    const token = localStorage.getItem("token");
    if (token) fetchTickets(token, { showSpinner: true });
  };

  const handleCloseWizard = () => {
    setIsWizardOpen(false);
    if (userId) localStorage.setItem(`onboarding_seen_${userId}`, "1");
  };

  // Shared single-ticket PATCH used by row actions, inline reassignment,
  // bulk actions, and keyboard shortcuts alike. Returns whether it succeeded.
  const patchTicket = async (ticketId: number, body: Record<string, unknown>): Promise<boolean> => {
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_BASE_URL}/tickets/${ticketId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
      if (isUnauthorized(res)) return false;
      return res.ok;
    } catch (e) {
      console.error("Failed to update ticket", ticketId, e);
      return false;
    }
  };

  const handleStatusChange = async (ticketId: number, newStatus: string) => {
    const token = localStorage.getItem("token");
    if (await patchTicket(ticketId, { status: newStatus })) fetchTickets(token as string);
  };

  const handleAssignToMe = async (ticketId: number) => {
    const token = localStorage.getItem("token");
    const currentUserId = parseInt(localStorage.getItem("userId") || "0");
    if (await patchTicket(ticketId, { tech_id: currentUserId })) fetchTickets(token as string);
  };

  // Inline per-row reassignment (item 11) - any technician, or null to unassign.
  const handleReassign = async (ticketId: number, techId: number | null) => {
    const token = localStorage.getItem("token");
    if (await patchTicket(ticketId, { tech_id: techId })) fetchTickets(token as string);
  };

  // "This didn't fix it" - sends a resolved ticket back into the active
  // queue instead of the requester filing a duplicate. A dedicated
  // endpoint (not the general PATCH) since it's the requester's own call
  // to make on their own ticket, not a technician-only edit.
  const handleReopen = async (ticketId: number) => {
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_BASE_URL}/tickets/${ticketId}/reopen`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (isUnauthorized(res)) return;
      if (res.ok && token) fetchTickets(token);
    } catch (e) {
      console.error("Failed to reopen ticket", ticketId, e);
    }
  };

  // --- Bulk selection (item 10) ---
  const toggleSelectOne = (ticketId: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(ticketId)) next.delete(ticketId); else next.add(ticketId);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkStatusValue("");
    setBulkTechValue("");
  };

  const applyBulkStatus = async (status: string) => {
    if (!status || selectedIds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    const token = localStorage.getItem("token");
    await Promise.all(Array.from(selectedIds).map(id => patchTicket(id, { status })));
    if (token) fetchTickets(token);
    clearSelection();
    setBulkBusy(false);
  };

  const applyBulkAssign = async (techValue: string) => {
    if (!techValue || selectedIds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    const tech_id = techValue === "unassigned" ? null : parseInt(techValue);
    const token = localStorage.getItem("token");
    await Promise.all(Array.from(selectedIds).map(id => patchTicket(id, { tech_id })));
    if (token) fetchTickets(token);
    clearSelection();
    setBulkBusy(false);
  };

  const isAdminOrTech = role === "admin" || role === "technician";
  const dashboardTitle = isAdminOrTech ? "All Support Tickets" : "My Tickets";

  const directoryMap = useMemo(() => {
    const map = new Map<number, Employee>();
    directory.forEach(e => map.set(e.id, e));
    return map;
  }, [directory]);

  const formatEmployee = (empId: number | null | undefined) => {
    if (empId == null) return null;
    const e = directoryMap.get(empId);
    if (!e) return null;
    const name = [e.first_name, e.last_name].filter(Boolean).join(" ");
    return { name: name || null, email: e.email };
  };

  // Technicians that actually appear assigned to at least one ticket, for
  // a relevant (not "every employee in the org") filter dropdown.
  const technicianOptions = useMemo(() => {
    const ids = new Set<number>();
    tickets.forEach(t => { if (t.tech_id) ids.add(t.tech_id); });
    return Array.from(ids).map(id => {
      const emp = formatEmployee(id);
      return { id, label: emp?.name || emp?.email || `Tech ${id}` };
    }).sort((a, b) => a.label.localeCompare(b.label));
  }, [tickets, directoryMap]);

  // Every technician/admin in the org (item 11) - unlike technicianOptions
  // above, this includes staff with zero tickets currently assigned, so a
  // manager can hand work to anyone, not just people already carrying load.
  const allTechnicians = useMemo(() => {
    return directory
      .filter(e => e.role === "technician" || e.role === "admin")
      .map(e => ({ id: e.id, label: [e.first_name, e.last_name].filter(Boolean).join(" ") || e.email || `User ${e.id}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [directory]);

  const categoryOptions = useMemo(() => {
    return Array.from(new Set(tickets.map(t => t.category))).sort();
  }, [tickets]);

  // Item 14: active (non-resolved) ticket count per technician, including
  // techs with zero so a manager can see who has room, not just who's busy.
  const OVERLOAD_THRESHOLD = 5;
  const workload = useMemo(() => {
    const counts = new Map<number, number>();
    tickets.forEach(t => {
      if (t.status !== "resolved" && t.tech_id) {
        counts.set(t.tech_id, (counts.get(t.tech_id) || 0) + 1);
      }
    });
    return allTechnicians
      .map(tech => ({ ...tech, count: counts.get(tech.id) || 0 }))
      .sort((a, b) => b.count - a.count);
  }, [tickets, allTechnicians]);

  // --- KPI Calculations (unaffected by table filters - overall snapshot) ---
  const totalTickets = tickets.length;
  const openTickets = tickets.filter((t: any) => t.status === "open").length;
  const highPriorityTickets = tickets.filter((t: any) => t.priority === "P1" || t.priority === "P2").length;
  const resolvedTickets = tickets.filter((t: any) => t.status === "resolved").length;

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

  // --- Chart Data Calculations (also unaffected by table filters) ---
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

  const techCounts = tickets.reduce((acc: any, ticket: any) => {
    const techName = ticket.tech_id ? `Tech ${ticket.tech_id}` : 'Unassigned';
    acc[techName] = (acc[techName] || 0) + 1;
    return acc;
  }, {});

  const techData = Object.keys(techCounts).map(key => ({
    name: key,
    count: techCounts[key]
  }));

  // --- Table pipeline: quick tab -> search -> column filters -> sort ---
  const currentUserIdNum = parseInt(userId || "0");

  const tabFiltered = useMemo(() => {
    switch (activeTab) {
      case "mine":
        return tickets.filter(t => t.tech_id === currentUserIdNum);
      case "unassigned":
        return tickets.filter(t => !t.tech_id);
      case "overdue":
        return tickets.filter(t => isOverdue(t));
      case "due_today":
        return tickets.filter(t => isDueWithin(t, 24));
      default:
        return tickets;
    }
  }, [tickets, activeTab, currentUserIdNum]);

  const searched = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tabFiltered;
    return tabFiltered.filter(t => {
      const requester = formatEmployee(t.requester_id);
      const affected = formatEmployee(t.affected_user_id);
      const haystack = [
        `#${t.id}`,
        t.title,
        t.description,
        requester?.name,
        requester?.email,
        affected?.name,
        affected?.email,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [tabFiltered, searchQuery, directoryMap]);

  const columnFiltered = useMemo(() => {
    return searched.filter(t => {
      if (statusFilter && t.status !== statusFilter) return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (categoryFilter && t.category !== categoryFilter) return false;
      if (technicianFilter === "unassigned" && t.tech_id) return false;
      if (technicianFilter && technicianFilter !== "unassigned" && String(t.tech_id) !== technicianFilter) return false;
      return true;
    });
  }, [searched, statusFilter, priorityFilter, categoryFilter, technicianFilter]);

  const compareByField = (a: any, b: any, field: SortField): number => {
    switch (field) {
      case "priority":
        return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
      case "sla": {
        const ams = a.sla_deadline ? new Date(a.sla_deadline).getTime() : Infinity;
        const bms = b.sla_deadline ? new Date(b.sla_deadline).getTime() : Infinity;
        return ams - bms;
      }
      case "category":
        return String(a.category).localeCompare(String(b.category));
      case "status":
        return String(a.status).localeCompare(String(b.status));
      default:
        return 0;
    }
  };

  const activeList = columnFiltered.filter(t => t.status !== "resolved");
  const resolvedList = columnFiltered.filter(t => t.status === "resolved");

  const sortedActive = useMemo(() => {
    const list = [...activeList];
    if (sortField) {
      list.sort((a, b) => compareByField(a, b, sortField) * (sortDirection === "asc" ? 1 : -1));
    } else {
      list.sort((a, b) => urgencyRank(a) - urgencyRank(b));
    }
    return list;
  }, [activeList, sortField, sortDirection]);

  const sortedResolved = useMemo(() => {
    const list = [...resolvedList];
    if (sortField) {
      list.sort((a, b) => compareByField(a, b, sortField) * (sortDirection === "asc" ? 1 : -1));
    } else {
      list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    }
    return list;
  }, [resolvedList, sortField, sortDirection]);

  const toggleSort = (field: Exclude<SortField, null>) => {
    if (sortField === field) {
      setSortDirection(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const sortArrow = (field: Exclude<SortField, null>) => {
    if (sortField !== field) return null;
    return <span className="ml-1">{sortDirection === "asc" ? "▲" : "▼"}</span>;
  };

  // Selection is scoped to whatever's currently visible - clear it whenever
  // the visible set changes so a user can't apply a bulk action to tickets
  // they can no longer see (or think they've selected something they haven't).
  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab, searchQuery, statusFilter, priorityFilter, categoryFilter, technicianFilter]);

  const allVisibleSelected = sortedActive.length > 0 && sortedActive.every(t => selectedIds.has(t.id));
  const toggleSelectAllVisible = () => {
    setSelectedIds(prev => {
      if (allVisibleSelected) return new Set();
      return new Set(sortedActive.map(t => t.id));
    });
  };

  // --- Keyboard shortcuts (item 12): act on the current selection ---
  useEffect(() => {
    if (!isAdminOrTech) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (isTyping) return;

      if (e.key === "Escape") {
        clearSelection();
        return;
      }
      if (selectedIds.size === 0) return;
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        applyBulkStatus("resolved");
      } else if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        applyBulkAssign(String(currentUserIdNum));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAdminOrTech, selectedIds, currentUserIdNum]);

  // Item 16: SLA-breach alert banner
  const overdueTickets = tickets.filter(t => isOverdue(t));

  // Item 15: export whatever's currently visible (both active + resolved,
  // respecting the active tab/search/column filters) as CSV.
  const exportCsv = () => {
    const rows = [...sortedActive, ...sortedResolved];
    const header = ["ID", "Title", "Status", "Priority", "Category", "Affected Employee", "Requester", "Technician", "SLA Deadline", "Created At"];
    const escapeCsv = (val: unknown) => {
      const s = val == null ? "" : String(val);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map(t => {
      const affected = formatEmployee(t.affected_user_id);
      const requester = formatEmployee(t.requester_id);
      const tech = formatEmployee(t.tech_id);
      return [
        t.id,
        t.title,
        t.status,
        t.priority,
        t.category,
        affected?.name || affected?.email || "",
        requester?.name || requester?.email || "",
        tech?.name || tech?.email || "",
        t.sla_deadline ? new Date(t.sla_deadline).toLocaleString() : "",
        new Date(t.created_at).toLocaleString(),
      ].map(escapeCsv).join(",");
    });
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tickets-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasActiveFilters = activeTab !== "all" || searchQuery || statusFilter || priorityFilter || categoryFilter || technicianFilter || sortField;
  const resetFilters = () => {
    setActiveTab("all");
    setSearchQuery("");
    setStatusFilter("");
    setPriorityFilter("");
    setCategoryFilter("");
    setTechnicianFilter("");
    setSortField(null);
    setSortDirection("asc");
  };

  const columnCount = 6 + (isAdminOrTech ? 2 : 0); // +1 checkbox, +1 actions

  const renderRow = (t: any, selectable: boolean) => {
    const overdue = isOverdue(t);
    const affected = formatEmployee(t.affected_user_id);
    return (
      <tr key={t.id} className={`border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 ${overdue ? "bg-red-50 dark:bg-red-900/20" : ""} ${selectedIds.has(t.id) ? "bg-sky-50 dark:bg-sky-900/20" : ""}`}>
        {isAdminOrTech && (
          <td className="p-4">
            {selectable && (
              <input
                type="checkbox"
                checked={selectedIds.has(t.id)}
                onChange={() => toggleSelectOne(t.id)}
                className="w-4 h-4 cursor-pointer"
                aria-label={`Select ticket #${t.id}`}
              />
            )}
          </td>
        )}
        <td className="p-4 font-medium text-medical-dark dark:text-medical-accent">
          <Link href={`/tickets/${t.id}`} className="hover:underline">
            #{t.id} - {t.title}
          </Link>
          {t.technician_note && <span className="ml-1.5" title="Technician left a note">📝</span>}
          {t.resolution && <span className="ml-1" title="Resolution documented">✅</span>}
        </td>
        <td className="p-4 text-sm text-slate-600 dark:text-slate-300">
          {affected ? (
            <>
              <div>{affected.name || "—"}</div>
              <div className="text-xs text-slate-400 dark:text-slate-500">{affected.email}</div>
            </>
          ) : (
            <span className="text-slate-400 dark:text-slate-500">Same as requester</span>
          )}
        </td>
        <td className="p-4 text-slate-700 dark:text-slate-300">{t.category}</td>
        <td className="p-4">
          {isAdminOrTech ? (
            <select
              className="bg-sky-50 dark:bg-sky-900/40 border border-sky-200 dark:border-sky-700 text-sky-800 dark:text-sky-300 text-xs font-bold uppercase rounded px-2 py-1 outline-none cursor-pointer"
              value={t.status}
              onChange={(e) => handleStatusChange(t.id, e.target.value)}
            >
              <option value="open">OPEN</option>
              <option value="in_progress">IN PROGRESS</option>
              <option value="resolved">RESOLVED</option>
            </select>
          ) : (
            <div className="flex flex-col gap-1 items-start">
              <StatusStepper status={t.status} />
              {t.status === "resolved" && (
                <button
                  onClick={() => handleReopen(t.id)}
                  className="text-[11px] text-medical-blue dark:text-medical-accent hover:text-medical-dark dark:hover:text-medical-light hover:underline cursor-pointer font-semibold"
                >
                  This didn't fix it — Reopen
                </button>
              )}
            </div>
          )}
        </td>
        <td className="p-4">
          <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${t.priority === 'P1' ? 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-700' : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-300'}`}>
            {t.priority}
          </span>
          {t.priority_needs_review && (
            <span className="ml-1" title="AI triage couldn't reach the classifier - this defaulted to P3 and hasn't been reviewed by a technician yet">🤖⚠️</span>
          )}
        </td>
        <td className="p-4 text-sm font-medium">
          <div className={overdue ? "text-red-600 dark:text-red-400 font-bold flex items-center gap-2" : "text-slate-600 dark:text-slate-300"}>
            {formatRelativeSla(t)}
            {overdue && (
              <span className="text-[10px] font-bold uppercase bg-red-600 text-white px-1.5 py-0.5 rounded">Overdue</span>
            )}
          </div>
          <div className="text-xs text-slate-400 dark:text-slate-500">
            {t.sla_deadline ? new Date(t.sla_deadline).toLocaleString() : ""}
          </div>
        </td>
        {isAdminOrTech && (
          <td className="p-4 text-right">
            <div className="flex flex-col items-end gap-1">
              <select
                className="text-xs border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 dark:text-slate-100 cursor-pointer max-w-[160px]"
                value={t.tech_id ?? ""}
                onChange={(e) => handleReassign(t.id, e.target.value ? parseInt(e.target.value) : null)}
                aria-label={`Reassign ticket #${t.id}`}
              >
                <option value="">Unassigned</option>
                {allTechnicians.map(tech => (
                  <option key={tech.id} value={tech.id}>
                    {tech.label}{tech.id === currentUserIdNum ? " (you)" : ""}
                  </option>
                ))}
              </select>
              {t.tech_id === currentUserIdNum ? (
                <span className="text-[10px] font-bold text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/40 px-1.5 py-0.5 rounded border border-green-200 dark:border-green-700">Assigned to you</span>
              ) : (
                <button
                  onClick={() => handleAssignToMe(t.id)}
                  className="text-[11px] text-medical-blue dark:text-medical-accent hover:text-medical-dark dark:hover:text-medical-light hover:underline cursor-pointer font-semibold"
                >
                  Assign to me
                </button>
              )}
            </div>
          </td>
        )}
      </tr>
    );
  };

  // Mobile equivalent of renderRow - a stacked card instead of table
  // columns, since a 6-8 column table just forces horizontal scrolling on
  // a phone. Carries the same data and actions as the desktop row.
  const renderCard = (t: any, selectable: boolean) => {
    const overdue = isOverdue(t);
    const affected = formatEmployee(t.affected_user_id);
    return (
      <div
        key={t.id}
        className={`p-4 rounded-xl border shadow-sm ${
          overdue ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800" : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
        } ${selectedIds.has(t.id) ? "ring-2 ring-sky-400 dark:ring-sky-600" : ""}`}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-start gap-2 min-w-0">
            {isAdminOrTech && selectable && (
              <input
                type="checkbox"
                checked={selectedIds.has(t.id)}
                onChange={() => toggleSelectOne(t.id)}
                className="w-4 h-4 mt-1 cursor-pointer shrink-0"
                aria-label={`Select ticket #${t.id}`}
              />
            )}
            <Link href={`/tickets/${t.id}`} className="font-semibold text-medical-dark dark:text-medical-accent hover:underline">
              #{t.id} - {t.title}
            </Link>
            {t.technician_note && <span title="Technician left a note">📝</span>}
            {t.resolution && <span title="Resolution documented">✅</span>}
          </div>
          <span className={`shrink-0 px-2 py-1 rounded text-xs font-bold uppercase ${t.priority === 'P1' ? 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-700' : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-300'}`}>
            {t.priority}
            {t.priority_needs_review && <span className="ml-1" title="AI triage couldn't reach the classifier - defaulted to P3, not yet reviewed">🤖⚠️</span>}
          </span>
        </div>

        <div className="text-sm text-slate-600 dark:text-slate-300 mb-3">
          {t.category}
          {affected && <> · {affected.name || affected.email}</>}
        </div>

        <div className="mb-3">
          {isAdminOrTech ? (
            <select
              className="bg-sky-50 dark:bg-sky-900/40 border border-sky-200 dark:border-sky-700 text-sky-800 dark:text-sky-300 text-xs font-bold uppercase rounded px-2 py-1 outline-none cursor-pointer"
              value={t.status}
              onChange={(e) => handleStatusChange(t.id, e.target.value)}
            >
              <option value="open">OPEN</option>
              <option value="in_progress">IN PROGRESS</option>
              <option value="resolved">RESOLVED</option>
            </select>
          ) : (
            <div className="flex flex-col gap-1 items-start">
              <StatusStepper status={t.status} />
              {t.status === "resolved" && (
                <button
                  onClick={() => handleReopen(t.id)}
                  className="text-xs text-medical-blue dark:text-medical-accent hover:underline cursor-pointer font-semibold"
                >
                  This didn't fix it — Reopen
                </button>
              )}
            </div>
          )}
        </div>

        <div className={`text-sm font-medium ${overdue ? "text-red-600 dark:text-red-400 font-bold flex items-center gap-2" : "text-slate-600 dark:text-slate-300"}`}>
          {formatRelativeSla(t)}
          {overdue && <span className="text-[10px] font-bold uppercase bg-red-600 text-white px-1.5 py-0.5 rounded">Overdue</span>}
        </div>

        {isAdminOrTech && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
            <select
              className="text-xs border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 dark:text-slate-100 cursor-pointer flex-1 min-w-0"
              value={t.tech_id ?? ""}
              onChange={(e) => handleReassign(t.id, e.target.value ? parseInt(e.target.value) : null)}
              aria-label={`Reassign ticket #${t.id}`}
            >
              <option value="">Unassigned</option>
              {allTechnicians.map(tech => (
                <option key={tech.id} value={tech.id}>
                  {tech.label}{tech.id === currentUserIdNum ? " (you)" : ""}
                </option>
              ))}
            </select>
            {t.tech_id === currentUserIdNum ? (
              <span className="shrink-0 text-[10px] font-bold text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/40 px-1.5 py-0.5 rounded border border-green-200 dark:border-green-700">You</span>
            ) : (
              <button
                onClick={() => handleAssignToMe(t.id)}
                className="shrink-0 text-xs text-medical-blue dark:text-medical-accent hover:underline cursor-pointer font-semibold"
              >
                Assign to me
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const tabButton = (tab: QuickTab, label: string, count: number) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
        activeTab === tab ? "bg-medical-blue text-white" : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
      }`}
    >
      {label} <span className="opacity-70">({count})</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      <header className="bg-medical-blue text-white p-4 shadow-md flex flex-wrap items-center justify-between gap-y-2 gap-x-4 px-4 sm:px-10">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <Image
              src="/images/delta-health-logo.png"
              alt="Delta Health Center"
              width={160}
              height={68}
              className="h-9 w-auto rounded bg-white p-1"
              preload
            />
            <h1 className="text-xl font-bold">Clinical IT Portal</h1>
          </div>
          {role === "admin" && (
            <>
              <Link href="/users" className="text-sm font-semibold hover:text-medical-light transition-colors">
                User Management
              </Link>
              <Link href="/settings" className="text-sm font-semibold hover:text-medical-light transition-colors">
                Settings
              </Link>
            </>
          )}
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <button
            onClick={() => setIsWizardOpen(true)}
            className="text-sm border border-white px-3 py-1 rounded hover:bg-medical-dark transition-colors cursor-pointer"
          >
            ? Help
          </button>
          <button
            onClick={async () => { await logout(); router.push("/login"); }}
            className="text-sm border border-white px-3 py-1 rounded hover:bg-medical-dark transition-colors cursor-pointer"
          >
            Logout
          </button>
        </div>
      </header>

      <OnboardingWizard isOpen={isWizardOpen} onClose={handleCloseWizard} role={role} />

      <main className="max-w-7xl mx-auto p-10 w-full flex-1">
        <div className="flex flex-wrap items-center justify-between gap-y-2 mb-2">
          <h2 className="text-3xl font-semibold text-slate-800 dark:text-slate-100">{dashboardTitle}</h2>
          <div className="flex items-center gap-3">
            <button
              data-tour="export-csv"
              onClick={exportCsv}
              className="bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 px-4 py-2 rounded shadow-sm transition-colors font-semibold cursor-pointer"
            >
              ⬇ Export CSV
            </button>
            <Link data-tour="new-ticket-button" href="/tickets/new" className="bg-medical-accent hover:bg-medical-blue text-white px-5 py-2 rounded shadow transition-colors font-semibold">
              + New Ticket
            </Link>
          </div>
        </div>

        {/* Item 19: manual refresh + last-updated, so it's clear the list can
            go stale (e.g. a ticket filed via MCP) and there's a way to fix it
            without a full page reload. Auto-refreshes every 30s on its own. */}
        <div className="flex items-center gap-2 mb-8 text-sm text-slate-500 dark:text-slate-400">
          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 text-medical-blue dark:text-medical-accent hover:text-medical-dark dark:hover:text-medical-light font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className={isRefreshing ? "animate-spin" : ""}>↻</span>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
          {lastUpdated && <span>· Updated {lastUpdated.toLocaleTimeString()}</span>}
        </div>

        {/* SLA-breach alert banner (item 16) */}
        {overdueTickets.length > 0 && (
          <button
            onClick={() => setActiveTab("overdue")}
            className="w-full text-left mb-6 bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-800 rounded-xl p-4 flex items-center justify-between gap-3 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors cursor-pointer"
          >
            <span className="font-semibold text-red-800 dark:text-red-300">
              ⚠ {overdueTickets.length} ticket{overdueTickets.length === 1 ? "" : "s"} {isAdminOrTech ? "" : "of yours "}past SLA deadline
              {isAdminOrTech ? " across the queue" : ""}
            </span>
            <span className="text-sm text-red-700 dark:text-red-400 font-semibold underline">View overdue tickets →</span>
          </button>
        )}

        {isInitialLoading ? (
          <DashboardSkeleton />
        ) : (
        <>
        {/* KPI Summary Cards - technicians/admins get the full ops
            snapshot; requesters get a smaller, personal-tracking view
            instead (org-wide totals and priority mix mean nothing about
            their own couple of tickets). Collapsible as a group
            (tester-requested) - individually collapsing each card would be
            more fiddly than useful for 3-4 small numbers. */}
        <div className="mb-8">
        <CollapsibleSectionHeader title="Key Metrics" expanded={kpiExpanded} onToggle={() => toggleKpiExpanded()} />
        {kpiExpanded && (
        <div data-tour="kpi-cards" className={`grid grid-cols-1 gap-6 ${isAdminOrTech ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
          {isAdminOrTech ? (
            <>
              <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase">Total Tickets</h3>
                <p className="text-3xl font-bold text-slate-800 dark:text-slate-100 mt-2">{totalTickets}</p>
                {renderTrend(totalTrend, "neutral")}
              </div>
              <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase">Open Tickets</h3>
                <p className="text-3xl font-bold text-amber-500 dark:text-amber-400 mt-2">{openTickets}</p>
                {renderTrend(openTrend, "down")}
              </div>
              <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase">High Priority (P1/P2)</h3>
                <p className="text-3xl font-bold text-red-500 dark:text-red-400 mt-2">{highPriorityTickets}</p>
                {renderTrend(highPriorityTrend, "down")}
              </div>
              <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase">Resolved</h3>
                <p className="text-3xl font-bold text-emerald-500 dark:text-emerald-400 mt-2">{resolvedTickets}</p>
                {renderTrend(resolvedTrend, "up")}
              </div>
            </>
          ) : (
            <>
              <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase">My Open Tickets</h3>
                <p className="text-3xl font-bold text-amber-500 dark:text-amber-400 mt-2">{myActiveTickets}</p>
                {renderTrend(openTrend, "down")}
              </div>
              <div className={`bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border ${overdueTickets.length > 0 ? "border-red-300 dark:border-red-800" : "border-slate-200 dark:border-slate-700"}`}>
                <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase">Overdue</h3>
                <p className={`text-3xl font-bold mt-2 ${overdueTickets.length > 0 ? "text-red-500 dark:text-red-400" : "text-slate-800 dark:text-slate-100"}`}>{overdueTickets.length}</p>
                <span className="text-xs text-slate-400 dark:text-slate-500 mt-1 block">
                  {overdueTickets.length > 0 ? "Past their SLA deadline" : "Nothing past deadline"}
                </span>
              </div>
              <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase">Resolved</h3>
                <p className="text-3xl font-bold text-emerald-500 dark:text-emerald-400 mt-2">{resolvedTickets}</p>
                {avgResolutionDays != null ? (
                  <span className="text-xs text-slate-400 dark:text-slate-500 mt-1 block">
                    Avg. {avgResolutionDays < 1 ? "under a day" : `${avgResolutionDays.toFixed(1)} days`} to resolve
                  </span>
                ) : renderTrend(resolvedTrend, "up")}
              </div>
            </>
          )}
        </div>
        )}
        </div>

        {/* Technician Workload (item 14) + charts, grouped under one
            collapse toggle (tester-requested) - both are staff-only
            org-wide breakdowns that don't mean much against a requester's
            own handful of tickets, so the whole group stays gated on
            isAdminOrTech same as before. */}
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
              )}
              </>
            )}
          </div>
        )}

        {/* Quick-filter tabs */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {tabButton("all", "All", tickets.length)}
          {isAdminOrTech && tabButton("mine", "My Tickets", tickets.filter(t => t.tech_id === currentUserIdNum).length)}
          {isAdminOrTech && tabButton("unassigned", "Unassigned", tickets.filter(t => !t.tech_id).length)}
          {tabButton("overdue", "Overdue", tickets.filter(t => isOverdue(t)).length)}
          {tabButton("due_today", "Due Today", tickets.filter(t => isDueWithin(t, 24)).length)}
        </div>

        {/* Search + column filters */}
        <div data-tour="search-filters" className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 mb-4 flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search title, description, requester, or affected employee..."
            className="flex-1 min-w-[240px] px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-medical-accent"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <select className="px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
          </select>
          <select className="px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg text-sm" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
            <option value="">All Priorities</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
            <option value="P3">P3</option>
            <option value="P4">P4</option>
          </select>
          <select className="px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg text-sm" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All Categories</option>
            {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {isAdminOrTech && (
            <select className="px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg text-sm" value={technicianFilter} onChange={(e) => setTechnicianFilter(e.target.value)}>
              <option value="">All Technicians</option>
              <option value="unassigned">Unassigned</option>
              {technicianOptions.map(t => <option key={t.id} value={String(t.id)}>{t.label}</option>)}
            </select>
          )}
          {hasActiveFilters && (
            <button onClick={resetFilters} className="text-sm text-medical-blue dark:text-medical-accent hover:text-medical-dark dark:hover:text-medical-light font-semibold cursor-pointer">
              Reset filters
            </button>
          )}
        </div>

        {/* Bulk action toolbar (item 10) - appears once at least one ticket is selected */}
        {isAdminOrTech && selectedIds.size > 0 && (
          <div className="bg-sky-50 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-800 rounded-xl p-4 mb-4 flex flex-wrap items-center gap-3">
            <span className="text-sm font-bold text-sky-900 dark:text-sky-200">{selectedIds.size} selected</span>

            <select
              className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-700 dark:text-slate-100"
              value={bulkStatusValue}
              onChange={(e) => setBulkStatusValue(e.target.value)}
            >
              <option value="">Set status...</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="resolved">Resolved</option>
            </select>
            <button
              disabled={!bulkStatusValue || bulkBusy}
              onClick={() => applyBulkStatus(bulkStatusValue)}
              className="text-sm bg-medical-blue hover:bg-medical-dark text-white px-3 py-1.5 rounded font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Apply
            </button>

            <select
              className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-700 dark:text-slate-100"
              value={bulkTechValue}
              onChange={(e) => setBulkTechValue(e.target.value)}
            >
              <option value="">Assign to...</option>
              <option value="unassigned">Unassigned</option>
              {allTechnicians.map(t => <option key={t.id} value={String(t.id)}>{t.label}</option>)}
            </select>
            <button
              disabled={!bulkTechValue || bulkBusy}
              onClick={() => applyBulkAssign(bulkTechValue)}
              className="text-sm bg-medical-blue hover:bg-medical-dark text-white px-3 py-1.5 rounded font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Apply
            </button>

            <button onClick={clearSelection} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer">
              Clear selection
            </button>

            <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">
              Shortcuts: <kbd className="px-1 py-0.5 bg-white dark:bg-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 rounded">R</kbd> resolve selected · <kbd className="px-1 py-0.5 bg-white dark:bg-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 rounded">A</kbd> assign to me · <kbd className="px-1 py-0.5 bg-white dark:bg-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 rounded">Esc</kbd> clear
            </span>
          </div>
        )}

        {/* Active tickets - stacked cards below the md breakpoint (a 6-8
            column table just forces horizontal scrolling on a phone), the
            full table at md and up. Wrapped in one data-tour target so the
            spotlight tour finds the same element regardless of viewport. */}
        <div data-tour="ticket-table">
          <div className="md:hidden space-y-3">
            {sortedActive.length === 0 ? (
              <div className="p-8 text-center text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                {tickets.length === 0 ? "No tickets found. Create one to get started!" : "No active tickets match the current filters."}
              </div>
            ) : (
              sortedActive.map(t => renderCard(t, true))
            )}
          </div>

          <div className="hidden md:block bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-600">
                  {isAdminOrTech && (
                    <th data-tour="bulk-select-header" className="p-4 font-semibold">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        className="w-4 h-4 cursor-pointer"
                        aria-label="Select all visible tickets"
                      />
                    </th>
                  )}
                  <th className="p-4 font-semibold">Ticket</th>
                  <th className="p-4 font-semibold">Affected Employee</th>
                  <th className="p-4 font-semibold cursor-pointer select-none" onClick={() => toggleSort("category")}>Category{sortArrow("category")}</th>
                  <th className="p-4 font-semibold cursor-pointer select-none" onClick={() => toggleSort("status")}>Status{sortArrow("status")}</th>
                  <th className="p-4 font-semibold cursor-pointer select-none" onClick={() => toggleSort("priority")}>Priority{sortArrow("priority")}</th>
                  <th className="p-4 font-semibold cursor-pointer select-none" onClick={() => toggleSort("sla")}>Resolution SLA (TTR){sortArrow("sla")}</th>
                  {isAdminOrTech && <th className="p-4 font-semibold text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {sortedActive.length === 0 ? (
                  <tr>
                    <td colSpan={columnCount} className="p-10 text-center text-slate-500 dark:text-slate-400">
                      {tickets.length === 0 ? "No tickets found. Create one to get started!" : "No active tickets match the current filters."}
                    </td>
                  </tr>
                ) : (
                  sortedActive.map(t => renderRow(t, true))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Resolved tickets - collapsed by default so they don't crowd the active work queue */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden mt-6">
          <button
            onClick={() => toggleResolvedExpanded()}
            className="w-full flex justify-between items-center p-4 text-left cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <span className="font-semibold text-slate-700 dark:text-slate-200">Resolved Tickets ({sortedResolved.length})</span>
            <span className="text-slate-400 dark:text-slate-500">{resolvedExpanded ? "▲ Hide" : "▼ Show"}</span>
          </button>
          {resolvedExpanded && (
            <div className="border-t border-slate-200 dark:border-slate-700">
              <div className="md:hidden p-4 space-y-3">
                {sortedResolved.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 dark:text-slate-400">No resolved tickets match the current filters.</div>
                ) : (
                  sortedResolved.map(t => renderCard(t, false))
                )}
              </div>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[900px]">
                  <tbody>
                    {sortedResolved.length === 0 ? (
                      <tr>
                        <td colSpan={columnCount} className="p-10 text-center text-slate-500 dark:text-slate-400">No resolved tickets match the current filters.</td>
                      </tr>
                    ) : (
                      sortedResolved.map(t => renderRow(t, false))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        </>
        )}
      </main>
    </div>
  );
}
