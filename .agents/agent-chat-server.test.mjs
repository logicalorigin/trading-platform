import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const serverScript = fileURLToPath(
  new URL("./agent-chat-server.mjs", import.meta.url),
);

const waitForServerMetadata = async (filePath) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("agent chat server did not write metadata");
};

const postJsonWithHost = ({ port, host, body }) => new Promise((resolve, reject) => {
  const req = request({
    hostname: "127.0.0.1",
    port,
    path: "/messages",
    method: "POST",
    headers: { host, "content-type": "application/json" },
  }, (res) => {
    res.resume();
    res.on("end", () => resolve(res.statusCode));
  });
  req.on("error", reject);
  req.end(Buffer.isBuffer(body) ? body : JSON.stringify(body));
});

test("chat preserves local JSONL, HTTP, Unicode, and Markdown boundaries", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "agent-chat-server-"));
  const metadataPath = path.join(repoRoot, ".agents", "agent-chat", "server.json");
  const messagePath = path.join(repoRoot, "AGENT_CHAT_MESSAGES.jsonl");
  const transcriptPath = path.join(repoRoot, "AGENT_CHAT.md");
  writeFileSync(
    messagePath,
    `incomplete legacy record\n\n[]\n${JSON.stringify({ at: 42, text: null })}\n${JSON.stringify({
      at: "2026-07-12T00:00:00.000Z",
      from: "legacy",
      text: "\ud800",
    })}\n${JSON.stringify({
      at: "2026-07-12T00:00:00.000Z",
      from: "legacy",
      text: "hello\u0000world",
    })}\n${JSON.stringify({
      at: "2026-07-12T00:00:00.000Z",
      from: "legacy",
      text: "badXbyte",
    })}\n${JSON.stringify({
      seq: "7\r## Forged Seq",
      at: "2026-07-12T00:00:00.000Z`\r## Forged Time",
      from: "legacy`\n## Forged",
      text: "legacy message",
    })}`,
  );
  const persisted = readFileSync(messagePath);
  const invalidByteOffset = persisted.indexOf("badXbyte");
  assert.notEqual(invalidByteOffset, -1);
  persisted[invalidByteOffset + 3] = 0x80;
  writeFileSync(messagePath, persisted);
  const child = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      AGENT_CHAT_HOST: "0.0.0.0",
      AGENT_CHAT_PORT: "0",
      AGENT_CHAT_REPO_ROOT: repoRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const childExit = new Promise((resolve) => child.once("exit", resolve));

  try {
    const metadata = await Promise.race([
      waitForServerMetadata(metadataPath),
      childExit.then(() => {
        throw new Error(`agent chat server exited before startup: ${stderr}`);
      }),
    ]);
    assert.equal(metadata.host, "127.0.0.1");

    assert.equal(await postJsonWithHost({
      port: metadata.port,
      host: `agent-chat.invalid:${metadata.port}`,
      body: { from: "worker", text: "foreign host" },
    }), 421);

    const plainResponse = await fetch(`http://127.0.0.1:${metadata.port}/messages`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "forged message",
    });
    assert.equal(plainResponse.status, 415);

    const malformedResponse = await fetch(
      `http://127.0.0.1:${metadata.port}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    );
    assert.equal(malformedResponse.status, 400);

    const arrayResponse = await fetch(`http://127.0.0.1:${metadata.port}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "[]",
    });
    assert.equal(arrayResponse.status, 400);

    const invalidUtf8Response = await postJsonWithHost({
      port: metadata.port,
      host: `127.0.0.1:${metadata.port}`,
      body: Buffer.concat([
        Buffer.from('{"from":"worker","text":"bad'),
        Buffer.from([0x80]),
        Buffer.from('byte"}'),
      ]),
    });
    assert.equal(invalidUtf8Response, 400);

    for (const malformedBody of [
      { from: "worker", text: "\ud800" },
      { from: "worker", text: "\udc00" },
      { from: "worker", text: "hello\u0000world" },
      { from: "worker\u0000", text: "normal message" },
    ]) {
      const malformedUnicodeResponse = await fetch(
        `http://127.0.0.1:${metadata.port}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(malformedBody),
        },
      );
      assert.equal(malformedUnicodeResponse.status, 400);
    }

    const oversizedResponse = await fetch(
      `http://127.0.0.1:${metadata.port}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: "worker", text: "€".repeat(24_000) }),
      },
    );
    assert.equal(oversizedResponse.status, 413);

    const jsonResponse = await fetch(`http://127.0.0.1:${metadata.port}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "worker`\n## Forged",
        text: "normal message\r## Forged From Text",
      }),
    });
    assert.equal(jsonResponse.status, 201);
    const postedMessage = (await jsonResponse.json()).message;
    assert.equal(postedMessage.seq, 9);

    const unicodeResponse = await fetch(
      `http://127.0.0.1:${metadata.port}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: `${"s".repeat(79)}😀x`,
          text: `${"t".repeat(11_999)}😀x`,
        }),
      },
    );
    assert.equal(unicodeResponse.status, 201);
    assert.equal((await unicodeResponse.json()).message.seq, 10);

    const messagesResponse = await fetch(
      `http://127.0.0.1:${metadata.port}/messages`,
    );
    const { messages } = await messagesResponse.json();
    assert.deepEqual(
      messages.slice(0, 2).map(({ seq, text }) => ({ seq, text })),
      [
        { seq: 8, text: "legacy message" },
        { seq: 9, text: "normal message\r## Forged From Text" },
      ],
    );
    assert.equal(messages[2].seq, 10);
    assert.match(messages[2].from, /^s{79}😀$/u);
    assert.match(messages[2].text, /^t{11999}😀$/u);

    appendFileSync(messagePath, JSON.stringify({
      at: "2026-07-12T00:00:00.000Z",
      from: "external",
      text: "external no-LF message",
    }));
    const liveTailResponse = await fetch(
      `http://127.0.0.1:${metadata.port}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: "worker", text: "message after live tail" }),
      },
    );
    assert.equal(liveTailResponse.status, 201);
    assert.equal((await liveTailResponse.json()).message.seq, 12);
    const messagesAfterTailResponse = await fetch(
      `http://127.0.0.1:${metadata.port}/messages?since=10`,
    );
    const { messages: messagesAfterTail } = await messagesAfterTailResponse.json();
    assert.deepEqual(
      messagesAfterTail.map(({ seq, text }) => ({ seq, text })),
      [
        { seq: 11, text: "external no-LF message" },
        { seq: 12, text: "message after live tail" },
      ],
    );

    const beforeBlankRepair = readFileSync(messagePath);
    const blankOffset = beforeBlankRepair.indexOf("\n\n");
    assert.notEqual(blankOffset, -1);
    const repairedBlankRow = Buffer.from(`${JSON.stringify({
      at: "2026-07-12T00:00:00.000Z",
      from: "legacy",
      text: "repaired blank row",
    })}\n`);
    writeFileSync(messagePath, Buffer.concat([
      beforeBlankRepair.subarray(0, blankOffset + 1),
      repairedBlankRow,
      beforeBlankRepair.subarray(blankOffset + 2),
    ]));
    const afterRepairResponse = await fetch(
      `http://127.0.0.1:${metadata.port}/messages?since=${messagesAfterTail.at(-1).seq}`,
    );
    assert.deepEqual((await afterRepairResponse.json()).messages, []);

    const transcript = readFileSync(transcriptPath, "utf8");
    const unicodePreview = transcript
      .split("\n")
      .find((line) => line.startsWith("| 10 |"))
      ?.replace(/^.* \| (.*) \|$/, "$1");
    assert.equal([...unicodePreview].length, 160);
    assert.doesNotMatch(transcript, /^## Forged/m);
    assert.doesNotMatch(transcript, /�/);
    assert.doesNotMatch(transcript, /\u0000/);
    assert.match(transcript, /normal message/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
    await childExit;
    rmSync(repoRoot, { force: true, recursive: true });
  }

  assert.equal(stderr, "");
});
