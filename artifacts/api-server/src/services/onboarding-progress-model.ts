import { HttpError } from "../lib/errors";

export const ONBOARDING_PROGRESS_MAX_BYTES = 64 * 1024;
const CATALOG_VERSION = 1;
const SAFETY_VERSION = 1;
const HISTORY_LIMIT = 32;

const TRACK_STEPS = {
  safety: ["environment", "review-boundary", "readiness-inspection"],
  "connect-account": ["open-settings", "choose-provider", "verify-readiness"],
  "read-signal": ["open-signals", "read-evidence"],
  "practice-review": ["build-practice", "review-practice"],
  "manage-risk": ["open-account", "read-risk"],
} as const;

export type OnboardingTrackProgressPreference = {
  catalogVersion: number;
  status: "active" | "paused" | "completed";
  lastStepId: string | null;
  completedStepIds: string[];
  completionHistory: Array<{ stepId: string; completedAt: string }>;
  completedAt: string | null;
};

export type OnboardingProgressPreference = {
  schemaVersion: 1;
  autoOpenShownVersion: number;
  requiredNoticeSeenVersion: number;
  requiredNoticeResolvedVersion: number;
  requiredAcknowledgedVersion: number;
  readinessInspectedVersion: number;
  activeTrackId: string | null;
  tracks: Record<string, OnboardingTrackProgressPreference>;
};

type JsonRecord = Record<string, unknown>;

const recordValue = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const invalid = (key: string, detail: string): never => {
  throw new HttpError(400, "Invalid user preference.", {
    code: "invalid_user_preference",
    detail: `${key} ${detail}`,
  });
};

const versionValue = (
  value: unknown,
  current: number,
  key: string,
  strict: boolean,
): number => {
  if (value === undefined) return 0;
  if (
    Number.isInteger(value) &&
    Number(value) >= 0 &&
    Number(value) <= current
  ) {
    return Number(value);
  }
  return strict ? invalid(key, `must be an integer from 0 through ${current}.`) : 0;
};

const dateValue = (
  value: unknown,
  key: string,
  strict: boolean,
): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return strict ? invalid(key, "must be an ISO date-time or null.") : null;
};

const defaultTrack = (
  catalogVersion = CATALOG_VERSION,
): OnboardingTrackProgressPreference => ({
  catalogVersion,
  status: "paused",
  lastStepId: null,
  completedStepIds: [],
  completionHistory: [],
  completedAt: null,
});

export const createDefaultOnboardingProgressPreference =
  (): OnboardingProgressPreference => ({
    schemaVersion: 1,
    autoOpenShownVersion: 0,
    requiredNoticeSeenVersion: 0,
    requiredNoticeResolvedVersion: 0,
    requiredAcknowledgedVersion: 0,
    readinessInspectedVersion: 0,
    activeTrackId: null,
    tracks: Object.fromEntries(
      Object.keys(TRACK_STEPS).map((trackId) => [trackId, defaultTrack()]),
    ),
  });

const normalizeTrack = (
  value: unknown,
  trackId: keyof typeof TRACK_STEPS,
  strict: boolean,
): OnboardingTrackProgressPreference => {
  if (value === undefined) return defaultTrack();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return strict
      ? invalid(`onboarding.tracks.${trackId}`, "must be an object.")
      : defaultTrack();
  }
  const input = recordValue(value);
  const steps = TRACK_STEPS[trackId] as readonly string[];
  const completedInput = input.completedStepIds;
  if (strict && completedInput !== undefined && !Array.isArray(completedInput)) {
    invalid(
      `onboarding.tracks.${trackId}.completedStepIds`,
      "must be an array.",
    );
  }
  if (
    strict &&
    Array.isArray(completedInput) &&
    completedInput.some(
      (stepId) => typeof stepId !== "string" || !steps.includes(stepId),
    )
  ) {
    invalid(
      `onboarding.tracks.${trackId}.completedStepIds`,
      "must reference only known steps.",
    );
  }
  const completedStepIds = steps.filter(
    (stepId) =>
      Array.isArray(completedInput) && completedInput.includes(stepId),
  );
  const historyInput = input.completionHistory;
  if (strict && historyInput !== undefined && !Array.isArray(historyInput)) {
    invalid(
      `onboarding.tracks.${trackId}.completionHistory`,
      "must be an array.",
    );
  }
  const completionHistory = Array.isArray(historyInput)
    ? historyInput.slice(-HISTORY_LIMIT).flatMap((item, index) => {
        const entry = recordValue(item);
        const stepId =
          typeof entry.stepId === "string" && steps.includes(entry.stepId)
            ? entry.stepId
            : null;
        const completedAt = dateValue(
          entry.completedAt,
          `onboarding.tracks.${trackId}.completionHistory.${index}.completedAt`,
          strict,
        );
        if (stepId && completedAt) return [{ stepId, completedAt }];
        if (strict) {
          invalid(
            `onboarding.tracks.${trackId}.completionHistory.${index}`,
            "must reference a known step.",
          );
        }
        return [];
      })
    : [];
  const requestedStatus =
    input.status === undefined || input.status === "paused"
      ? "paused"
      : input.status === "active" || input.status === "completed"
        ? input.status
        : strict
          ? invalid(
              `onboarding.tracks.${trackId}.status`,
              "must be active, paused, or completed.",
            )
          : "paused";
  const allComplete = completedStepIds.length === steps.length;
  const lastStepId =
    input.lastStepId === undefined || input.lastStepId === null
      ? null
      : typeof input.lastStepId === "string" &&
          steps.includes(input.lastStepId)
        ? input.lastStepId
        : strict
          ? invalid(
              `onboarding.tracks.${trackId}.lastStepId`,
              "must reference a known step.",
            )
          : null;

  return {
    catalogVersion:
      input.catalogVersion === undefined
        ? 0
        : versionValue(
            input.catalogVersion,
            CATALOG_VERSION,
            `onboarding.tracks.${trackId}.catalogVersion`,
            strict,
          ),
    status:
      requestedStatus === "completed" && allComplete
        ? "completed"
        : requestedStatus === "active"
          ? "active"
          : "paused",
    lastStepId,
    completedStepIds,
    completionHistory,
    completedAt: dateValue(
      input.completedAt,
      `onboarding.tracks.${trackId}.completedAt`,
      strict,
    ),
  };
};

export const normalizeOnboardingProgressPreference = (
  value: unknown,
  options: { strict?: boolean } = {},
): OnboardingProgressPreference => {
  const strict = options.strict === true;
  if (value === undefined) return createDefaultOnboardingProgressPreference();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return strict
      ? invalid("onboarding", "must be an object.")
      : createDefaultOnboardingProgressPreference();
  }
  if (strict) {
    try {
      if (Buffer.byteLength(JSON.stringify(value), "utf8") > ONBOARDING_PROGRESS_MAX_BYTES) {
        invalid("onboarding", "must be no larger than 64 KiB.");
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      invalid("onboarding", "must be serializable JSON.");
    }
  }
  const input = recordValue(value);
  if (
    strict &&
    input.schemaVersion !== undefined &&
    input.schemaVersion !== 1
  ) {
    invalid("onboarding.schemaVersion", "must be 1.");
  }
  if (
    strict &&
    input.tracks !== undefined &&
    (!input.tracks ||
      typeof input.tracks !== "object" ||
      Array.isArray(input.tracks))
  ) {
    invalid("onboarding.tracks", "must be an object.");
  }
  const tracksInput = recordValue(input.tracks);
  const tracks = Object.fromEntries(
    (Object.keys(TRACK_STEPS) as Array<keyof typeof TRACK_STEPS>).map(
      (trackId) => [
        trackId,
        normalizeTrack(tracksInput[trackId], trackId, strict),
      ],
    ),
  );
  const requestedActive =
    input.activeTrackId === undefined || input.activeTrackId === null
      ? null
      : typeof input.activeTrackId === "string" &&
          input.activeTrackId in TRACK_STEPS
        ? input.activeTrackId
        : strict
          ? invalid(
              "onboarding.activeTrackId",
              "must reference a known track or be null.",
            )
          : null;
  for (const [trackId, track] of Object.entries(tracks)) {
    track.status =
      requestedActive === trackId && track.status !== "completed"
        ? "active"
        : track.status === "completed"
          ? "completed"
          : "paused";
  }

  return {
    schemaVersion: 1,
    autoOpenShownVersion: versionValue(
      input.autoOpenShownVersion,
      CATALOG_VERSION,
      "onboarding.autoOpenShownVersion",
      strict,
    ),
    requiredNoticeSeenVersion: versionValue(
      input.requiredNoticeSeenVersion,
      SAFETY_VERSION,
      "onboarding.requiredNoticeSeenVersion",
      strict,
    ),
    requiredNoticeResolvedVersion: versionValue(
      input.requiredNoticeResolvedVersion,
      SAFETY_VERSION,
      "onboarding.requiredNoticeResolvedVersion",
      strict,
    ),
    requiredAcknowledgedVersion: versionValue(
      input.requiredAcknowledgedVersion,
      SAFETY_VERSION,
      "onboarding.requiredAcknowledgedVersion",
      strict,
    ),
    readinessInspectedVersion: versionValue(
      input.readinessInspectedVersion,
      SAFETY_VERSION,
      "onboarding.readinessInspectedVersion",
      strict,
    ),
    activeTrackId:
      requestedActive && tracks[requestedActive]?.status === "active"
        ? requestedActive
        : null,
    tracks,
  };
};
