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

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const CHANNEL = path.join(ROOT, "AGENT_CHAT_LIVE.jsonl");
const USAGE =
  'usage: agent-chat.mjs post <handle> "<text>"  |  read [--since <iso>] [--from <h>] [--not-from <h>] [--tail <n>]';
const READ_OPTION_KEYS = new Map([
  ["--since", "since"],
  ["--from", "from"],
  ["--not-from", "not-from"],
  ["--tail", "tail"],
]);

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

export function parseReadOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const key = READ_OPTION_KEYS.get(flag);
    const value = args[index + 1];
    if (!key)
      throw new Error(`unknown read option: ${formatTerminalField(flag)}`);
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    if (Object.hasOwn(options, key))
      throw new Error(`duplicate read option: ${flag}`);
    if (key === "tail") {
      const tail = Number(value);
      if (!Number.isSafeInteger(tail) || tail < 0) {
        throw new Error("--tail must be a non-negative integer");
      }
      options[key] = tail;
    } else if (key === "since") {
      if (!Number.isFinite(Date.parse(value))) {
        throw new Error("--since must be a valid ISO timestamp");
      }
      options[key] = new Date(value).toISOString();
    } else {
      options[key] = value;
    }
  }
  return options;
}

function formatTerminalField(value) {
  return JSON.stringify(String(value))
    .slice(1, -1)
    .replace(
      /[\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu,
      (character) =>
        `\\u${character.codePointAt(0).toString(16).padStart(4, "0")}`,
    );
}

export function formatMessage(message) {
  return `[${formatTerminalField(message.at)}] ${formatTerminalField(message.from)}: ${formatTerminalField(message.text)}`;
}

export function run(args = process.argv.slice(2)) {
  const [cmd, ...rest] = args;
  if (cmd === "post") {
    const from = rest[0];
    const text = rest.slice(1).join(" ");
    if (!from || !text) {
      console.error('usage: post <handle> "<text>"');
      return 1;
    }
    appendFileSync(
      CHANNEL,
      JSON.stringify({ at: new Date().toISOString(), from, text }) + "\n",
    );
    console.log(
      `posted to ${path.relative(ROOT, CHANNEL)} as "${formatTerminalField(from)}"`,
    );
    return 0;
  }

  if (cmd !== "read") {
    console.error(USAGE);
    return 1;
  }

  let opts;
  try {
    opts = parseReadOptions(rest);
  } catch (error) {
    console.error(`error: ${error.message}`);
    console.error(USAGE);
    return 1;
  }
  let msgs = readAll();
  if (opts.since !== undefined) msgs = msgs.filter((m) => m.at > opts.since);
  if (opts.from !== undefined) msgs = msgs.filter((m) => m.from === opts.from);
  if (opts["not-from"] !== undefined) {
    msgs = msgs.filter((m) => m.from !== opts["not-from"]);
  }
  if (opts.tail !== undefined) {
    msgs = opts.tail === 0 ? [] : msgs.slice(-opts.tail);
  }
  for (const message of msgs) console.log(formatMessage(message));
  if (!msgs.length) console.log("(no messages)");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  process.exitCode = run();
}
