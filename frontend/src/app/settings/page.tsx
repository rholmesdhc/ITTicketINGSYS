"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API_BASE_URL, isUnauthorized, logout } from "@/lib/api";
import ThemeToggle from "@/components/ThemeToggle";

type SaveStatus = { state: "idle" | "saving" | "saved" | "error"; message?: string };
type Category = { id: number; name: string };

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
