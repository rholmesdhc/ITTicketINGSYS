"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { API_BASE_URL } from "@/lib/api";
import ThemeToggle from "@/components/ThemeToggle";

// useSearchParams() opts the component using it out of static rendering
// unless isolated behind a Suspense boundary - kept separate so the rest
// of the login form can stay statically prerendered.
function SessionExpiredBanner() {
  const searchParams = useSearchParams();
  if (searchParams.get("expired") !== "1") return null;
  return (
    <div className="mb-6 p-3 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded text-sm text-center">
      Your session expired. Please sign in again.
    </div>
  );
}

/**
 * Bridges a completed Microsoft sign-in to this app's own session model.
 * NextAuth's session is only ever used for this one handshake: once it
 * reports an authenticated session with a captured Graph access token
 * (see src/auth.ts), that token is exchanged with our backend for a local
 * JWT via POST /auth/entra, stored in localStorage exactly like the
 * legacy username/password login always did. Every other page in the app
 * only ever reads that local JWT and is completely unaware Entra exists.
 */
function EntraLoginBridge() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [error, setError] = useState("");
  const exchanged = useRef(false);

  useEffect(() => {
    const graphAccessToken = (session as any)?.graphAccessToken;
    if (status !== "authenticated" || !graphAccessToken || exchanged.current) return;
    exchanged.current = true;

    (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/entra`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token: graphAccessToken }),
        });
        if (!response.ok) throw new Error("Backend rejected the Microsoft sign-in");
        const data = await response.json();
        localStorage.setItem("token", data.access_token);
        localStorage.setItem("role", data.role);
        localStorage.setItem("userId", data.id);
        router.push("/dashboard");
      } catch (e) {
        exchanged.current = false;
        setError("Signed in with Microsoft, but couldn't complete sign-in to the ticketing app. Try again.");
      }
    })();
  }, [session, status, router]);

  if (status === "loading" || (status === "authenticated" && !error)) {
    return <p className="text-center text-slate-500 dark:text-slate-400 text-sm mb-4">Finishing sign-in...</p>;
  }
  if (error) {
    return <p className="text-center text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>;
  }
  return null;
}

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
    <div className="flex flex-col flex-1 items-center justify-center bg-medical-light dark:bg-slate-900 min-h-screen w-full relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle variant="standalone" />
      </div>
      <div className="bg-white dark:bg-slate-800 p-10 rounded-xl shadow-xl w-full max-w-md border-t-8 border-medical-blue">
        <div className="text-center mb-8">
          <Image
            src="/images/delta-health-logo.png"
            alt="Delta Health Center"
            width={280}
            height={119}
            className="h-16 w-auto mx-auto mb-4"
            preload
          />
          <h1 className="text-3xl font-bold text-medical-dark dark:text-medical-light">Clinical IT Portal</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">Sign in to manage support tickets</p>
        </div>

        <Suspense fallback={null}>
          <SessionExpiredBanner />
        </Suspense>

        <Suspense fallback={null}>
          <EntraLoginBridge />
        </Suspense>

        <button
          onClick={() => signIn("microsoft-entra-id")}
          className="w-full flex items-center justify-center gap-2 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold py-3 px-4 rounded-lg transition-colors cursor-pointer mb-6"
        >
          <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          Sign in with Microsoft
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
          <span className="text-xs text-slate-400 dark:text-slate-500 uppercase font-semibold">or</span>
          <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Username</label>
            <input
              type="text"
              required
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-medical-accent"
              value={username}
              onChange={e => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Password</label>
            <input
              type="password"
              required
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-medical-accent"
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
