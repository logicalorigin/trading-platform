import {
  ONBOARDING_CATALOG,
  ONBOARDING_SAFETY_VERSION,
  type OnboardingCatalogStep,
} from "./onboardingCatalog";
import {
  normalizeOnboardingProgress,
  type OnboardingProgress,
  type OnboardingProgressAction,
} from "./onboardingModel";
import type { ConnectAccountReadiness } from "./onboardingRuntimeFacts";
import type {
  OnboardingGoalPresentation,
  OnboardingReadinessPresentation,
} from "./OnboardingGoalPicker";

const PILOT_TRACK_ID = "connect-account";
const ACTION_NOUNS: Record<string, string> = {
  "connect-account": "account setup",
  "read-signal": "signal walkthrough",
  "practice-review": "practice review",
  "manage-risk": "risk walkthrough",
};
export type AccountObservationState = "loading" | "ready" | "stale" | "error";

export const onboardingEssentialsComplete = (
  value: OnboardingProgress,
): boolean => {
  const progress = normalizeOnboardingProgress(value);
  return (
    progress.requiredAcknowledgedVersion >= ONBOARDING_SAFETY_VERSION &&
    progress.readinessInspectedVersion >= ONBOARDING_SAFETY_VERSION
  );
};

export const findCurrentOnboardingStep = (
  value: OnboardingProgress,
): OnboardingCatalogStep | null => {
  const progress = normalizeOnboardingProgress(value);
  const track = ONBOARDING_CATALOG.tracks.find(
    (entry) => entry.id === progress.activeTrackId,
  );
  const trackProgress = track ? progress.tracks[track.id] : null;
  if (!track || !trackProgress) return null;
  return (
    track.steps.find(
      (step) => !trackProgress.completedStepIds.includes(step.id),
    ) ?? null
  );
};

export const buildGoalPresentations = (
  value: OnboardingProgress,
  connectReadiness: ConnectAccountReadiness,
  accountState: AccountObservationState = "ready",
): OnboardingGoalPresentation[] => {
  const progress = normalizeOnboardingProgress(value);
  return ONBOARDING_CATALOG.tracks
    .filter((track) => !track.required)
    .map((track) => {
      const trackProgress = progress.tracks[track.id];
      const isPilot = track.id === PILOT_TRACK_ID;
      const historicalConnectCompletion =
        isPilot && trackProgress.status === "completed";
      const priorConnectCompletion =
        historicalConnectCompletion ||
        (isPilot && Boolean(trackProgress.completedAt));
      let state: OnboardingGoalPresentation["state"];
      if (!isPilot && trackProgress.status !== "completed") {
        state = "unavailable";
      } else if (
        historicalConnectCompletion &&
        accountState === "loading"
      ) {
        state = "checking";
      } else if (
        historicalConnectCompletion &&
        accountState === "stale"
      ) {
        state = "stale";
      } else if (
        historicalConnectCompletion &&
        accountState === "error"
      ) {
        state = "status-unavailable";
      } else if (
        historicalConnectCompletion &&
        !connectReadiness.satisfied
      ) {
        state = "setup-needed";
      } else if (trackProgress.status === "completed") {
        state = "completed";
      } else if (trackProgress.status === "active") {
        state = "active";
      } else if (
        trackProgress.completedStepIds.length > 0 ||
        trackProgress.lastStepId
      ) {
        state = "paused";
      } else if (isPilot && !connectReadiness.satisfied) {
        state = "setup-needed";
      } else {
        state = "available";
      }

      return {
        id: track.id,
        title: track.label,
        description: track.description,
        actionNoun: ACTION_NOUNS[track.id] ?? "walkthrough",
        completedSteps: trackProgress.completedStepIds.length,
        totalSteps: track.steps.length,
        state,
        unavailableReason:
          state === "unavailable"
            ? "Available after the Connect Account pilot review."
            : undefined,
        priorCompletionRetained:
          priorConnectCompletion && state !== "completed",
        retryable:
          historicalConnectCompletion &&
          (state === "stale" || state === "status-unavailable"),
      };
    });
};

export const selectConnectAccountAction = (
  value: OnboardingProgress,
  accountState: AccountObservationState,
  connectReadiness: ConnectAccountReadiness,
): OnboardingProgressAction | null => {
  const progress = normalizeOnboardingProgress(value);
  const track = progress.tracks[PILOT_TRACK_ID];
  if (track.status !== "completed") {
    return { type: "activate-track", trackId: PILOT_TRACK_ID };
  }
  if (accountState !== "ready") return null;
  if (!connectReadiness.satisfied) {
    return {
      type: "review-runtime-step",
      trackId: PILOT_TRACK_ID,
      stepId: "verify-readiness",
    };
  }
  return { type: "replay-track", trackId: PILOT_TRACK_ID };
};

type ReadinessInput = {
  sessionState: "loading" | "ready" | "error";
  dataConfigured: boolean;
  accountState: AccountObservationState;
  connectReadiness: ConnectAccountReadiness;
};

export const buildReadinessPresentations = ({
  sessionState,
  dataConfigured,
  accountState,
  connectReadiness,
}: ReadinessInput): OnboardingReadinessPresentation[] => {
  const data =
    sessionState === "loading"
      ? { status: "Checking", tone: "neutral" as const }
      : sessionState === "error"
        ? { status: "Status unavailable", tone: "danger" as const }
        : dataConfigured
          ? { status: "Configured", tone: "ready" as const }
          : { status: "Setup needed", tone: "warning" as const };
  const provider =
    accountState === "loading"
      ? { status: "Checking", tone: "neutral" as const }
      : accountState === "stale"
        ? { status: "Stale", tone: "warning" as const }
      : accountState === "error"
        ? { status: "Status unavailable", tone: "danger" as const }
        : connectReadiness.accountCount > 0
          ? { status: "Available", tone: "ready" as const }
          : { status: "Setup needed", tone: "warning" as const };
  const account =
    accountState === "loading"
      ? { status: "Checking", tone: "neutral" as const }
      : accountState === "stale"
        ? { status: "Stale", tone: "warning" as const }
      : accountState === "error"
        ? { status: "Status unavailable", tone: "danger" as const }
        : connectReadiness.satisfied
          ? { status: "Connection verified", tone: "ready" as const }
          : { status: "Setup needed", tone: "warning" as const };

  return [
    { id: "data", label: "Data", ...data },
    { id: "provider", label: "Provider", ...provider },
    { id: "account", label: "Account", ...account },
  ];
};
