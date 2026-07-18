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
const CONTROL_ACTION_PATTERN = /^(ensure|keepalive|release|status)$/;
const GRANT_NOT_AFTER_NS_PATTERN = /^[1-9][0-9]{0,18}$/;
const MAX_GRANT_NOT_AFTER_NS = 9_223_371_916_854_775_807n;
const VERSION = "1";
const RECEIPT_VERSION = "1";
const MAX_CLOCK_SKEW_SECONDS = 30;

export type IbkrHostControlHeaders = Record<string, string>;
export type IbkrHostControlAction =
  | "ensure"
  | "keepalive"
  | "release"
  | "status";
export type IbkrHostLeaseGrant = {
  version: 1;
  bootId: string;
  grantNotAfterNs: string;
};
export type IbkrHostLeaseRequest = IbkrHostLeaseGrant & {
  controlAttemptId: string;
};

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

type SignReceiptInput = {
  action: IbkrHostControlAction;
  body: string | Uint8Array;
  controlAttemptId: string;
  hostId: string;
  key: Uint8Array;
  status: number;
};

type VerifyReceiptInput = Omit<SignReceiptInput, "hostId"> & {
  expectedHostId: string;
  headers: Record<string, string | string[] | undefined>;
};

function isValidKey(key: Uint8Array): boolean {
  return key.byteLength === 32;
}

function isValidReceiptBody(value: unknown): value is string | Uint8Array {
  return typeof value === "string" || value instanceof Uint8Array;
}

function isValidMethod(method: string): boolean {
  return /^[A-Z]{3,10}$/.test(method);
}

function isIbkrHostLeaseRequest(value: unknown): value is IbkrHostLeaseRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === 4 &&
    keys.every((key) =>
      ["bootId", "controlAttemptId", "grantNotAfterNs", "version"].includes(
        key,
      ),
    ) &&
    record.version === 1 &&
    typeof record.bootId === "string" &&
    HOST_ID_PATTERN.test(record.bootId) &&
    typeof record.grantNotAfterNs === "string" &&
    GRANT_NOT_AFTER_NS_PATTERN.test(record.grantNotAfterNs) &&
    BigInt(record.grantNotAfterNs) <= MAX_GRANT_NOT_AFTER_NS &&
    typeof record.controlAttemptId === "string" &&
    HOST_ID_PATTERN.test(record.controlAttemptId)
  );
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

function canonicalReceipt(input: {
  action: IbkrHostControlAction;
  contentDigest: string;
  controlAttemptId: string;
  hostId: string;
  status: number;
}): string {
  return [
    "PYRUS-IBKR-HOST-CONTROL-RECEIPT-V1",
    input.hostId,
    input.controlAttemptId,
    input.action,
    String(input.status),
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

export function parseIbkrHostLeaseRequest(
  body: string,
): IbkrHostLeaseRequest | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return isIbkrHostLeaseRequest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function serializeIbkrHostLeaseRequest(
  request: IbkrHostLeaseRequest,
): string {
  if (!isIbkrHostLeaseRequest(request)) {
    throw new Error("Invalid IBKR host lease request.");
  }
  return JSON.stringify({
    version: request.version,
    bootId: request.bootId,
    grantNotAfterNs: request.grantNotAfterNs,
    controlAttemptId: request.controlAttemptId,
  });
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
  if (
    expected.byteLength !== provided.byteLength ||
    !timingSafeEqual(expected, provided)
  ) {
    return { valid: false };
  }
  return { nonce, timestampSeconds, valid: true };
}

export function signIbkrHostControlReceipt(
  input: SignReceiptInput,
): IbkrHostControlHeaders {
  if (
    !CONTROL_ACTION_PATTERN.test(input.action) ||
    !isValidReceiptBody(input.body) ||
    !HOST_ID_PATTERN.test(input.controlAttemptId) ||
    !HOST_ID_PATTERN.test(input.hostId) ||
    !isValidKey(input.key) ||
    !Number.isSafeInteger(input.status) ||
    input.status < 100 ||
    input.status > 599
  ) {
    throw new Error("Invalid IBKR host control receipt signing input.");
  }
  const contentDigest = bodyDigest(input.body);
  const signature = createHmac("sha256", input.key)
    .update(
      canonicalReceipt({
        action: input.action,
        contentDigest,
        controlAttemptId: input.controlAttemptId,
        hostId: input.hostId,
        status: input.status,
      }),
    )
    .digest("hex");
  return {
    "x-pyrus-control-receipt": `Pyrus-HMAC-SHA256 ${signature}`,
    "x-pyrus-control-receipt-version": RECEIPT_VERSION,
  };
}

export function verifyIbkrHostControlReceipt(
  input: VerifyReceiptInput,
): boolean {
  const signature = normalizedHeader(input.headers, "x-pyrus-control-receipt");
  const version = normalizedHeader(
    input.headers,
    "x-pyrus-control-receipt-version",
  );
  const signatureMatch = signature?.match(SIGNATURE_PATTERN);
  if (
    !signatureMatch ||
    version !== RECEIPT_VERSION ||
    !CONTROL_ACTION_PATTERN.test(input.action) ||
    !isValidReceiptBody(input.body) ||
    !HOST_ID_PATTERN.test(input.controlAttemptId) ||
    !HOST_ID_PATTERN.test(input.expectedHostId) ||
    !isValidKey(input.key) ||
    !Number.isSafeInteger(input.status) ||
    input.status < 100 ||
    input.status > 599
  ) {
    return false;
  }
  const expected = createHmac("sha256", input.key)
    .update(
      canonicalReceipt({
        action: input.action,
        contentDigest: bodyDigest(input.body),
        controlAttemptId: input.controlAttemptId,
        hostId: input.expectedHostId,
        status: input.status,
      }),
    )
    .digest();
  const provided = Buffer.from(signatureMatch[1], "hex");
  return (
    expected.byteLength === provided.byteLength &&
    timingSafeEqual(expected, provided)
  );
}
