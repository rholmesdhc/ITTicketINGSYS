import { signOut } from "next-auth/react";

// Base URL for the FastAPI backend. Inlined at build time by Next.js since
// it's a NEXT_PUBLIC_ var — set via --build-arg in the Docker build (see
// frontend/Dockerfile) or a .env.local for local dev. Falls back to the
// local dev backend when unset.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8005";

/**
 * Clears our own local session AND ends the NextAuth/Microsoft one.
 * Clearing only the local JWT (the original behavior) left NextAuth's
 * session - and its cached Graph access token - alive, so "Sign in with
 * Microsoft" after a "logout" could silently reuse a stale token instead
 * of doing a fresh round-trip through Microsoft. That stale token is
 * exactly what caused a real login to come back with outdated group
 * membership once during Entra testing.
 */
export async function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("role");
  localStorage.removeItem("userId");
  await signOut({ redirect: false });
}

/**
 * A 401 means the JWT expired or is invalid (access tokens last 60 minutes
 * - see backend/auth.py). Without this, pages were silently rendering
 * empty/stale data on every failed fetch with no indication why. Call this
 * wherever a fetch response might be 401 and bail out of the caller.
 */
export function isUnauthorized(res: Response): boolean {
  if (res.status !== 401) return false;
  localStorage.removeItem("token");
  localStorage.removeItem("role");
  localStorage.removeItem("userId");
  window.location.href = "/login?expired=1";
  return true;
}
