"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API_BASE_URL, isUnauthorized, logout } from "@/lib/api";
import OnboardingWizard from "@/components/OnboardingWizard";
import ThemeToggle from "@/components/ThemeToggle";

export default function UserManagement() {
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [role, setRole] = useState<string | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  // Create user state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("requester");
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newMi, setNewMi] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhoneNumber, setNewPhoneNumber] = useState("");
  const [newClinicSiteId, setNewClinicSiteId] = useState("");
  const [clinicSites, setClinicSites] = useState([]);
  const [error, setError] = useState("");

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
    fetchUsers(token);
    fetchClinicSites(token);
  }, [router]);

  const fetchUsers = async (token: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/users/`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (isUnauthorized(res)) return;
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (e) {
      console.error("Failed to fetch users", e);
    }
  };

  const fetchClinicSites = async (token: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/clinic-sites/`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (isUnauthorized(res)) return;
      if (res.ok) {
        const data = await res.json();
        setClinicSites(data);
      }
    } catch (e) {
      console.error("Failed to fetch clinic sites", e);
    }
  };

  const handleRoleChange = async (userId: number, newRole: string) => {
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_BASE_URL}/users/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ role: newRole })
      });
      if (isUnauthorized(res)) return;
      if (res.ok) {
        fetchUsers(token as string);
      }
    } catch (e) {
      console.error("Failed to update user role", e);
    }
  };

  const openEditModal = (user: any) => {
    setEditingUserId(user.id);
    setNewUsername(user.username);
    setNewPassword("");
    setNewRole(user.role);
    setNewFirstName(user.first_name || "");
    setNewLastName(user.last_name || "");
    setNewMi(user.mi || "");
    setNewEmail(user.email || "");
    setNewPhoneNumber(user.phone_number || "");
    setNewClinicSiteId(user.clinic_site_id ? user.clinic_site_id.toString() : "");
    setIsModalOpen(true);
    setError("");
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingUserId(null);
    setNewUsername("");
    setNewPassword("");
    setNewRole("requester");
    setNewFirstName("");
    setNewLastName("");
    setNewMi("");
    setNewEmail("");
    setNewPhoneNumber("");
    setNewClinicSiteId("");
    setError("");
  };

  const handleDeleteUser = async (userId: number) => {
    if (!window.confirm("Are you sure you want to delete this user?")) return;
    
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_BASE_URL}/users/${userId}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (isUnauthorized(res)) return;
      if (res.ok) {
        fetchUsers(token as string);
      } else {
        const data = await res.json();
        alert(data.detail || "Failed to delete user");
      }
    } catch (e) {
      console.error("Failed to delete user", e);
      alert("Network error occurred while trying to delete user");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const token = localStorage.getItem("token");
    
    const payload: any = {
      role: newRole,
      first_name: newFirstName,
      last_name: newLastName,
      mi: newMi || null,
      email: newEmail,
      phone_number: newPhoneNumber || null,
      clinic_site_id: newClinicSiteId ? parseInt(newClinicSiteId) : null
    };

    if (!editingUserId) {
      payload.username = newUsername;
      payload.password = newPassword;
    }

    try {
      const url = editingUserId
        ? `${API_BASE_URL}/users/${editingUserId}`
        : `${API_BASE_URL}/users/`;
      const method = editingUserId ? "PATCH" : "POST";
      
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (isUnauthorized(res)) return;
      if (res.ok) {
        closeModal();
        fetchUsers(token as string);
      } else {
        const data = await res.json();
        setError(data.detail || `Failed to ${editingUserId ? 'update' : 'create'} user`);
      }
    } catch (e) {
      setError("Network error occurred");
      console.error(`Failed to ${editingUserId ? 'update' : 'create'} user`, e);
    }
  };

  if (role !== "admin") return null;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      <header className="bg-medical-blue text-white p-4 shadow-md flex flex-wrap items-center justify-between gap-y-2 gap-x-4 px-4 sm:px-10">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold">Clinical IT Portal</h1>
          <Link href="/dashboard" className="text-sm font-semibold hover:text-medical-light transition-colors">
            Dashboard
          </Link>
          <Link href="/users" className="text-sm font-semibold text-medical-light transition-colors">
            User Management
          </Link>
          <Link href="/settings" className="text-sm font-semibold hover:text-medical-light transition-colors">
            Settings
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <button
            onClick={() => setIsWizardOpen(true)}
            className="text-sm border border-white px-3 py-1 rounded hover:bg-medical-dark transition-colors cursor-pointer"
          >
            ? Help
          </button>
          <button
            onClick={async () => { await logout(); router.push("/login"); }}
            className="text-sm border border-white px-3 py-1 rounded hover:bg-medical-dark transition-colors cursor-pointer"
          >
            Logout
          </button>
        </div>
      </header>

      <OnboardingWizard isOpen={isWizardOpen} onClose={() => setIsWizardOpen(false)} role={role} />

      <main className="max-w-7xl mx-auto p-10 w-full flex-1">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-semibold text-slate-800 dark:text-slate-100">User Management</h2>
          <button 
            onClick={() => closeModal()}
            className="bg-medical-accent hover:bg-medical-blue text-white px-5 py-2 rounded shadow transition-colors font-semibold cursor-pointer"
          >
            + New User
          </button>
        </div>
        
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-600">
                <th className="p-4 font-semibold">Username</th>
                <th className="p-4 font-semibold">Name</th>
                <th className="p-4 font-semibold">Email</th>
                <th data-tour="primary-clinic-site-column" className="p-4 font-semibold">Primary Clinic Site</th>
                <th className="p-4 font-semibold">Role</th>
                <th className="p-4 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u: any) => {
                const site = clinicSites.find((s: any) => s.id === u.clinic_site_id);
                return (
                  <tr key={u.id} className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700">
                    <td className="p-4 font-medium text-slate-800 dark:text-slate-100">{u.username}</td>
                    <td className="p-4 text-slate-800 dark:text-slate-100">{u.first_name} {u.mi ? u.mi + '.' : ''} {u.last_name}</td>
                    <td className="p-4 text-slate-600 dark:text-slate-300">{u.email}</td>
                    <td className="p-4 text-slate-600 dark:text-slate-300">{site ? (site as any).name : <span className="text-slate-400 dark:text-slate-500 italic">Mobile / not set</span>}</td>
                    <td className="p-4">
                      <select
                        className={`border text-sm font-bold uppercase rounded px-2 py-1 outline-none cursor-pointer ${
                          u.role === 'admin' ? 'bg-purple-50 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-700' :
                          u.role === 'technician' ? 'bg-amber-50 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-700' :
                          'bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600'
                        }`}
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      >
                        <option value="requester">REQUESTER</option>
                        <option value="technician">TECHNICIAN</option>
                        <option value="admin">ADMIN</option>
                      </select>
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => openEditModal(u)}
                        className="text-medical-blue dark:text-medical-accent hover:text-medical-dark dark:hover:text-medical-light font-semibold text-sm mr-4"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteUser(u.id)}
                        className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-semibold text-sm"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-10 text-center text-slate-500 dark:text-slate-400">No users found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* Create / Edit User Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4 border-b dark:border-slate-700 pb-3">
              <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">{editingUserId ? "Edit User" : "Create New User"}</h3>
              <button
                onClick={() => closeModal()}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer text-2xl font-bold"
              >
                &times;
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded text-sm">
                {error}
              </div>
            )}
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">First Name</label>
                  <input 
                    type="text" 
                    value={newFirstName}
                    onChange={(e) => setNewFirstName(e.target.value)}
                    className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded px-3 py-2 outline-none focus:border-medical-blue focus:ring-1 focus:ring-medical-blue"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Last Name</label>
                  <input 
                    type="text" 
                    value={newLastName}
                    onChange={(e) => setNewLastName(e.target.value)}
                    className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded px-3 py-2 outline-none focus:border-medical-blue focus:ring-1 focus:ring-medical-blue"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Middle Initial (Optional)</label>
                  <input 
                    type="text" 
                    value={newMi}
                    onChange={(e) => setNewMi(e.target.value)}
                    className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded px-3 py-2 outline-none focus:border-medical-blue focus:ring-1 focus:ring-medical-blue"
                    maxLength={1}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Email</label>
                  <input 
                    type="email" 
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded px-3 py-2 outline-none focus:border-medical-blue focus:ring-1 focus:ring-medical-blue"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Phone Number (Optional)</label>
                  <input 
                    type="tel" 
                    value={newPhoneNumber}
                    onChange={(e) => setNewPhoneNumber(e.target.value)}
                    className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded px-3 py-2 outline-none focus:border-medical-blue focus:ring-1 focus:ring-medical-blue"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Primary Clinic Site</label>
                  <select
                    value={newClinicSiteId}
                    onChange={(e) => setNewClinicSiteId(e.target.value)}
                    className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded px-3 py-2 outline-none focus:border-medical-blue focus:ring-1 focus:ring-medical-blue"
                  >
                    <option value="">Mobile / no fixed site</option>
                    {clinicSites.map((site: any) => (
                      <option key={site.id} value={site.id}>{site.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Most employees are assigned one home site. Leave unset for staff who work
                    across multiple sites day-to-day - individual tickets can still record which
                    site the issue actually happened at.
                  </p>
                </div>

                {/* Account Credentials */}
                <div className="md:col-span-2 pt-4 border-t dark:border-slate-700 mt-2">
                  <h4 className="text-md font-semibold text-slate-700 dark:text-slate-200 mb-3">Account Credentials</h4>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Username</label>
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded px-3 py-2 outline-none focus:border-medical-blue focus:ring-1 focus:ring-medical-blue disabled:bg-slate-100 dark:disabled:bg-slate-800 disabled:text-slate-500"
                    required
                    disabled={!!editingUserId}
                  />
                </div>
                {!editingUserId && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Password</label>
                    <input 
                      type="password" 
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded px-3 py-2 outline-none focus:border-medical-blue focus:ring-1 focus:ring-medical-blue"
                      required
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Role</label>
                  <select 
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded px-3 py-2 outline-none focus:border-medical-blue focus:ring-1 focus:ring-medical-blue"
                  >
                    <option value="requester">Requester</option>
                    <option value="technician">Technician</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
              
              <div className="pt-6 flex gap-3 justify-end border-t dark:border-slate-700 mt-4">
                <button
                  type="button"
                  onClick={() => closeModal()}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer font-semibold"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-6 py-2 bg-medical-blue text-white rounded hover:bg-medical-dark transition-colors cursor-pointer font-semibold"
                >
                  {editingUserId ? "Save Changes" : "Create User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
