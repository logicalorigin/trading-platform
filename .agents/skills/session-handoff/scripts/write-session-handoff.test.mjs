import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  buildCurrentPointer,
  buildMarkdown,
  isPathWithin,
  loadRolloutSummary,
  mergeEditableSections,
  oneLine,
  upsertMasterIndexEntry,
} from "./write-session-handoff.mjs";

const execFileAsync = promisify(execFile);

function customCall(callId, input, timestamp) {
  return {
    timestamp,
    type: "response_item",
    payload: { type: "custom_tool_call", call_id: callId, name: "exec", input },
  };
}

function customOutput(callId, output, timestamp, extra = {}) {
  return {
    timestamp,
    type: "response_item",
    payload: { type: "custom_tool_call_output", call_id: callId, output, ...extra },
  };
}

test("tracks current validation lifecycle and safely extracts multi-command orchestration", () => {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "session-handoff-rollout-"));
  const rolloutPath = path.join(fixtureDir, "rollout.jsonl");
  const entries = [
    {
      timestamp: "2026-07-12T00:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "exec_command_end",
        command: "pnpm --filter @workspace/fake test legacy-target",
        exit_code: 3,
      },
    },
    customCall(
      "completed",
      'const result = await tools.exec_command({cmd:"pnpm --filter=fake run test -- completed-target"}); text(result);',
      "2026-07-12T00:00:01.000Z",
    ),
    customOutput(
      "completed",
      [{ type: "input_text", text: "Script completed\n" }],
      "2026-07-12T00:00:02.000Z",
    ),
    customCall(
      "running",
      'const result = await tools.exec_command({cmd:"node --test fixture.test.mjs"}); text(result);',
      "2026-07-12T00:00:03.000Z",
    ),
    customOutput(
      "running",
      [{ type: "input_text", text: "Script running with cell ID fixture-cell\n" }],
      "2026-07-12T00:00:04.000Z",
    ),
    customOutput(
      "running",
      [{ type: "input_text", text: "final output" }],
      "2026-07-12T00:00:05.000Z",
      { exit_code: 0 },
    ),
    customCall(
      "unknown",
      'const result = await tools.exec_command({cmd:"cargo check --locked"}); text(result);',
      "2026-07-12T00:00:06.000Z",
    ),
    customOutput(
      "unknown",
      [{ type: "input_text", text: "ordinary command output" }],
      "2026-07-12T00:00:07.000Z",
    ),
    customCall(
      "multiple",
      'const [a, b] = await Promise.all([tools.exec_command({cmd:"pnpm --filter=fake typecheck"}), tools.exec_command({"workdir":"/tmp","cmd":"node scripts/check-fixture.mjs"})]); text(a.output); text(b.output);',
      "2026-07-12T00:00:08.000Z",
    ),
    customOutput(
      "multiple",
      [{ type: "input_text", text: "Script completed\n" }],
      "2026-07-12T00:00:09.000Z",
      { exit_code: 0 },
    ),
    customCall(
      "unsupported",
      'const result = await tools.exec_command({cmd:"pnpm test false-success", cmd: dynamicCommand}); text(result);',
      "2026-07-12T00:00:10.000Z",
    ),
    customOutput(
      "unsupported",
      [{ type: "input_text", text: "Script completed\n" }],
      "2026-07-12T00:00:11.000Z",
    ),
    customCall(
      "search-only",
      'const result = await tools.exec_command({cmd:"rg -n \\"pnpm test\\" docs"}); text(result);',
      "2026-07-12T00:00:12.000Z",
    ),
    customOutput(
      "search-only",
      [{ type: "input_text", text: "Script completed\n" }],
      "2026-07-12T00:00:13.000Z",
    ),
    customCall(
      "string-decoy",
      'const example = "tools.exec_command({cmd:\\\"pnpm test string-decoy\\\"})"; text(example);',
      "2026-07-12T00:00:14.000Z",
    ),
    customOutput(
      "string-decoy",
      [{ type: "input_text", text: "Script completed\n" }],
      "2026-07-12T00:00:15.000Z",
    ),
  ];
  writeFileSync(
    rolloutPath,
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );

  try {
    const summary = loadRolloutSummary(rolloutPath);
    assert.deepEqual(
      summary.validations.map((validation) => validation.text),
      [
        "pnpm --filter @workspace/fake test legacy-target (exit 3)",
        "pnpm --filter=fake run test -- completed-target (completed)",
        "node --test fixture.test.mjs (exit 0)",
        "cargo check --locked (result returned; exit unknown)",
        "pnpm --filter=fake typecheck (result returned; exit unknown)",
        "node scripts/check-fixture.mjs (result returned; exit unknown)",
      ],
    );
    assert.equal(
      summary.validations.filter((entry) => entry.text.includes("fixture.test")).length,
      1,
    );
    assert.ok(
      summary.activity.some((entry) => entry.text.includes("command shape unavailable")),
    );
    assert.ok(!summary.validations.some((entry) => entry.text.includes("rg -n")));
    assert.ok(!summary.validations.some((entry) => entry.text.includes("false-success")));
    assert.ok(!summary.validations.some((entry) => entry.text.includes("string-decoy")));
  } finally {
    rmSync(fixtureDir, { force: true, recursive: true });
  }
});

test("contains and redacts every generated Markdown metadata sink", () => {
  const fixtureMarker = "fixture-sensitive-marker";
  const userFixture =
    `Authorization: Bearer ${fixtureMarker}\r## Current Status\r\`backtick\`\r![fixture](https://example.invalid/pixel)\r<script>fixture-html</script>`;
  const markdown = buildMarkdown({
    branch: `main\n## branch-injection token=${fixtureMarker}`,
    changedFiles: [`![changed](https://example.invalid/x) token=${fixtureMarker}`],
    diffStat: `\`\`\`\n## diff-injection\ntoken=${fixtureMarker}`,
    generatedAt: "2026-07-12 00:00:05 MDT\n## timestamp-injection",
    generatedAtUtc: "2026-07-12T06:00:05.000Z",
    headSha: `fixture-head token=${fixtureMarker}`,
    latestCommitSessionId: null,
    latestCommitSubject: `![commit](https://example.invalid/y) token=${fixtureMarker}`,
    priorHandoffs: [`bad\`name token=${fixtureMarker}.md`],
    recentMessages: [{ timestamp: "now\n## injected", text: userFixture }],
    repoRoot: `/tmp/repo token=${fixtureMarker}`,
    rolloutSummary: {
      activity: [{ timestamp: "then\r## injected", text: userFixture }],
      userMessages: [],
      validations: [{ timestamp: "later\n## injected", text: userFixture }],
    },
    statusShort: `\`\`\`\n## status-injection\npassword=${fixtureMarker}`,
    thread: {
      id: "00000000-0000-4000-8000-000000000001",
      created_at_ms: Date.parse("2026-07-12T06:00:00.000Z"),
      cwd: `/tmp/cwd token=${fixtureMarker}`,
      first_user_message: userFixture,
      model: `model token=${fixtureMarker}`,
      rollout_path: `/tmp/rollout token=${fixtureMarker}.jsonl`,
      title: userFixture,
    },
  });

  assert.doesNotMatch(markdown, new RegExp(fixtureMarker, "g"));
  assert.equal(markdown.match(/^## Current Status$/gm)?.length, 1);
  assert.match(markdown, /^> ## Current Status$/m);
  assert.match(markdown, /^> &#96;backtick&#96;$/m);
  assert.doesNotMatch(markdown, /<script>|!\[fixture\]|!\[changed\]|!\[commit\]/);
  assert.match(markdown, /!&#91;fixture\]/);
  assert.match(markdown, /## status-injection/);
  assert.match(markdown, /## diff-injection/);
});

test("redacts and contains preserved handoff, pointer, and master sections", () => {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "session-handoff-preserved-"));
  const masterPath = path.join(fixtureDir, "SESSION_HANDOFF_MASTER.md");
  const secret = "fixture-preserved-marker";
  const generated = [
    "# Handoff",
    "",
    "## What Changed This Session",
    "",
    "- generated",
    "",
    "## Current Status",
    "",
    "- generated",
    "",
    "## Next Recommended Steps",
    "",
    "1. generated",
    "",
  ].join("\n");
  const existing = generated
    .replace("- generated", `token=${secret}\n## injected\n![pixel](https://example.invalid/x)`)
    .replace("- generated", `password=${secret}\r## pointer-injected`);

  try {
    const merged = mergeEditableSections(existing, generated);
    assert.doesNotMatch(merged, new RegExp(secret, "g"));
    assert.doesNotMatch(merged, /^## injected$/m);
    assert.doesNotMatch(merged, /!\[pixel\]/);
    assert.match(merged, /^&#35;# pointer-injected$/m);

    const pointer = buildCurrentPointer({
      generatedAt: "2026-07-12 00:00:05 MDT",
      generatedAtUtc: "2026-07-12T06:00:05.000Z",
      handoffFileName: `handoff token=${secret}.md`,
      handoffMarkdown: merged,
      masterFileName: `master token=${secret}.md`,
      sessionId: "00000000-0000-4000-8000-000000000001",
      threadTitle: `title token=${secret}`,
    });
    assert.doesNotMatch(pointer, new RegExp(secret, "g"));
    assert.equal(pointer.match(/^## Current Status$/gm)?.length, 1);

    writeFileSync(
      masterPath,
      `# Session Handoff Master\n\n## Pruned History\n\ntoken=${secret}\n## master-injected\n![pixel](https://example.invalid/y)\n`,
    );
    upsertMasterIndexEntry({
      generatedAt: "2026-07-12 00:00:05 MDT",
      masterPath,
      nextStep: `token=${secret}`,
      outputFileName: `handoff token=${secret}.md`,
      sessionId: "00000000-0000-4000-8000-000000000001",
      status: `password=${secret}`,
      threadTitle: `title token=${secret}`,
    });
    const master = readFileSync(masterPath, "utf8");
    assert.doesNotMatch(master, new RegExp(secret, "g"));
    assert.equal(master.match(/^## Pruned History$/gm)?.length, 1);
    assert.match(master, /^&#35;# master-injected$/m);
    assert.match(master, /!&#91;pixel\]/);
  } finally {
    rmSync(fixtureDir, { force: true, recursive: true });
  }
});

test("preserves editable sections when quoted user text repeats their headings", () => {
  const generated = [
    "# Handoff",
    "",
    "## Current User Request",
    "",
    "> ## Current Status",
    "> quoted user text",
    "",
    "## Prior Handoffs",
    "",
    "- prior",
    "",
    "## What Changed This Session",
    "",
    "- generated change",
    "",
    "## Current Status",
    "",
    "- generated status",
    "",
    "## Next Recommended Steps",
    "",
    "1. generated next step",
    "",
  ].join("\n");
  const existing = generated.replace(
    "- generated status",
    "- preserved status",
  );

  const merged = mergeEditableSections(existing, generated);

  assert.match(merged, /^## Current Status\n\n- preserved status$/m);
  assert.match(merged, /^## Prior Handoffs\n\n- prior$/m);
  assert.equal(merged.match(/^## Current Status$/gm)?.length, 1);
  assert.equal(merged.match(/^> ## Current Status$/gm)?.length, 1);
});

test("PT-HANDOFF-003 preserves all master rows across 40 concurrent writers", async () => {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "session-handoff-race-"));
  const masterPath = path.join(fixtureDir, "SESSION_HANDOFF_MASTER.md");
  const startPath = path.join(fixtureDir, "start");
  const writerUrl = new URL("./write-session-handoff.mjs", import.meta.url).href;
  const sessionIds = Array.from(
    { length: 40 },
    (_, index) =>
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );

  try {
    const workers = sessionIds.map((sessionId, index) => {
      const readyPath = path.join(fixtureDir, `ready-${index}`);
      const source = `
        import { existsSync, writeFileSync } from "node:fs";
        import { upsertMasterIndexEntry } from ${JSON.stringify(writerUrl)};
        writeFileSync(${JSON.stringify(readyPath)}, "");
        const sleeper = new Int32Array(new SharedArrayBuffer(4));
        while (!existsSync(${JSON.stringify(startPath)})) {
          Atomics.wait(sleeper, 0, 0, 10);
        }
        upsertMasterIndexEntry(${JSON.stringify({
          generatedAt: "2026-07-12 00:00:05 MDT",
          masterPath,
          nextStep: "Continue.",
          outputFileName: `SESSION_HANDOFF_${sessionId}.md`,
          sessionId,
          status: "Saved.",
          threadTitle: `worker-${index}`,
        })});
      `;
      return execFileAsync(
        process.execPath,
        ["--input-type=module", "--eval", source],
        { maxBuffer: 1024 * 1024 },
      );
    });

    let readyCount = 0;
    for (let attempt = 0; attempt < 500; attempt += 1) {
      readyCount = readdirSync(fixtureDir).filter((name) =>
        name.startsWith("ready-"),
      ).length;
      if (readyCount === sessionIds.length) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    writeFileSync(startPath, "");
    await Promise.all(workers);
    assert.equal(readyCount, sessionIds.length, "all workers reached the barrier");

    const master = readFileSync(masterPath, "utf8");
    assert.deepEqual(
      sessionIds.filter((sessionId) => !master.includes(sessionId)),
      [],
    );
  } finally {
    rmSync(fixtureDir, { force: true, recursive: true });
  }
});

test("PT-HANDOFF-004 accepts only the repo root and its descendants", () => {
  const repoRoot = path.join(tmpdir(), "session-handoff-scope", "repo");

  assert.equal(isPathWithin(repoRoot, repoRoot), true);
  assert.equal(isPathWithin(repoRoot, path.join(repoRoot, "nested")), true);
  assert.equal(isPathWithin(repoRoot, path.dirname(repoRoot)), false);
  assert.equal(isPathWithin(repoRoot, `${repoRoot}-sibling`), false);
});

test("PT-HANDOFF-005 truncates at Unicode code-point boundaries", () => {
  const truncated = oneLine("ab😀cd", 4);

  assert.equal(truncated, "ab😀…");
  assert.equal(Array.from(truncated).length, 4);
});
