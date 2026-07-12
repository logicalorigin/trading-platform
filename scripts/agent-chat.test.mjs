import assert from "node:assert/strict";
import test from "node:test";

import { formatMessage, parseReadOptions } from "./agent-chat.mjs";

test("read options reject inputs that would silently dump full history", () => {
  for (const args of [
    ["--tail"],
    ["--tail", "not-a-number"],
    ["--tail", "-1"],
    ["--tail", "1.5"],
    ["--from", ""],
    ["--unknown", "value"],
  ]) {
    assert.throws(() => parseReadOptions(args));
  }

  assert.deepEqual(parseReadOptions(["--tail", "0"]), { tail: 0 });
  assert.deepEqual(parseReadOptions(["--from", "worker", "--tail", "2"]), {
    from: "worker",
    tail: 2,
  });
  assert.deepEqual(parseReadOptions(["--since", "2026-07-12T01:00:00+01:00"]), {
    since: "2026-07-12T00:00:00.000Z",
  });
});

test("message formatting cannot inject extra terminal records or controls", () => {
  const rendered = formatMessage({
    at: "2026-07-12T00:00:00.000Z",
    from: "worker\n[forged] leader",
    text: "first line\n[forged] leader: second\u001b[31m\u009b32m",
  });

  assert.equal(
    rendered,
    "[2026-07-12T00:00:00.000Z] worker\\n[forged] leader: first line\\n[forged] leader: second\\u001b[31m\\u009b32m",
  );
  assert.equal(rendered.split("\n").length, 1);
  assert.equal(rendered.includes("\u001b"), false);
});
