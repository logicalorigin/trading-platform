import assert from "node:assert/strict";
import test from "node:test";
import { describeUserFacingRuntimeError } from "./userFacingRuntimeError.js";

test("describeUserFacingRuntimeError replaces route admission 429 copy", () => {
  const copy = describeUserFacingRuntimeError(
    {
      status: 429,
      message: "Request shed by PYRUS route admission",
    },
    {
      title: "Signals unavailable",
      detail: "Signal monitor data could not be loaded.",
      rateLimitedTitle: "Signals request delayed",
    },
  );

  assert.equal(copy.title, "Signals request delayed");
  assert.match(copy.detail, /pacing live data requests/i);
  assert.doesNotMatch(copy.detail, /route admission/i);
  assert.match(copy.technicalDetail, /route admission/i);
});

test("describeUserFacingRuntimeError replaces safe QA copy", () => {
  const copy = describeUserFacingRuntimeError(
    new Error("blocked while pyrusQa=safe is enabled"),
    {
      title: "Shadow scan failed",
      detail: "The signal-options scan could not finish.",
      safeQaTitle: "Shadow scan paused",
    },
  );

  assert.equal(copy.title, "Shadow scan paused");
  assert.match(copy.detail, /Safe QA mode/i);
  assert.doesNotMatch(copy.detail, /pyrusQa=safe/i);
});

test("describeUserFacingRuntimeError falls back to product copy", () => {
  const copy = describeUserFacingRuntimeError(new Error("database timeout"), {
    title: "Signals unavailable",
    detail: "Signal monitor data could not be loaded.",
  });

  assert.equal(copy.title, "Signals unavailable");
  assert.equal(copy.detail, "Signal monitor data could not be loaded.");
  assert.equal(copy.technicalDetail, "database timeout");
});
