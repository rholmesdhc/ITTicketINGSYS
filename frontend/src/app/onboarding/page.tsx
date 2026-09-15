"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API_BASE_URL, isUnauthorized } from "@/lib/api";
import Sidebar from "@/components/Sidebar";

type Candidate = {
  id: number;
  first_name: string;
  last_name: string;
  job_title: string;
  department: string;
  stage: string;
};

type Batch = {
  id: number;
  submitted_at: string;
  status: string;
  notes: string | null;
  candidates: Candidate[];
};

type Task = {
  id: number;
  candidate_id: number;
  task_name: string;
  assigned_role: string;
  is_blocked: boolean;
  status: string;
};

const STAGE_LABELS: Record<string, string> = {
  it_identity: "IT Identity",
  ehr_provisioning: "EHR Provisioning",
  clinical_training: "Clinical Training",
  ready: "Ready",
};

const STAGE_COLORS: Record<string, string> = {
  it_identity: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  ehr_provisioning: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  clinical_training: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  ready: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
};

export default function OnboardingList() {
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [queue, setQueue] = useState<Task[]>([]);
  const [candidateNames, setCandidateNames] = useState<Record<number, string>>({});

  useEffect(() => {
    const token = localStorage.getItem("token");
    const currentRole = localStorage.getItem("role");
    if (!token) { router.push("/login"); return; }
    // Same access list as the sidebar's Onboarding item - a plain requester
    // landing here directly (typed URL) gets bounced, not a broken page.
    if (!currentRole || !["hr", "technician", "admin"].includes(currentRole)) {
      router.push("/dashboard");
      return;
    }
    setRole(currentRole);

    fetch(`${API_BASE_URL}/onboarding/batches`, { headers: { "Authorization": `Bearer ${token}` } })
      .then(res => { if (isUnauthorized(res)) return null; return res.ok ? res.json() : []; })
      .then((data: Batch[] | null) => {
        if (data) {
          setBatches(data);
          const names: Record<number, string> = {};
          data.forEach(b => b.candidates.forEach(c => { names[c.id] = `${c.first_name} ${c.last_name}`; }));
          setCandidateNames(names);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));

    // Cross-batch work queue - technician/admin only (hr has no tasks to
    // action, just their own submitted batches above).
    if (currentRole === "technician" || currentRole === "admin") {
      fetch(`${API_BASE_URL}/onboarding/tasks?status=pending`, { headers: { "Authorization": `Bearer ${token}` } })
        .then(res => (res.ok ? res.json() : []))
        .then((data: Task[]) => setQueue(data.filter(t => !t.is_blocked)))
        .catch(() => {});
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex">
      <Sidebar role={role} />
      <div className="flex-1 flex flex-col min-w-0 pt-14 md:pt-0">
        <main className="max-w-4xl mx-auto p-10 w-full flex-1">
          <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
            <h2 className="text-3xl font-semibold text-slate-800 dark:text-slate-100">Employee Onboarding</h2>
            {(role === "hr" || role === "admin") && (
              <Link
                href="/onboarding/new"
                className="bg-medical-blue hover:bg-medical-dark text-white font-bold py-2.5 px-5 rounded-lg transition-colors"
              >
                + New Onboarding Request
              </Link>
            )}
          </div>

          {queue.length > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 mb-6">
              <h3 className="text-sm font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">
                Your Task Queue ({queue.length} actionable)
              </h3>
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {queue.map(t => (
                  <div key={t.id} className="flex items-center justify-between py-2.5 text-sm gap-3">
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{candidateNames[t.candidate_id] || `Candidate #${t.candidate_id}`}</span>
                      <span className="text-slate-500 dark:text-slate-400"> — {t.task_name}</span>
                    </div>
                    <span className="text-xs shrink-0 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-medium">
                      {t.assigned_role.replace(/_/g, " ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loaded && batches.length === 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-10 text-center text-slate-500 dark:text-slate-400">
              No onboarding requests yet.
            </div>
          )}

          <div className="flex flex-col gap-3">
            {batches.map(b => (
              <Link
                key={b.id}
                href={`/onboarding/${b.id}`}
                className="block bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 hover:border-medical-blue dark:hover:border-medical-accent transition-colors"
              >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-100">
                      Batch #{b.id} — {b.candidates.length} candidate{b.candidates.length === 1 ? "" : "s"}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Submitted {new Date(b.submitted_at).toLocaleDateString()} · {b.candidates.map(c => `${c.first_name} ${c.last_name}`).join(", ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {b.candidates.map(c => (
                      <span key={c.id} className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STAGE_COLORS[c.stage] || ""}`}>
                        {STAGE_LABELS[c.stage] || c.stage}
                      </span>
                    ))}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
