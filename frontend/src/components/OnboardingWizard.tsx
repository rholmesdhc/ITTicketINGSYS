"use client";
import { useEffect, useState } from "react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  role: string | null;
};

type Step = {
  icon: string;
  title: string;
  body: React.ReactNode;
  /**
   * Matches a `data-tour="<targetId>"` attribute on the real element to spot-
   * light. Optional - if omitted, or if no matching element exists on the
   * current page, the step falls back to a plain centered card (e.g. a step
   * describing something on a different page than the one the tour started
   * on, like the ticket detail page).
   */
  targetId?: string;
};

const REQUESTER_STEPS: Step[] = [
  {
    icon: "👋",
    title: "Welcome to the Clinical IT Portal",
    body: "This quick guide walks through how to file and track IT support tickets, highlighting each part of the screen as we go. Skip anytime, or reopen it later from the Help button.",
  },
  {
    icon: "➕",
    title: "Filing a Ticket",
    targetId: "new-ticket-button",
    body: (
      <>
        Click <strong>+ New Ticket</strong> to report an issue. Pick a category and priority (P1
        is critical patient-care impact, P4 is a general inquiry) - each priority sets an SLA
        deadline automatically. If you're reporting on behalf of a coworker, use the{" "}
        <strong>Affected Employee</strong> field to search them by name or email.
        <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-900/30 border-l-4 border-amber-500 text-amber-800 dark:text-amber-300 text-sm rounded-r">
          Never include patient names, DOBs, or MRNs in a ticket - that's Protected Health
          Information (PHI).
        </div>
      </>
    ),
  },
  {
    icon: "📊",
    title: "Your Dashboard",
    targetId: "kpi-cards",
    body: "These cards summarize your tickets, with a small arrow showing the trend vs. last week. Click any ticket's title in the table below to see its full details and SLA countdown.",
  },
  {
    icon: "🔍",
    title: "Finding a Ticket Fast",
    targetId: "search-filters",
    body: "Use the quick-filter tabs above, or this search bar, to find a ticket by title, description, or the employee it's about - plus dropdowns to narrow by status, priority, or category.",
  },
];

const TECH_STEPS: Step[] = [
  {
    icon: "🚦",
    title: "Triage at a Glance",
    targetId: "ticket-table",
    body: "Tickets past their SLA deadline are highlighted red with an OVERDUE badge and sorted to the top automatically. A banner also appears above when any tickets are breached - click it to jump straight to them.",
  },
  {
    icon: "⚡",
    title: "Working Tickets Fast",
    targetId: "bulk-select-header",
    body: (
      <>
        Change status or reassign a ticket directly from its row - no need to open it. Select
        multiple tickets with these checkboxes to bulk-resolve or bulk-reassign them at once. With
        tickets selected, keyboard shortcuts work too:
        <div className="mt-2 flex gap-2 flex-wrap">
          <span className="text-xs bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded px-2 py-1"><kbd>R</kbd> resolve selected</span>
          <span className="text-xs bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded px-2 py-1"><kbd>A</kbd> assign to me</span>
          <span className="text-xs bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded px-2 py-1"><kbd>Esc</kbd> clear selection</span>
        </div>
      </>
    ),
  },
  {
    icon: "🏥",
    title: "Affected Employee & Clinic Site",
    body: "Open any ticket to edit its Affected Employee and Clinic Site directly. Clinic Site defaults from that employee's primary site, but you can override it per-ticket - useful for mobile staff working a different location that day. Every change auto-saves; watch the bottom-right corner for confirmation.",
  },
  {
    icon: "📈",
    title: "Reporting",
    targetId: "export-csv",
    body: "The Technician Workload panel further up shows each tech's active ticket count and flags anyone overloaded. This Export CSV button grabs whatever's currently filtered/searched for reporting elsewhere.",
  },
];

const ADMIN_STEPS: Step[] = [
  {
    icon: "👥",
    title: "Managing Users",
    targetId: "primary-clinic-site-column",
    body: "From Admin Settings → User Management, create accounts, change roles, and set each employee's Primary Clinic Site - their usual home base. Leave it unset for staff who float between sites; individual tickets can still record where an issue actually happened.",
  },
];

const CLOSING_STEP: Step = {
  icon: "✅",
  title: "You're All Set",
  body: "That's the core workflow. Click the Help button in the header anytime to replay this guide.",
};

function buildSteps(role: string | null): Step[] {
  const isAdmin = role === "admin";
  const isAdminOrTech = role === "admin" || role === "technician";
  return [
    ...REQUESTER_STEPS,
    ...(isAdminOrTech ? TECH_STEPS : []),
    ...(isAdmin ? ADMIN_STEPS : []),
    CLOSING_STEP,
  ];
}

const TOOLTIP_WIDTH = 380;
const SPOTLIGHT_PADDING = 8;

export default function OnboardingWizard({ isOpen, onClose, role }: Props) {
  const steps = buildSteps(role);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const step = isOpen ? steps[stepIndex] : null;

  // Locate and spotlight the current step's real UI element, if it exists
  // on this page. Scrolls it into view once per step change; a separate
  // scroll/resize listener keeps the spotlight's position in sync without
  // re-triggering that scroll (which would otherwise fight the user).
  useEffect(() => {
    if (!step?.targetId) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${step.targetId}"]`) as HTMLElement | null;
    if (!el) {
      setTargetRect(null);
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });

    const updateRect = () => setTargetRect(el.getBoundingClientRect());
    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, isOpen]);

  if (!isOpen || !step) return null;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  const handleClose = () => {
    setStepIndex(0); // reset so replaying via the Help button starts from the top
    onClose();
  };

  const goNext = () => (isLast ? handleClose() : setStepIndex(i => i + 1));
  const goBack = () => setStepIndex(i => i - 1);

  const progressDots = (
    <div className="flex items-center justify-center gap-1.5 mb-4">
      {steps.map((_, i) => (
        <span key={i} className={`w-2 h-2 rounded-full ${i === stepIndex ? "bg-medical-blue" : "bg-slate-300 dark:bg-slate-600"}`} />
      ))}
    </div>
  );

  const controls = (
    <div className="flex items-center justify-between">
      <button onClick={handleClose} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer font-semibold">
        Skip
      </button>
      <div className="flex gap-2">
        {!isFirst && (
          <button onClick={goBack} className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer font-semibold">
            Back
          </button>
        )}
        <button onClick={goNext} className="px-5 py-2 bg-medical-blue hover:bg-medical-dark text-white rounded transition-colors cursor-pointer font-semibold">
          {isLast ? "Get Started" : "Next →"}
        </button>
      </div>
    </div>
  );

  const cardContent = (
    <>
      <div className="text-4xl mb-3">{step.icon}</div>
      <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">{step.title}</h3>
      <div className="text-slate-600 dark:text-slate-300 leading-relaxed text-sm mb-4">{step.body}</div>
      {progressDots}
      {controls}
    </>
  );

  // No spotlight target (either this step has none, or it wasn't found on
  // the current page) - fall back to a plain centered modal.
  if (!targetRect) {
    return (
      <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg w-full max-w-lg p-8">
          <div className="text-5xl mb-4">{step.icon}</div>
          <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-3">{step.title}</h3>
          <div className="text-slate-600 dark:text-slate-300 leading-relaxed mb-6">{step.body}</div>
          {progressDots}
          {controls}
        </div>
      </div>
    );
  }

  // Spotlight mode: a small fixed box exactly around the target, whose huge
  // box-shadow dims the rest of the viewport (the classic dependency-free
  // "cutout" technique - the shadow extends visually past the box's own
  // edges without needing an SVG mask or multiple overlay divs).
  const spotlightStyle: React.CSSProperties = {
    position: "fixed",
    top: targetRect.top - SPOTLIGHT_PADDING,
    left: targetRect.left - SPOTLIGHT_PADDING,
    width: targetRect.width + SPOTLIGHT_PADDING * 2,
    height: targetRect.height + SPOTLIGHT_PADDING * 2,
    borderRadius: 10,
    boxShadow: "0 0 0 3px #2563eb, 0 0 0 9999px rgba(15, 23, 42, 0.6)",
    pointerEvents: "none",
    zIndex: 51,
    transition: "top 0.3s ease, left 0.3s ease, width 0.3s ease, height 0.3s ease",
  };

  // Prefer placing the tooltip below the target; flip above if there's not
  // enough room. Clamp horizontally so it never runs off-screen.
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1024;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 768;
  const spaceBelow = viewportH - targetRect.bottom;
  const placeBelow = spaceBelow > 260 || targetRect.top < 260;
  let left = targetRect.left;
  if (left + TOOLTIP_WIDTH > viewportW - 16) left = viewportW - TOOLTIP_WIDTH - 16;
  if (left < 16) left = 16;

  const tooltipStyle: React.CSSProperties = {
    position: "fixed",
    left,
    width: TOOLTIP_WIDTH,
    ...(placeBelow ? { top: targetRect.bottom + 16 } : { bottom: viewportH - targetRect.top + 16 }),
    zIndex: 52,
    transition: "top 0.3s ease, left 0.3s ease, bottom 0.3s ease",
  };

  return (
    <>
      {/* Blocks interaction with the rest of the page while the tour is
          active. Transparent - the spotlight box's shadow provides the
          actual dimming visual, this just captures/swallows clicks so an
          accidental click on the dimmed area can't dismiss the tour. */}
      <div className="fixed inset-0 z-50" />
      <div style={spotlightStyle} />
      <div style={tooltipStyle} className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-6">
        {cardContent}
      </div>
    </>
  );
}
