"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL, isUnauthorized } from "@/lib/api";

export type Employee = { id: number; email: string | null; first_name: string | null; last_name: string | null; role: string };

/**
 * Shared foundation for both the Dashboard (Key Metrics/Workload &
 * Analytics) and Tickets (the actual ticket list) pages - they used to be
 * one page sharing one `tickets` fetch; now that they're split across two
 * routes, each page calls this hook independently (its own fetch on its
 * own mount - there's no cross-page client store here), but the fetching/
 * auth-guard/auto-refresh logic itself isn't duplicated by hand in both
 * files.
 *
 * Deliberately does NOT include page-specific concerns (KPI card order,
 * table filters/sort, the onboarding wizard) - those stay local to
 * whichever page actually has them.
 */
export function useTicketsFeed() {
  const router = useRouter();
  const [tickets, setTickets] = useState<any[]>([]);
  const [directory, setDirectory] = useState<Employee[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchTickets = async (token: string, opts?: { showSpinner?: boolean }) => {
    if (opts?.showSpinner) setIsRefreshing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/tickets/`, {
        headers: { "Authorization": `Bearer ${token}` }
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

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.push("/login");
      return;
    }
    setRole(localStorage.getItem("role"));
    setUserId(localStorage.getItem("userId"));
    fetchTickets(token);

    fetch(`${API_BASE_URL}/users/directory`, {
      headers: { "Authorization": `Bearer ${token}` }
    })
      .then(res => {
        if (isUnauthorized(res)) return [];
        return res.ok ? res.json() : [];
      })
      .then(setDirectory)
      .catch(() => setDirectory([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Every technician/admin in the org (item 11) - includes staff with zero
  // tickets currently assigned, so a manager can hand work to anyone, not
  // just people already carrying load. Used by both pages: the Workload
  // panel (Dashboard) and the per-row/bulk reassignment dropdowns (Tickets).
  const allTechnicians = useMemo(() => {
    return directory
      .filter(e => e.role === "technician" || e.role === "admin")
      .map(e => ({ id: e.id, label: [e.first_name, e.last_name].filter(Boolean).join(" ") || e.email || `User ${e.id}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [directory]);

  return {
    tickets, setTickets,
    directory, directoryMap, formatEmployee, allTechnicians,
    role, userId,
    isInitialLoading, isRefreshing, lastUpdated,
    fetchTickets, handleManualRefresh,
  };
}
