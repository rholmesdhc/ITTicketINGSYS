"use client";
import { useEffect, useRef, useState } from "react";
import { API_BASE_URL, isUnauthorized } from "@/lib/api";

type Employee = {
  id: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
};

type Props = {
  /** Currently selected employee's user id, or null if none selected. */
  value: number | null;
  onChange: (userId: number | null) => void;
  placeholder?: string;
  required?: boolean;
};

/**
 * Search-as-you-type dropdown for picking an employee by email.
 * Fetches the lightweight /users/directory list once and filters
 * client-side (dataset is small - a couple hundred employees at most).
 */
export default function EmployeeEmailSelect({ value, onChange, placeholder, required }: Props) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    fetch(`${API_BASE_URL}/users/directory`, {
      headers: { "Authorization": `Bearer ${token}` }
    })
      .then(res => {
        if (isUnauthorized(res)) return [];
        return res.ok ? res.json() : [];
      })
      .then((data: Employee[]) => setEmployees(data))
      .catch(() => setEmployees([]));
  }, []);

  // Keep the visible text in sync with the selected id (e.g. when editing
  // an existing ticket that already has an affected employee).
  useEffect(() => {
    if (value == null) {
      setQuery("");
      return;
    }
    const selected = employees.find(e => e.id === value);
    if (selected) setQuery(formatLabel(selected));
  }, [value, employees]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function formatLabel(e: Employee) {
    const name = [e.first_name, e.last_name].filter(Boolean).join(" ");
    return name ? `${name} <${e.email}>` : (e.email || "");
  }

  const filtered = query.trim() === ""
    ? employees
    : employees.filter(e => {
        const haystack = `${e.email || ""} ${e.first_name || ""} ${e.last_name || ""}`.toLowerCase();
        return haystack.includes(query.trim().toLowerCase());
      });

  const handleSelect = (employee: Employee) => {
    onChange(employee.id);
    setQuery(formatLabel(employee));
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setIsOpen(true);
    setHighlightedIndex(0);
    if (value !== null) onChange(null); // typing invalidates the previous selection
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const match = filtered[highlightedIndex];
      if (match) handleSelect(match);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        required={required}
        autoComplete="off"
        placeholder={placeholder || "Search by name or email..."}
        className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-medical-accent focus:outline-none"
        value={query}
        onChange={handleInputChange}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {isOpen && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg">
          {filtered.map((employee, index) => (
            <li
              key={employee.id}
              onMouseDown={() => handleSelect(employee)}
              onMouseEnter={() => setHighlightedIndex(index)}
              className={`px-4 py-2 cursor-pointer text-sm ${
                index === highlightedIndex ? "bg-sky-50 dark:bg-sky-900/40 text-sky-800 dark:text-sky-300" : "text-slate-700 dark:text-slate-200"
              }`}
            >
              <div className="font-medium">{[employee.first_name, employee.last_name].filter(Boolean).join(" ") || "(no name on file)"}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{employee.email}</div>
            </li>
          ))}
        </ul>
      )}
      {isOpen && filtered.length === 0 && (
        <div className="absolute z-10 mt-1 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg px-4 py-2 text-sm text-slate-500 dark:text-slate-400">
          No matching employees.
        </div>
      )}
    </div>
  );
}
