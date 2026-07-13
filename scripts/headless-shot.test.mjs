import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  captureSucceeded,
  createBoundedCollector,
  parseCli,
  redactUrl,
  reserveOutput,
  runCapture,
  safeText,
} from "./headless-shot.mjs";

test("headless-shot CLI validates arguments before side effects", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "headless-shot-cli-"));
  try {
    const out = path.join(dir, "fresh.png");
    const config = parseCli([
      "https://example.com/page?token=secret",
      "--out",
      out,
      "--wait",
      "0",
      "--wait-for",
      "#ready",
      "--settle",
      "5",
      "--viewport",
      "800x600",
      "--match",
      "/api",
      "--json",
    ]);
    assert.equal(config.url, "https://example.com/page?token=secret");
    assert.equal(config.out, out);
    assert.deepEqual(config.viewport, { width: 800, height: 600 });
    assert.deepEqual(config.match, ["/api"]);

    writeFileSync(path.join(dir, "exists.png"), "existing");
    for (const argv of [
      [],
      ["https://example.com", "extra"],
      ["https://example.com", "--unknown"],
      ["https://example.com", "--wait"],
      ["https://example.com", "--wait", "NaN"],
      ["https://example.com", "--wait", "-1"],
      ["https://example.com", "--viewport", "800x"],
      ["https://user:pass@example.com"],
      ["javascript:alert(1)"],
      ["https://example.com", "--settle", "1"],
      ["https://example.com", "--out", path.join(dir, "wrong.jpg")],
      ["https://example.com", "--out", path.join(dir, "exists.png")],
    ]) {
      assert.throws(() => parseCli(argv));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("browser diagnostics redact secrets and remain terminal-safe", () => {
  assert.equal(
    redactUrl(
      "https://user:pass@example.com/path?signature=abc&ok=yes#access_token=def",
    ),
    "https://example.com/path?signature=%5Bredacted%5D&ok=yes#access_token=%5Bredacted%5D",
  );
  assert.equal(safeText("A\u001b[31mB\u0000😀Z", 4), "AB 😀…");
});

test("diagnostic collectors retain bounded samples and exact counts", () => {
  const collector = createBoundedCollector(2, 20);
  collector.add("one");
  collector.add("two");
  collector.add("three");
  assert.deepEqual(collector.snapshot(), {
    count: 3,
    samples: ["one", "two"],
  });
});

test("output reservation prevents a second capture from claiming the path", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "headless-shot-output-"));
  const out = path.join(dir, "capture.png");
  try {
    await reserveOutput(out);
    await assert.rejects(reserveOutput(out), /refusing to overwrite/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("capture success requires HTTP readiness and a screenshot", () => {
  assert.equal(
    captureSucceeded({ status: 200, ready: true, screenshotCaptured: true }),
    true,
  );
  assert.equal(
    captureSucceeded({ status: 500, ready: true, screenshotCaptured: true }),
    false,
  );
  assert.equal(
    captureSucceeded({ status: 200, ready: false, screenshotCaptured: true }),
    false,
  );
  assert.equal(
    captureSucceeded({ status: 200, ready: true, screenshotCaptured: false }),
    false,
  );
});

test("capture reports HTTP and readiness failures after a diagnostic screenshot", async () => {
  const calls = [];
  const page = {
    on() {},
    async goto() {
      return { status: () => 503 };
    },
    url() {
      return "https://example.com/final?token=secret";
    },
    async waitForSelector() {
      throw new Error("selector timed out\u001b[31m");
    },
    async screenshot(options) {
      calls.push(["screenshot", options]);
    },
    async title() {
      return "Temporary failure";
    },
  };
  const browser = {
    async newContext() {
      return { newPage: async () => page };
    },
    async close() {
      calls.push(["close"]);
    },
  };
  const result = await runCapture(
    {
      url: "https://example.com/start?token=secret",
      redactedUrl: "https://example.com/start?token=%5Bredacted%5D",
      out: "/tmp/unused.png",
      wait: 0,
      waitFor: "#ready",
      settle: 0,
      storageState: null,
      viewport: { width: 800, height: 600 },
      full: false,
      match: [],
    },
    { launch: async () => browser },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.ready, false);
  assert.equal(result.screenshotCaptured, true);
  assert.equal(
    result.finalUrl,
    "https://example.com/final?token=%5Bredacted%5D",
  );
  assert.doesNotMatch(result.waitForError, /\u001b/);
  assert.deepEqual(calls, [
    ["screenshot", { path: "/tmp/unused.png", fullPage: false }],
    ["close"],
  ]);
});

test("browser launch failures stay in the structured result", async () => {
  const result = await runCapture(
    {
      url: "https://example.com/",
      redactedUrl: "https://example.com/",
      out: "/tmp/unused.png",
      wait: 0,
      waitFor: null,
      settle: 0,
      storageState: null,
      viewport: { width: 800, height: 600 },
      full: false,
      match: [],
    },
    {
      launch: async () => {
        throw new Error("launch failed");
      },
    },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /launch failed/);
});
