import assert from "node:assert/strict";
import test from "node:test";
import {
  getCurrentAppUserId,
  requireCurrentAppUserId,
  runAsAppUser,
} from "./app-user-context";

test("getCurrentAppUserId returns null outside a bound scope", () => {
  assert.equal(getCurrentAppUserId(), null);
});

test("requireCurrentAppUserId throws 401 outside a bound scope (fail-closed)", () => {
  assert.throws(
    () => requireCurrentAppUserId(),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 401);
      assert.equal((error as { code?: string }).code, "auth_required");
      return true;
    },
  );
});

test("runAsAppUser binds the id for the duration of the callback only", () => {
  const observed = runAsAppUser("user-123", () => {
    assert.equal(getCurrentAppUserId(), "user-123");
    return requireCurrentAppUserId();
  });
  assert.equal(observed, "user-123");
  assert.equal(getCurrentAppUserId(), null);
});
