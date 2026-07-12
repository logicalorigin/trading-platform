import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { createServer, Socket, type Server } from "node:net";
import { createServer as createTlsServer } from "node:tls";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const relayPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../capsule/pyrus-capsule-relay.py",
);

// Test-only self-signed localhost certificate and key.
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBfDCCASOgAwIBAgIURwkSmLn7jUFJXOTQP33rqV7jDoIwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDcxMjE3MjkyM1oXDTM2MDcwOTE3
MjkyM1owFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAEe6GHYI7acK9NIZeYPSGqQWRBgutY1efc2i7Mkr18dZ7bSvW/kpgzSPPw
rfpbntnEnsNzvYOrd2S2rGXsGsdy66NTMFEwHQYDVR0OBBYEFKtpvffJHcqViZdL
6a1pNQYy9Qr+MB8GA1UdIwQYMBaAFKtpvffJHcqViZdL6a1pNQYy9Qr+MA8GA1Ud
EwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDRwAwRAIgQLzkz6XspfE7BknZikz6+7Jq
2tDfWt1XLAX9Leo89RMCIGy8fRQ3SFEZsNjB6m+yCnHuciCKNAopFyb69XFfQAfl
-----END CERTIFICATE-----`;
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg+mfue5t36yBeUl5q
3Z7FzgXi6u3VcZ0rRj5ho3B67JahRANCAAR7oYdgjtpwr00hl5g9IapBZEGC61jV
59zaLsySvXx1nttK9b+SmDNI8/Ct+lue2cSew3O9g6t3ZLasZewax3Lr
-----END PRIVATE KEY-----`;
const TEST_CERT_SHA256 = createHash("sha256")
  .update(new X509Certificate(TEST_CERT).raw)
  .digest("hex");

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

test("capsule relay wraps the target in TLS only when its certificate matches", async () => {
  const target = createTlsServer(
    { cert: TEST_CERT, key: TEST_KEY },
    (socket) => socket.pipe(socket),
  );
  const targetPort = await listen(target);
  const relayPort = await reservePort();
  const relay = spawn(
    "python3",
    [relayPath, String(relayPort), String(targetPort), TEST_CERT_SHA256],
    { stdio: "ignore" },
  );
  const relayExit = once(relay, "exit");
  let socket: Socket | null = null;

  try {
    await waitForRelay(relayPort);
    socket = await connect(relayPort);
    assert.equal(await exchange(socket, "secure"), "secure");
  } finally {
    socket?.destroy();
    relay.kill("SIGTERM");
    target.close();
    await Promise.allSettled([relayExit, once(target, "close")]);
  }
});

test("capsule relay rejects a TLS target whose certificate does not match", async () => {
  let targetBytes = 0;
  const targetCloses: Array<Promise<unknown>> = [];
  const target = createTlsServer(
    { cert: TEST_CERT, key: TEST_KEY },
    (socket) => {
      targetCloses.push(once(socket, "close"));
      socket.on("data", (data) => {
        targetBytes += data.length;
      });
    },
  );
  const targetPort = await listen(target);
  const relayPort = await reservePort();
  const relay = spawn(
    "python3",
    [relayPath, String(relayPort), String(targetPort), "00".repeat(32)],
    { stdio: "ignore" },
  );
  const relayExit = once(relay, "exit");
  let socket: Socket | null = null;

  try {
    await waitForRelay(relayPort);
    socket = await connect(relayPort);
    const closed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("mismatched certificate was not rejected")),
        1_500,
      );
      socket?.once("data", () => {
        clearTimeout(timeout);
        reject(new Error("relay forwarded data through a mismatched certificate"));
      });
      socket?.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket?.once("error", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    socket.write("blocked");
    await closed;
    await Promise.allSettled([...targetCloses]);
    assert.equal(targetBytes, 0, "relay leaked data before certificate validation");
  } finally {
    socket?.destroy();
    relay.kill("SIGTERM");
    target.close();
    await Promise.allSettled([relayExit, once(target, "close")]);
  }
});
