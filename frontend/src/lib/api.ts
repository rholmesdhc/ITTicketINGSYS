// Base URL for the FastAPI backend. Inlined at build time by Next.js since
// it's a NEXT_PUBLIC_ var — set via --build-arg in the Docker build (see
// frontend/Dockerfile) or a .env.local for local dev. Falls back to the
// local dev backend when unset.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8005";

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
