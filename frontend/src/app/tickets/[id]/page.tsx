"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { API_BASE_URL, isUnauthorized } from "@/lib/api";
import EmployeeEmailSelect from "@/components/EmployeeEmailSelect";
import ThemeToggle from "@/components/ThemeToggle";

type SaveStatus = { state: "idle" | "saving" | "saved" | "error"; message?: string };

export default function TicketDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [ticket, setTicket] = useState<any>(null);
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [directory, setDirectory] = useState<any[]>([]);
  const [clinicSites, setClinicSites] = useState<any[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: "idle" });
  const saveIdRef = useRef(0);
  const [noteDraft, setNoteDraft] = useState("");
  const [reopening, setReopening] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.push("/login");
      return;
    }
    setRole(localStorage.getItem("role"));
    setUserId(localStorage.getItem("userId"));

    const fetchTicket = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/tickets/`, {
          headers: {
            "Authorization": `Bearer ${token}`
          }
        });
        if (isUnauthorized(res)) return;
        if (res.ok) {
          const data = await res.json();
          const t = data.find((x: any) => x.id === parseInt(id as string));
          if (t) setTicket(t);
        }
      } catch (e) {
        console.error(e);
      }
    };
    fetchTicket();

    // Fetched only to resolve the affected employee's name/email for display.
    fetch(`${API_BASE_URL}/users/directory`, {
      headers: { "Authorization": `Bearer ${token}` }
    })
      .then(res => {
        if (isUnauthorized(res)) return [];
        return res.ok ? res.json() : [];
      })
      .then(setDirectory)
      .catch(() => setDirectory([]));

    // Public endpoint, no auth needed - used to resolve a clinic site id to
    // its display name (item 18: surface a real site instead of the
    // "Unknown site" text some phone-intake tickets have baked into their
    // title).
    fetch(`${API_BASE_URL}/clinic-sites/`)
      .then(res => (res.ok ? res.json() : []))
      .then(setClinicSites)
      .catch(() => setClinicSites([]));
  }, [id, router]);

  // Only resyncs when switching to a different ticket, not on every
  // server-echoed update from our own save - otherwise a save triggered
  // mid-typing would reset the cursor/selection in the textarea.
  useEffect(() => {
    setNoteDraft(ticket?.technician_note || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id]);

  // Every field on this page auto-saves on change - there's no Save button
  // because there's nothing left un-submitted. This helper is what actually
  // makes that safe to rely on: it surfaces a "Saving.../Saved/Failed to
  // save" indicator so a silent failure (expired session, dropped network)
  // is never mistaken for a successful save. `saveIdRef` guards against a
  // fast second edit clearing the "Saved" toast for a still-in-flight one.
  const patchTicket = async (body: Record<string, unknown>, label: string): Promise<boolean> => {
    const myId = ++saveIdRef.current;
    const token = localStorage.getItem("token");
    setSaveStatus({ state: "saving", message: `Saving ${label}...` });
    try {
      const res = await fetch(`${API_BASE_URL}/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
      if (isUnauthorized(res)) return false;
      if (res.ok) {
        const updated = await res.json();
        setTicket(updated);
        setSaveStatus({ state: "saved", message: `${label.charAt(0).toUpperCase() + label.slice(1)} saved` });
        setTimeout(() => {
          if (saveIdRef.current === myId) setSaveStatus({ state: "idle" });
        }, 2500);
        return true;
      }
      setSaveStatus({ state: "error", message: `Failed to save ${label}` });
      return false;
    } catch (e) {
      console.error(`Failed to update ${label}`, e);
      setSaveStatus({ state: "error", message: `Failed to save ${label} - check your connection` });
      return false;
    }
  };

  const handleStatusChange = (newStatus: string) => patchTicket({ status: newStatus }, "status");

  const handleAffectedUserChange = (affectedUserId: number | null) => {
    if (affectedUserId == null) return; // ignore in-progress typing, only submit on an actual selection
    patchTicket({ affected_user_id: affectedUserId }, "affected employee");
  };

  const handleClinicSiteChange = (clinicSiteId: number | null) => patchTicket({ clinic_site_id: clinicSiteId }, "clinic site");

  const handleAssignToMe = () => patchTicket({ tech_id: parseInt(userId as string) }, "assignment");

  // Saves on blur (not per-keystroke) - a free-text field auto-saving on
  // every keystroke would spam the API and thrash the save-status toast.
  const handleNoteBlur = () => {
    if (noteDraft !== (ticket.technician_note || "")) {
      patchTicket({ technician_note: noteDraft || null }, "technician note");
    }
  };

  // "This didn't fix it" - sends the ticket back into the active queue.
  // Backend restricts this to the requester who filed it or staff, and
  // only while it's actually resolved.
  const handleReopen = async () => {
    setReopening(true);
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_BASE_URL}/tickets/${ticket.id}/reopen`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (isUnauthorized(res)) return;
      if (res.ok) {
        const updated = await res.json();
        setTicket(updated);
      }
    } catch (e) {
      console.error("Failed to reopen ticket", e);
    } finally {
      setReopening(false);
    }
  };

  if (!ticket) {
    return <div className="p-10 text-center font-bold text-slate-500 dark:text-slate-400">Loading ticket details...</div>;
  }

  const isAdminOrTech = role === "admin" || role === "technician";
  const affectedEmployee = directory.find((e: any) => e.id === ticket.affected_user_id);
  const requesterEmployee = directory.find((e: any) => e.id === ticket.requester_id);
  // A tech's explicit choice (ticket.clinic_site_id) always wins. Otherwise
  // fall back to the affected employee's own site, then the requester's -
  // that fallback is a best guess, which is exactly why it needs to stay
  // directly overridable rather than only ever being inferred.
  const effectiveClinicSiteId = ticket.clinic_site_id ?? affectedEmployee?.clinic_site_id ?? requesterEmployee?.clinic_site_id ?? null;
  const clinicSiteName = clinicSites.find((s: any) => s.id === effectiveClinicSiteId)?.name;

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

      <main className="max-w-4xl mx-auto p-10 w-full flex-1">
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="bg-slate-100 dark:bg-slate-700 p-6 border-b border-slate-200 dark:border-slate-600 flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">#{ticket.id} - {ticket.title}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Submitted on {new Date(ticket.created_at).toLocaleString()}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${ticket.priority === 'P1' ? 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-700' : 'bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-100'}`}>
                {ticket.priority} - {ticket.status.replace("_", " ")}
              </span>
              {!isAdminOrTech && ticket.status === "resolved" && (
                <button
                  onClick={handleReopen}
                  disabled={reopening}
                  className="text-xs text-medical-blue dark:text-medical-accent hover:underline cursor-pointer font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {reopening ? "Reopening..." : "This didn't fix it — Reopen"}
                </button>
              )}
            </div>
          </div>

          <div className="p-8">
            <div className="grid grid-cols-2 gap-8 mb-8">
              <div>
                <h3 className="text-sm font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Category</h3>
                <p className="text-lg font-medium text-slate-800 dark:text-slate-100">{ticket.category}</p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Asset Link</h3>
                <p className="text-lg font-medium text-slate-800 dark:text-slate-100">{ticket.asset_id ? `Asset #${ticket.asset_id}` : "None Selected"}</p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Clinic Site</h3>
                {isAdminOrTech ? (
                  <select
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 rounded-lg text-lg font-medium text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-medical-accent focus:outline-none cursor-pointer"
                    value={effectiveClinicSiteId ?? ""}
                    onChange={(e) => handleClinicSiteChange(e.target.value ? parseInt(e.target.value) : null)}
                  >
                    <option value="">Unknown / Not set</option>
                    {clinicSites.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                ) : (
                  <p className="text-lg font-medium text-slate-800 dark:text-slate-100">{clinicSiteName || "Unknown"}</p>
                )}
                {isAdminOrTech && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {ticket.clinic_site_id != null
                      ? "Set specifically for this ticket."
                      : "Defaults to the affected employee's primary site - override here if they're mobile and working elsewhere today."}
                  </p>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Affected Employee</h3>
                {isAdminOrTech ? (
                  <EmployeeEmailSelect
                    value={ticket.affected_user_id}
                    onChange={handleAffectedUserChange}
                    placeholder="Search by name or email..."
                  />
                ) : (
                  <p className="text-lg font-medium text-slate-800 dark:text-slate-100">
                    {affectedEmployee
                      ? `${[affectedEmployee.first_name, affectedEmployee.last_name].filter(Boolean).join(" ")} <${affectedEmployee.email}>`
                      : "Same as requester"}
                  </p>
                )}
              </div>
            </div>

            <div className="mb-8">
              <h3 className="text-sm font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">SLA / Time to Resolution Target</h3>
              <div className="flex items-center gap-3">
                <div className={`text-xl font-mono p-3 rounded-lg border ${ticket.priority === 'P1' ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800' : 'bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600'}`}>
                  {ticket.sla_deadline ? new Date(ticket.sla_deadline).toLocaleString() : "No Deadline"}
                </div>
              </div>
            </div>

            {/* Read-only surface for the note a tech left below - the only
                communication channel this ticket has back to whoever
                filed it, short of a phone call. */}
            {!isAdminOrTech && ticket.technician_note && (
              <div className="mb-8">
                <h3 className="text-sm font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Note From Your Technician</h3>
                <div className="bg-sky-50 dark:bg-sky-900/20 border-l-4 border-sky-400 dark:border-sky-600 p-4 rounded-r text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
                  {ticket.technician_note}
                </div>
              </div>
            )}

            <div className="mb-8">
              <h3 className="text-sm font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Description</h3>
              <div className="bg-slate-50 dark:bg-slate-700 p-5 rounded-lg border border-slate-200 dark:border-slate-600 whitespace-pre-wrap text-slate-700 dark:text-slate-200 text-lg">
                {ticket.description}
              </div>
            </div>

            {isAdminOrTech && (
              <div className="mt-8 pt-8 border-t border-slate-200 dark:border-slate-700">
                <h3 className="text-sm font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">Technician Actions</h3>
                <div className="flex items-center gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Update Status</label>
                    <select
                      className="bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 text-sm font-bold uppercase rounded px-3 py-2 outline-none cursor-pointer focus:ring-2 focus:ring-medical-accent"
                      value={ticket.status}
                      onChange={(e) => handleStatusChange(e.target.value)}
                    >
                      <option value="open">OPEN</option>
                      <option value="in_progress">IN PROGRESS</option>
                      <option value="resolved">RESOLVED</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Assignment</label>
                    {ticket.tech_id === parseInt(userId || "0") ? (
                      <div className="text-sm font-bold text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-4 py-2 rounded border border-green-200 dark:border-green-800 inline-block">
                        Assigned to you
                      </div>
                    ) : (
                      <button
                        onClick={handleAssignToMe}
                        className="text-sm bg-medical-blue hover:bg-medical-dark text-white px-4 py-2 rounded font-semibold transition-colors"
                      >
                        Assign to me
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                    Note to Requester <span className="font-normal normal-case text-slate-400 dark:text-slate-500">(visible to them - e.g. "waiting on a replacement part")</span>
                  </label>
                  <textarea
                    rows={2}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none text-sm"
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onBlur={handleNoteBlur}
                    placeholder="Leave an update for whoever filed this ticket..."
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Save-status toast - every field on this page auto-saves, so this is
          the only feedback that a change actually went through. */}
      {saveStatus.state !== "idle" && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg text-sm font-semibold flex items-center gap-2 ${
            saveStatus.state === "error"
              ? "bg-red-600 text-white"
              : saveStatus.state === "saved"
              ? "bg-emerald-600 text-white"
              : "bg-slate-800 text-white"
          }`}
        >
          {saveStatus.state === "saving" && <span className="animate-spin">⟳</span>}
          {saveStatus.state === "saved" && <span>✓</span>}
          {saveStatus.state === "error" && <span>⚠</span>}
          {saveStatus.message}
          {saveStatus.state === "error" && (
            <button onClick={() => setSaveStatus({ state: "idle" })} className="ml-2 cursor-pointer opacity-80 hover:opacity-100">
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}
