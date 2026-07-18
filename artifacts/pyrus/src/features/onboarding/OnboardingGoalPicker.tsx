import { useRef } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Pause,
  Play,
  RefreshCcw,
} from "lucide-react";

// @ts-expect-error JSX module imported into TypeScript context
import { StatusPill } from "../../components/platform/primitives.jsx";
// @ts-expect-error JSX module imported into TypeScript context
import { Button } from "../../components/ui/Button.jsx";
// @ts-expect-error JSX module imported into TypeScript context
import { CSS_COLOR } from "../../lib/uiTokens.jsx";
import {
  OnboardingSurface,
  type OnboardingPresentation,
} from "./OnboardingSurface";

export type OnboardingGoalState =
  | "available"
  | "active"
  | "paused"
  | "completed"
  | "updated"
  | "setup-needed"
  | "checking"
  | "stale"
  | "status-unavailable"
  | "unavailable";

export type OnboardingStatusTone =
  | "neutral"
  | "accent"
  | "ready"
  | "warning"
  | "danger";

export type OnboardingReadinessPresentation = {
  id: string;
  label: string;
  status: string;
  tone: OnboardingStatusTone;
};

export type OnboardingGoalPresentation = {
  id: string;
  title: string;
  description: string;
  actionNoun: string;
  completedSteps: number;
  totalSteps: number;
  state: OnboardingGoalState;
  unavailableReason?: string;
  retryable?: boolean;
  priorCompletionRetained?: boolean;
};

export type OnboardingGoalPickerProps = {
  open: boolean;
  goals: readonly OnboardingGoalPresentation[];
  readiness: readonly OnboardingReadinessPresentation[];
  essentialsComplete: boolean;
  recommendedGoalId?: string | null;
  syncLabel?: string | null;
  loading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  onClose: () => void;
  onReviewEssentials: () => void;
  onSelectGoal: (goalId: string) => void;
  presentation?: OnboardingPresentation;
};

const toneColor = (tone: OnboardingStatusTone) => {
  switch (tone) {
    case "accent":
      return CSS_COLOR.accent;
    case "ready":
      return CSS_COLOR.green;
    case "warning":
      return CSS_COLOR.amber;
    case "danger":
      return CSS_COLOR.red;
    default:
      return CSS_COLOR.textMuted;
  }
};

const goalStateLabel = (goal: OnboardingGoalPresentation) => {
  const progress = `${goal.completedSteps}/${goal.totalSteps}`;
  switch (goal.state) {
    case "active":
      return `Current · ${progress}`;
    case "paused":
      return `Paused · ${progress}`;
    case "completed":
      return `Complete · ${progress}`;
    case "updated":
      return `Updated · ${progress}`;
    case "setup-needed":
      return `Setup needed · ${progress}`;
    case "checking":
      return `Checking · ${progress}`;
    case "stale":
      return `Stale · ${progress}`;
    case "status-unavailable":
      return `Status unavailable · ${progress}`;
    case "unavailable":
      return `Unavailable · ${goal.unavailableReason || "Try again later"}`;
    default:
      return `Available · ${progress}`;
  }
};

const goalStateTone = (
  state: OnboardingGoalState,
): OnboardingStatusTone => {
  if (state === "completed") return "ready";
  if (
    state === "updated" ||
    state === "setup-needed" ||
    state === "stale"
  ) {
    return "warning";
  }
  if (state === "unavailable" || state === "status-unavailable") {
    return "danger";
  }
  if (state === "active") return "accent";
  return "neutral";
};

const goalActionLabel = (goal: OnboardingGoalPresentation) => {
  switch (goal.state) {
    case "active":
    case "paused":
      return `Resume ${goal.actionNoun}`;
    case "completed":
      return `Replay ${goal.actionNoun}`;
    case "updated":
      return `Review updates to ${goal.actionNoun}`;
    case "setup-needed":
      return goal.priorCompletionRetained
        ? `Review ${goal.actionNoun}`
        : `Start ${goal.actionNoun}`;
    case "checking":
    case "stale":
    case "status-unavailable":
    case "unavailable":
      return goal.retryable ? `Retry ${goal.actionNoun}` : null;
    default:
      return `Start ${goal.actionNoun}`;
  }
};

const GoalStateIcon = ({ state }: { state: OnboardingGoalState }) => {
  const iconProps = {
    "aria-hidden": true,
    size: 16,
    strokeWidth: 1.8,
  } as const;
  if (state === "active") return <Play {...iconProps} />;
  if (state === "paused") return <Pause {...iconProps} />;
  if (state === "completed") return <Check {...iconProps} />;
  if (state === "updated" || state === "checking" || state === "stale") {
    return <RefreshCcw {...iconProps} />;
  }
  if (state === "unavailable" || state === "status-unavailable") {
    return <AlertTriangle {...iconProps} />;
  }
  return <Play {...iconProps} />;
};

export function OnboardingGoalPicker({
  open,
  goals,
  readiness,
  essentialsComplete,
  recommendedGoalId = null,
  syncLabel = null,
  loading = false,
  errorMessage = null,
  onRetry,
  onClose,
  onReviewEssentials,
  onSelectGoal,
  presentation = "auto",
}: OnboardingGoalPickerProps) {
  const reviewEssentialsRef = useRef<HTMLButtonElement>(null);
  const initialGoalRef = useRef<HTMLButtonElement>(null);
  const recommended = goals.find((goal) => goal.id === recommendedGoalId);
  const orderedGoals = recommended
    ? [recommended, ...goals.filter((goal) => goal.id !== recommendedGoalId)]
    : goals;
  const resumableGoal = orderedGoals.find(
    (goal) => goal.state === "active" || goal.state === "paused",
  );
  const initialGoalId =
    resumableGoal?.id ||
    orderedGoals.find((goal) => goal.id === recommendedGoalId)?.id ||
    orderedGoals.find((goal) => goalActionLabel(goal))?.id;
  const allComplete =
    goals.length > 0 && goals.every((goal) => goal.state === "completed");
  const initialFocusRef = essentialsComplete
    ? initialGoalRef
    : reviewEssentialsRef;

  return (
    <OnboardingSurface
      open={open}
      title="Getting Started"
      description="Choose one goal. Pause or close at any time."
      closeLabel="Close and pause Getting Started"
      onClose={onClose}
      initialFocusRef={initialFocusRef}
      presentation={presentation}
      testId="onboarding-goal-picker"
    >
      <section
        className="onboarding-readiness-band"
        aria-label="Current onboarding readiness"
      >
        <div className="onboarding-readiness-heading">
          <span>Current readiness</span>
          {syncLabel ? (
            <span className="onboarding-sync-label">{syncLabel}</span>
          ) : null}
        </div>
        <dl className="onboarding-readiness-list">
          {readiness.map((item) => (
            <div className="onboarding-readiness-item" key={item.id}>
              <dt>{item.label}</dt>
              <dd>
                <StatusPill
                  color={toneColor(item.tone)}
                  variant="ghost"
                >
                  {item.status}
                </StatusPill>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {!essentialsComplete ? (
        <section
          className="onboarding-essentials-gate"
          aria-labelledby="onboarding-essentials-gate-title"
        >
          <div>
            <h2 id="onboarding-essentials-gate-title">
              Safety essentials
            </h2>
            <p>
              Confirm the environment, execution boundary, and current
              readiness.
            </p>
          </div>
          <div className="onboarding-essentials-action">
            <Button
              ref={reviewEssentialsRef}
              variant="primary"
              onClick={onReviewEssentials}
            >
              Review essentials
            </Button>
          </div>
        </section>
      ) : null}
      {errorMessage ? (
        <div className="onboarding-inline-warning" role="alert">
          <span>{errorMessage}</span>
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}

      <section
        className="onboarding-goals"
        aria-labelledby="onboarding-goals-title"
      >
        <div className="onboarding-section-heading">
          <h2 id="onboarding-goals-title">Choose a goal</h2>
          {allComplete ? (
            <p>4 of 4 goals complete. Replay any goal when you need it.</p>
          ) : null}
        </div>
        {loading ? (
          <div
            className="onboarding-goal-skeleton-list"
            aria-busy="true"
            aria-label="Loading Getting Started goals"
          >
            {Array.from({ length: 4 }, (_, index) => (
              <span
                className="onboarding-goal-skeleton"
                key={index}
              />
            ))}
          </div>
        ) : (
          <ol
            className="onboarding-goal-list"
            aria-label="Getting Started goals"
          >
            {orderedGoals.map((goal) => {
              const descriptionId = `onboarding-goal-${goal.id}-description`;
              const statusId = `onboarding-goal-${goal.id}-status`;
              const actionLabel = essentialsComplete
                ? goalActionLabel(goal)
                : null;
              const isRecommended = goal.id === recommendedGoalId;
              const visibleStatus = essentialsComplete
                ? goalStateLabel(goal)
                : "Review essentials first";
              const accessibleStatus = [
                isRecommended ? "Recommended." : null,
                visibleStatus,
                goal.priorCompletionRetained
                  ? "Prior completion retained."
                  : null,
              ]
                .filter(Boolean)
                .join(" ");
              const content = (
                <>
                  <span
                    className="onboarding-goal-icon"
                    data-tone={goalStateTone(goal.state)}
                  >
                    <GoalStateIcon state={goal.state} />
                  </span>
                  <span className="onboarding-goal-copy">
                    <span className="onboarding-goal-title-line">
                      <span className="onboarding-goal-title">
                        {goal.title}
                      </span>
                      {isRecommended ? (
                        <span className="onboarding-recommended-label">
                          Recommended
                        </span>
                      ) : null}
                    </span>
                    <span
                      className="onboarding-goal-description"
                      id={descriptionId}
                    >
                      {goal.description}
                    </span>
                    <span
                      className="onboarding-goal-phone-status"
                      aria-hidden="true"
                    >
                      {visibleStatus}
                    </span>
                    {goal.priorCompletionRetained ? (
                      <span className="onboarding-retained-copy">
                        Prior completion retained.
                      </span>
                    ) : null}
                  </span>
                  <span className="onboarding-sr-only" id={statusId}>
                    {accessibleStatus}
                  </span>
                  <span
                    className="onboarding-goal-status"
                    aria-hidden="true"
                  >
                    {!essentialsComplete ? (
                      <span>Review essentials first</span>
                    ) : (
                      <StatusPill
                        color={toneColor(goalStateTone(goal.state))}
                        variant="ghost"
                      >
                        {goalStateLabel(goal)}
                      </StatusPill>
                    )}
                  </span>
                  {actionLabel ? (
                    <ChevronRight
                      className="onboarding-goal-chevron"
                      aria-hidden="true"
                      size={16}
                      strokeWidth={1.8}
                    />
                  ) : null}
                </>
              );

              return (
                <li
                  className="onboarding-goal-item"
                  data-recommended={isRecommended || undefined}
                  key={goal.id}
                >
                  {actionLabel ? (
                    <button
                      ref={
                        goal.id === initialGoalId
                          ? initialGoalRef
                          : undefined
                      }
                      className="onboarding-goal-row"
                      type="button"
                      aria-label={actionLabel}
                      aria-describedby={`${descriptionId} ${statusId}`}
                      aria-current={goal.state === "active" ? "step" : undefined}
                      onClick={() => onSelectGoal(goal.id)}
                    >
                      {content}
                    </button>
                  ) : (
                    <div
                      className="onboarding-goal-row onboarding-goal-row-static"
                      role="group"
                      aria-label={goal.title}
                      aria-describedby={`${descriptionId} ${statusId}`}
                    >
                      {content}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </OnboardingSurface>
  );
}
