import assert from "node:assert/strict";
import test from "node:test";

import { readSessionToken } from "./auth";

test("a malformed session cookie is treated as signed out", () => {
  assert.equal(
    readSessionToken({
      headers: { cookie: "pyrus_session=%E0%A4%A" },
    }),
    null,
  );
});
