#!/usr/bin/env node
import { createServer } from "node:http";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

const repoRoot = process.env.AGENT_CHAT_REPO_ROOT
  ? path.resolve(process.env.AGENT_CHAT_REPO_ROOT)
  : process.cwd();
const dataDir = path.join(repoRoot, ".agents", "agent-chat");
const legacyMessageFile = path.join(dataDir, "messages.jsonl");
const messageFile = process.env.AGENT_CHAT_MESSAGE_FILE
  ? path.resolve(process.env.AGENT_CHAT_MESSAGE_FILE)
  : path.join(repoRoot, "AGENT_CHAT_MESSAGES.jsonl");
const transcriptFile = process.env.AGENT_CHAT_TRANSCRIPT_FILE
  ? path.resolve(process.env.AGENT_CHAT_TRANSCRIPT_FILE)
  : path.join(repoRoot, "AGENT_CHAT.md");
const taskBoardFile = process.env.AGENT_CHAT_TASK_BOARD_FILE
  ? path.resolve(process.env.AGENT_CHAT_TASK_BOARD_FILE)
  : path.join(repoRoot, "AGENT_TASK_BOARD.md");
const serverFile = path.join(dataDir, "server.json");
const host = "127.0.0.1";
const requestedPort = Number.parseInt(
  process.env.AGENT_CHAT_PORT || "8765",
  10,
);
const port = Number.isFinite(requestedPort) && requestedPort >= 0
  ? requestedPort
  : 8765;
let activePort = port;

mkdirSync(dataDir, { recursive: true });

function ensureParentDir(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function isolateMessageTail() {
  if (!existsSync(messageFile)) return;
  const raw = readFileSync(messageFile);
  if (raw.length && raw.at(-1) !== 0x0a) appendFileSync(messageFile, "\n");
}

function migrateLegacyMessages() {
  ensureParentDir(messageFile);
  if (!existsSync(messageFile) && existsSync(legacyMessageFile)) {
    copyFileSync(legacyMessageFile, messageFile);
  }
  isolateMessageTail();
}

function nowIso() {
  return new Date().toISOString();
}

// ponytail: code-point caps avoid malformed UTF-16; use Intl.Segmenter if grapheme-perfect caps matter.
function truncateCodePoints(value, maxLength) {
  return [...value].slice(0, maxLength).join("");
}

const disallowedTextControls =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;

function isInvalidMessageString(value) {
  return typeof value === "string" &&
    (!value.isWellFormed() || disallowedTextControls.test(value));
}

function normalizeSender(value) {
  if (typeof value !== "string") {
    return "agent";
  }
  return truncateCodePoints(
    value.replace(/\s+/g, " ").replaceAll("`", "'").trim(),
    80,
  ) || "agent";
}

const utf8Decoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

function splitPhysicalLines(raw) {
  const lines = [];
  let start = 0;
  for (let end = 0; end <= raw.length; end += 1) {
    if (end === raw.length || raw[end] === 0x0a) {
      lines.push(raw.subarray(start, end));
      start = end + 1;
    }
  }
  return lines;
}

function readMessages() {
  let raw;
  try {
    raw = readFileSync(messageFile);
  } catch {
    return [];
  }

  return splitPhysicalLines(raw)
    .map((lineBytes, index) => {
      try {
        const line = utf8Decoder.decode(lineBytes);
        if (!line) return null;
        const message = JSON.parse(line);
        if (
          typeof message !== "object" ||
          message === null ||
          Array.isArray(message) ||
          typeof message.at !== "string" ||
          typeof message.text !== "string" ||
          isInvalidMessageString(message.at) ||
          isInvalidMessageString(message.from) ||
          isInvalidMessageString(message.text)
        ) {
          return null;
        }
        return {
          ...message,
          seq: index + 1,
          from: normalizeSender(message.from),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function escapeTableCell(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("`", "'")
    .replace(/\s+/g, " ")
    .trim();
}

function previewText(value, maxLength = 160) {
  const compact = String(value).replace(/\s+/g, " ").trim();
  return [...compact].length > maxLength
    ? `${truncateCodePoints(compact, maxLength - 3)}...`
    : compact;
}

function formatBlockquote(value) {
  return String(value)
    .split(/\r\n?|\n/)
    .flatMap((line) => (line.trim() ? [`> ${line}`] : [">"]))
    .join("\n");
}

function participantSummary(messages) {
  const counts = new Map();
  for (const message of messages) {
    counts.set(message.from, (counts.get(message.from) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  });
}

function formatTranscriptMessage(message) {
  return [
    `### #${message.seq} - \`${message.from}\``,
    "",
    `Time: \`${escapeTableCell(message.at)}\``,
    "",
    formatBlockquote(message.text),
    "",
    "---",
    "",
  ].join("\n");
}

function readTaskBoard() {
  try {
    return readFileSync(taskBoardFile, "utf8").trim();
  } catch {
    return "";
  }
}

function writeTranscript() {
  ensureParentDir(transcriptFile);
  const messages = readMessages();
  const participants = participantSummary(messages);
  const lastMessage = messages[messages.length - 1] ?? null;
  const taskBoard = readTaskBoard();
  const body = [
    "# Agent Coordination Chat",
    "",
    "> Ongoing local coordination transcript between agents working in this workspace.",
    "> This file is regenerated from `AGENT_CHAT_MESSAGES.jsonl` by the local chat endpoint.",
    "",
    "## Status",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Last rendered | \`${nowIso()}\` |`,
    `| Endpoint | \`http://${host}:${activePort}\` |`,
    `| Message log | \`${path.relative(repoRoot, messageFile)}\` |`,
    `| Transcript | \`${path.relative(repoRoot, transcriptFile)}\` |`,
    `| Task board | \`${path.relative(repoRoot, taskBoardFile)}\` |`,
    `| Total messages | ${messages.length} |`,
    `| Last message | ${lastMessage ? `#${lastMessage.seq} from \`${escapeTableCell(lastMessage.from)}\`` : "none"} |`,
    "",
    "## Task Board",
    "",
    taskBoard || "- No task board has been written yet.",
    "",
    "## Participants",
    "",
    participants.length
      ? participants
          .map(
            ([from, count]) =>
              `- \`${from}\` - ${count} message${count === 1 ? "" : "s"}`,
          )
          .join("\n")
      : "- None yet",
    "",
    "## Message Index",
    "",
    "| # | Time (UTC) | From | Preview |",
    "| ---: | --- | --- | --- |",
    ...messages.map(
      (message) =>
        `| ${message.seq} | \`${escapeTableCell(message.at)}\` | \`${escapeTableCell(
          message.from,
        )}\` | ${escapeTableCell(previewText(message.text))} |`,
    ),
    "",
    "## Messages",
    "",
    ...messages.map(formatTranscriptMessage),
  ].join("\n");
  writeFileSync(transcriptFile, body.endsWith("\n") ? body : `${body}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function appendMessage(input) {
  if (isInvalidMessageString(input.from) || isInvalidMessageString(input.text)) {
    const error = new Error(
      "message strings must contain well-formed Unicode without control characters",
    );
    error.statusCode = 400;
    throw error;
  }
  const from = normalizeSender(input.from);
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) {
    const error = new Error("message text is required");
    error.statusCode = 400;
    throw error;
  }

  const message = {
    at: nowIso(),
    from,
    text: truncateCodePoints(text, 12_000),
  };
  isolateMessageTail();
  appendFileSync(messageFile, `${JSON.stringify(message)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const seq = readMessages().at(-1)?.seq ?? 0;
  writeTranscript();
  return { seq, ...message };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bodyBytes = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) {
        return;
      }
      bodyBytes += chunk.length;
      if (bodyBytes > 64 * 1024) {
        rejected = true;
        reject(Object.assign(new Error("request body too large"), {
          statusCode: 413,
        }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!rejected) {
        resolve(Buffer.concat(chunks, bodyBytes));
      }
    });
    req.on("error", (error) => {
      if (!rejected) {
        reject(error);
      }
    });
  });
}

async function parseMessageRequest(req) {
  const mediaType = String(req.headers["content-type"] || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw Object.assign(new Error("content-type must be application/json"), {
      statusCode: 415,
    });
  }

  const bodyBytes = await readRequestBody(req);
  let body;
  try {
    body = utf8Decoder.decode(bodyBytes);
  } catch {
    throw Object.assign(new Error("request body must be valid UTF-8"), {
      statusCode: 400,
    });
  }
  let input;
  try {
    input = JSON.parse(body || "{}");
  } catch {
    throw Object.assign(new Error("request body must be valid JSON"), {
      statusCode: 400,
    });
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw Object.assign(new Error("request body must be a JSON object"), {
      statusCode: 400,
    });
  }
  return input;
}

function usageText(actualPort) {
  return [
    "Local agent chat endpoint",
    "",
    `Base URL: http://${host}:${actualPort}`,
    "",
    "Send:",
    `curl -sS -X POST http://${host}:${actualPort}/messages \\`,
    "  -H 'content-type: application/json' \\",
    "  -d '{\"from\":\"codex\",\"text\":\"message\"}'",
    "",
    "Read:",
    `curl -sS http://${host}:${actualPort}/messages`,
    "",
    "Stream:",
    `curl -N http://${host}:${actualPort}/stream`,
    "",
    `Visible transcript: ${transcriptFile}`,
    `Message log: ${messageFile}`,
    "",
  ].join("\n");
}

const server = createServer(async (req, res) => {
  try {
    if (req.headers.host !== `${host}:${activePort}`) {
      sendJson(res, 421, { error: "host must match the loopback endpoint" });
      return;
    }
    const url = new URL(req.url || "/", `http://${host}:${activePort}`);

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        pid: process.pid,
        messageFile,
        transcriptFile,
        at: nowIso(),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/messages") {
      const since = Number.parseInt(url.searchParams.get("since") || "0", 10);
      const messages = readMessages().filter((message) =>
        Number.isFinite(since) ? message.seq > since : true,
      );
      sendJson(res, 200, { messages });
      return;
    }

    if (req.method === "POST" && url.pathname === "/messages") {
      const message = appendMessage(await parseMessageRequest(req));
      sendJson(res, 201, { message });
      return;
    }

    if (req.method === "GET" && url.pathname === "/stream") {
      let lastSeq = Number.parseInt(url.searchParams.get("since") || "0", 10);
      if (!Number.isFinite(lastSeq)) lastSeq = 0;

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });

      const sendNewMessages = () => {
        for (const message of readMessages()) {
          if (message.seq <= lastSeq) continue;
          lastSeq = message.seq;
          res.write(`event: message\n`);
          res.write(`data: ${JSON.stringify(message)}\n\n`);
        }
      };

      sendNewMessages();
      const interval = setInterval(sendNewMessages, 1_000);
      req.on("close", () => clearInterval(interval));
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      sendText(res, 200, usageText(server.address().port));
      return;
    }

    sendJson(res, 404, { error: "not found" });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

migrateLegacyMessages();
writeTranscript();

server.listen(port, host, () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("agent chat server did not expose a TCP address");
  }
  const actualHost = address.address;
  const actualPort = address.port;
  activePort = actualPort;
  writeTranscript();
  const metadata = {
    host: actualHost,
    port: actualPort,
    baseUrl: `http://${actualHost}:${actualPort}`,
    pid: process.pid,
    startedAt: nowIso(),
    messageFile,
    transcriptFile,
  };
  writeFileSync(serverFile, `${JSON.stringify(metadata, null, 2)}\n`, {
    mode: 0o600,
  });
  process.stdout.write(`${usageText(actualPort)}\n`);
});
