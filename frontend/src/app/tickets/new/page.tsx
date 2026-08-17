"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API_BASE_URL, isUnauthorized } from "@/lib/api";
import EmployeeEmailSelect from "@/components/EmployeeEmailSelect";
import ThemeToggle from "@/components/ThemeToggle";

// Fallback only for if /categories can't be reached - keep in sync with
// TICKET_CATEGORIES in backend/schemas.py, which is the actual source of
// truth the backend validates against.
const FALLBACK_CATEGORIES = ["Hardware/Workstation", "Software", "EHR/NextGen", "Network/Connectivity", "Telecom"];

// One-click starting points for the issues that make up most real ticket
// volume (see the recurring titles in production data: password resets,
// screen problems, shared mailbox access, NextGen access issues). Pre-fills
// title/category/priority/description - the employee can still edit
// anything before submitting.
type Template = {
  icon: string;
  label: string;
  title: string;
  category: string;
  priority: string;
  description: string;
};

const ISSUE_TEMPLATES: Template[] = [
  {
    icon: "🔑",
    label: "Reset My Password",
    title: "Need my login password reset",
    category: "Hardware/Workstation",
    priority: "P4",
    description: "I'm locked out of my account and need my password reset.",
  },
  {
    icon: "📧",
    label: "Email Not Working",
    title: "Trouble sending/receiving email",
    category: "Hardware/Workstation",
    priority: "P4",
    description: "I'm having trouble with my email - describe what's happening (not receiving, not sending, an error message, etc.).",
  },
  {
    icon: "🖥️",
    label: "Screen/Monitor Issue",
    title: "Monitor/screen isn't working",
    category: "Hardware/Workstation",
    priority: "P4",
    description: "My monitor isn't displaying correctly - describe the issue (blank screen, flickering, won't turn on, etc.).",
  },
  {
    icon: "📁",
    label: "Shared Mailbox/Folder Access",
    title: "Need access to a shared mailbox or folder",
    category: "Hardware/Workstation",
    priority: "P4",
    description: "I need access to a shared mailbox or folder - specify which one.",
  },
  {
    icon: "🏥",
    label: "NextGen/EHR Issue",
    title: "NextGen issue",
    category: "EHR/NextGen",
    priority: "P3",
    description: "I'm having an issue in NextGen - describe what you were doing and what happened.",
  },
  {
    icon: "🖨️",
    label: "Printer Not Working",
    title: "Printer isn't working",
    category: "Hardware/Workstation",
    priority: "P4",
    description: "The printer isn't working - describe the issue (won't print, paper jam, out of toner, error message, etc.).",
  },
];

type ExistingTicket = {
  id: number;
  title: string;
  status: string;
  requester_id: number;
};

type CreatedTicket = {
  id: number;
  status: string;
  priority: string;
  sla_deadline: string | null;
};

// Lightweight word-overlap heuristic for "did I already file this" - no
// need for anything fancier at this ticket volume. Ignores short/common
// words so two titles matching only on "issue" or "not working" don't
// falsely flag as duplicates.
const STOPWORDS = new Set([
  "a", "an", "the", "to", "for", "of", "my", "i", "is", "are", "on", "in", "at", "with", "and", "or",
  "from", "need", "please", "can", "cant", "not", "working", "issue", "issues", "problem", "help", "me",
]);

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w))
  );
}

function titleSimilarity(a: string, b: string): number {
  const wa = significantWords(a);
  const wb = significantWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let overlap = 0;
  wa.forEach(w => { if (wb.has(w)) overlap++; });
  return overlap / Math.min(wa.size, wb.size);
}

// Humanizes the SLA deadline the backend computes, so the confirmation
// screen reads "in about 2 days" instead of a raw ISO timestamp.
function formatDeadline(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const hours = Math.round(diffMs / 3600000);
  if (hours <= 1) return "within the hour";
  if (hours < 24) return `in about ${hours} hours`;
  const days = Math.round(hours / 24);
  return `in about ${days} day${days === 1 ? "" : "s"}`;
}

export default function NewTicket() {
  const router = useRouter();
  // Priority is only requester-editable for staff filing a ticket
  // themselves - requesters get it decided for them by AI triage server-side
  // (see backend/triage.py + create_ticket), since left to pick their own,
  // almost everyone reflexively selects P1 regardless of actual severity.
  const [role, setRole] = useState<string | null>(null);
  const isStaff = role === "admin" || role === "technician";
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "Hardware/Workstation",
    priority: "P4",
    asset_id: ""
  });
  const [affectedUserId, setAffectedUserId] = useState<number | null>(null);
  const [categories, setCategories] = useState<string[]>(FALLBACK_CATEGORIES);
  const [myTickets, setMyTickets] = useState<ExistingTicket[]>([]);
  const [dismissedDuplicateWarning, setDismissedDuplicateWarning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdTicket, setCreatedTicket] = useState<CreatedTicket | null>(null);

  useEffect(() => {
    setRole(localStorage.getItem("role"));
  }, []);

  useEffect(() => {
    fetch(`${API_BASE_URL}/categories`)
      .then(res => (res.ok ? res.json() : FALLBACK_CATEGORIES))
      .then((cats: string[]) => {
        if (cats.length > 0) setCategories(cats);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    fetch(`${API_BASE_URL}/tickets/`, {
      headers: { "Authorization": `Bearer ${token}` }
    })
      .then(res => {
        if (isUnauthorized(res)) return [];
        return res.ok ? res.json() : [];
      })
      .then((data: ExistingTicket[]) => setMyTickets(data))
      .catch(() => setMyTickets([]));
  }, []);

  // Duplicate-detection: only warn about the current employee's own
  // still-open tickets - a resolved one isn't an active duplicate, and
  // someone else's ticket isn't this employee's to notice.
  const duplicateMatches = useMemo(() => {
    const title = formData.title.trim();
    const currentUserId = Number(typeof window !== "undefined" ? localStorage.getItem("userId") : NaN);
    if (title.length < 6 || !currentUserId) return [];
    return myTickets
      .filter(t => t.requester_id === currentUserId && t.status !== "resolved")
      .map(t => ({ ticket: t, score: titleSimilarity(title, t.title) }))
      .filter(m => m.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [formData.title, myTickets]);

  const applyTemplate = (t: Template) => {
    setFormData({ ...formData, title: t.title, category: t.category, priority: t.priority, description: t.description });
    setDismissedDuplicateWarning(false);
  };

  const resetForm = () => {
    setFormData({ title: "", description: "", category: "Hardware/Workstation", priority: "P4", asset_id: "" });
    setAffectedUserId(null);
    setDismissedDuplicateWarning(false);
    setCreatedTicket(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { priority, ...rest } = formData;
      const payload = {
        ...rest,
        // Requesters don't choose priority - the backend decides via AI
        // triage regardless of what's in formData, but there's no reason
        // to send a stale/template value that'll just be discarded.
        ...(isStaff ? { priority } : {}),
        asset_id: formData.asset_id ? parseInt(formData.asset_id) : null,
        affected_user_id: affectedUserId
      };
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE_URL}/tickets/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      if (isUnauthorized(res)) return;
      if (res.ok) {
        const data = await res.json();
        setCreatedTicket({ id: data.id, status: data.status, priority: data.priority, sla_deadline: data.sla_deadline });
      } else {
        alert("Failed to submit ticket.");
      }
    } catch (e) {
      alert("Error submitting ticket.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      <header className="bg-medical-blue text-white p-4 shadow-md flex flex-wrap items-center justify-between gap-y-2 gap-x-4 px-4 sm:px-10">
        <h1 className="text-xl font-bold">Clinical IT Portal</h1>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <Link href="/dashboard" className="text-sm border border-white px-3 py-1 rounded hover:bg-medical-dark transition-colors">
            Back to Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-10 w-full">
        {createdTicket ? (
          <div className="bg-white dark:bg-slate-800 p-10 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 text-center">
            <div className="text-5xl mb-4">✅</div>
            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">Ticket #{createdTicket.id} Submitted</h2>
            <p className="text-slate-600 dark:text-slate-300 mb-1">
              Priority <strong>{createdTicket.priority}</strong>
              {!isStaff && <span className="text-slate-400 dark:text-slate-500 text-sm"> (assessed by our triage system)</span>}
              {createdTicket.sla_deadline && <> - expected response {formatDeadline(createdTicket.sla_deadline)}</>}
            </p>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-8">
              You can track its status anytime from your dashboard or the link below.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href={`/tickets/${createdTicket.id}`}
                className="bg-medical-blue hover:bg-medical-dark text-white font-bold py-3 px-6 rounded-lg transition-colors"
              >
                Track This Ticket →
              </Link>
              <button
                onClick={resetForm}
                className="border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold py-3 px-6 rounded-lg transition-colors cursor-pointer"
              >
                Submit Another Ticket
              </button>
              <Link
                href="/dashboard"
                className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                Back to Dashboard
              </Link>
            </div>
          </div>
        ) : (
          <>
            <h2 className="text-3xl font-semibold text-slate-800 dark:text-slate-100 mb-6">Create Support Ticket</h2>

            <div className="bg-amber-50 dark:bg-amber-900/30 border-l-4 border-amber-500 p-4 mb-6 text-amber-800 dark:text-amber-300 font-medium rounded-r shadow-sm">
              <strong>HIPAA Warning:</strong> Please do not include any Protected Health Information (PHI) such as patient names, DOBs, or MRNs in the ticket details.
            </div>

            <div className="mb-6">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Common issue? Start here:</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ISSUE_TEMPLATES.map(t => (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => applyTemplate(t)}
                    className="flex items-center gap-2 text-left text-sm px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:border-medical-accent hover:shadow-sm transition-colors cursor-pointer text-slate-700 dark:text-slate-200"
                  >
                    <span className="text-lg">{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-8 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Issue Title</label>
                  <input required type="text" className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none"
                         value={formData.title} onChange={e => { setFormData({...formData, title: e.target.value}); setDismissedDuplicateWarning(false); }} />

                  {duplicateMatches.length > 0 && !dismissedDuplicateWarning && (
                    <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-900/30 border-l-4 border-amber-500 rounded-r text-sm">
                      <div className="flex justify-between items-start gap-3">
                        <p className="text-amber-800 dark:text-amber-300 font-medium">
                          You may already have an open ticket for this:
                        </p>
                        <button
                          type="button"
                          onClick={() => setDismissedDuplicateWarning(true)}
                          className="text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 cursor-pointer shrink-0"
                          aria-label="Dismiss"
                        >
                          ✕
                        </button>
                      </div>
                      <ul className="mt-1 space-y-1">
                        {duplicateMatches.map(m => (
                          <li key={m.ticket.id}>
                            <Link href={`/tickets/${m.ticket.id}`} className="text-medical-blue dark:text-medical-accent hover:underline font-semibold">
                              #{m.ticket.id} - {m.ticket.title}
                            </Link>
                            <span className="text-amber-700 dark:text-amber-400"> ({m.ticket.status.replace("_", " ")})</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Category</label>
                    <select className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none"
                            value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                      {categories.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Priority (Urgency Matrix)</label>
                    {isStaff ? (
                      <select className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none bg-slate-50 dark:bg-slate-700 dark:text-slate-100"
                              value={formData.priority} onChange={e => setFormData({...formData, priority: e.target.value})}>
                        <option value="P4">P4 - General Inquiry (48h)</option>
                        <option value="P3">P3 - Minor Issue (24h)</option>
                        <option value="P2">P2 - Major Disruption (4h)</option>
                        <option value="P1">P1 - Critical Patient Care Impact (1h)</option>
                      </select>
                    ) : (
                      <div className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-700/50 text-sm text-slate-500 dark:text-slate-400">
                        Assessed automatically from your description
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Affected Employee (Optional)</label>
                  <EmployeeEmailSelect
                    value={affectedUserId}
                    onChange={setAffectedUserId}
                    placeholder="Search by name or email if filing on someone's behalf..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Asset ID (Optional)</label>
                  <input type="number" placeholder="e.g. 1004" className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none"
                         value={formData.asset_id} onChange={e => setFormData({...formData, asset_id: e.target.value})} />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Detailed Description</label>
                  <textarea required rows={4} className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none"
                            value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})}></textarea>
                </div>

                <button type="submit" disabled={submitting} className="mt-4 bg-medical-blue hover:bg-medical-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-colors cursor-pointer">
                  {submitting ? "Submitting..." : "Submit Ticket"}
                </button>
              </form>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
