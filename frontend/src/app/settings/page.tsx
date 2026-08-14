"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API_BASE_URL, isUnauthorized, logout } from "@/lib/api";
import ThemeToggle from "@/components/ThemeToggle";

type SaveStatus = { state: "idle" | "saving" | "saved" | "error"; message?: string };

export default function Settings() {
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [requireResolution, setRequireResolution] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: "idle" });

  useEffect(() => {
    const token = localStorage.getItem("token");
    const currentRole = localStorage.getItem("role");

    if (!token) {
      router.push("/login");
      return;
    }
    if (currentRole !== "admin") {
      router.push("/dashboard");
      return;
    }
    setRole(currentRole);

    fetch(`${API_BASE_URL}/settings`, { headers: { "Authorization": `Bearer ${token}` } })
      .then(res => {
        if (isUnauthorized(res)) return null;
        return res.ok ? res.json() : null;
      })
      .then(data => {
        if (data) setRequireResolution(data.require_resolution_to_resolve);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [router]);

  // No Save button, same as every other settings/edit surface in this app
  // (ticket detail, users) - toggling immediately persists, with the same
  // Saving/Saved/Failed feedback pattern.
  const handleToggle = async () => {
    const next = !requireResolution;
    setRequireResolution(next); // optimistic - reverted below on failure
    setSaveStatus({ state: "saving", message: "Saving..." });
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_BASE_URL}/settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ require_resolution_to_resolve: next })
      });
      if (isUnauthorized(res)) return;
      if (res.ok) {
        setSaveStatus({ state: "saved", message: "Saved" });
        setTimeout(() => setSaveStatus({ state: "idle" }), 2000);
      } else {
        setRequireResolution(!next);
        setSaveStatus({ state: "error", message: "Failed to save" });
      }
    } catch (e) {
      setRequireResolution(!next);
      setSaveStatus({ state: "error", message: "Failed to save - check your connection" });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      <header className="bg-medical-blue text-white p-4 shadow-md flex flex-wrap items-center justify-between gap-y-2 gap-x-4 px-4 sm:px-10">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold">Clinical IT Portal</h1>
          <Link href="/dashboard" className="text-sm font-semibold hover:text-medical-light transition-colors">
            Dashboard
          </Link>
          <Link href="/users" className="text-sm font-semibold hover:text-medical-light transition-colors">
            User Management
          </Link>
          <Link href="/settings" className="text-sm font-semibold text-medical-light transition-colors">
            Settings
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <button
            onClick={async () => { await logout(); router.push("/login"); }}
            className="text-sm border border-white px-3 py-1 rounded hover:bg-medical-dark transition-colors cursor-pointer"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-10 w-full flex-1">
        <h2 className="text-3xl font-semibold text-slate-800 dark:text-slate-100 mb-8">Settings</h2>

        {loaded && (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-8">
            <h3 className="text-sm font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">Ticket Resolution</h3>

            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="font-semibold text-slate-800 dark:text-slate-100">Require a resolution before resolving a ticket</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  When on, a technician can't set a ticket's status to Resolved until they've filled in the
                  Resolution field on that ticket - it's the same field always available, this just makes it
                  mandatory instead of optional.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={requireResolution}
                aria-label="Require a resolution before resolving a ticket"
                onClick={handleToggle}
                className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                  requireResolution ? "bg-medical-blue" : "bg-slate-300 dark:bg-slate-600"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    requireResolution ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>
        )}
      </main>

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
        </div>
      )}
    </div>
  );
}
