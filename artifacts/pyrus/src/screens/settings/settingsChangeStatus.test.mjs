import assert from "node:assert/strict";
import test from "node:test";

import {
  getSettingsChangeStatus,
  settleSettingsDrafts,
} from "./settingsChangeStatus.js";

test("settings change status prioritizes active work and failures", () => {
  assert.deepEqual(
    getSettingsChangeStatus({ saving: true, dirtyCount: 2 }),
    { kind: "working", label: "Applying 2 changes…" },
  );
  assert.deepEqual(getSettingsChangeStatus({ saving: true }), {
    kind: "working",
    label: "Applying changes…",
  });
  assert.deepEqual(
    getSettingsChangeStatus({ loading: true, hasSnapshot: false }),
    { kind: "working", label: "Loading settings…" },
  );
  assert.deepEqual(
    getSettingsChangeStatus({ loading: true, hasSnapshot: true }),
    { kind: "working", label: "Refreshing settings…" },
  );
  assert.deepEqual(
    getSettingsChangeStatus({ error: "partial apply", dirtyCount: 1 }),
    { kind: "error", label: "Settings need attention" },
  );
});

test("settings change status distinguishes dirty, applied, and pristine states", () => {
  assert.deepEqual(getSettingsChangeStatus({ dirtyCount: 1 }), {
    kind: "dirty",
    label: "1 unsaved change",
  });
  assert.deepEqual(getSettingsChangeStatus({ dirtyCount: 3 }), {
    kind: "dirty",
    label: "3 unsaved changes",
  });
  assert.deepEqual(getSettingsChangeStatus({ applyOutcome: "success" }), {
    kind: "success",
    label: "Changes applied",
  });
  assert.deepEqual(getSettingsChangeStatus({}), {
    kind: "idle",
    label: "No unsaved changes",
  });
});

test("settings apply settlement retains rejected and newer draft values", () => {
  assert.deepEqual(
    settleSettingsDrafts({
      currentDrafts: {
        "isolation.mode": "report-only",
        "isolation.coop": "same-origin",
      },
      submittedDrafts: {
        "isolation.mode": "report-only",
        "isolation.coop": "same-origin",
      },
      rejectedKeys: ["isolation.mode"],
    }),
    { "isolation.mode": "report-only" },
  );
  assert.deepEqual(
    settleSettingsDrafts({
      currentDrafts: {
        "isolation.mode": "enforce",
        "local.unsubmitted": "keep",
      },
      submittedDrafts: { "isolation.mode": "report-only" },
      rejectedKeys: [],
    }),
    {
      "isolation.mode": "enforce",
      "local.unsubmitted": "keep",
    },
  );
});
