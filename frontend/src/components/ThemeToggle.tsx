"use client";
import { useTheme, type Theme } from "@/components/ThemeProvider";

const OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "☀️" },
  { value: "system", label: "System", icon: "🖥️" },
  { value: "dark", label: "Dark", icon: "🌙" },
];

type Props = {
  /** "header": translucent-white-on-blue, matches the Help/Logout buttons
   *  in every page's medical-blue header bar. "standalone": neutral card
   *  style for pages with no colored header to sit on (just the login page
   *  today). */
  variant?: "header" | "standalone";
};

/** Three-way segmented control for light/system/dark. */
export default function ThemeToggle({ variant = "header" }: Props) {
  const { theme, setTheme } = useTheme();
  const containerClass =
    variant === "header"
      ? "border-white/40"
      : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-sm";
  return (
    <div className={`flex items-center gap-0.5 border rounded-lg p-0.5 ${containerClass}`} role="group" aria-label="Display theme">
      {OPTIONS.map(opt => {
        const active = theme === opt.value;
        const buttonClass =
          variant === "header"
            ? active
              ? "bg-white/25 text-white"
              : "text-white/70 hover:text-white hover:bg-white/10"
            : active
            ? "bg-slate-100 dark:bg-slate-700 text-medical-blue dark:text-white"
            : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700";
        return (
          <button
            key={opt.value}
            onClick={() => setTheme(opt.value)}
            title={opt.label}
            aria-label={opt.label}
            aria-pressed={active}
            className={`text-sm px-2 py-1 rounded-md transition-colors cursor-pointer ${buttonClass}`}
          >
            {opt.icon}
          </button>
        );
      })}
    </div>
  );
}
