"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL, isUnauthorized } from "@/lib/api";
import Sidebar from "@/components/Sidebar";

type JobTitle = { id: number; title: string; department: string; default_workstation_type: string | null };
type ClinicSite = { id: number; name: string };

// Keep in sync with backend/schemas.py's ONBOARDING_DEPARTMENTS/
// ONBOARDING_WORKSTATION_TYPES - the backend is the actual source of truth
// it validates against, these are just this form's dropdown options.
const DEPARTMENTS = ["Dental", "Clinical", "Administrative", "Billing", "Nursing", "IT", "Other"];
const WORKSTATION_TYPES: { value: string; label: string }[] = [
  { value: "dedicated_desktop", label: "Dedicated Desktop/All-in-One" },
  { value: "laptop", label: "Laptop" },
  { value: "shared_workstation", label: "Shared Workstation Only" },
];

type CandidateForm = {
  first_name: string;
  middle_name: string;
  last_name: string;
  job_title: string;
  department: string;
  clinic_site_id: string;
  start_date: string;
  is_rehire: boolean;
  workstation_type: string;
  requires_dexis: boolean;
  requires_fastattach: boolean;
  workstation_suite: string;
};

function blankCandidate(): CandidateForm {
  return {
    first_name: "", middle_name: "", last_name: "",
    job_title: "", department: "Clinical", clinic_site_id: "",
    start_date: "", is_rehire: false, workstation_type: "dedicated_desktop",
    requires_dexis: true, requires_fastattach: false, workstation_suite: "",
  };
}

export default function NewOnboardingRequest() {
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [clinicSites, setClinicSites] = useState<ClinicSite[]>([]);
  const [isBatch, setIsBatch] = useState(false);
  const [candidates, setCandidates] = useState<CandidateForm[]>([blankCandidate()]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    const currentRole = localStorage.getItem("role");
    if (!token) { router.push("/login"); return; }
    if (currentRole !== "hr" && currentRole !== "admin") { router.push("/onboarding"); return; }
    setRole(currentRole);

    fetch(`${API_BASE_URL}/onboarding/job-titles`, { headers: { "Authorization": `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : []))
      .then(setJobTitles)
      .catch(() => {});
    fetch(`${API_BASE_URL}/clinic-sites/`, { headers: { "Authorization": `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : []))
      .then(setClinicSites)
      .catch(() => {});
  }, [router]);

  const updateCandidate = (index: number, patch: Partial<CandidateForm>) => {
    setCandidates(prev => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  // Selecting a job title auto-populates department (and a workstation
  // default, if the title has one) but leaves both still editable - the
  // spec calls this out explicitly ("Department auto-populated from
  // position but editable").
  const applyJobTitle = (index: number, titleValue: string) => {
    const match = jobTitles.find(jt => jt.title === titleValue);
    updateCandidate(index, {
      job_title: titleValue,
      ...(match ? { department: match.department, ...(match.default_workstation_type ? { workstation_type: match.default_workstation_type } : {}) } : {}),
    });
  };

  const addCandidate = () => setCandidates(prev => [...prev, blankCandidate()]);
  const removeCandidate = (index: number) => setCandidates(prev => prev.filter((_, i) => i !== index));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const token = localStorage.getItem("token");
    try {
      const payload = {
        notes: notes.trim() || null,
        candidates: candidates.map(c => ({
          first_name: c.first_name.trim(),
          middle_name: c.middle_name.trim() || null,
          last_name: c.last_name.trim(),
          job_title: c.job_title,
          department: c.department,
          clinic_site_id: c.clinic_site_id ? parseInt(c.clinic_site_id) : null,
          start_date: c.start_date,
          is_rehire: c.is_rehire,
          workstation_type: c.workstation_type,
          // Only sent for Dental - the backend rejects these set on any
          // other department (see schemas.OnboardingCandidateCreate's
          // dental_fields_only_for_dental validator).
          requires_dexis: c.department === "Dental" ? c.requires_dexis : null,
          requires_fastattach: c.department === "Dental" ? c.requires_fastattach : null,
          workstation_suite: c.department === "Dental" ? (c.workstation_suite.trim() || null) : null,
        })),
      };
      const res = await fetch(`${API_BASE_URL}/onboarding/batches`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (isUnauthorized(res)) return;
      if (res.ok) {
        const data = await res.json();
        router.push(`/onboarding/${data.id}`);
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.detail ? String(data.detail) : "Failed to submit onboarding request.");
      }
    } catch {
      setError("Error talking to the API.");
    } finally {
      setSubmitting(false);
    }
  };

  const visibleCandidates = isBatch ? candidates : candidates.slice(0, 1);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex">
      <Sidebar role={role} />
      <div className="flex-1 flex flex-col min-w-0 pt-14 md:pt-0">
        <main className="max-w-3xl mx-auto p-10 w-full flex-1">
          <h2 className="text-3xl font-semibold text-slate-800 dark:text-slate-100 mb-2">New Hire Onboarding Request</h2>
          <p className="text-slate-500 dark:text-slate-400 mb-6">
            Submitting creates a master ticket plus one child ticket per candidate, and queues Stage 1 IT setup.
          </p>

          <div className="flex items-center gap-2 mb-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1 w-fit">
            <button
              type="button"
              onClick={() => setIsBatch(false)}
              className={`px-4 py-1.5 rounded-md text-sm font-semibold cursor-pointer transition-colors ${!isBatch ? "bg-medical-blue text-white" : "text-slate-600 dark:text-slate-300"}`}
            >
              Single Hire
            </button>
            <button
              type="button"
              onClick={() => setIsBatch(true)}
              className={`px-4 py-1.5 rounded-md text-sm font-semibold cursor-pointer transition-colors ${isBatch ? "bg-medical-blue text-white" : "text-slate-600 dark:text-slate-300"}`}
            >
              Batch Submission
            </button>
          </div>

          {error && (
            <div className="mb-6 p-3 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {visibleCandidates.map((c, index) => (
              <div key={index} className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                {isBatch && (
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-slate-700 dark:text-slate-200">Candidate {index + 1}</h3>
                    {candidates.length > 1 && (
                      <button type="button" onClick={() => removeCandidate(index)} className="text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-semibold cursor-pointer">
                        Remove
                      </button>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">First Name</label>
                    <input required type="text" className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none"
                           value={c.first_name} onChange={e => updateCandidate(index, { first_name: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Middle Name (Optional)</label>
                    <input type="text" className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none"
                           value={c.middle_name} onChange={e => updateCandidate(index, { middle_name: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Last Name</label>
                    <input required type="text" className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none"
                           value={c.last_name} onChange={e => updateCandidate(index, { last_name: e.target.value })} />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Position / Title</label>
                    <input
                      required
                      list={`job-titles-${index}`}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none"
                      value={c.job_title}
                      onChange={e => applyJobTitle(index, e.target.value)}
                      placeholder="e.g. Nurse Practitioner, LPN, Receptionist..."
                    />
                    <datalist id={`job-titles-${index}`}>
                      {jobTitles.map(jt => <option key={jt.id} value={jt.title} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Department</label>
                    <select className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none"
                            value={c.department} onChange={e => updateCandidate(index, { department: e.target.value })}>
                      {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Work Location / Clinic Site</label>
                    <select className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none"
                            value={c.clinic_site_id} onChange={e => updateCandidate(index, { clinic_site_id: e.target.value })}>
                      <option value="">Select a site...</option>
                      {clinicSites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Start Date</label>
                    <input required type="date" className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none"
                           value={c.start_date} onChange={e => updateCandidate(index, { start_date: e.target.value })} />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Hardware &amp; Workstation Need</label>
                    <select className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none"
                            value={c.workstation_type} onChange={e => updateCandidate(index, { workstation_type: e.target.value })}>
                      {WORKSTATION_TYPES.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Previously Worked at DHC?</label>
                    <div className="flex items-center gap-4 h-[42px]">
                      <label className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                        <input type="radio" checked={c.is_rehire} onChange={() => updateCandidate(index, { is_rehire: true })} /> Yes
                      </label>
                      <label className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                        <input type="radio" checked={!c.is_rehire} onChange={() => updateCandidate(index, { is_rehire: false })} /> No
                      </label>
                    </div>
                  </div>
                </div>

                {c.department === "Dental" && (
                  <div className="mt-2 p-4 bg-sky-50 dark:bg-sky-900/20 border-l-4 border-sky-500 rounded-r">
                    <p className="text-sm font-semibold text-sky-800 dark:text-sky-300 mb-3">Dental-specific access</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                        <input type="checkbox" checked={c.requires_dexis} onChange={e => updateCandidate(index, { requires_dexis: e.target.checked })} />
                        Requires Dexis Imaging Access
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                        <input type="checkbox" checked={c.requires_fastattach} onChange={e => updateCandidate(index, { requires_fastattach: e.target.checked })} />
                        Requires FastAttach Access
                      </label>
                    </div>
                    <div className="mt-3">
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Workstation / Suite Number</label>
                      <input type="text" className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none"
                             value={c.workstation_suite} onChange={e => updateCandidate(index, { workstation_suite: e.target.value })} />
                    </div>
                  </div>
                )}
              </div>
            ))}

            {isBatch && (
              <button type="button" onClick={addCandidate} className="self-start text-sm text-medical-blue dark:text-medical-accent hover:underline font-semibold cursor-pointer">
                + Add another candidate
              </button>
            )}

            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Notes (Optional)</label>
              <textarea rows={3} className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none"
                        value={notes} onChange={e => setNotes(e.target.value)} />
            </div>

            <button type="submit" disabled={submitting} className="mt-2 bg-medical-blue hover:bg-medical-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-colors cursor-pointer">
              {submitting ? "Submitting..." : `Submit ${isBatch && candidates.length > 1 ? `${candidates.length} Candidates` : "Request"}`}
            </button>
          </form>
        </main>
      </div>
    </div>
  );
}
