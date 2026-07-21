import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";
import type { Readable } from "node:stream";

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENTRYPOINT_PATH = path.resolve(
  SOURCE_DIR,
  "../capsule/pyrus-capsule-entrypoint",
);

function shellFunction(source: string, name: string): string {
  const match = source.match(
    new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, "m"),
  );
  assert.ok(match, `expected ${name} in the capsule entrypoint`);
  return match[0];
}

test("capsule readiness probes preserve the inherited marker descriptor", async () => {
  const entrypoint = await readFile(ENTRYPOINT_PATH, "utf8");
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    socket.end("HTTP/1.0 200 OK\r\nContent-Length: 0\r\n\r\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const script = [
      "set -Eeuo pipefail",
      shellFunction(entrypoint, "wait_for_port"),
      shellFunction(entrypoint, "wait_for_cpg_login"),
      `wait_for_port ${address.port} 2`,
      `wait_for_cpg_login ${address.port} 2`,
      "printf 'marker-channel-survives\\n' >&3",
    ].join("\n");
    const child = spawn("bash", ["-c", script], {
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    });
    const marker = child.stdio[3] as Readable;
    const stderr = child.stderr;
    assert.ok(stderr);
    const markerChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    marker.on("data", (chunk: Buffer) => markerChunks.push(chunk));
    stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const [code, signal] = (await once(child, "close")) as [
      number | null,
      NodeJS.Signals | null,
    ];
    assert.equal(signal, null);
    assert.equal(
      code,
      0,
      Buffer.concat(stderrChunks).toString("utf8").trim(),
    );
    assert.equal(
      Buffer.concat(markerChunks).toString("utf8"),
      "marker-channel-survives\n",
    );
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});
