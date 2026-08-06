"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { API_BASE_URL } from "@/lib/api";

export default function TicketDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [ticket, setTicket] = useState<any>(null);
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

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
  }, [id, router]);

  const handleStatusChange = async (newStatus: string) => {
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_BASE_URL}/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        const updated = await res.json();
        setTicket(updated);
      }
    } catch (e) {
      console.error("Failed to update status", e);
    }
  };

  const handleAssignToMe = async () => {
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_BASE_URL}/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ tech_id: parseInt(userId as string) })
      });
      if (res.ok) {
        const updated = await res.json();
        setTicket(updated);
      }
    } catch (e) {
      console.error("Failed to assign ticket", e);
    }
  };

  if (!ticket) {
    return <div className="p-10 text-center font-bold text-slate-500">Loading ticket details...</div>;
  }

  const isAdminOrTech = role === "admin" || role === "technician";

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-medical-blue text-white p-4 shadow-md flex justify-between items-center px-10">
        <h1 className="text-xl font-bold">Clinical IT Portal</h1>
        <Link href="/dashboard" className="text-sm border border-white px-3 py-1 rounded hover:bg-medical-dark transition-colors">
          Back to Dashboard
        </Link>
      </header>

      <main className="max-w-4xl mx-auto p-10 w-full flex-1">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-slate-100 p-6 border-b border-slate-200 flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-bold text-slate-800">#{ticket.id} - {ticket.title}</h2>
              <p className="text-sm text-slate-500 mt-1">Submitted on {new Date(ticket.created_at).toLocaleString()}</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${ticket.priority === 'P1' ? 'bg-red-100 text-red-800 border border-red-300' : 'bg-slate-200 text-slate-800'}`}>
              {ticket.priority} - {ticket.status.replace("_", " ")}
            </span>
          </div>
          
          <div className="p-8">
            <div className="grid grid-cols-2 gap-8 mb-8">
              <div>
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Category</h3>
                <p className="text-lg font-medium text-slate-800">{ticket.category}</p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Asset Link</h3>
                <p className="text-lg font-medium text-slate-800">{ticket.asset_id ? `Asset #${ticket.asset_id}` : "None Selected"}</p>
              </div>
            </div>

            <div className="mb-8">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">SLA / Time to Resolution Target</h3>
              <div className="flex items-center gap-3">
                <div className={`text-xl font-mono p-3 rounded-lg border ${ticket.priority === 'P1' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                  {ticket.sla_deadline ? new Date(ticket.sla_deadline).toLocaleString() : "No Deadline"}
                </div>
              </div>
            </div>

            <div className="mb-8">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Description</h3>
              <div className="bg-slate-50 p-5 rounded-lg border border-slate-200 whitespace-pre-wrap text-slate-700 text-lg">
                {ticket.description}
              </div>
            </div>

            {isAdminOrTech && (
              <div className="mt-8 pt-8 border-t border-slate-200">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Technician Actions</h3>
                <div className="flex items-center gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Update Status</label>
                    <select 
                      className="bg-white border border-slate-300 text-slate-800 text-sm font-bold uppercase rounded px-3 py-2 outline-none cursor-pointer focus:ring-2 focus:ring-medical-accent"
                      value={ticket.status}
                      onChange={(e) => handleStatusChange(e.target.value)}
                    >
                      <option value="open">OPEN</option>
                      <option value="in_progress">IN PROGRESS</option>
                      <option value="resolved">RESOLVED</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Assignment</label>
                    {ticket.tech_id === parseInt(userId || "0") ? (
                      <div className="text-sm font-bold text-green-700 bg-green-50 px-4 py-2 rounded border border-green-200 inline-block">
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
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
