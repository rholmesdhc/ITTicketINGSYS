"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { API_BASE_URL } from "@/lib/api";

export default function Dashboard() {
  const router = useRouter();
  const [tickets, setTickets] = useState([]);
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
    fetchTickets(token);
  }, [router]);

  const fetchTickets = async (token: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/tickets/`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setTickets(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleStatusChange = async (ticketId: number, newStatus: string) => {
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_BASE_URL}/tickets/${ticketId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        fetchTickets(token as string);
      }
    } catch (e) {
      console.error("Failed to update status", e);
    }
  };

  const handleAssignToMe = async (ticketId: number) => {
    const token = localStorage.getItem("token");
    const currentUserId = localStorage.getItem("userId");
    try {
      const res = await fetch(`${API_BASE_URL}/tickets/${ticketId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ tech_id: parseInt(currentUserId as string) })
      });
      if (res.ok) {
        fetchTickets(token as string);
      }
    } catch (e) {
      console.error("Failed to assign ticket", e);
    }
  };

  const isAdminOrTech = role === "admin" || role === "technician";
  const dashboardTitle = isAdminOrTech ? "All Support Tickets" : "My Tickets";

  // KPI Calculations
  const totalTickets = tickets.length;
  const openTickets = tickets.filter((t: any) => t.status === "open").length;
  const highPriorityTickets = tickets.filter((t: any) => t.priority === "P1" || t.priority === "P2").length;
  const resolvedTickets = tickets.filter((t: any) => t.status === "resolved").length;

  // Chart Data Calculations
  const statusCounts = tickets.reduce((acc: any, ticket: any) => {
    acc[ticket.status] = (acc[ticket.status] || 0) + 1;
    return acc;
  }, {});
  
  const statusData = [
    { name: 'Open', value: statusCounts['open'] || 0, color: '#f59e0b' },
    { name: 'In Progress', value: statusCounts['in_progress'] || 0, color: '#3b82f6' },
    { name: 'Resolved', value: statusCounts['resolved'] || 0, color: '#10b981' },
  ].filter(item => item.value > 0);

  const categoryCounts = tickets.reduce((acc: any, ticket: any) => {
    acc[ticket.category] = (acc[ticket.category] || 0) + 1;
    return acc;
  }, {});

  const categoryData = Object.keys(categoryCounts).map(key => ({
    name: key,
    count: categoryCounts[key]
  }));

  const techCounts = tickets.reduce((acc: any, ticket: any) => {
    const techName = ticket.tech_id ? `Tech ${ticket.tech_id}` : 'Unassigned';
    acc[techName] = (acc[techName] || 0) + 1;
    return acc;
  }, {});

  const techData = Object.keys(techCounts).map(key => ({
    name: key,
    count: techCounts[key]
  }));

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-medical-blue text-white p-4 shadow-md flex justify-between items-center px-10">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold">Clinical IT Portal</h1>
          {role === "admin" && (
            <Link href="/users" className="text-sm font-semibold hover:text-medical-light transition-colors">
              User Management
            </Link>
          )}
        </div>
        <button 
          onClick={() => { localStorage.removeItem("token"); localStorage.removeItem("role"); localStorage.removeItem("userId"); router.push("/login"); }}
          className="text-sm border border-white px-3 py-1 rounded hover:bg-medical-dark transition-colors cursor-pointer"
        >
          Logout
        </button>
      </header>
      
      <main className="max-w-7xl mx-auto p-10 w-full flex-1">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-semibold text-slate-800">{dashboardTitle}</h2>
          <Link href="/tickets/new" className="bg-medical-accent hover:bg-medical-blue text-white px-5 py-2 rounded shadow transition-colors font-semibold">
            + New Ticket
          </Link>
        </div>
        
        {/* KPI Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h3 className="text-sm font-semibold text-slate-500 uppercase">Total Tickets</h3>
            <p className="text-3xl font-bold text-slate-800 mt-2">{totalTickets}</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h3 className="text-sm font-semibold text-slate-500 uppercase">Open Tickets</h3>
            <p className="text-3xl font-bold text-amber-500 mt-2">{openTickets}</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h3 className="text-sm font-semibold text-slate-500 uppercase">High Priority (P1/P2)</h3>
            <p className="text-3xl font-bold text-red-500 mt-2">{highPriorityTickets}</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h3 className="text-sm font-semibold text-slate-500 uppercase">Resolved</h3>
            <p className="text-3xl font-bold text-emerald-500 mt-2">{resolvedTickets}</p>
          </div>
        </div>

        {/* Charts Section */}
        {tickets.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">Tickets by Status</h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {statusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
            
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">Tickets by Category</h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
                    <RechartsTooltip cursor={{fill: '#f1f5f9'}} />
                    <Bar dataKey="count" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">Tickets by Technician</h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={techData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
                    <RechartsTooltip cursor={{fill: '#f1f5f9'}} />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-slate-100 text-slate-600 border-b border-slate-200">
                <th className="p-4 font-semibold">Ticket</th>
                <th className="p-4 font-semibold">Category</th>
                <th className="p-4 font-semibold">Status</th>
                <th className="p-4 font-semibold">Priority</th>
                <th className="p-4 font-semibold">Resolution SLA (TTR)</th>
                {isAdminOrTech && <th className="p-4 font-semibold text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {tickets.length === 0 ? (
                <tr>
                  <td colSpan={isAdminOrTech ? 6 : 5} className="p-10 text-center text-slate-500">No tickets found. Create one to get started!</td>
                </tr>
              ) : (
                tickets.map((t: any) => (
                  <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="p-4 font-medium text-medical-dark">
                      <Link href={`/tickets/${t.id}`} className="hover:underline">
                        #{t.id} - {t.title}
                      </Link>
                    </td>
                    <td className="p-4">{t.category}</td>
                    <td className="p-4">
                      {isAdminOrTech ? (
                        <select 
                          className="bg-sky-50 border border-sky-200 text-sky-800 text-xs font-bold uppercase rounded px-2 py-1 outline-none cursor-pointer"
                          value={t.status}
                          onChange={(e) => handleStatusChange(t.id, e.target.value)}
                        >
                          <option value="open">OPEN</option>
                          <option value="in_progress">IN PROGRESS</option>
                          <option value="resolved">RESOLVED</option>
                        </select>
                      ) : (
                        <span className="bg-sky-100 text-sky-800 px-2 py-1 rounded text-xs font-bold uppercase">{t.status.replace("_", " ")}</span>
                      )}
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${t.priority === 'P1' ? 'bg-red-100 text-red-800 border border-red-300' : 'bg-slate-100 text-slate-800'}`}>
                        {t.priority}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-slate-500 font-medium">
                      {t.sla_deadline ? new Date(t.sla_deadline).toLocaleString() : "N/A"}
                    </td>
                    {isAdminOrTech && (
                      <td className="p-4 text-right">
                        {t.tech_id === parseInt(userId || "0") ? (
                          <span className="text-xs font-bold text-green-600 bg-green-100 px-2 py-1 rounded border border-green-200">Assigned to you</span>
                        ) : (
                          <button 
                            onClick={() => handleAssignToMe(t.id)}
                            className="text-xs bg-medical-blue hover:bg-medical-dark text-white px-3 py-1 rounded font-semibold transition-colors"
                          >
                            Assign to me
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
