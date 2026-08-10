"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API_BASE_URL, isUnauthorized } from "@/lib/api";
import EmployeeEmailSelect from "@/components/EmployeeEmailSelect";

// Fallback only for if /categories can't be reached - keep in sync with
// TICKET_CATEGORIES in backend/schemas.py, which is the actual source of
// truth the backend validates against.
const FALLBACK_CATEGORIES = ["Hardware/Workstation", "Software", "EHR/NextGen", "Network/Connectivity", "Telecom"];

export default function NewTicket() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "Hardware/Workstation",
    priority: "P4",
    asset_id: ""
  });
  const [affectedUserId, setAffectedUserId] = useState<number | null>(null);
  const [categories, setCategories] = useState<string[]>(FALLBACK_CATEGORIES);

  useEffect(() => {
    fetch(`${API_BASE_URL}/categories`)
      .then(res => (res.ok ? res.json() : FALLBACK_CATEGORIES))
      .then((cats: string[]) => {
        if (cats.length > 0) setCategories(cats);
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        ...formData,
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
        router.push("/dashboard");
      } else {
        alert("Failed to submit ticket.");
      }
    } catch (e) {
      alert("Error submitting ticket.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-medical-blue text-white p-4 shadow-md flex justify-between items-center px-10">
        <h1 className="text-xl font-bold">Clinical IT Portal</h1>
        <Link href="/dashboard" className="text-sm border border-white px-3 py-1 rounded hover:bg-medical-dark transition-colors">
          Back to Dashboard
        </Link>
      </header>

      <main className="max-w-3xl mx-auto p-10 w-full">
        <h2 className="text-3xl font-semibold text-slate-800 mb-6">Create Support Ticket</h2>
        
        <div className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-6 text-amber-800 font-medium rounded-r shadow-sm">
          <strong>HIPAA Warning:</strong> Please do not include any Protected Health Information (PHI) such as patient names, DOBs, or MRNs in the ticket details.
        </div>

        <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Issue Title</label>
              <input required type="text" className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none" 
                     value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} />
            </div>

            <div className="grid grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Category</label>
                <select className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none"
                        value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                  {categories.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Priority (Urgency Matrix)</label>
                <select className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none bg-slate-50"
                        value={formData.priority} onChange={e => setFormData({...formData, priority: e.target.value})}>
                  <option value="P4">P4 - General Inquiry (48h)</option>
                  <option value="P3">P3 - Minor Issue (24h)</option>
                  <option value="P2">P2 - Major Disruption (4h)</option>
                  <option value="P1">P1 - Critical Patient Care Impact (1h)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Affected Employee (Optional)</label>
              <EmployeeEmailSelect
                value={affectedUserId}
                onChange={setAffectedUserId}
                placeholder="Search by name or email if filing on someone's behalf..."
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Asset ID (Optional)</label>
              <input type="number" placeholder="e.g. 1004" className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none" 
                     value={formData.asset_id} onChange={e => setFormData({...formData, asset_id: e.target.value})} />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Detailed Description</label>
              <textarea required rows={4} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none"
                        value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})}></textarea>
            </div>

            <button type="submit" className="mt-4 bg-medical-blue hover:bg-medical-dark text-white font-bold py-3 px-4 rounded-lg transition-colors cursor-pointer">
              Submit Ticket
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
