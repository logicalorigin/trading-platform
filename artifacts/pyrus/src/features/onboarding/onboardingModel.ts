import {
  ONBOARDING_CATALOG,
  ONBOARDING_CATALOG_VERSION,
  ONBOARDING_SAFETY_VERSION,
  type OnboardingCompletionKey,
  type OnboardingCompletionOwner,
} from "./onboardingCatalog";

export const ONBOARDING_LIMITS = {
  maxCompletionHistoryPerTrack: 32,
} as const;

export type OnboardingTrackStatus = "active" | "paused" | "completed";

export type OnboardingStepCompletion = {
  stepId: string;
  completedAt: string;
};

export type OnboardingTrackProgress = {
  catalogVersion: number;
  status: OnboardingTrackStatus;
  lastStepId: string | null;
  completedStepIds: string[];
  completionHistory: OnboardingStepCompletion[];
  completedAt: string | null;
};

export type OnboardingProgress = {
  schemaVersion: 1;
  autoOpenShownVersion: number;
  requiredNoticeSeenVersion: number;
  requiredNoticeResolvedVersion: number;
  requiredAcknowledgedVersion: number;
  readinessInspectedVersion: number;
  activeTrackId: string | null;
  tracks: Record<string, OnboardingTrackProgress>;
};

export type OnboardingProgressAction =
  | { type: "mark-auto-open-shown" }
  | { type: "activate-track"; trackId: string }
  | { type: "pause-active-track"; trackId: string }
  | { type: "replay-track"; trackId: string }
  | { type: "review-runtime-step"; trackId: string; stepId: string }
  | {
      type: "complete-current-step";
      trackId: string;
      stepId: string;
      owner: OnboardingCompletionOwner;
      evidenceKey?: OnboardingCompletionKey;
      completedAt: string;
    };

type JsonRecord = Record<string, unknown>;

const recordValue = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const versionValue = (value: unknown, current: number): number =>
  Number.isInteger(value) && Number(value) >= 0 && Number(value) <= current
    ? Number(value)
    : 0;

const dateValue = (value: unknown): string | null => {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const trackById = (trackId: string) =>
  ONBOARDING_CATALOG.tracks.find((track) => track.id === trackId);

const createDefaultTrackProgress = (
  catalogVersion: number,
): OnboardingTrackProgress => ({
  catalogVersion,
  status: "paused",
  lastStepId: null,
  completedStepIds: [],
  completionHistory: [],
  completedAt: null,
});

export const createDefaultOnboardingProgress = (): OnboardingProgress => ({
  schemaVersion: 1,
  autoOpenShownVersion: 0,
  requiredNoticeSeenVersion: 0,
  requiredNoticeResolvedVersion: 0,
  requiredAcknowledgedVersion: 0,
  readinessInspectedVersion: 0,
  activeTrackId: null,
  tracks: Object.fromEntries(
    ONBOARDING_CATALOG.tracks.map((track) => [
      track.id,
      createDefaultTrackProgress(track.version),
    ]),
  ),
});

const normalizeTrackProgress = (
  value: unknown,
  trackId: string,
): OnboardingTrackProgress => {
  const track = trackById(trackId);
  if (!track) {
    return createDefaultTrackProgress(0);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createDefaultTrackProgress(track.version);
  }
  const input = recordValue(value);
  const stepIds = new Set(track.steps.map((step) => step.id));
  const inputCompletedStepIds = Array.isArray(input.completedStepIds)
    ? input.completedStepIds
    : [];
  const completedStepIds = track.steps
    .map((step) => step.id)
    .filter((stepId) => inputCompletedStepIds.includes(stepId));
  const completionHistory = Array.isArray(input.completionHistory)
    ? input.completionHistory
        .slice(-ONBOARDING_LIMITS.maxCompletionHistoryPerTrack)
        .map(recordValue)
        .flatMap((entry) => {
          const completedAt = dateValue(entry.completedAt);
          return typeof entry.stepId === "string" &&
            stepIds.has(entry.stepId) &&
            completedAt
            ? [{ stepId: entry.stepId, completedAt }]
            : [];
        })
    : [];
  const completedAt = dateValue(input.completedAt);
  const requestedStatus =
    input.status === "active" ||
    input.status === "paused" ||
    input.status === "completed"
      ? input.status
      : "paused";
  const allComplete =
    completedStepIds.length === track.steps.length && track.steps.length > 0;

  return {
    catalogVersion: versionValue(input.catalogVersion, track.version),
    status:
      requestedStatus === "completed" && allComplete ? "completed" : "paused",
    lastStepId:
      typeof input.lastStepId === "string" && stepIds.has(input.lastStepId)
        ? input.lastStepId
        : null,
    completedStepIds,
    completionHistory,
    completedAt,
  };
};

export const normalizeOnboardingProgress = (
  value: unknown,
): OnboardingProgress => {
  const input = recordValue(value);
  const inputTracks = recordValue(input.tracks);
  const progress: OnboardingProgress = {
    schemaVersion: 1,
    autoOpenShownVersion: versionValue(
      input.autoOpenShownVersion,
      ONBOARDING_CATALOG_VERSION,
    ),
    requiredNoticeSeenVersion: versionValue(
      input.requiredNoticeSeenVersion,
      ONBOARDING_SAFETY_VERSION,
    ),
    requiredNoticeResolvedVersion: versionValue(
      input.requiredNoticeResolvedVersion,
      ONBOARDING_SAFETY_VERSION,
    ),
    requiredAcknowledgedVersion: versionValue(
      input.requiredAcknowledgedVersion,
      ONBOARDING_SAFETY_VERSION,
    ),
    readinessInspectedVersion: versionValue(
      input.readinessInspectedVersion,
      ONBOARDING_SAFETY_VERSION,
    ),
    activeTrackId: null,
    tracks: Object.fromEntries(
      ONBOARDING_CATALOG.tracks.map((track) => [
        track.id,
        normalizeTrackProgress(inputTracks[track.id], track.id),
      ]),
    ),
  };

  const requestedActiveTrack =
    typeof input.activeTrackId === "string"
      ? trackById(input.activeTrackId)
      : undefined;
  if (
    requestedActiveTrack &&
    progress.tracks[requestedActiveTrack.id]?.status !== "completed"
  ) {
    progress.activeTrackId = requestedActiveTrack.id;
    progress.tracks[requestedActiveTrack.id].status = "active";
  }
  return progress;
};

export const shouldAutoOpenOnboarding = (
  progress: OnboardingProgress,
): boolean =>
  normalizeOnboardingProgress(progress).autoOpenShownVersion <
  ONBOARDING_CATALOG_VERSION;

const currentStep = (progress: OnboardingProgress, trackId: string) => {
  const track = trackById(trackId);
  const trackProgress = progress.tracks[trackId];
  if (!track || !trackProgress) return undefined;
  return track.steps.find(
    (step) => !trackProgress.completedStepIds.includes(step.id),
  );
};

export const reduceOnboardingProgress = (
  value: OnboardingProgress,
  action: OnboardingProgressAction,
): OnboardingProgress => {
  const progress = normalizeOnboardingProgress(value);

  if (action.type === "mark-auto-open-shown") {
    progress.autoOpenShownVersion = ONBOARDING_CATALOG_VERSION;
    return progress;
  }

  if (action.type === "pause-active-track") {
    if (
      progress.activeTrackId !== action.trackId ||
      !progress.tracks[action.trackId]
    ) {
      return progress;
    }
    const target = progress.tracks[action.trackId];
    target.status = "paused";
    target.lastStepId ??= currentStep(progress, action.trackId)?.id ?? null;
    progress.activeTrackId = null;
    return progress;
  }

  if (action.type === "replay-track") {
    const target = progress.tracks[action.trackId];
    if (!target || target.status !== "completed") return progress;
    if (progress.activeTrackId) {
      progress.tracks[progress.activeTrackId].status = "paused";
    }
    target.status = "active";
    target.lastStepId = null;
    target.completedStepIds = [];
    progress.activeTrackId = action.trackId;
    return progress;
  }

  if (action.type === "review-runtime-step") {
    const track = trackById(action.trackId);
    const target = progress.tracks[action.trackId];
    const step = track?.steps.find((entry) => entry.id === action.stepId);
    if (
      !track ||
      !target ||
      target.status !== "completed" ||
      step?.completionOwner !== "runtime" ||
      !target.completedStepIds.includes(step.id)
    ) {
      return progress;
    }
    if (progress.activeTrackId) {
      progress.tracks[progress.activeTrackId].status = "paused";
    }
    target.status = "active";
    target.completedStepIds = target.completedStepIds.filter(
      (stepId) => stepId !== step.id,
    );
    target.lastStepId = target.completedStepIds.at(-1) ?? null;
    progress.activeTrackId = action.trackId;
    return progress;
  }

  if (action.type === "activate-track") {
    const track = trackById(action.trackId);
    const target = progress.tracks[action.trackId];
    const safetyComplete =
      progress.requiredAcknowledgedVersion >= ONBOARDING_SAFETY_VERSION &&
      progress.readinessInspectedVersion >= ONBOARDING_SAFETY_VERSION;
    if (!track || !target || (!track.required && !safetyComplete)) {
      return progress;
    }
    if (target.status === "completed") {
      return progress;
    }
    if (progress.activeTrackId && progress.activeTrackId !== action.trackId) {
      progress.tracks[progress.activeTrackId].status = "paused";
    }
    target.status = "active";
    progress.activeTrackId = action.trackId;
    return progress;
  }

  if (
    progress.activeTrackId !== action.trackId ||
    !dateValue(action.completedAt)
  ) {
    return progress;
  }
  const track = trackById(action.trackId);
  const trackProgress = progress.tracks[action.trackId];
  const step = currentStep(progress, action.trackId);
  if (
    !track ||
    !trackProgress ||
    !step ||
    step.id !== action.stepId ||
    step.completionOwner !== action.owner ||
    step.completionKey !== action.evidenceKey
  ) {
    return progress;
  }

  const completedAt = dateValue(action.completedAt);
  if (!completedAt) return progress;
  trackProgress.completedStepIds.push(step.id);
  trackProgress.lastStepId = step.id;
  trackProgress.completionHistory = [
    ...trackProgress.completionHistory,
    { stepId: step.id, completedAt },
  ].slice(-ONBOARDING_LIMITS.maxCompletionHistoryPerTrack);

  if (trackProgress.completedStepIds.length === track.steps.length) {
    trackProgress.status = "completed";
    trackProgress.completedAt = completedAt;
    progress.activeTrackId = null;
    if (track.id === "safety") {
      progress.requiredAcknowledgedVersion = ONBOARDING_SAFETY_VERSION;
      progress.readinessInspectedVersion = ONBOARDING_SAFETY_VERSION;
    }
  }
  return progress;
};
