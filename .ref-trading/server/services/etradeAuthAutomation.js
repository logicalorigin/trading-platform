import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildEtradeAuthorizeUrl,
  exchangeEtradeAccessToken,
  requestEtradeRequestToken,
} from "./etradeOAuth.js";

const PROFILE_ROOT = path.join("/tmp", "etrade-auth");
const AVAILABILITY_CACHE_MS = 60000;
let playwrightAvailabilityCache = null;

export async function detectPlaywrightAvailability(options = {}) {
  const force = Boolean(options.force);
  if (!force && playwrightAvailabilityCache) {
    const age = Date.now() - Number(playwrightAvailabilityCache.checkedAt || 0);
    if (age >= 0 && age < AVAILABILITY_CACHE_MS) {
      return playwrightAvailabilityCache.value;
    }
  }

  let value;
  try {
    const module = await import("playwright");
    if (!module?.chromium) {
      value = {
        available: false,
        reason: "Playwright chromium launcher missing",
      };
      playwrightAvailabilityCache = {
        checkedAt: Date.now(),
        value,
      };
      return value;
    }

    try {
      const browser = await module.chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      await browser.close();
      value = {
        available: true,
        reason: null,
      };
      playwrightAvailabilityCache = {
        checkedAt: Date.now(),
        value,
      };
      return value;
    } catch (launchError) {
      const reason = firstErrorLine(launchError?.message || "Playwright browser launch failed");
      value = {
        available: false,
        reason,
      };
      playwrightAvailabilityCache = {
        checkedAt: Date.now(),
        value,
      };
      return value;
    }
  } catch (error) {
    value = {
      available: false,
      reason: firstErrorLine(error?.message || "playwright package not installed"),
    };
    playwrightAvailabilityCache = {
      checkedAt: Date.now(),
      value,
    };
    return value;
  }
}

export async function runEtradeOAuthAutomation({
  accountId,
  consumerKey,
  consumerSecret,
  useSandbox,
  callbackUrl = "oob",
  username,
  password,
  totpSecret,
  timeoutMs = 120000,
  headless = true,
}) {
  if (!hasValue(username) || !hasValue(password)) {
    throw new Error("ETRADE_WEB_USERNAME and ETRADE_WEB_PASSWORD are required for automated E*TRADE auth");
  }

  const request = await requestEtradeRequestToken({
    consumerKey,
    consumerSecret,
    useSandbox,
    callbackUrl,
  });
  const authorizeUrl = buildEtradeAuthorizeUrl({
    consumerKey,
    requestToken: request.requestToken,
  });

  const playwrightInfo = await detectPlaywrightAvailability();
  if (!playwrightInfo.available) {
    return {
      status: "manual_required",
      reason: playwrightInfo.reason,
      requestToken: request.requestToken,
      requestTokenSecret: request.requestTokenSecret,
      authorizeUrl,
      callbackUrl,
    };
  }

  const { chromium } = await import("playwright");
  const userDataDir = path.join(PROFILE_ROOT, sanitizeSegment(accountId || "etrade"));
  await fs.mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    viewport: { width: 1280, height: 840 },
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(Math.min(timeoutMs, 30000));
    await page.goto(authorizeUrl, { waitUntil: "domcontentloaded" });

    await progressAuthorizationPage(page, { username, password, totpSecret });

    const verifier = await waitForVerifier({
      page,
      requestToken: request.requestToken,
      timeoutMs,
      username,
      password,
      totpSecret,
    });

    if (!verifier) {
      return {
        status: "manual_required",
        reason: "Verifier code not detected automatically",
        requestToken: request.requestToken,
        requestTokenSecret: request.requestTokenSecret,
        authorizeUrl,
        callbackUrl,
      };
    }

    const access = await exchangeEtradeAccessToken({
      consumerKey,
      consumerSecret,
      useSandbox,
      requestToken: request.requestToken,
      requestTokenSecret: request.requestTokenSecret,
      verifier,
    });

    return {
      status: "authenticated",
      verifier,
      requestToken: request.requestToken,
      requestTokenSecret: request.requestTokenSecret,
      authorizeUrl,
      accessToken: access.accessToken,
      accessSecret: access.accessSecret,
      issuedAt: access.issuedAt,
      etradeSessionDate: access.etradeSessionDate,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function progressAuthorizationPage(page, { username, password, totpSecret }) {
  const userSelectors = [
    'input[name="USER"]',
    'input[name="username"]',
    'input[id*="user" i]',
    'input[type="email"]',
    'input[autocomplete="username"]',
  ];
  const passSelectors = [
    'input[name="PASSWORD"]',
    'input[name="password"]',
    'input[id*="pass" i]',
    'input[type="password"]',
    'input[autocomplete="current-password"]',
  ];
  const otpSelectors = [
    'input[autocomplete="one-time-code"]',
    'input[name*="otp" i]',
    'input[id*="otp" i]',
    'input[name*="totp" i]',
    'input[id*="totp" i]',
    'input[name*="mfa" i]',
    'input[id*="mfa" i]',
    'input[name*="twofactor" i]',
    'input[id*="twofactor" i]',
    'input[name*="securityCode" i]',
    'input[id*="securityCode" i]',
  ];
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Log on")',
    'button:has-text("Log in")',
    'button:has-text("Continue")',
    'button:has-text("Verify")',
    'button:has-text("Submit")',
    'button:has-text("Authorize")',
    'button:has-text("Accept")',
    'button:has-text("Allow")',
    'a:has-text("Continue")',
    'a:has-text("Authorize")',
    'a:has-text("Accept")',
  ];

  const userFilled = hasValue(username)
    ? await fillFirst(page, userSelectors, username)
    : false;
  const passFilled = hasValue(password)
    ? await fillFirst(page, passSelectors, password)
    : false;
  const totpCode = resolveCurrentTotpCode(totpSecret);
  const otpFilled = hasValue(totpCode)
    ? await fillFirst(page, otpSelectors, totpCode, { replaceExisting: true })
    : false;

  const clicked = await clickFirst(page, submitSelectors);
  if (!clicked && (userFilled || passFilled || otpFilled)) {
    await page.keyboard.press("Enter").catch(() => {});
  }
}

async function fillFirst(page, selectors, value, options = {}) {
  const replaceExisting = Boolean(options.replaceExisting);
  for (const selector of selectors) {
    try {
      const nodes = page.locator(selector);
      const count = Math.min(await nodes.count(), 4);
      if (count === 0) {
        continue;
      }

      for (let index = 0; index < count; index += 1) {
        const field = nodes.nth(index);
        if (!(await field.isVisible().catch(() => true))) {
          continue;
        }
        const currentValue = String(await field.inputValue().catch(() => "")).trim();
        const nextValue = String(value);
        if (currentValue === nextValue) {
          return true;
        }
        if (currentValue && !replaceExisting) {
          return true;
        }
        await field.fill(String(value));
        return true;
      }
    } catch {
      // Try next selector.
    }
  }
  return false;
}

async function clickFirst(page, selectors) {
  for (const selector of selectors) {
    try {
      const nodes = page.locator(selector);
      const count = Math.min(await nodes.count(), 4);
      if (count === 0) {
        continue;
      }
      for (let index = 0; index < count; index += 1) {
        const node = nodes.nth(index);
        if (!(await node.isVisible().catch(() => true))) {
          continue;
        }
        await node.click();
        return true;
      }
    } catch {
      // Try next selector.
    }
  }
  return false;
}

async function waitForVerifier({
  page,
  requestToken,
  timeoutMs,
  username,
  password,
  totpSecret,
}) {
  const deadline = Date.now() + Math.max(10000, Number(timeoutMs) || 120000);
  while (Date.now() < deadline) {
    await progressAuthorizationPage(page, {
      username,
      password,
      totpSecret,
    });

    const fromUrl = extractVerifierFromUrl(page.url());
    if (hasValue(fromUrl)) {
      return fromUrl;
    }

    const fromPage = await extractVerifierFromPage(page);
    if (hasValue(fromPage)) {
      return fromPage;
    }

    const approved = await isApprovalComplete(page, requestToken);
    if (approved) {
      const urlVerifier = extractVerifierFromUrl(page.url());
      if (hasValue(urlVerifier)) {
        return urlVerifier;
      }
    }

    await page.waitForTimeout(1000);
  }

  return null;
}

function resolveCurrentTotpCode(secretValue) {
  const secret = extractTotpSecret(secretValue);
  if (!secret) {
    return "";
  }
  try {
    return generateTotp(secret);
  } catch {
    return "";
  }
}

function extractTotpSecret(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.toLowerCase().startsWith("otpauth://")) {
    try {
      const uri = new URL(text);
      return String(uri.searchParams.get("secret") || "").trim();
    } catch {
      return "";
    }
  }
  return text;
}

function generateTotp(secret, nowMs = Date.now(), digits = 6, periodSeconds = 30) {
  const normalizedSecret = decodeBase32(secret);
  if (!normalizedSecret.length) {
    throw new Error("Invalid TOTP secret");
  }

  const counter = Math.floor(nowMs / 1000 / periodSeconds);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac("sha1", normalizedSecret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = (
    ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff)
  );
  const otp = binary % (10 ** digits);
  return String(otp).padStart(digits, "0");
}

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = String(value || "").toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of cleaned) {
    const index = alphabet.indexOf(char);
    if (index < 0) {
      continue;
    }
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function extractVerifierFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.searchParams.get("oauth_verifier") || "";
  } catch {
    return "";
  }
}

async function extractVerifierFromPage(page) {
  try {
    const maybeInput = await page
      .locator('input[name*="verifier" i], input[id*="verifier" i], input[name*="code" i], input[id*="code" i]')
      .first();
    if ((await maybeInput.count()) > 0) {
      const value = String(await maybeInput.inputValue()).trim();
      if (/[A-Za-z0-9]{6,16}/.test(value)) {
        return value;
      }
    }
  } catch {
    // Ignore and continue with text extraction.
  }

  try {
    const text = await page.locator("body").innerText();
    const normalized = String(text || "").replace(/\s+/g, " ");
    const keywordMatch = normalized.match(/(?:verifier|verification code|verification|pin|code)\D{0,30}([A-Za-z0-9]{6,16})/i);
    if (keywordMatch?.[1]) {
      return keywordMatch[1];
    }
  } catch {
    // Ignore and continue.
  }

  return null;
}

async function isApprovalComplete(page, requestToken) {
  try {
    const url = page.url();
    if (url.includes("oauth_verifier=")) {
      return true;
    }

    const text = String(await page.locator("body").innerText()).toLowerCase();
    if (text.includes("authorized") && text.includes("oauth")) {
      return true;
    }
    if (hasValue(requestToken) && text.includes(String(requestToken).toLowerCase())) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function sanitizeSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "etrade";
}

function hasValue(value) {
  return value != null && String(value).trim().length > 0;
}

function firstErrorLine(message) {
  const text = String(message || "").trim();
  if (!text) {
    return "Unknown Playwright error";
  }
  return text.split("\n").find((line) => line.trim())?.trim() || text.slice(0, 180);
}
