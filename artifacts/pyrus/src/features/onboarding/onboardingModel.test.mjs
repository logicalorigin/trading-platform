import assert from "node:assert/strict";
import test from "node:test";

import {
  ONBOARDING_LIMITS,
  createDefaultOnboardingProgress,
  normalizeOnboardingProgress,
  reduceOnboardingProgress,
  shouldAutoOpenOnboarding,
} from "./onboardingModel.ts";

const completeStep = (progress, trackId, stepId, owner, evidenceKey) =>
  reduceOnboardingProgress(progress, {
    type: "complete-current-step",
    trackId,
    stepId,
    owner,
    evidenceKey,
    completedAt: "2026-07-18T00:00:00.000Z",
  });

const completeSafety = () => {
  let progress = createDefaultOnboardingProgress();
  progress = reduceOnboardingProgress(progress, {
    type: "activate-track",
    trackId: "safety",
  });
  progress = completeStep(progress, "safety", "environment", "manual");
  progress = completeStep(progress, "safety", "review-boundary", "manual");
  return completeStep(progress, "safety", "readiness-inspection", "manual");
};

test("defaults auto-open every unresolved authenticated user once", () => {
  const progress = createDefaultOnboardingProgress();

  assert.equal(shouldAutoOpenOnboarding(progress), true);
  assert.equal(progress.autoOpenShownVersion, 0);
  assert.equal(progress.activeTrackId, null);
  assert.deepEqual(
    Object.values(progress.tracks).map((track) => track.status),
    ["paused", "paused", "paused", "paused", "paused"],
  );

  const shown = reduceOnboardingProgress(progress, {
    type: "mark-auto-open-shown",
  });
  assert.equal(shouldAutoOpenOnboarding(shown), false);
});

test("optional tracks stay gated until both safety milestones complete", () => {
  const initial = createDefaultOnboardingProgress();
  const rejected = reduceOnboardingProgress(initial, {
    type: "activate-track",
    trackId: "connect-account",
  });
  assert.deepEqual(rejected, initial);

  const ready = completeSafety();
  assert.equal(ready.requiredAcknowledgedVersion, 1);
  assert.equal(ready.readinessInspectedVersion, 1);

  const activated = reduceOnboardingProgress(ready, {
    type: "activate-track",
    trackId: "connect-account",
  });
  assert.equal(activated.activeTrackId, "connect-account");
  assert.equal(activated.tracks["connect-account"].status, "active");
});

test("switching tracks pauses the current track and preserves its progress", () => {
  let progress = completeSafety();
  progress = reduceOnboardingProgress(progress, {
    type: "activate-track",
    trackId: "connect-account",
  });
  progress = completeStep(
    progress,
    "connect-account",
    "open-settings",
    "manual",
  );
  progress = reduceOnboardingProgress(progress, {
    type: "activate-track",
    trackId: "read-signal",
  });

  assert.equal(progress.activeTrackId, "read-signal");
  assert.equal(progress.tracks["connect-account"].status, "paused");
  assert.deepEqual(progress.tracks["connect-account"].completedStepIds, [
    "open-settings",
  ]);
});

test("pausing before the first completion retains the current step", () => {
  let progress = completeSafety();
  progress = reduceOnboardingProgress(progress, {
    type: "activate-track",
    trackId: "connect-account",
  });

  const paused = reduceOnboardingProgress(progress, {
    type: "pause-active-track",
    trackId: "connect-account",
  });

  assert.equal(paused.activeTrackId, null);
  assert.equal(paused.tracks["connect-account"].status, "paused");
  assert.equal(
    paused.tracks["connect-account"].lastStepId,
    "open-settings",
  );
});

test("Connect Account completes only from the exact connection verification fact", () => {
  let progress = completeSafety();
  progress = reduceOnboardingProgress(progress, {
    type: "activate-track",
    trackId: "connect-account",
  });
  progress = completeStep(
    progress,
    "connect-account",
    "open-settings",
    "manual",
  );
  progress = completeStep(
    progress,
    "connect-account",
    "choose-provider",
    "manual",
  );

  const rejected = completeStep(
    progress,
    "connect-account",
    "verify-readiness",
    "runtime",
    "account.execution-ready",
  );
  assert.deepEqual(rejected, progress);

  const completed = completeStep(
    progress,
    "connect-account",
    "verify-readiness",
    "runtime",
    "account.connection-verified",
  );
  assert.equal(completed.activeTrackId, null);
  assert.equal(completed.tracks["connect-account"].status, "completed");
});

test("reviewing connection drift reopens only the runtime step and retains prior completion", () => {
  let progress = completeSafety();
  progress = reduceOnboardingProgress(progress, {
    type: "activate-track",
    trackId: "connect-account",
  });
  progress = completeStep(
    progress,
    "connect-account",
    "open-settings",
    "manual",
  );
  progress = completeStep(
    progress,
    "connect-account",
    "choose-provider",
    "manual",
  );
  progress = completeStep(
    progress,
    "connect-account",
    "verify-readiness",
    "runtime",
    "account.connection-verified",
  );
  const beforeReview = progress.tracks["connect-account"];

  const reviewed = reduceOnboardingProgress(progress, {
    type: "review-runtime-step",
    trackId: "connect-account",
    stepId: "verify-readiness",
  });
  const reviewedTrack = reviewed.tracks["connect-account"];

  assert.equal(reviewed.activeTrackId, "connect-account");
  assert.equal(reviewedTrack.status, "active");
  assert.deepEqual(reviewedTrack.completedStepIds, [
    "open-settings",
    "choose-provider",
  ]);
  assert.equal(reviewedTrack.lastStepId, "choose-provider");
  assert.deepEqual(
    reviewedTrack.completionHistory,
    beforeReview.completionHistory,
  );
  assert.equal(reviewedTrack.completedAt, beforeReview.completedAt);
  assert.equal(
    normalizeOnboardingProgress(reviewed).tracks["connect-account"].completedAt,
    beforeReview.completedAt,
  );
});

test("explicit replay resets current steps but retains completion history and timestamp", () => {
  let progress = completeSafety();
  progress = reduceOnboardingProgress(progress, {
    type: "activate-track",
    trackId: "connect-account",
  });
  progress = completeStep(
    progress,
    "connect-account",
    "open-settings",
    "manual",
  );
  progress = completeStep(
    progress,
    "connect-account",
    "choose-provider",
    "manual",
  );
  progress = completeStep(
    progress,
    "connect-account",
    "verify-readiness",
    "runtime",
    "account.connection-verified",
  );
  const beforeReplay = progress.tracks["connect-account"];

  const replayed = reduceOnboardingProgress(progress, {
    type: "replay-track",
    trackId: "connect-account",
  });
  const replayedTrack = replayed.tracks["connect-account"];

  assert.deepEqual(replayedTrack.completedStepIds, []);
  assert.deepEqual(
    replayedTrack.completionHistory,
    beforeReplay.completionHistory,
  );
  assert.equal(replayedTrack.completedAt, beforeReplay.completedAt);
});

test("normalization strips unknown state and bounds completion history", () => {
  const history = Array.from({ length: 80 }, (_, index) => ({
    stepId: "open-settings",
    completedAt: new Date(index * 1_000).toISOString(),
  }));
  const cyclic = {};
  cyclic.self = cyclic;
  cyclic.schemaVersion = 99;
  cyclic.autoOpenShownVersion = Number.POSITIVE_INFINITY;
  cyclic.activeTrackId = "unknown";
  cyclic.tracks = {
    unknown: { status: "active" },
    "connect-account": {
      catalogVersion: 999,
      status: "active",
      lastStepId: "not-a-step",
      completedStepIds: ["open-settings", "not-a-step", "open-settings"],
      completionHistory: history,
      completedAt: "not-a-date",
    },
  };

  const normalized = normalizeOnboardingProgress(cyclic);

  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.autoOpenShownVersion, 0);
  assert.equal(normalized.activeTrackId, null);
  assert.equal(normalized.tracks.unknown, undefined);
  assert.deepEqual(
    normalized.tracks["connect-account"].completedStepIds,
    ["open-settings"],
  );
  assert.equal(
    normalized.tracks["connect-account"].completionHistory.length,
    ONBOARDING_LIMITS.maxCompletionHistoryPerTrack,
  );
  assert.equal(normalized.tracks["connect-account"].completedAt, null);
});
