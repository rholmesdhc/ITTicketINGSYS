"use client";
import { SessionProvider } from "next-auth/react";

// NextAuth's useSession() (used by the login page's Microsoft sign-in
// bridge) needs this context available - SessionProvider itself must be a
// client component, so it's wrapped here rather than used directly in the
// (server) root layout.
export default function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
