import assert from "node:assert/strict";
import test from "node:test";

import { collectReferencedEnvNames } from "./check-env-example.mjs";

test("finds indirect environment variable references", () => {
  const referenced = collectReferencedEnvNames(`
    const injected = env["PYRUS_PYTHON_COMPUTE_ENABLED"];
    const template = { enabledEnv: "PYRUS_PYTHON_RISK_COMPUTE_ENABLED" };
    const pool = readPositiveInteger("DB_POOL_MAX", 10);
    const api = readImportMetaEnv().VITE_API_BASE_URL;
  `);

  assert.deepEqual([...referenced].sort(), [
    "DB_POOL_MAX",
    "PYRUS_PYTHON_COMPUTE_ENABLED",
    "PYRUS_PYTHON_RISK_COMPUTE_ENABLED",
    "VITE_API_BASE_URL",
  ]);
});
