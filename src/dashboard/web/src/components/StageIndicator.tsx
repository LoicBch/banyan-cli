/**
 * Horizontal stage timeline rendered on each feature card. Visualises
 * where the feature is in its lifecycle from a quick glance:
 *
 *   ── Setup ── Plan ── Execute ── Report ── Done ──
 *
 * The backend exposes 6 stages (created/planning/approval/working/
 * reported/merged). We collapse them into 5 UI stages because
 * "planning" and "approval" are sub-states of "the agent is building
 * a plan" from the user's POV — they don't deserve separate columns
 * in the timeline.
 *
 *   created            → Setup
 *   planning + approval → Plan
 *   working            → Execute
 *   reported           → Report
 *   merged             → Done
 *
 * A pulsing emerald dot on a stage = "your move" (plan or report
 * awaiting review). A red ring on a stage = an off-pipeline flag
 * (rejected / blocked / needs_review).
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import type { FeatureState } from "@/lib/api";

interface StageIndicatorProps {
  feature: FeatureState;
}

interface UIStage {
  key: string;
  label: string;
  matches: string[];
}

const UI_STAGES: UIStage[] = [
  { key: "setup", label: "Setup", matches: ["created"] },
  { key: "plan", label: "Plan", matches: ["planning", "approval"] },
  { key: "execute", label: "Execute", matches: ["working"] },
  { key: "report", label: "Report", matches: ["reported"] },
  { key: "done", label: "Done", matches: ["merged"] },
];

export function StageIndicator({ feature }: StageIndicatorProps): React.JSX.Element | null {
  // No backend stage at all → don't render the bar (live features that
  // never registered an approval / report keep the card uncluttered).
  if (!feature.stage) return null;

  const currentIdx = UI_STAGES.findIndex((s) => s.matches.includes(feature.stage!));
  // Unknown stage from a future backend → bail out silently rather than
  // render a confusing blank bar.
  if (currentIdx < 0) return null;

  const planNeedsAction = feature.approval?.status === "pending";
  const reportNeedsAction =
    feature.latestReport?.status === "done" &&
    feature.reportApproval?.status === "pending";
  const planFlag = feature.approval?.status === "rejected";
  const executeFlag = feature.flag === "blocked" || feature.flag === "needs_review";

  return (
    <div className="flex items-center gap-1.5 pt-1">
      {UI_STAGES.map((s, i) => {
        const isComplete = i < currentIdx;
        const isCurrent = i === currentIdx;
        const isFuture = i > currentIdx;
        const needsAction =
          (s.key === "plan" && planNeedsAction) ||
          (s.key === "report" && reportNeedsAction);
        const hasFlag =
          (s.key === "plan" && planFlag) || (s.key === "execute" && executeFlag);

        return (
          <React.Fragment key={s.key}>
            <div className="flex flex-col items-center gap-1 min-w-0 shrink-0">
              <div className="relative">
                <span
                  className={cn(
                    "block size-2 rounded-full transition-colors",
                    isComplete && "bg-emerald-500",
                    isCurrent && !needsAction && !hasFlag && "bg-foreground ring-2 ring-foreground/20",
                    isCurrent && needsAction && "bg-emerald-500 ring-2 ring-emerald-500/30 animate-pulse",
                    isCurrent && hasFlag && "bg-amber-500 ring-2 ring-amber-500/30",
                    isFuture && "bg-muted-foreground/30",
                  )}
                />
                {hasFlag ? (
                  <span className="absolute -top-0.5 -right-0.5 size-1 rounded-full bg-amber-500 animate-pulse" />
                ) : null}
              </div>
              <span
                className={cn(
                  "text-[9px] font-medium uppercase tracking-wider transition-colors",
                  isComplete && "text-foreground/70",
                  isCurrent && "text-foreground",
                  isFuture && "text-muted-foreground/40",
                )}
              >
                {s.label}
              </span>
            </div>
            {i < UI_STAGES.length - 1 ? (
              <div
                className={cn(
                  "h-px flex-1 -mt-3 transition-colors",
                  isComplete ? "bg-emerald-500/40" : "bg-muted-foreground/20",
                )}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}
