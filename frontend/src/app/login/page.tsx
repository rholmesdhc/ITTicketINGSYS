"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL } from "@/lib/api";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role: "requester" }),
      });
      if (response.ok) {
        const data = await response.json();
        localStorage.setItem("token", data.access_token);
        localStorage.setItem("role", data.role);
        localStorage.setItem("userId", data.id);
        router.push("/dashboard");
      } else {
        alert("Invalid login");
      }
    } catch {
      alert("Error talking to API");
    }
  };

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-medical-light min-h-screen w-full">
      <div className="bg-white p-10 rounded-xl shadow-xl w-full max-w-md border-t-8 border-medical-blue">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-medical-dark">Clinical IT Portal</h1>
          <p className="text-slate-500 mt-2">Sign in to manage support tickets</p>
        </div>
        
        <form onSubmit={handleLogin} className="flex flex-col gap-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Username</label>
            <input 
              type="text" 
              required
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-medical-accent"
              value={username}
              onChange={e => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Password</label>
            <input 
              type="password"
              required
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-medical-accent"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>
          <button 
            type="submit" 
            className="mt-4 w-full bg-medical-blue hover:bg-medical-dark text-white font-bold py-3 px-4 rounded-lg transition-colors cursor-pointer"
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}
