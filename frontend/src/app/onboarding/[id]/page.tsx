"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { API_BASE_URL, isUnauthorized } from "@/lib/api";
import Sidebar from "@/components/Sidebar";

type Task = {
  id: number;
  candidate_id: number;
  task_name: string;
  assigned_role: string;
  is_blocked: boolean;
  status: string;
  triggers_stage1_handoff: boolean;
  completed_at: string | null;
};

type Candidate = {
  id: number;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  job_title: string;
  department: string;
  clinic_site_id: number | null;
  start_date: string;
  is_rehire: boolean;
  workstation_type: string;
  requires_dexis: boolean | null;
  requires_fastattach: boolean | null;
  workstation_suite: string | null;
  assigned_email: string | null;
  stage: string;
  child_ticket_id: number | null;
  tasks: Task[];
};

type Batch = {
  id: number;
  submitted_at: string;
  status: string;
  notes: string | null;
  master_ticket_id: number | null;
  candidates: Candidate[];
};

const STAGE_LABELS: Record<string, string> = {
  it_identity: "IT Identity", ehr_provisioning: "EHR Provisioning",
  clinical_training: "Clinical Training", ready: "Ready",
};
const TASK_STATUS_LABELS: Record<string, string> = { pending: "Pending", in_progress: "In Progress", completed: "Completed" };

export default function OnboardingBatchDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<number | null>(null);
  const [stage1Result, setStage1Result] = useState<{ name: string; email: string; password: string } | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const isStaff = role === "technician" || role === "admin";

  const loadBatch = () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    fetch(`${API_BASE_URL}/onboarding/batches/${id}`, { headers: { "Authorization": `Bearer ${token}` } })
      .then(res => { if (isUnauthorized(res)) return null; return res.ok ? res.json() : null; })
      .then(data => { setBatch(data); setLoaded(true); })
      .catch(() => setLoaded(true));
  };

  useEffect(() => {
    const token = localStorage.getItem("token");
    const currentRole = localStorage.getItem("role");
    if (!token) { router.push("/login"); return; }
    if (!currentRole || !["hr", "technician", "admin"].includes(currentRole)) { router.push("/dashboard"); return; }
    setRole(currentRole);
    loadBatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, router]);

  const handleTaskStatusChange = async (task: Task, status: string) => {
    setBusyTaskId(task.id);
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_BASE_URL}/onboarding/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ status }),
      });
      if (isUnauthorized(res)) return;
      if (res.ok) loadBatch();
      else {
        const data = await res.json().catch(() => null);
        alert(data?.detail || "Failed to update task.");
      }
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleCompleteStage1 = async (candidate: Candidate) => {
    if (!window.confirm(`Complete Stage 1 for ${candidate.first_name} ${candidate.last_name} and notify stakeholders (Paychex/NextGen teams)?`)) return;
    setBusyTaskId(candidate.id);
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_BASE_URL}/onboarding/candidates/${candidate.id}/complete-stage1`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (isUnauthorized(res)) return;
      if (res.ok) {
        const data = await res.json();
        setStage1Result({
          name: `${candidate.first_name} ${candidate.last_name}`,
          email: data.candidate.assigned_email,
          password: data.temp_password,
        });
        loadBatch();
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.detail || "Failed to complete Stage 1.");
      }
    } finally {
      setBusyTaskId(null);
    }
  };

  const copyCredentials = () => {
    if (!stage1Result) return;
    const text = `Email: ${stage1Result.email}\nTemporary Password: ${stage1Result.password}`;
    navigator.clipboard?.writeText(text).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    }).catch(() => {});
  };

  if (loaded && !batch) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex">
        <Sidebar role={role} />
        <div className="flex-1 flex flex-col min-w-0 pt-14 md:pt-0">
          <main className="max-w-3xl mx-auto p-10 w-full flex-1 text-center text-slate-500 dark:text-slate-400">
            Onboarding request not found.
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex">
      <Sidebar role={role} />
      <div className="flex-1 flex flex-col min-w-0 pt-14 md:pt-0">
        <main className="max-w-3xl mx-auto p-10 w-full flex-1">
          {batch && (
            <>
              <h2 className="text-3xl font-semibold text-slate-800 dark:text-slate-100 mb-1">Onboarding Batch #{batch.id}</h2>
              <p className="text-slate-500 dark:text-slate-400 mb-6">
                Submitted {new Date(batch.submitted_at).toLocaleString()} · Status: {batch.status.replace("_", " ")}
                {batch.master_ticket_id && (
                  <> · <a href={`/tickets/${batch.master_ticket_id}`} className="text-medical-blue dark:text-medical-accent hover:underline">Master Ticket #{batch.master_ticket_id}</a></>
                )}
              </p>
              {batch.notes && (
                <div className="mb-6 p-4 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm text-slate-700 dark:text-slate-200">{batch.notes}</div>
              )}

              <div className="flex flex-col gap-6">
                {batch.candidates.map(c => (
                  <div key={c.id} className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
                    <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
                      <div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                          {c.first_name} {c.middle_name ? c.middle_name + " " : ""}{c.last_name}
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          {c.job_title} · {c.department} · Starts {new Date(c.start_date).toLocaleDateString()}
                          {c.is_rehire && " · Rehire"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {c.child_ticket_id && (
                          <a href={`/tickets/${c.child_ticket_id}`} className="text-xs text-medical-blue dark:text-medical-accent hover:underline font-semibold">
                            Ticket #{c.child_ticket_id}
                          </a>
                        )}
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold">
                          {STAGE_LABELS[c.stage] || c.stage}
                        </span>
                      </div>
                    </div>

                    {c.department === "Dental" && (
                      <p className="text-xs text-sky-700 dark:text-sky-400 mb-3">
                        Dexis: {c.requires_dexis ? "Required" : "Not required"} · FastAttach: {c.requires_fastattach ? "Required" : "Not required"}
                        {c.workstation_suite && ` · Suite ${c.workstation_suite}`}
                      </p>
                    )}

                    {c.assigned_email && (
                      <p className="text-xs text-emerald-700 dark:text-emerald-400 mb-3 font-semibold">
                        Assigned email: {c.assigned_email}
                      </p>
                    )}

                    <div className="divide-y divide-slate-100 dark:divide-slate-700 border-t border-slate-100 dark:border-slate-700">
                      {c.tasks.map(t => (
                        <div key={t.id} className="flex items-center justify-between gap-3 py-3">
                          <div className="min-w-0">
                            <p className={`text-sm font-semibold ${t.is_blocked ? "text-slate-400 dark:text-slate-500" : "text-slate-800 dark:text-slate-100"}`}>
                              {t.task_name}
                            </p>
                            <p className="text-xs text-slate-400 dark:text-slate-500">
                              {t.assigned_role.replace(/_/g, " ")}{t.is_blocked && " · Blocked until prior stage completes"}
                            </p>
                          </div>

                          {isStaff && !t.is_blocked && t.triggers_stage1_handoff && t.status !== "completed" ? (
                            <button
                              onClick={() => handleCompleteStage1(c)}
                              disabled={busyTaskId === c.id}
                              className="shrink-0 text-xs bg-medical-blue hover:bg-medical-dark disabled:opacity-60 text-white font-bold py-2 px-3 rounded-lg transition-colors cursor-pointer"
                            >
                              {busyTaskId === c.id ? "Working..." : "Complete Stage 1 & Notify Stakeholders"}
                            </button>
                          ) : isStaff && !t.is_blocked ? (
                            <select
                              className="shrink-0 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 rounded px-2 py-1.5 outline-none cursor-pointer focus:ring-2 focus:ring-medical-accent"
                              value={t.status}
                              disabled={busyTaskId === t.id}
                              onChange={e => handleTaskStatusChange(t, e.target.value)}
                            >
                              <option value="pending">Pending</option>
                              <option value="in_progress">In Progress</option>
                              <option value="completed">Completed</option>
                            </select>
                          ) : (
                            <span className={`shrink-0 text-xs px-2 py-1 rounded-full font-semibold ${
                              t.status === "completed" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                            }`}>
                              {TASK_STATUS_LABELS[t.status] || t.status}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </main>
      </div>

      {stage1Result && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg w-full max-w-md p-6">
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1">Stage 1 Complete: {stage1Result.name}</h3>
            <p className="text-sm text-amber-700 dark:text-amber-400 mb-4">
              This temporary password is shown once and is not stored anywhere - copy it now and use it to set the account's actual password.
            </p>
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4 font-mono text-sm mb-4">
              <p><span className="text-slate-500 dark:text-slate-400">Email:</span> {stage1Result.email}</p>
              <p><span className="text-slate-500 dark:text-slate-400">Temp Password:</span> {stage1Result.password}</p>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={copyCredentials} className="px-4 py-2 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold cursor-pointer">
                {copyFeedback ? "Copied!" : "Copy"}
              </button>
              <button onClick={() => setStage1Result(null)} className="px-4 py-2 rounded bg-medical-blue hover:bg-medical-dark text-white font-semibold cursor-pointer">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
