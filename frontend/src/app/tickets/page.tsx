"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API_BASE_URL, isUnauthorized, updateUserPreferences } from "@/lib/api";
import { isOverdue, isDueWithin, formatRelativeSla, urgencyRank, PRIORITY_RANK } from "@/lib/ticketSla";
import Sidebar from "@/components/Sidebar";
import { useTicketsFeed } from "@/hooks/useTicketsFeed";

type QuickTab = "all" | "mine" | "unassigned" | "overdue" | "due_today";
type SortField = "priority" | "sla" | "category" | "status" | null;

// Item 20: shape-matched placeholder for the first load, instead of a blank
// flash while the table waits on the initial fetch.
function TicketsSkeleton() {
  return (
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
  );
}

// Item: visual status timeline for requesters - a 3-step stepper reads at a
// glance much better than a bare status word, and maps directly onto the
// actual backend state machine (open -> in_progress -> resolved) rather
// than inventing steps the data doesn't really track.
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

// Shared paging footer for both grids on this page (Active and Resolved
// tickets) - renders nothing when everything already fits on one page, so
// it doesn't add clutter to a short list.
function Pagination({
  page, pageCount, totalItems, pageSize, onPageChange,
}: {
  page: number; pageCount: number; totalItems: number; pageSize: number; onPageChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-700 text-sm">
      <span className="text-slate-500 dark:text-slate-400">
        Showing {start}-{end} of {totalItems}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          ← Prev
        </button>
        <span className="text-slate-500 dark:text-slate-400 px-1">Page {page} of {pageCount}</span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
          className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

export default function Tickets() {
  const { tickets, formatEmployee, directoryMap, allTechnicians, role, userId, isInitialLoading, isRefreshing, lastUpdated, fetchTickets, handleManualRefresh } = useTicketsFeed();

  // Triage & visibility / search & filtering state
  const [activeTab, setActiveTab] = useState<QuickTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  // Deliberately separate from searchQuery above - that one filters the
  // table in place, this one navigates straight to a ticket's own detail
  // page. Keeping them as two distinct controls avoids the same input
  // sometimes filtering and sometimes navigating depending on what's typed,
  // which would be a surprising, inconsistent behavior for one search box.
  const [jumpToTicketQuery, setJumpToTicketQuery] = useState("");
  const [jumpToTicketError, setJumpToTicketError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [technicianFilter, setTechnicianFilter] = useState(""); // "" = all, "unassigned", or a tech_id string
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [resolvedExpanded, setResolvedExpanded] = useState(false);
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

  // Paging - the Active and Resolved tables are two separate grids with
  // their own independent page number, since browsing one has nothing to
  // do with where you left off in the other.
  const TICKETS_PAGE_SIZE = 15;
  const [activePage, setActivePage] = useState(1);
  const [resolvedPage, setResolvedPage] = useState(1);

  // Saved collapse preference for the Resolved Tickets section - kept under
  // the same "dashboard_*" preference key it always used, even though the
  // section itself now lives on this page, so existing saved values aren't
  // orphaned by the split.
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
        if (typeof prefs?.dashboard_resolved_expanded === "boolean") setResolvedExpanded(prefs.dashboard_resolved_expanded);
      })
      .catch(() => {});
  }, []);

  // Navigates straight to a ticket's detail page rather than filtering the
  // table - the detail page (/tickets/[id]) already 404s (not 403) for a
  // ticket a requester doesn't own, same as visiting the URL directly, so
  // there's no separate permission check needed here.
  const router = useRouter();
  const handleJumpToTicket = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = jumpToTicketQuery.trim().replace(/^#/, "");
    const id = parseInt(raw, 10);
    if (!raw || isNaN(id) || id <= 0) {
      setJumpToTicketError("Enter a valid ticket number");
      return;
    }
    setJumpToTicketError("");
    setJumpToTicketQuery("");
    router.push(`/tickets/${id}`);
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
  // endpoint (not the general PATCH) since it's the requester's own call to
  // make on their own ticket, not a technician-only edit.
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
  const pageTitle = isAdminOrTech ? "All Support Tickets" : "My Tickets";

  // Technicians that actually appear assigned to at least one ticket, for a
  // relevant (not "every employee in the org") filter dropdown.
  const technicianOptions = useMemo(() => {
    const ids = new Set<number>();
    tickets.forEach((t: any) => { if (t.tech_id) ids.add(t.tech_id); });
    return Array.from(ids).map(id => {
      const emp = formatEmployee(id);
      return { id, label: emp?.name || emp?.email || `Tech ${id}` };
    }).sort((a, b) => a.label.localeCompare(b.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, directoryMap]);

  const categoryOptions = useMemo(() => {
    return Array.from(new Set(tickets.map((t: any) => t.category))).sort() as string[];
  }, [tickets]);

  // --- Table pipeline: quick tab -> search -> column filters -> sort ---
  const currentUserIdNum = parseInt(userId || "0");

  // Base for the quick-filter tab pill counts (All/My Tickets/Unassigned/
  // Overdue/Due Today) - respects the status dropdown only, not the other
  // column filters or search, and is deliberately separate from tabFiltered
  // below (that pipeline filters the *table* by the active tab; this just
  // recalculates what each tab's own pill number should read given the
  // current status filter).
  const ticketsForTabCounts = statusFilter ? tickets.filter((t: any) => t.status === statusFilter) : tickets;

  const tabFiltered = useMemo(() => {
    switch (activeTab) {
      case "mine":
        return tickets.filter((t: any) => t.tech_id === currentUserIdNum);
      case "unassigned":
        return tickets.filter((t: any) => !t.tech_id);
      case "overdue":
        return tickets.filter((t: any) => isOverdue(t));
      case "due_today":
        return tickets.filter((t: any) => isDueWithin(t, 24));
      default:
        return tickets;
    }
  }, [tickets, activeTab, currentUserIdNum]);

  const searched = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tabFiltered;
    return tabFiltered.filter((t: any) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabFiltered, searchQuery, directoryMap]);

  const columnFiltered = useMemo(() => {
    return searched.filter((t: any) => {
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

  const activeList = columnFiltered.filter((t: any) => t.status !== "resolved");
  const resolvedList = columnFiltered.filter((t: any) => t.status === "resolved");

  const sortedActive = useMemo(() => {
    const list = [...activeList];
    if (sortField) {
      list.sort((a, b) => compareByField(a, b, sortField) * (sortDirection === "asc" ? 1 : -1));
    } else {
      list.sort((a, b) => urgencyRank(a) - urgencyRank(b));
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeList, sortField, sortDirection]);

  const sortedResolved = useMemo(() => {
    const list = [...resolvedList];
    if (sortField) {
      list.sort((a, b) => compareByField(a, b, sortField) * (sortDirection === "asc" ? 1 : -1));
    } else {
      list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedList, sortField, sortDirection]);

  // Client-side paging - the full filtered/sorted lists above stay intact
  // (exportCsv and the tab/pill counts all still need the complete set);
  // only what's actually rendered gets sliced down to one page. Clamped so
  // a page number that's now out of range (the filtered set shrank, or a
  // ticket got bulk-resolved off the active list) doesn't render blank -
  // it falls back to the last real page instead of an empty grid.
  const activePageCount = Math.max(1, Math.ceil(sortedActive.length / TICKETS_PAGE_SIZE));
  const clampedActivePage = Math.min(activePage, activePageCount);
  const pagedActive = sortedActive.slice((clampedActivePage - 1) * TICKETS_PAGE_SIZE, clampedActivePage * TICKETS_PAGE_SIZE);

  const resolvedPageCount = Math.max(1, Math.ceil(sortedResolved.length / TICKETS_PAGE_SIZE));
  const clampedResolvedPage = Math.min(resolvedPage, resolvedPageCount);
  const pagedResolved = sortedResolved.slice((clampedResolvedPage - 1) * TICKETS_PAGE_SIZE, clampedResolvedPage * TICKETS_PAGE_SIZE);

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
  // Paging resets alongside it (and also on a re-sort, since "page 2"
  // means something different once the order changes) so a filter/sort
  // change always lands back on page 1 instead of a now-unrelated page.
  useEffect(() => {
    setSelectedIds(new Set());
    setActivePage(1);
    setResolvedPage(1);
  }, [activeTab, searchQuery, statusFilter, priorityFilter, categoryFilter, technicianFilter, sortField, sortDirection]);

  // "Select all" is scoped to the current page, not every filtered ticket
  // across every page - the checkbox sits in the header of the rows
  // actually rendered, and silently selecting tickets the user can't see
  // would be surprising (this matches how most paginated admin grids,
  // including WordPress's, handle a page-level "select all").
  const allVisibleSelected = pagedActive.length > 0 && pagedActive.every(t => selectedIds.has(t.id));
  const toggleSelectAllVisible = () => {
    setSelectedIds(prev => {
      if (allVisibleSelected) return new Set();
      return new Set(pagedActive.map(t => t.id));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminOrTech, selectedIds, currentUserIdNum]);

  // Item 16: SLA-breach alert banner
  const overdueTickets = tickets.filter((t: any) => isOverdue(t));

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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex">
      <Sidebar role={role} />

      <div className="flex-1 flex flex-col min-w-0 pt-14 md:pt-0">
        {/* max-w-[100rem] (was max-w-7xl/1280px) - the ticket table's last
            column (technician reassignment) was getting clipped at the
            container edge on a typical laptop screen, forcing a horizontal
            scroll to see who a ticket is assigned to that wasn't obvious was
            even there. */}
        <main className="max-w-[100rem] mx-auto p-10 w-full flex-1">
          <div className="flex flex-wrap items-center justify-between gap-y-2 mb-2">
            <h2 className="text-3xl font-semibold text-slate-800 dark:text-slate-100">{pageTitle}</h2>
            <button
              data-tour="export-csv"
              onClick={exportCsv}
              className="bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 px-4 py-2 rounded shadow-sm transition-colors font-semibold cursor-pointer"
            >
              ⬇ Export CSV
            </button>
          </div>

          {/* Quick jump to a specific ticket by number - navigates straight to
              its detail page, distinct from the table search box below (which
              filters in place). "+ New Ticket" sits right next to it - the
              only other way to reach /tickets/new is hovering Tickets in the
              sidebar, which isn't as discoverable as a button on the page
              itself (TODO item from Sep 2026). No data-tour id here - the
              onboarding tour's "Filing a Ticket" step already spotlights the
              sidebar's own Tickets item, which (unlike this button) exists
              on every page, not just this one. */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <form onSubmit={handleJumpToTicket} className="flex items-center gap-2">
              <div className="relative w-full max-w-xs">
                <input
                  type="text"
                  inputMode="numeric"
                  value={jumpToTicketQuery}
                  onChange={(e) => { setJumpToTicketQuery(e.target.value); setJumpToTicketError(""); }}
                  placeholder="Jump to ticket #..."
                  aria-label="Jump to ticket by number"
                  className="w-full pl-4 pr-10 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg text-sm focus:ring-2 focus:ring-medical-accent focus:outline-none"
                />
                <button
                  type="submit"
                  aria-label="Go to ticket"
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-medical-blue dark:hover:text-medical-accent cursor-pointer"
                >
                  →
                </button>
              </div>
              {jumpToTicketError && <span className="text-xs text-red-600 dark:text-red-400">{jumpToTicketError}</span>}
            </form>
            <Link
              href="/tickets/new"
              className="shrink-0 bg-medical-accent hover:bg-medical-blue text-white px-5 py-2 rounded shadow transition-colors font-semibold whitespace-nowrap"
            >
              + New Ticket
            </Link>
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
            <TicketsSkeleton />
          ) : (
            <>
              {/* Quick-filter tabs - pill counts respect the "All Statuses"
                  dropdown below (not the other column filters/search), so
                  e.g. "My Tickets" narrows to just your open ones when that
                  dropdown is set to Open, instead of staying frozen at the
                  org-wide total. All 5 pills stay consistent with each other
                  rather than just one of them moving. */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                {tabButton("all", "All", ticketsForTabCounts.length)}
                {isAdminOrTech && tabButton("mine", "My Tickets", ticketsForTabCounts.filter((t: any) => t.tech_id === currentUserIdNum).length)}
                {isAdminOrTech && tabButton("unassigned", "Unassigned", ticketsForTabCounts.filter((t: any) => !t.tech_id).length)}
                {tabButton("overdue", "Overdue", ticketsForTabCounts.filter((t: any) => isOverdue(t)).length)}
                {tabButton("due_today", "Due Today", ticketsForTabCounts.filter((t: any) => isDueWithin(t, 24)).length)}
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
                  column table just forces horizontal scrolling on a phone),
                  the full table at md and up. Wrapped in one data-tour target
                  so the spotlight tour finds the same element regardless of
                  viewport. */}
              <div data-tour="ticket-table">
                <div className="md:hidden space-y-3">
                  {sortedActive.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                      {tickets.length === 0 ? "No tickets found. Create one to get started!" : "No active tickets match the current filters."}
                    </div>
                  ) : (
                    pagedActive.map(t => renderCard(t, true))
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
                        pagedActive.map(t => renderRow(t, true))
                      )}
                    </tbody>
                  </table>
                  <Pagination page={clampedActivePage} pageCount={activePageCount} totalItems={sortedActive.length} pageSize={TICKETS_PAGE_SIZE} onPageChange={setActivePage} />
                </div>
                {/* Mobile pagination lives outside the card-per-row stack
                    above (there's no shared card wrapper there to anchor a
                    footer to) - same control, shown only below md. */}
                <div className="md:hidden bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 mt-3">
                  <Pagination page={clampedActivePage} pageCount={activePageCount} totalItems={sortedActive.length} pageSize={TICKETS_PAGE_SIZE} onPageChange={setActivePage} />
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
                        pagedResolved.map(t => renderCard(t, false))
                      )}
                    </div>
                    <div className="md:hidden">
                      <Pagination page={clampedResolvedPage} pageCount={resolvedPageCount} totalItems={sortedResolved.length} pageSize={TICKETS_PAGE_SIZE} onPageChange={setResolvedPage} />
                    </div>
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left border-collapse min-w-[900px]">
                        <tbody>
                          {sortedResolved.length === 0 ? (
                            <tr>
                              <td colSpan={columnCount} className="p-10 text-center text-slate-500 dark:text-slate-400">No resolved tickets match the current filters.</td>
                            </tr>
                          ) : (
                            pagedResolved.map(t => renderRow(t, false))
                          )}
                        </tbody>
                      </table>
                      <Pagination page={clampedResolvedPage} pageCount={resolvedPageCount} totalItems={sortedResolved.length} pageSize={TICKETS_PAGE_SIZE} onPageChange={setResolvedPage} />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
