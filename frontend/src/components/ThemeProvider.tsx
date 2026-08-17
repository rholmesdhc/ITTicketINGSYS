"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { API_BASE_URL, updateUserPreferences } from "@/lib/api";

export type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  /** The user's stored preference - may be "system". */
  theme: Theme;
  /** What's actually applied right now ("system" always resolved to light/dark). */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  /** Pulls the saved theme from the server and applies it if present -
   *  see the login page, which calls this right after storing a fresh
   *  token (client-side navigation into the app never remounts this
   *  provider, so its own mount-time sync only ever catches an
   *  already-authenticated page *reload*, not a fresh login). */
  syncThemeFromServer: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "theme";

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.setAttribute("data-theme", resolved);
}

/**
 * Manages the light/dark/system preference: persists it, resolves "system"
 * against the OS setting, keeps it in sync if the OS setting changes while
 * "system" is selected, and applies the .dark class Tailwind's custom dark
 * variant looks for (see globals.css). The layout also injects a small
 * blocking inline script that does this same resolve-and-apply step before
 * first paint - this provider is what keeps things in sync afterward, not
 * what prevents the initial flash (that's the script's job).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) || "system";
    setThemeState(stored);
    setResolvedTheme(stored === "system" ? getSystemTheme() : stored);
  }, []);

  // Cross-device sync: once logged in, a saved server preference wins over
  // whatever's cached locally (e.g. a different theme set on another
  // browser). Only ever runs with a token present - this provider also
  // mounts on the unauthenticated login page, where it must stay a no-op.
  // Doesn't touch the blocking init-script/localStorage flash-prevention in
  // layout.tsx - that still applies the last-known value before first
  // paint; this only settles a moment later if the server disagrees.
  const syncThemeFromServer = () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    fetch(`${API_BASE_URL}/users/me/preferences`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        const serverTheme = data?.preferences?.theme as Theme | undefined;
        if (!serverTheme || !["light", "dark", "system"].includes(serverTheme)) return;
        setThemeState(serverTheme);
        localStorage.setItem(STORAGE_KEY, serverTheme);
        const resolved = serverTheme === "system" ? getSystemTheme() : serverTheme;
        setResolvedTheme(resolved);
        applyTheme(resolved);
      })
      .catch(() => {});
  };

  // Covers reloading an already-authenticated tab (e.g. F5 on /dashboard) -
  // a token is already present at this provider's one-time mount. A fresh
  // *login* is a client-side navigation that never remounts this provider,
  // so that path calls syncThemeFromServer() explicitly instead (see
  // login/page.tsx) rather than relying on this effect to catch it.
  useEffect(() => {
    syncThemeFromServer();
  }, []);

  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const resolved = getSystemTheme();
      setResolvedTheme(resolved);
      applyTheme(resolved);
    };
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, [theme]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    const resolved = next === "system" ? getSystemTheme() : next;
    setResolvedTheme(resolved);
    applyTheme(resolved);
    updateUserPreferences({ theme: next });
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, syncThemeFromServer }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
