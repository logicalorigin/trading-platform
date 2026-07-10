import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeLoadingEndpoint } from "./ContainerLoadingStatus.jsx";

test("loading endpoint sanitization masks malformed identifier segments", () => {
  for (const [endpoint, expected] of [
    ["/api/accounts/DU12345%/orders", "/api/accounts/:id/orders"],
    ["/api/accounts/DU12345/orders", "/api/accounts/:account/orders"],
    ["/api/accounts/DU%31%32%33%34%35/orders", "/api/accounts/:account/orders"],
    ["/api/studies/12345678-1234-4123-8123-123456789abc", "/api/studies/:id"],
    ["/api/runs/1234", "/api/runs/:id"],
  ]) {
    assert.equal(sanitizeLoadingEndpoint(endpoint), expected);
  }
});
