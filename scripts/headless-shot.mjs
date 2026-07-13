#!/usr/bin/env node
/**
 * Repo-native headless browser helper.
 *
 * Drives Chromium via the already-installed `@playwright/test`, pointed at the
 * Chromium binary Replit provides through its Nix Playwright module
 * (`REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`). The required shared libraries are
 * declared in `replit.nix`, so this works in the Replit container with NO
 * `playwright install` / `install-deps` step and survives container rebuilds.
 *
 * Outside Replit (CI, local) the env var is unset and Playwright falls back to
 * its own downloaded browser — run `pnpm exec playwright install chromium` once.
 *
 * Usage:
 *   node scripts/headless-shot.mjs <url> [options]
 *
 * Options:
 *   --out <path>        Screenshot output path (default: ./.headless-shots/shot-<ts>.png)
 *   --wait <ms>         Fixed settle wait after load (default: 6000). The platform
 *                       holds open SSE streams, so `networkidle` never fires — use a
 *                       fixed wait or --wait-for.
 *   --wait-for <css>    Wait for a selector to appear instead of the fixed wait.
 *   --settle <ms>       Extra settle wait AFTER --wait-for resolves (for data to
 *                       paint once the loaded-shell selector appears). Default 0.
 *   --storage-state <p> Playwright storageState JSON (cookies) to load an
 *                       authenticated session. Default: anonymous.
 *   --viewport <WxH>    Viewport size (default: 1440x900).
 *   --full              Capture the full scrollable page (default: viewport only).
 *   --match <substr>    Repeatable. Count network request paths containing <substr>
 *                       and report them (handy for "one call, not per-row" checks).
 *   --json              Print a machine-readable JSON summary instead of prose.
 *   --fail-on-console   Exit 1 if any console errors were logged.
 *
 * Examples:
 *   node scripts/headless-shot.mjs "https://$REPLIT_DEV_DOMAIN/?screen=market-demo" --out /tmp/demo.png
 *   node scripts/headless-shot.mjs http://127.0.0.1:18747/ --wait-for '[data-testid="market-demo-screen"]' --json
 */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import { parseArgs, stripVTControlCharacters } from "node:util";
import { fileURLToPath } from "node:url";

const USAGE =
  "Usage: node scripts/headless-shot.mjs <url> [--out path.png] [--wait ms] [--wait-for css] [--settle ms] [--storage-state path] [--viewport WxH] [--full] [--match substr] [--json] [--fail-on-console]";
const CONTROL_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const SECRET_QUERY_PATTERN =
  /^(?:code|credential|jwt|nonce|sid|sig|signature|state|.*(?:token|secret|password|passwd|api[-_]?key|auth|session|cookie))$/i;

export function safeText(value, maxCodePoints = 300) {
  const clean = stripVTControlCharacters(String(value ?? ""))
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const points = Array.from(clean);
  return points.length > maxCodePoints
    ? `${points.slice(0, maxCodePoints).join("")}…`
    : clean;
}

function plainOption(name, value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} requires a nonempty value`);
  }
  if (
    CONTROL_PATTERN.test(value) ||
    stripVTControlCharacters(value) !== value
  ) {
    throw new Error(`${name} contains unsupported control characters`);
  }
  return value;
}

function nonnegativeInteger(name, value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a nonnegative integer`);
  }
  return parsed;
}

function navigationUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("url must be a valid HTTP(S) URL");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error("url must be credential-free HTTP(S)");
  }
  return parsed.href;
}

export function redactUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (SECRET_QUERY_PATTERN.test(key)) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }
    const fragment = new URLSearchParams(parsed.hash.slice(1));
    let fragmentChanged = false;
    for (const key of [...fragment.keys()]) {
      if (SECRET_QUERY_PATTERN.test(key)) {
        fragment.set(key, "[redacted]");
        fragmentChanged = true;
      }
    }
    if (fragmentChanged) parsed.hash = fragment.toString();
    return parsed.href;
  } catch {
    return safeText(value);
  }
}

function redactedPath(value) {
  try {
    const parsed = new URL(redactUrl(value));
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return safeText(value);
  }
}

export function parseCli(argv, now = new Date()) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      out: { type: "string" },
      wait: { type: "string" },
      "wait-for": { type: "string" },
      settle: { type: "string" },
      "storage-state": { type: "string" },
      viewport: { type: "string" },
      full: { type: "boolean" },
      match: { type: "string", multiple: true },
      json: { type: "boolean" },
      "fail-on-console": { type: "boolean" },
    },
  });
  if (positionals.length !== 1) throw new Error("exactly one URL is required");

  const url = navigationUrl(positionals[0]);
  const wait = nonnegativeInteger("--wait", values.wait, 6_000);
  const settle = nonnegativeInteger("--settle", values.settle, 0);
  const waitFor = values["wait-for"]
    ? plainOption("--wait-for", values["wait-for"])
    : null;
  if (settle > 0 && !waitFor) {
    throw new Error("--settle requires --wait-for");
  }
  const storageState = values["storage-state"]
    ? path.resolve(plainOption("--storage-state", values["storage-state"]))
    : null;
  const match = (values.match ?? []).map((item) =>
    plainOption("--match", item),
  );

  const viewportText = values.viewport ?? "1440x900";
  const viewportMatch = /^(\d+)x(\d+)$/i.exec(viewportText);
  const width = Number(viewportMatch?.[1]);
  const height = Number(viewportMatch?.[2]);
  if (
    !viewportMatch ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("--viewport must be positive WxH dimensions");
  }

  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const out = values.out
    ? path.resolve(plainOption("--out", values.out))
    : path.resolve(".headless-shots", `shot-${stamp}.png`);
  if (path.extname(out).toLowerCase() !== ".png") {
    throw new Error("--out must use a .png extension");
  }
  if (existsSync(out))
    throw new Error(`refusing to overwrite existing output: ${out}`);

  return {
    url,
    redactedUrl: redactUrl(url),
    out,
    wait,
    waitFor,
    settle,
    storageState,
    viewport: { width, height },
    full: values.full ?? false,
    json: values.json ?? false,
    failOnConsole: values["fail-on-console"] ?? false,
    match,
  };
}

export function createBoundedCollector(sampleLimit, maxCodePoints) {
  let count = 0;
  const samples = [];
  return {
    add(value, unique = false) {
      count += 1;
      const sample = safeText(value, maxCodePoints);
      if (
        samples.length < sampleLimit &&
        (!unique || !samples.includes(sample))
      ) {
        samples.push(sample);
      }
    },
    snapshot() {
      return { count, samples: [...samples] };
    },
  };
}

export async function reserveOutput(out) {
  try {
    await (await open(out, "wx")).close();
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`refusing to overwrite existing output: ${out}`);
    }
    throw error;
  }
}

export function captureSucceeded({ status, ready, screenshotCaptured }) {
  return (
    Number.isInteger(status) &&
    status >= 200 &&
    status < 400 &&
    ready === true &&
    screenshotCaptured === true
  );
}

export async function runCapture(config, launcher = chromium) {
  const executablePath =
    process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  const result = {
    url: config.redactedUrl,
    executablePath: executablePath || "(playwright default)",
    screenshot: config.out,
    screenshotCaptured: false,
    ready: config.waitFor === null,
    ok: false,
  };
  const consoleErrors = createBoundedCollector(10, 300);
  const failedRequests = createBoundedCollector(10, 500);
  const matches = new Map(
    config.match.map((item) => [item, createBoundedCollector(12, 500)]),
  );
  let browser;
  try {
    browser = await launcher.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      viewport: config.viewport,
      ...(config.storageState ? { storageState: config.storageState } : {}),
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.add(message.text());
    });
    page.on("requestfailed", (request) => {
      failedRequests.add(
        `${request.method()} ${redactUrl(request.url())} (${request.failure()?.errorText || "failed"})`,
      );
    });
    if (matches.size > 0) {
      page.on("request", (request) => {
        const rawPath = (() => {
          try {
            const parsed = new URL(request.url());
            return `${parsed.pathname}${parsed.search}${parsed.hash}`;
          } catch {
            return request.url();
          }
        })();
        for (const [match, collector] of matches) {
          if (rawPath.includes(match)) {
            collector.add(redactedPath(request.url()), true);
          }
        }
      });
    }

    const response = await page.goto(config.url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    result.status = response?.status() ?? null;
    result.finalUrl = redactUrl(page.url());
    if (config.waitFor) {
      try {
        await page.waitForSelector(config.waitFor, {
          timeout: Math.max(config.wait, 15_000),
        });
        result.ready = true;
        if (config.settle > 0) await page.waitForTimeout(config.settle);
      } catch (error) {
        result.ready = false;
        result.waitForMissed = safeText(config.waitFor, 500);
        result.waitForError = safeText(error?.message || error, 500);
      }
    } else {
      await page.waitForTimeout(config.wait);
    }
    await page.screenshot({ path: config.out, fullPage: config.full });
    result.screenshotCaptured = true;
    result.title = safeText(await page.title().catch(() => ""), 300) || null;
    result.ok = captureSucceeded(result);
    if (!result.ok && !result.error) {
      result.error = result.ready
        ? `navigation returned HTTP ${result.status ?? "unknown"}`
        : `selector did not appear: ${result.waitForMissed}`;
    }
  } catch (error) {
    result.ok = false;
    result.error = safeText(error?.message || error, 500);
  } finally {
    const consoleSnapshot = consoleErrors.snapshot();
    const failedSnapshot = failedRequests.snapshot();
    result.consoleErrorCount = consoleSnapshot.count;
    result.consoleErrors = consoleSnapshot.samples;
    result.failedRequestCount = failedSnapshot.count;
    result.failedRequests = failedSnapshot.samples;
    if (matches.size > 0) {
      result.matches = Object.fromEntries(
        [...matches].map(([match, collector]) => {
          const snapshot = collector.snapshot();
          return [
            safeText(match, 300),
            { count: snapshot.count, sample: snapshot.samples },
          ];
        }),
      );
    }
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        result.ok = false;
        result.closeError = safeText(error?.message || error, 500);
      }
    }
  }
  return result;
}

function printResult(result) {
  console.log(
    `${result.ok ? "OK" : "FAILED"}  ${safeText(result.finalUrl || result.url, 500)}  -> HTTP ${result.status ?? "?"}`,
  );
  console.log(`  title: ${result.title ?? "(none)"}`);
  console.log(`  chromium: ${safeText(result.executablePath, 500)}`);
  console.log(`  screenshot: ${safeText(result.screenshot, 500)}`);
  if (result.waitForMissed) {
    console.log(`  WARN: selector never appeared: ${result.waitForMissed}`);
  }
  console.log(`  console errors: ${result.consoleErrorCount ?? 0}`);
  for (const error of result.consoleErrors || []) console.log(`    - ${error}`);
  if (result.matches) {
    for (const [match, info] of Object.entries(result.matches)) {
      console.log(
        `  match "${match}": ${info.count}  ${JSON.stringify(info.sample)}`,
      );
    }
  }
  if (result.error) console.log(`  error: ${result.error}`);
  if (result.closeError) console.log(`  close error: ${result.closeError}`);
}

async function main(argv = process.argv.slice(2)) {
  const wantsJson = argv.includes("--json");
  let config;
  try {
    config = parseCli(argv);
    await mkdir(path.dirname(config.out), { recursive: true });
    await reserveOutput(config.out);
  } catch (error) {
    const result = { ok: false, error: safeText(error?.message || error, 500) };
    wantsJson
      ? console.log(JSON.stringify(result, null, 2))
      : console.error(`${result.error}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  const result = await runCapture(config);
  if (!result.screenshotCaptured) await rm(config.out, { force: true });
  config.json
    ? console.log(JSON.stringify(result, null, 2))
    : printResult(result);
  process.exitCode =
    result.ok && !(config.failOnConsole && result.consoleErrorCount > 0)
      ? 0
      : 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
