import assert from "node:assert/strict";
import test from "node:test";

import {
  extractCanonicalEnvironment,
  extractEnvironmentModeMembers,
} from "./check-canonical-signal-env.mjs";

test("ignores commented signal environments", () => {
  const service = `
// const CANONICAL_SIGNAL_ENVIRONMENT: RuntimeMode = "paper";
/*
const CANONICAL_SIGNAL_ENVIRONMENT: RuntimeMode = "paper";
*/
const CANONICAL_SIGNAL_ENVIRONMENT: RuntimeMode = "shadow";
`;
  const enums = `
/*
export const retiredEnvironmentModeEnum = pgEnum("environment_mode", [
  "paper",
]);
*/
export const environmentModeEnum = pgEnum("environment_mode", [
  // "paper",
  "shadow",
  "live",
]);
`;

  assert.equal(extractCanonicalEnvironment(service), "shadow");
  assert.deepEqual(extractEnvironmentModeMembers(enums), ["shadow", "live"]);
});
