"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API_BASE_URL, isUnauthorized } from "@/lib/api";
import Sidebar from "@/components/Sidebar";

type SaveStatus = { state: "idle" | "saving" | "saved" | "error"; message?: string };
type Category = { id: number; name: string };
type JobTitle = { id: number; title: string; department: string; default_workstation_type: string | null };
type NotificationRecipient = { id: number; trigger: string; department: string | null; recipient_name: string; recipient_email: string; cc: boolean };

// Keep in sync with backend/schemas.py's ONBOARDING_DEPARTMENTS/
// ONBOARDING_NOTIFICATION_TRIGGERS.
const ONBOARDING_DEPARTMENTS = ["Dental", "Clinical", "Administrative", "Billing", "Nursing", "IT", "Other"];
const NOTIFICATION_TRIGGERS: { value: string; label: string }[] = [
  { value: "batch_submitted", label: "New batch submitted (HR files a request)" },
  { value: "stage1_complete", label: "Stage 1 complete (IT identity ready)" },
];

export default function Settings() {
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [requireResolution, setRequireResolution] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: "idle" });

  // Ticket categories CRUD (tester-requested) - a name-only entity, so a
  // much lighter version of the create/edit modal pattern in users/page.tsx
  // (which has ~8 fields) rather than reusing that component directly.
  const [categories, setCategories] = useState<Category[]>([]);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [categoryBusy, setCategoryBusy] = useState(false);

  // Onboarding job titles - same lightweight CRUD shape as categories above,
  // plus a department (and optional default workstation type) each row
  // carries, so the onboarding request form can auto-populate those.
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [isJobTitleModalOpen, setIsJobTitleModalOpen] = useState(false);
  const [editingJobTitleId, setEditingJobTitleId] = useState<number | null>(null);
  const [jobTitleForm, setJobTitleForm] = useState({ title: "", department: "Clinical", default_workstation_type: "" });
  const [jobTitleError, setJobTitleError] = useState("");
  const [jobTitleBusy, setJobTitleBusy] = useState(false);

  // Onboarding notification recipients (config-driven routing - who hears
  // about a batch submission / Stage 1 completion, instead of hardcoded
  // names in backend code). Add-and-delete only, no edit - simpler to
  // remove and re-add a row than build a second modal for it.
  const [notificationRecipients, setNotificationRecipients] = useState<NotificationRecipient[]>([]);
  const [isRecipientModalOpen, setIsRecipientModalOpen] = useState(false);
  const [recipientForm, setRecipientForm] = useState({ trigger: "batch_submitted", department: "", recipient_name: "", recipient_email: "", cc: false });
  const [recipientError, setRecipientError] = useState("");
  const [recipientBusy, setRecipientBusy] = useState(false);

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

    fetchCategories(token);
    fetchJobTitles(token);
    fetchNotificationRecipients(token);
  }, [router]);

  const fetchCategories = async (token: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/categories`, { headers: { "Authorization": `Bearer ${token}` } });
      if (isUnauthorized(res)) return;
      if (res.ok) setCategories(await res.json());
    } catch (e) {
      console.error("Failed to fetch categories", e);
    }
  };

  const openAddCategoryModal = () => {
    setEditingCategoryId(null);
    setCategoryName("");
    setCategoryError("");
    setIsCategoryModalOpen(true);
  };

  const openEditCategoryModal = (category: Category) => {
    setEditingCategoryId(category.id);
    setCategoryName(category.name);
    setCategoryError("");
    setIsCategoryModalOpen(true);
  };

  const closeCategoryModal = () => {
    setIsCategoryModalOpen(false);
    setEditingCategoryId(null);
    setCategoryName("");
    setCategoryError("");
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setCategoryBusy(true);
    setCategoryError("");
    const token = localStorage.getItem("token");
    const isEditing = editingCategoryId !== null;
    try {
      const res = await fetch(
        isEditing ? `${API_BASE_URL}/categories/${editingCategoryId}` : `${API_BASE_URL}/categories`,
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ name: categoryName.trim() }),
        }
      );
      if (isUnauthorized(res)) return;
      if (res.ok) {
        closeCategoryModal();
        fetchCategories(token as string);
      } else {
        const data = await res.json().catch(() => null);
        setCategoryError(data?.detail || "Failed to save category");
      }
    } catch (e) {
      setCategoryError("Error talking to API");
    } finally {
      setCategoryBusy(false);
    }
  };

  const handleDeleteCategory = async (category: Category) => {
    if (!window.confirm(`Delete "${category.name}"? Existing tickets that used it keep the name - this only affects new tickets.`)) return;
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_BASE_URL}/categories/${category.id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (isUnauthorized(res)) return;
      if (res.ok) fetchCategories(token as string);
    } catch (e) {
      console.error("Failed to delete category", e);
    }
  };

  const fetchJobTitles = async (token: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/onboarding/job-titles`, { headers: { "Authorization": `Bearer ${token}` } });
      if (isUnauthorized(res)) return;
      if (res.ok) setJobTitles(await res.json());
    } catch (e) {
      console.error("Failed to fetch onboarding job titles", e);
    }
  };

  const openAddJobTitleModal = () => {
    setEditingJobTitleId(null);
    setJobTitleForm({ title: "", department: "Clinical", default_workstation_type: "" });
    setJobTitleError("");
    setIsJobTitleModalOpen(true);
  };

  const openEditJobTitleModal = (jt: JobTitle) => {
    setEditingJobTitleId(jt.id);
    setJobTitleForm({ title: jt.title, department: jt.department, default_workstation_type: jt.default_workstation_type || "" });
    setJobTitleError("");
    setIsJobTitleModalOpen(true);
  };

  const closeJobTitleModal = () => {
    setIsJobTitleModalOpen(false);
    setEditingJobTitleId(null);
    setJobTitleError("");
  };

  const handleSaveJobTitle = async (e: React.FormEvent) => {
    e.preventDefault();
    setJobTitleBusy(true);
    setJobTitleError("");
    const token = localStorage.getItem("token");
    const isEditing = editingJobTitleId !== null;
    try {
      const res = await fetch(
        isEditing ? `${API_BASE_URL}/onboarding/job-titles/${editingJobTitleId}` : `${API_BASE_URL}/onboarding/job-titles`,
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({
            title: jobTitleForm.title.trim(),
            department: jobTitleForm.department,
            default_workstation_type: jobTitleForm.default_workstation_type || null,
          }),
        }
      );
      if (isUnauthorized(res)) return;
      if (res.ok) {
        closeJobTitleModal();
        fetchJobTitles(token as string);
      } else {
        const data = await res.json().catch(() => null);
        setJobTitleError(data?.detail || "Failed to save job title");
      }
    } catch (e) {
      setJobTitleError("Error talking to API");
    } finally {
      setJobTitleBusy(false);
    }
  };

  const handleDeleteJobTitle = async (jt: JobTitle) => {
    if (!window.confirm(`Delete "${jt.title}"? Existing onboarding candidates that used it keep it on their record - this only affects new submissions.`)) return;
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_BASE_URL}/onboarding/job-titles/${jt.id}`, { method: "DELETE", headers: { "Authorization": `Bearer ${token}` } });
      if (isUnauthorized(res)) return;
      if (res.ok) fetchJobTitles(token as string);
    } catch (e) {
      console.error("Failed to delete job title", e);
    }
  };

  const fetchNotificationRecipients = async (token: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/onboarding/notification-recipients`, { headers: { "Authorization": `Bearer ${token}` } });
      if (isUnauthorized(res)) return;
      if (res.ok) setNotificationRecipients(await res.json());
    } catch (e) {
      console.error("Failed to fetch onboarding notification recipients", e);
    }
  };

  const openAddRecipientModal = () => {
    setRecipientForm({ trigger: "batch_submitted", department: "", recipient_name: "", recipient_email: "", cc: false });
    setRecipientError("");
    setIsRecipientModalOpen(true);
  };

  const handleSaveRecipient = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecipientBusy(true);
    setRecipientError("");
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_BASE_URL}/onboarding/notification-recipients`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          trigger: recipientForm.trigger,
          department: recipientForm.department || null,
          recipient_name: recipientForm.recipient_name.trim(),
          recipient_email: recipientForm.recipient_email.trim(),
          cc: recipientForm.cc,
        }),
      });
      if (isUnauthorized(res)) return;
      if (res.ok) {
        setIsRecipientModalOpen(false);
        fetchNotificationRecipients(token as string);
      } else {
        const data = await res.json().catch(() => null);
        setRecipientError(data?.detail || "Failed to save recipient");
      }
    } catch (e) {
      setRecipientError("Error talking to API");
    } finally {
      setRecipientBusy(false);
    }
  };

  const handleDeleteRecipient = async (r: NotificationRecipient) => {
    if (!window.confirm(`Remove ${r.recipient_name} from this notification?`)) return;
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_BASE_URL}/onboarding/notification-recipients/${r.id}`, { method: "DELETE", headers: { "Authorization": `Bearer ${token}` } });
      if (isUnauthorized(res)) return;
      if (res.ok) fetchNotificationRecipients(token as string);
    } catch (e) {
      console.error("Failed to delete notification recipient", e);
    }
  };

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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex">
      <Sidebar role={role} />
      <div className="flex-1 flex flex-col min-w-0 pt-14 md:pt-0">
      <main className="max-w-3xl mx-auto p-10 w-full flex-1">
        <h2 className="text-3xl font-semibold text-slate-800 dark:text-slate-100 mb-8">Admin Settings</h2>

        {loaded && (
          <Link
            href="/users"
            className="block bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 mb-6 hover:border-medical-blue dark:hover:border-medical-accent transition-colors"
          >
            <div className="flex items-center justify-between gap-6">
              <div>
                <h3 className="text-sm font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">User Management</h3>
                <p className="text-slate-600 dark:text-slate-300">Create accounts, change roles, and set primary clinic sites.</p>
              </div>
              <span className="text-medical-blue dark:text-medical-accent font-semibold shrink-0">Manage users →</span>
            </div>
          </Link>
        )}

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

        {loaded && (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 mt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Ticket Categories</h3>
              <button
                onClick={openAddCategoryModal}
                className="text-sm bg-medical-blue hover:bg-medical-dark text-white px-3 py-1.5 rounded font-semibold transition-colors cursor-pointer"
              >
                + Add Category
              </button>
            </div>

            {categories.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No categories yet.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {categories.map(c => (
                  <div key={c.id} className="flex items-center justify-between py-3">
                    <span className="text-slate-800 dark:text-slate-100">{c.name}</span>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => openEditCategoryModal(c)}
                        className="text-sm text-medical-blue dark:text-medical-accent hover:text-medical-dark dark:hover:text-medical-light font-semibold cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteCategory(c)}
                        className="text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-semibold cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-4">
              Renaming or deleting a category only affects new tickets - existing tickets keep whatever
              category name they were filed under.
            </p>
          </div>
        )}

        {loaded && (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 mt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Onboarding Job Titles</h3>
              <button
                onClick={openAddJobTitleModal}
                className="text-sm bg-medical-blue hover:bg-medical-dark text-white px-3 py-1.5 rounded font-semibold transition-colors cursor-pointer"
              >
                + Add Job Title
              </button>
            </div>

            {jobTitles.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No job titles yet - the onboarding request form's Position dropdown will be blank until some exist.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {jobTitles.map(jt => (
                  <div key={jt.id} className="flex items-center justify-between py-3 gap-3">
                    <div>
                      <span className="text-slate-800 dark:text-slate-100 font-medium">{jt.title}</span>
                      <span className="text-slate-400 dark:text-slate-500 text-sm"> — {jt.department}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button onClick={() => openEditJobTitleModal(jt)} className="text-sm text-medical-blue dark:text-medical-accent hover:text-medical-dark dark:hover:text-medical-light font-semibold cursor-pointer">
                        Edit
                      </button>
                      <button onClick={() => handleDeleteJobTitle(jt)} className="text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-semibold cursor-pointer">
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {loaded && (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 mt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Onboarding Notifications</h3>
              <button
                onClick={openAddRecipientModal}
                className="text-sm bg-medical-blue hover:bg-medical-dark text-white px-3 py-1.5 rounded font-semibold transition-colors cursor-pointer"
              >
                + Add Recipient
              </button>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              Who gets emailed when an HR onboarding batch is submitted, or when a technician completes
              Stage 1 IT setup - configured here instead of hardcoded, so staffing changes don't need a code change.
            </p>

            {notificationRecipients.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No recipients configured yet - onboarding notifications won't be sent to anyone.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {notificationRecipients.map(r => (
                  <div key={r.id} className="flex items-center justify-between py-3 gap-3">
                    <div>
                      <span className="text-slate-800 dark:text-slate-100 font-medium">{r.recipient_name}</span>
                      <span className="text-slate-400 dark:text-slate-500 text-sm"> ({r.recipient_email})</span>
                      <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                        {NOTIFICATION_TRIGGERS.find(t => t.value === r.trigger)?.label || r.trigger}
                        {r.department && ` · ${r.department} only`} · {r.cc ? "CC" : "To"}
                      </div>
                    </div>
                    <button onClick={() => handleDeleteRecipient(r)} className="shrink-0 text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-semibold cursor-pointer">
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {isCategoryModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4 border-b dark:border-slate-700 pb-3">
              <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                {editingCategoryId ? "Edit Category" : "Add Category"}
              </h3>
              <button
                onClick={closeCategoryModal}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer text-2xl font-bold"
              >
                &times;
              </button>
            </div>

            {categoryError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded text-sm">
                {categoryError}
              </div>
            )}

            <form onSubmit={handleSaveCategory} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Name</label>
                <input
                  type="text"
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                  className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded px-3 py-2 outline-none focus:border-medical-blue focus:ring-1 focus:ring-medical-blue"
                  required
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeCategoryModal}
                  className="px-4 py-2 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={categoryBusy}
                  className="px-4 py-2 rounded bg-medical-blue hover:bg-medical-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold cursor-pointer"
                >
                  {categoryBusy ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isJobTitleModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4 border-b dark:border-slate-700 pb-3">
              <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                {editingJobTitleId ? "Edit Job Title" : "Add Job Title"}
              </h3>
              <button onClick={closeJobTitleModal} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer text-2xl font-bold">
                &times;
              </button>
            </div>

            {jobTitleError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded text-sm">
                {jobTitleError}
              </div>
            )}

            <form onSubmit={handleSaveJobTitle} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Title</label>
                <input
                  type="text"
                  value={jobTitleForm.title}
                  onChange={(e) => setJobTitleForm({ ...jobTitleForm, title: e.target.value })}
                  className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded px-3 py-2 outline-none focus:border-medical-blue focus:ring-1 focus:ring-medical-blue"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Department</label>
                <select
                  value={jobTitleForm.department}
                  onChange={(e) => setJobTitleForm({ ...jobTitleForm, department: e.target.value })}
                  className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded px-3 py-2 outline-none focus:border-medical-blue focus:ring-1 focus:ring-medical-blue"
                >
                  {ONBOARDING_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Default Workstation Type (Optional)</label>
                <select
                  value={jobTitleForm.default_workstation_type}
                  onChange={(e) => setJobTitleForm({ ...jobTitleForm, default_workstation_type: e.target.value })}
                  className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded px-3 py-2 outline-none focus:border-medical-blue focus:ring-1 focus:ring-medical-blue"
                >
                  <option value="">None</option>
                  <option value="dedicated_desktop">Dedicated Desktop/All-in-One</option>
                  <option value="laptop">Laptop</option>
                  <option value="shared_workstation">Shared Workstation Only</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeJobTitleModal} className="px-4 py-2 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={jobTitleBusy} className="px-4 py-2 rounded bg-medical-blue hover:bg-medical-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold cursor-pointer">
                  {jobTitleBusy ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isRecipientModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4 border-b dark:border-slate-700 pb-3">
              <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">Add Notification Recipient</h3>
              <button onClick={() => setIsRecipientModalOpen(false)} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer text-2xl font-bold">
                &times;
              </button>
            </div>

            {recipientError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded text-sm">
                {recipientError}
              </div>
            )}

            <form onSubmit={handleSaveRecipient} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Notify When</label>
                <select
                  value={recipientForm.trigger}
                  onChange={(e) => setRecipientForm({ ...recipientForm, trigger: e.target.value })}
                  className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded px-3 py-2 outline-none focus:border-medical-blue focus:ring-1 focus:ring-medical-blue"
                >
                  {NOTIFICATION_TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Only for Department (Optional)</label>
                <select
                  value={recipientForm.department}
                  onChange={(e) => setRecipientForm({ ...recipientForm, department: e.target.value })}
                  className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded px-3 py-2 outline-none focus:border-medical-blue focus:ring-1 focus:ring-medical-blue"
                >
                  <option value="">All departments</option>
                  {ONBOARDING_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Name</label>
                  <input
                    type="text"
                    value={recipientForm.recipient_name}
                    onChange={(e) => setRecipientForm({ ...recipientForm, recipient_name: e.target.value })}
                    className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded px-3 py-2 outline-none focus:border-medical-blue focus:ring-1 focus:ring-medical-blue"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Email</label>
                  <input
                    type="email"
                    value={recipientForm.recipient_email}
                    onChange={(e) => setRecipientForm({ ...recipientForm, recipient_email: e.target.value })}
                    className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded px-3 py-2 outline-none focus:border-medical-blue focus:ring-1 focus:ring-medical-blue"
                    required
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                <input type="checkbox" checked={recipientForm.cc} onChange={(e) => setRecipientForm({ ...recipientForm, cc: e.target.checked })} />
                CC only (not the primary "To" recipient)
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsRecipientModalOpen(false)} className="px-4 py-2 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={recipientBusy} className="px-4 py-2 rounded bg-medical-blue hover:bg-medical-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold cursor-pointer">
                  {recipientBusy ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
    </div>
  );
}
