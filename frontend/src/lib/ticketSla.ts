// Shared helpers for SLA urgency: breach detection, human-readable
// countdowns, and a sort ranking used to surface the most urgent active
// work first.

export type SlaTicket = {
  sla_deadline: string | null;
  status: string;
  priority: string;
};

export function isResolved(ticket: SlaTicket): boolean {
  return ticket.status === "resolved";
}

export function isOverdue(ticket: SlaTicket, now: Date = new Date()): boolean {
  if (!ticket.sla_deadline || isResolved(ticket)) return false;
  return new Date(ticket.sla_deadline) < now;
}

export function isDueWithin(ticket: SlaTicket, hours: number, now: Date = new Date()): boolean {
  if (!ticket.sla_deadline || isResolved(ticket)) return false;
  const deadline = new Date(ticket.sla_deadline);
  const diffMs = deadline.getTime() - now.getTime();
  return diffMs >= 0 && diffMs <= hours * 60 * 60 * 1000;
}

const UNITS: [string, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

function humanizeDuration(ms: number): string {
  for (const [label, unitMs] of UNITS) {
    const value = Math.floor(ms / unitMs);
    if (value >= 1) return `${value} ${label}${value === 1 ? "" : "s"}`;
  }
  return "less than a minute";
}

/**
 * "2h left", "Overdue by 3 months", or "No deadline" / "Resolved" as
 * appropriate. Pass `now` in tests to keep them deterministic.
 */
export function formatRelativeSla(ticket: SlaTicket, now: Date = new Date()): string {
  if (!ticket.sla_deadline) return "No deadline";
  if (isResolved(ticket)) return "Resolved";
  const deadline = new Date(ticket.sla_deadline);
  const diffMs = deadline.getTime() - now.getTime();
  if (diffMs < 0) return `Overdue by ${humanizeDuration(-diffMs)}`;
  return `${humanizeDuration(diffMs)} left`;
}

export const PRIORITY_RANK: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

/**
 * Lower rank sorts first. Overdue active tickets always come before
 * non-overdue ones regardless of priority; ties break by priority, then by
 * how soon the deadline is.
 */
export function urgencyRank(ticket: SlaTicket & { sla_deadline: string | null }, now: Date = new Date()): number {
  const overdue = isOverdue(ticket, now) ? 0 : 1;
  const priority = PRIORITY_RANK[ticket.priority] ?? 9;
  const deadlineMs = ticket.sla_deadline ? new Date(ticket.sla_deadline).getTime() : Infinity;
  // Weighted so overdue dominates, then priority, then deadline proximity.
  return overdue * 1e15 + priority * 1e13 + deadlineMs;
}
