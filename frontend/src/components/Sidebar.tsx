"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { logout } from "@/lib/api";
import ThemeToggle from "@/components/ThemeToggle";

type Props = {
  role: string | null;
  /** Opens the current page's own onboarding tour. Omitted on pages that
   * don't have one (ticket detail, new ticket, settings, users) - the Help
   * item simply isn't rendered rather than being shown non-functional. */
  onHelpClick?: () => void;
};

const COLLAPSE_KEY = "sidebar_collapsed";

type FlyoutChild = { href: string; label: string; active: boolean; dataTour?: string };

/**
 * A top-level nav item that reveals a WordPress-admin-style flyout submenu
 * on hover (see the SiteGround/WP screenshot the user referenced - hovering
 * "Pages" pops "All Pages"/"Add Page" out to the side). Driven by React
 * state (onMouseEnter/onMouseLeave) rather than a pure-CSS group-hover
 * toggle, matching this codebase's other floating menu (the dashboard's
 * "+ Add card" dropdown) - also means the flyout only exists in the DOM
 * while actually open, so it never intercepts clicks or shows up in an
 * accessibility tree when closed.
 *
 * The parent item is still a real link to its own default destination
 * (clicking "Tickets" itself goes to the ticket list, same as clicking
 * "Pages" in WP goes to All Pages) - the flyout is an additional shortcut,
 * not the only way in. On a touch device there's no hover at all, so
 * tapping the parent just navigates - the same graceful fallback WP's own
 * mobile admin relies on for this exact pattern.
 */
function FlyoutNavItem({
  href, icon, label, active, collapsed, dataTour, items,
}: {
  href: string; icon: string; label: string; active: boolean; collapsed: boolean; dataTour?: string; items: FlyoutChild[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {/* No `title` attribute here - the native OS tooltip it triggers on
          hover would visually collide with the custom flyout below (both
          appear near the cursor at once). aria-label covers the same
          "what is this icon" need for screen readers without that clash. */}
      <Link
        href={href}
        data-tour={dataTour}
        aria-label={label}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
          active ? "bg-medical-accent text-white" : "text-slate-200 hover:bg-white/10"
        } ${collapsed ? "justify-center" : ""}`}
      >
        <span aria-hidden>{icon}</span>
        {!collapsed && <span className="truncate">{label}</span>}
      </Link>
      {/* Positioned flush against the right edge of the parent item, like
          the reference screenshot. A child of the same hover-tracked
          wrapper (not a portal), so moving the cursor from the link into
          the flyout itself doesn't count as "leaving" for onMouseLeave. */}
      {open && (
        <div className="absolute left-full top-0 z-30 ml-1 min-w-[180px] bg-slate-800 border border-white/10 rounded-lg shadow-xl py-1">
          {items.map(child => (
            <Link
              key={child.href}
              href={child.href}
              data-tour={child.dataTour}
              className={`block px-4 py-2 text-sm font-medium transition-colors ${
                child.active ? "text-white bg-white/10" : "text-slate-200 hover:bg-white/10"
              }`}
            >
              {child.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * App-wide left navigation, replacing the top header bar every page used to
 * carry its own copy of (logo/title, Admin Settings, +New Ticket, Help,
 * Theme toggle, Logout). One shared component instead of that duplicated
 * per-page markup - see the WordPress/SiteGround admin sidebar the user
 * referenced as the pattern to follow, including its hover-flyout submenus.
 *
 * "Active" section is derived from the current route (usePathname), not a
 * prop every page has to remember to pass - /tickets, /tickets/new, and
 * /tickets/[id] all highlight "Tickets"; /settings and /users both
 * highlight "Admin Settings".
 *
 * Below the md breakpoint this renders as a slim fixed top bar (hamburger +
 * logo) instead of a permanent 240px column - a static sidebar was eating
 * most of a phone-width viewport otherwise. Opening the hamburger slides in
 * the same nav as a full-height overlay drawer with a backdrop, closed by
 * the backdrop, its own X, or navigating anywhere.
 */
export default function Sidebar({ role, onHelpClick }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Read the saved collapse state on mount only - this is a per-browser
  // convenience (like the theme choice), not a synced-across-devices
  // account preference, so plain localStorage is the right tool, not the
  // server-side ui_preferences JSON the dashboard's KPI cards use.
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
    } catch {}
  }, []);

  // The mobile drawer doesn't get its own click-driven close on every nav
  // link (that's a lot of onClick plumbing to thread through every item
  // below) - simpler and just as correct to close it whenever the route
  // itself changes, which covers every way of navigating away at once.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  };

  const isDashboard = pathname === "/dashboard";
  const isTickets = pathname?.startsWith("/tickets") ?? false;
  const isAdminArea = pathname === "/settings" || pathname === "/users";

  // Shared between the desktop (in-flow, collapsible) and mobile (always
  // full-width, no collapse toggle) renderings - `collapsed` and
  // `showCollapseToggle` are the only two things that differ between them.
  const renderNavBody = (collapsed: boolean, showCollapseToggle: boolean) => {
    const linkClass = (active: boolean) =>
      `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
        active
          ? "bg-medical-accent text-white"
          : "text-slate-200 hover:bg-white/10"
      } ${collapsed ? "justify-center" : ""}`;

    const label = (text: string) => (collapsed ? null : <span className="truncate">{text}</span>);

    return (
      <>
        <div className={`flex items-center gap-2 p-4 border-b border-white/10 ${collapsed ? "justify-center px-2" : ""}`}>
          <Image
            src="/images/delta-health-logo.png"
            alt="Delta Health Center"
            width={160}
            height={68}
            className="h-8 w-auto rounded bg-white p-1 shrink-0"
          />
          {!collapsed && <span className="font-bold text-sm leading-tight">IT Helpdesk Portal</span>}
        </div>

        {/* No overflow-y-auto here (even alone, it forces overflow-x: auto
            too per the CSS spec's "visible + non-visible = both become
            auto" rule), which would clip the flyout submenus below since
            they need to overflow horizontally past this container's right
            edge. The nav item list is short and fixed, so vertical
            scrolling isn't needed in practice. */}
        <div className="flex-1 p-3 flex flex-col gap-1">
          <Link href="/dashboard" className={linkClass(isDashboard)} title="Dashboard">
            <span aria-hidden>📊</span>
            {label("Dashboard")}
          </Link>

          {/* data-tour="new-ticket-button" on the parent item, not the "New
              Ticket" flyout child below - the onboarding tour's "Filing a
              Ticket" step spotlights this, and needs something that's
              always mounted (the flyout child only exists in the DOM while
              actually hovered). */}
          <FlyoutNavItem
            href="/tickets"
            icon="🎫"
            label="Tickets"
            active={isTickets}
            collapsed={collapsed}
            dataTour="new-ticket-button"
            items={[
              { href: "/tickets", label: "All Tickets", active: pathname === "/tickets" },
              { href: "/tickets/new", label: "New Ticket", active: pathname === "/tickets/new" },
            ]}
          />

          {role === "admin" && (
            <FlyoutNavItem
              href="/settings"
              icon="⚙️"
              label="Admin Settings"
              active={isAdminArea}
              collapsed={collapsed}
              items={[
                { href: "/settings", label: "General Settings", active: pathname === "/settings" },
                { href: "/users", label: "User Management", active: pathname === "/users" },
              ]}
            />
          )}

          <div className="my-2 border-t border-white/10" />

          {onHelpClick && (
            <button
              onClick={onHelpClick}
              className={linkClass(false) + " cursor-pointer"}
              title="Help"
            >
              <span aria-hidden>❓</span>
              {label("Help")}
            </button>
          )}
        </div>

        <div className={`p-3 border-t border-white/10 flex flex-col gap-1 ${collapsed ? "items-center" : ""}`}>
          {/* The 3-way segmented control doesn't shrink to an icon rail
              gracefully - only shown expanded, matching the "icons only"
              treatment collapsed mode gives everything else anyway. */}
          {!collapsed && (
            <div className="px-1 mb-1">
              <ThemeToggle />
            </div>
          )}
          <button
            onClick={async () => { await logout(); router.push("/login"); }}
            className={linkClass(false) + " cursor-pointer"}
            title="Logout"
          >
            <span aria-hidden>🚪</span>
            {label("Logout")}
          </button>
          {showCollapseToggle && (
            <button
              onClick={toggleCollapsed}
              className={linkClass(false) + " cursor-pointer text-slate-400"}
              title={collapsed ? "Expand menu" : "Collapse menu"}
            >
              <span aria-hidden>{collapsed ? "»" : "«"}</span>
              {label("Collapse Menu")}
            </button>
          )}
        </div>
      </>
    );
  };

  return (
    <>
      {/* Mobile top bar - replaces the permanent column below md. Fixed, so
          every page's own content wrapper needs top padding to clear it
          (pt-14 md:pt-0) instead of getting hidden underneath. */}
      <div className="md:hidden fixed top-0 inset-x-0 h-14 bg-medical-dark text-white flex items-center gap-3 px-4 z-40 shadow-md">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="text-2xl leading-none cursor-pointer w-8 h-8 flex items-center justify-center -ml-1"
        >
          ☰
        </button>
        <Image
          src="/images/delta-health-logo.png"
          alt="Delta Health Center"
          width={160}
          height={68}
          className="h-7 w-auto rounded bg-white p-0.5 shrink-0"
        />
        <span className="font-bold text-sm truncate">IT Helpdesk Portal</span>
      </div>

      {/* Backdrop - closes the drawer on an outside tap. */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* Mobile drawer - always full-width/expanded (no collapse toggle;
          "collapsed" is a desktop-only concept), slides in from the left. */}
      <nav
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-64 bg-medical-dark text-white flex flex-col transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Main navigation"
      >
        <button
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
          className="absolute top-3 right-3 text-xl leading-none text-slate-300 hover:text-white cursor-pointer w-8 h-8 flex items-center justify-center"
        >
          ✕
        </button>
        {renderNavBody(false, false)}
      </nav>

      {/* Desktop sidebar - unchanged from before, in-flow, collapsible.
          z-30 on the nav itself, not just the flyout inside it - a sticky
          element establishes its own local stacking context, so the
          flyout's z-30 was only ever being compared against other things
          inside this <nav>, never against the page's main content sitting
          right next to it. Without a z-index here, the nav (and everything
          inside it, flyout included) painted at its plain DOM-order
          position - which loses to main content, since that div comes
          later in the page's markup. */}
      <nav
        className={`hidden md:flex shrink-0 bg-medical-dark text-white flex-col h-screen sticky top-0 z-30 transition-[width] duration-150 ${
          collapsed ? "w-16" : "w-60"
        }`}
        aria-label="Main navigation"
      >
        {renderNavBody(collapsed, true)}
      </nav>
    </>
  );
}
