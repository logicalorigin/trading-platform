import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("./app.ts", import.meta.url), "utf8");

test("authenticated requests bind both app-user and IBKR portal contexts", () => {
  const start = appSource.indexOf("readAuthSessionFromToken(token)");
  const end = appSource.indexOf("app.use(gzipJsonResponses)", start);
  assert.notEqual(start, -1, "authenticated session middleware is missing");
  assert.notEqual(end, -1, "authenticated session middleware end marker is missing");
  const block = appSource.slice(start, end);

  assert.match(block, /runAsAppUser\(session\.user\.id/);
  assert.match(block, /runWithIbkrPortalUser\(session\.user\.id,\s*next\)/);
});
