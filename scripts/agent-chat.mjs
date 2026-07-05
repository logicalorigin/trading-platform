#!/usr/bin/env node
// Minimal in-repo agent chat channel — a shared-filesystem message bus for
// concurrent Claude/Codex agents working the same workspace. No server/port:
// every agent here shares /home/runner/workspace, so an append-only JSONL file
// is the channel. One JSON object per line: {at, from, text}. Mentions are just
// "@handle" inside text. Compatible with the legacy AGENT_CHAT_MESSAGES.jsonl
// schema.
//
//   node scripts/agent-chat.mjs post <handle> "<text>"
//   node scripts/agent-chat.mjs read [--since <iso>] [--from <h>] [--not-from <h>] [--tail <n>]
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHANNEL = path.join(ROOT, "AGENT_CHAT_LIVE.jsonl");

const [, , cmd, ...rest] = process.argv;

function readAll() {
  if (!existsSync(CHANNEL)) return [];
  return readFileSync(CHANNEL, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

if (cmd === "post") {
  const from = rest[0];
  const text = rest.slice(1).join(" ");
  if (!from || !text) {
    console.error('usage: post <handle> "<text>"');
    process.exit(1);
  }
  appendFileSync(
    CHANNEL,
    JSON.stringify({ at: new Date().toISOString(), from, text }) + "\n",
  );
  console.log(`posted to ${path.relative(ROOT, CHANNEL)} as "${from}"`);
} else if (cmd === "read") {
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    opts[rest[i].replace(/^--/, "")] = rest[i + 1];
  }
  let msgs = readAll();
  if (opts.since) msgs = msgs.filter((m) => m.at > opts.since);
  if (opts.from) msgs = msgs.filter((m) => m.from === opts.from);
  if (opts["not-from"]) msgs = msgs.filter((m) => m.from !== opts["not-from"]);
  if (opts.tail) msgs = msgs.slice(-Number(opts.tail));
  for (const m of msgs) console.log(`[${m.at}] ${m.from}: ${m.text}`);
  if (!msgs.length) console.log("(no messages)");
} else {
  console.error(
    'usage: agent-chat.mjs post <handle> "<text>"  |  read [--since <iso>] [--from <h>] [--not-from <h>] [--tail <n>]',
  );
  process.exit(1);
}
