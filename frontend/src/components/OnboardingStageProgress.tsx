"use client";

// Shared by the onboarding list page (compact strip per candidate, for an
// IT Manager scanning every active onboarding at once) and the batch
// detail page (full stepper, for whoever's actually working a candidate's
// checklist) - one component so the two views can never silently drift
// out of sync on stage labels/ordering.

export type OnboardingProgressTask = {
  task_name: string;
  assigned_role: string;
  status: string;
  triggers_stage1_handoff: boolean;
};

const STAGES: { key: string; label: string }[] = [
  { key: "it_identity", label: "IT Identity" },
  // Labeled "Access Provisioning" rather than the backend's literal
  // ehr_provisioning key - this stage already covers more than EHR access
  // even in v1 (Dexis/FastAttach for Dental), and v1.1 adds QuickBooks on
  // top, so the UI label is deliberately broader than the stored value.
  { key: "ehr_provisioning", label: "Access Provisioning" },
  { key: "clinical_training", label: "Training" },
  { key: "ready", label: "Ready" },
];

// Buckets a candidate's tasks by which of the 4 macro-stages they belong
// to - presentation-only grouping, mirrors (but doesn't replace) the
// authoritative grouping in backend main.py's _recompute_candidate_stage.
// candidate.stage itself, computed server-side, is still what actually
// decides which stage is "current" here - this is only used to show a
// task-completion count within the current stage.
function tasksForStage(tasks: OnboardingProgressTask[], stageKey: string): OnboardingProgressTask[] {
  const isTraining = (t: OnboardingProgressTask) => t.assigned_role === "CLINICAL_TRAINER" || t.assigned_role === "DENTAL_TRAINER";
  if (stageKey === "it_identity") return tasks.filter(t => t.triggers_stage1_handoff);
  if (stageKey === "ehr_provisioning") {
    // "Equipment Issued" (v1.1) doesn't gate anything and isn't part of
    // this stage's completion count, same exclusion as the backend.
    return tasks.filter(t => !t.triggers_stage1_handoff && !isTraining(t) && t.task_name !== "Equipment Issued");
  }
  if (stageKey === "clinical_training") return tasks.filter(isTraining);
  return [];
}

type Props = {
  stage: string;
  tasks?: OnboardingProgressTask[];
  /** Compact = a small segmented strip (onboarding list page - many
   * candidates visible at once, no room for a full stepper). Omitted/false
   * = full stepper with stage labels and a task-completion count under the
   * current stage (batch detail page - one candidate at a time). */
  compact?: boolean;
};

export default function OnboardingStageProgress({ stage, tasks = [], compact }: Props) {
  const currentIndex = Math.max(0, STAGES.findIndex(s => s.key === stage));

  if (compact) {
    return (
      <div className="flex items-center gap-1.5" title={STAGES[currentIndex]?.label}>
        <div className="flex gap-0.5">
          {STAGES.map((s, i) => (
            <div
              key={s.key}
              className={`h-1.5 w-5 rounded-full ${
                i < currentIndex ? "bg-emerald-500" : i === currentIndex ? "bg-medical-accent" : "bg-slate-200 dark:bg-slate-600"
              }`}
            />
          ))}
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">
          {STAGES[currentIndex]?.label}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start w-full py-1">
      {STAGES.map((s, i) => {
        const isDone = i < currentIndex;
        const isCurrent = i === currentIndex;
        const stageTasks = tasksForStage(tasks, s.key);
        const doneCount = stageTasks.filter(t => t.status === "completed").length;
        return (
          <div key={s.key} className="flex items-start flex-1 last:flex-none">
            {/* w-14/sm:w-20 - narrow enough at phone width for all 4 nodes
                to fit without the overflow-x-auto wrapper below kicking in
                (it did, silently, at 390px before this - the 4th node
                scrolled out of view with no visual hint it was there). */}
            <div className="flex flex-col items-center gap-1 shrink-0 w-14 sm:w-20">
              <div
                aria-label={`${s.label}: ${isDone ? "complete" : isCurrent ? "in progress" : "not started"}`}
                className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-[11px] sm:text-xs font-bold border-2 shrink-0 ${
                  isDone
                    ? "bg-emerald-500 border-emerald-500 text-white"
                    : isCurrent
                    ? "bg-medical-accent border-medical-accent text-white"
                    : "bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500"
                }`}
              >
                {isDone ? "✓" : i + 1}
              </div>
              <span
                className={`text-[10px] sm:text-[11px] font-semibold text-center leading-tight ${
                  isCurrent
                    ? "text-medical-accent"
                    : isDone
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-slate-400 dark:text-slate-500"
                }`}
              >
                {s.label}
              </span>
              {isCurrent && stageTasks.length > 0 && (
                <span className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500">{doneCount}/{stageTasks.length} tasks</span>
              )}
            </div>
            {i < STAGES.length - 1 && (
              <div className={`h-0.5 flex-1 mt-3 sm:mt-3.5 mx-0.5 sm:mx-1 ${i < currentIndex ? "bg-emerald-500" : "bg-slate-200 dark:bg-slate-600"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
