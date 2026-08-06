// Base URL for the FastAPI backend. Inlined at build time by Next.js since
// it's a NEXT_PUBLIC_ var — set via --build-arg in the Docker build (see
// frontend/Dockerfile) or a .env.local for local dev. Falls back to the
// local dev backend when unset.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8005";
