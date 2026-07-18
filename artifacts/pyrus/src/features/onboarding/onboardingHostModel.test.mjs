import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGoalPresentations,
  buildReadinessPresentations,
  findCurrentOnboardingStep,
  onboardingEssentialsComplete,
  selectConnectAccountAction,
} from "./onboardingHostModel.ts";
import {
  createDefaultOnboardingProgress,
  reduceOnboardingProgress,
} from "./onboardingModel.ts";

const emptyReadiness = {
  status: "empty",
  satisfied: false,
  accountCount: 0,
  includedAccountCount: 0,
  verifiedAccountCount: 0,
  blockerCodes: [],
};

test("the pilot exposes Connect Account and truthfully holds later tracks", () => {
  const progress = createDefaultOnboardingProgress();
  const goals = buildGoalPresentations(progress, emptyReadiness);

  assert.deepEqual(
    goals.map(({ id, state }) => ({ id, state })),
    [
      { id: "connect-account", state: "setup-needed" },
      { id: "read-signal", state: "unavailable" },
      { id: "practice-review", state: "unavailable" },
      { id: "manage-risk", state: "unavailable" },
    ],
  );
  assert.match(goals[1].unavailableReason, /pilot review/i);
});

test("a zero-completion paused Connect track remains resumable", () => {
  const progress = createDefaultOnboardingProgress();
  progress.tracks["connect-account"] = {
    ...progress.tracks["connect-account"],
    status: "paused",
    lastStepId: "open-settings",
  };

  assert.equal(
    buildGoalPresentations(progress, emptyReadiness)[0].state,
    "paused",
  );
});

test("historical Connect completion never replaces current server readiness", () => {
  const progress = createDefaultOnboardingProgress();
  progress.tracks["connect-account"] = {
    ...progress.tracks["connect-account"],
    status: "completed",
    completedStepIds: [
      "open-settings",
      "choose-provider",
      "verify-readiness",
    ],
    completedAt: "2026-07-18T00:00:00.000Z",
  };

  const [connect] = buildGoalPresentations(progress, emptyReadiness);

  assert.equal(connect.state, "setup-needed");
  assert.equal(connect.priorCompletionRetained, true);
});

test("historical Connect completion distinguishes transient account observations from drift", () => {
  const progress = createDefaultOnboardingProgress();
  progress.tracks["connect-account"] = {
    ...progress.tracks["connect-account"],
    status: "completed",
    completedStepIds: [
      "open-settings",
      "choose-provider",
      "verify-readiness",
    ],
    completedAt: "2026-07-18T00:00:00.000Z",
  };

  const checking = buildGoalPresentations(
    progress,
    emptyReadiness,
    "loading",
  )[0];
  assert.equal(checking.state, "checking");
  assert.equal(checking.retryable, false);
  const stale = buildGoalPresentations(
    progress,
    emptyReadiness,
    "stale",
  )[0];
  assert.equal(stale.state, "stale");
  assert.equal(stale.retryable, true);
  const unavailable = buildGoalPresentations(
    progress,
    emptyReadiness,
    "error",
  )[0];
  assert.equal(unavailable.state, "status-unavailable");
  assert.equal(unavailable.retryable, true);
  assert.equal(
    buildGoalPresentations(progress, emptyReadiness, "ready")[0].state,
    "setup-needed",
  );
});

test("completed Connect selection reviews only verified drift and otherwise replays", () => {
  const progress = createDefaultOnboardingProgress();
  progress.tracks["connect-account"] = {
    ...progress.tracks["connect-account"],
    status: "completed",
    completedStepIds: [
      "open-settings",
      "choose-provider",
      "verify-readiness",
    ],
    completedAt: "2026-07-18T00:00:00.000Z",
  };

  assert.deepEqual(
    selectConnectAccountAction(progress, "ready", emptyReadiness),
    {
      type: "review-runtime-step",
      trackId: "connect-account",
      stepId: "verify-readiness",
    },
  );
  assert.equal(
    selectConnectAccountAction(progress, "loading", emptyReadiness),
    null,
  );
  assert.deepEqual(
    selectConnectAccountAction(progress, "ready", {
      ...emptyReadiness,
      status: "ready",
      satisfied: true,
      accountCount: 1,
      verifiedAccountCount: 1,
    }),
    { type: "replay-track", trackId: "connect-account" },
  );
});

test("readiness labels distinguish loading, setup, and verified connection", () => {
  assert.deepEqual(
    buildReadinessPresentations({
      sessionState: "loading",
      dataConfigured: false,
      accountState: "loading",
      connectReadiness: emptyReadiness,
    }).map(({ label, status }) => ({ label, status })),
    [
      { label: "Data", status: "Checking" },
      { label: "Provider", status: "Checking" },
      { label: "Account", status: "Checking" },
    ],
  );

  assert.deepEqual(
    buildReadinessPresentations({
      sessionState: "ready",
      dataConfigured: true,
      accountState: "ready",
      connectReadiness: emptyReadiness,
    }).map(({ label, status }) => ({ label, status })),
    [
      { label: "Data", status: "Configured" },
      { label: "Provider", status: "Setup needed" },
      { label: "Account", status: "Setup needed" },
    ],
  );

  const ready = {
    ...emptyReadiness,
    status: "ready",
    satisfied: true,
    accountCount: 1,
    includedAccountCount: 1,
    verifiedAccountCount: 1,
  };
  assert.equal(
    buildReadinessPresentations({
      sessionState: "ready",
      dataConfigured: true,
      accountState: "ready",
      connectReadiness: ready,
    })[2].status,
    "Connection verified",
  );
});

test("current step and essentials derive only from bounded progress", () => {
  let progress = createDefaultOnboardingProgress();
  assert.equal(onboardingEssentialsComplete(progress), false);
  progress = reduceOnboardingProgress(progress, {
    type: "activate-track",
    trackId: "safety",
  });
  assert.equal(findCurrentOnboardingStep(progress)?.id, "environment");
});
