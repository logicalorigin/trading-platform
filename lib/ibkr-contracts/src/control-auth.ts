import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const HOST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const NONCE_PATTERN = /^[a-f0-9]{32}$/;
const SIGNATURE_PATTERN = /^Pyrus-HMAC-SHA256 ([a-f0-9]{64})$/;
const TIMESTAMP_PATTERN = /^(0|[1-9][0-9]{0,10})$/;
const VERSION = "1";
const MAX_CLOCK_SKEW_SECONDS = 30;

export type IbkrHostControlHeaders = Record<string, string>;

type SignInput = {
  body?: string | Uint8Array;
  hostId: string;
  key: Uint8Array;
  method: string;
  nonce?: string;
  path: string;
  timestampSeconds?: number;
};

type VerifyInput = {
  body?: string | Uint8Array;
  expectedHostId: string;
  headers: Record<string, string | string[] | undefined>;
  key: Uint8Array;
  maxClockSkewSeconds?: number;
  method: string;
  nowSeconds?: number;
  path: string;
};

export type IbkrHostControlVerification =
  | { valid: false }
  | { nonce: string; timestampSeconds: number; valid: true };

function isValidKey(key: Uint8Array): boolean {
  return key.byteLength === 32;
}

function isValidMethod(method: string): boolean {
  return /^[A-Z]{3,10}$/.test(method);
}

function isValidPath(path: string): boolean {
  return path.startsWith("/") && path.length <= 4_096 && !/[\r\n\0]/.test(path);
}

function bodyDigest(body: string | Uint8Array | undefined): string {
  return createHash("sha256")
    .update(body ?? "")
    .digest("hex");
}

function canonicalRequest(input: {
  contentDigest: string;
  hostId: string;
  method: string;
  nonce: string;
  path: string;
  timestamp: string;
}): string {
  return [
    "PYRUS-IBKR-HOST-CONTROL-V1",
    input.hostId,
    input.timestamp,
    input.nonce,
    input.method,
    input.path,
    input.contentDigest,
  ].join("\n");
}

function normalizedHeader(
  headers: VerifyInput["headers"],
  name: string,
): string | null {
  const value = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === name,
  )?.[1];
  return typeof value === "string" ? value : null;
}

export function decodeIbkrHostControlKey(value: string): Buffer | null {
  if (!KEY_PATTERN.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  return decoded.byteLength === 32 && decoded.toString("base64url") === value
    ? decoded
    : null;
}

export function deriveIbkrHostControlKey(
  rootKey: Uint8Array,
  hostId: string,
): Buffer {
  if (!isValidKey(rootKey) || !HOST_ID_PATTERN.test(hostId)) {
    throw new Error("Invalid IBKR host control key derivation input.");
  }
  return createHmac("sha256", rootKey)
    .update(`PYRUS-IBKR-HOST-CONTROL-KEY-V1\0${hostId}`)
    .digest();
}

export function signIbkrHostControlRequest(
  input: SignInput,
): IbkrHostControlHeaders {
  const timestampSeconds =
    input.timestampSeconds ?? Math.floor(Date.now() / 1_000);
  const nonce = input.nonce ?? randomBytes(16).toString("hex");
  if (
    !HOST_ID_PATTERN.test(input.hostId) ||
    !isValidKey(input.key) ||
    !isValidMethod(input.method) ||
    !isValidPath(input.path) ||
    !Number.isSafeInteger(timestampSeconds) ||
    timestampSeconds < 0 ||
    !NONCE_PATTERN.test(nonce)
  ) {
    throw new Error("Invalid IBKR host control signing input.");
  }
  const timestamp = String(timestampSeconds);
  const contentDigest = bodyDigest(input.body);
  const signature = createHmac("sha256", input.key)
    .update(
      canonicalRequest({
        contentDigest,
        hostId: input.hostId,
        method: input.method,
        nonce,
        path: input.path,
        timestamp,
      }),
    )
    .digest("hex");
  return {
    authorization: `Pyrus-HMAC-SHA256 ${signature}`,
    "x-pyrus-control-content-sha256": contentDigest,
    "x-pyrus-control-host": input.hostId,
    "x-pyrus-control-nonce": nonce,
    "x-pyrus-control-timestamp": timestamp,
    "x-pyrus-control-version": VERSION,
  };
}

export function verifyIbkrHostControlRequest(
  input: VerifyInput,
): IbkrHostControlVerification {
  const authorization = normalizedHeader(input.headers, "authorization");
  const contentDigest = normalizedHeader(
    input.headers,
    "x-pyrus-control-content-sha256",
  );
  const hostId = normalizedHeader(input.headers, "x-pyrus-control-host");
  const nonce = normalizedHeader(input.headers, "x-pyrus-control-nonce");
  const timestamp = normalizedHeader(
    input.headers,
    "x-pyrus-control-timestamp",
  );
  const version = normalizedHeader(input.headers, "x-pyrus-control-version");
  const signatureMatch = authorization?.match(SIGNATURE_PATTERN);
  if (
    !signatureMatch ||
    contentDigest !== bodyDigest(input.body) ||
    hostId !== input.expectedHostId ||
    !HOST_ID_PATTERN.test(input.expectedHostId) ||
    !isValidKey(input.key) ||
    !isValidMethod(input.method) ||
    !isValidPath(input.path) ||
    !nonce ||
    !NONCE_PATTERN.test(nonce) ||
    !timestamp ||
    !TIMESTAMP_PATTERN.test(timestamp) ||
    version !== VERSION
  ) {
    return { valid: false };
  }
  const timestampSeconds = Number(timestamp);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const maxClockSkewSeconds =
    input.maxClockSkewSeconds ?? MAX_CLOCK_SKEW_SECONDS;
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    !Number.isSafeInteger(nowSeconds) ||
    !Number.isSafeInteger(maxClockSkewSeconds) ||
    maxClockSkewSeconds < 0 ||
    Math.abs(nowSeconds - timestampSeconds) > maxClockSkewSeconds
  ) {
    return { valid: false };
  }
  const expected = Buffer.from(
    createHmac("sha256", input.key)
      .update(
        canonicalRequest({
          contentDigest,
          hostId,
          method: input.method,
          nonce,
          path: input.path,
          timestamp,
        }),
      )
      .digest("hex"),
    "hex",
  );
  const provided = Buffer.from(signatureMatch[1], "hex");
  return expected.byteLength === provided.byteLength &&
    timingSafeEqual(expected, provided)
    ? { nonce, timestampSeconds, valid: true }
    : { valid: false };
}
