import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer, Socket, type Server } from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const relayPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../capsule/pyrus-capsule-relay.py",
);

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return address.port;
}

async function reservePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  server.close();
  await once(server, "close");
  return port;
}

function connect(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    socket.once("error", reject);
    socket.connect(port, "127.0.0.1", () => {
      socket.off("error", reject);
      resolve(socket);
    });
  });
}

function exchange(socket: Socket, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("relay exchange timed out"));
    }, 1_500);
    socket.once("data", (data) => {
      clearTimeout(timeout);
      resolve(data.toString("utf8"));
    });
    socket.write(payload);
  });
}

function exchangeSlowly(socket: Socket, payload: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    const timeout = setTimeout(
      () => reject(new Error("large relay exchange timed out")),
      5_000,
    );
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      received += chunk.length;
      if (received >= payload.length) {
        clearTimeout(timeout);
        resolve(Buffer.concat(chunks, received));
      }
    });
    socket.pause();
    socket.write(payload);
    setTimeout(() => socket.resume(), 100);
  });
}

async function waitForRelay(port: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const socket = await connect(port);
      socket.destroy();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error("relay did not start");
}

test("capsule relay accepts a second browser connection while the first remains open", async () => {
  const target = createServer((socket) => socket.pipe(socket));
  const targetPort = await listen(target);
  const relayPort = await reservePort();
  const relay = spawn(
    "python3",
    [relayPath, String(relayPort), String(targetPort)],
    { stdio: "ignore" },
  );
  const relayExit = once(relay, "exit");
  const sockets: Socket[] = [];

  try {
    await waitForRelay(relayPort);
    const first = await connect(relayPort);
    sockets.push(first);
    assert.equal(await exchange(first, "first"), "first");

    const second = await connect(relayPort);
    sockets.push(second);
    assert.equal(await exchange(second, "second"), "second");
  } finally {
    for (const socket of sockets) socket.destroy();
    relay.kill("SIGTERM");
    target.close();
    await Promise.allSettled([relayExit, once(target, "close")]);
  }
});

test("capsule relay survives an unavailable target and accepts a later connection", async () => {
  const targetReservation = createServer();
  const targetPort = await listen(targetReservation);
  const relayPort = await reservePort();
  targetReservation.close();
  await once(targetReservation, "close");
  const relay = spawn(
    "python3",
    [relayPath, String(relayPort), String(targetPort)],
    { stdio: "ignore" },
  );
  const relayExit = once(relay, "exit");
  const target = createServer((socket) => socket.pipe(socket));
  let socket: Socket | null = null;

  try {
    await waitForRelay(relayPort);
    await new Promise((resolve) => setTimeout(resolve, 100));
    target.listen(targetPort, "127.0.0.1");
    await once(target, "listening");

    socket = await connect(relayPort);
    assert.equal(await exchange(socket, "recovered"), "recovered");
  } finally {
    socket?.destroy();
    relay.kill("SIGTERM");
    target.close();
    await Promise.allSettled([
      relayExit,
      target.listening ? once(target, "close") : Promise.resolve(),
    ]);
  }
});

test("capsule relay preserves a large transfer while the browser reads slowly", async () => {
  const target = createServer((socket) => socket.pipe(socket));
  const targetPort = await listen(target);
  const relayPort = await reservePort();
  const relay = spawn(
    "python3",
    [relayPath, String(relayPort), String(targetPort)],
    { stdio: "ignore" },
  );
  const relayExit = once(relay, "exit");
  let socket: Socket | null = null;

  try {
    await waitForRelay(relayPort);
    socket = await connect(relayPort);
    const payload = Buffer.alloc(2 * 1024 * 1024, 0x5a);
    assert.deepEqual(await exchangeSlowly(socket, payload), payload);
  } finally {
    socket?.destroy();
    relay.kill("SIGTERM");
    target.close();
    await Promise.allSettled([relayExit, once(target, "close")]);
  }
});
