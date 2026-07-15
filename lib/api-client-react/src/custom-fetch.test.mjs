import assert from "node:assert/strict";
import test from "node:test";

import { __customFetchInternalsForTests } from "./custom-fetch.ts";

const { applyBaseUrl } = __customFetchInternalsForTests;

test("customFetch can apply a per-request base URL to relative API paths", () => {
  assert.equal(
    applyBaseUrl(
      "/api/algo/deployments/deployment-1/signal-options/profile",
      "http://127.0.0.1:8080/",
    ),
    "http://127.0.0.1:8080/api/algo/deployments/deployment-1/signal-options/profile",
  );
  assert.equal(
    applyBaseUrl(
      "http://127.0.0.1:18747/api/session",
      "http://127.0.0.1:8080",
    ),
    "http://127.0.0.1:18747/api/session",
  );
});
