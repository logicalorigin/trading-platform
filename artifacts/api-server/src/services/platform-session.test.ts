import assert from "node:assert/strict";
import test from "node:test";
import { GetSessionResponse } from "@workspace/api-zod";
import { getSession } from "./platform";

test("getSession returns a response that satisfies the generated session schema", async () => {
  const session = await getSession();
  const parsed = GetSessionResponse.safeParse(session);

  assert.equal(
    parsed.success,
    true,
    parsed.success
      ? undefined
      : JSON.stringify(
          parsed.error.issues.map((issue) => ({
            path: issue.path,
            code: issue.code,
            message: issue.message,
          })),
        ),
  );
});
