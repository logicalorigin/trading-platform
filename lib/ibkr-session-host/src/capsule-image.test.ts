import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capsuleDir = path.join(packageDir, "capsule");
const BASE_DIGEST =
  "sha256:1def178129dfb5f24db43afbf2fcac04530012e3264ba4ff81c71184e17a9ee4";
const CPG_SHA256 =
  "2f2d380b2f9424520ff5f9c11fe45e82ef39459329ac056258a3274bea6f76f9";
const SECCOMP_SHA256 =
  "19f1c5b65ff8280092de391959775201004f2c58eae2983612c028c6256a5b54";
const LOGIN_COMPLETE_MARKER = "PYRUS_IBKR_CAPSULE_LOGIN_COMPLETE_V1";

test("capsule image is immutable, nonroot, internally watched, and has no volumes", async () => {
  const dockerfile = await readFile(path.join(capsuleDir, "Dockerfile"), "utf8");
  const fromLines = dockerfile.match(/^FROM .+$/gm) ?? [];

  assert(fromLines.length >= 2, "expected separate download and runtime stages");
  for (const line of fromLines) {
    assert.match(line, new RegExp(`^FROM debian:bookworm-slim@${BASE_DIGEST}`));
  }
  assert.match(
    dockerfile,
    new RegExp(`ARG CPG_SHA256=${CPG_SHA256}`),
  );
  assert.match(
    dockerfile,
    /ADD --checksum=[\s\S]*?https:\/\/download2\.interactivebrokers\.com\/portal\/clientportal\.gw\.zip/,
  );
  assert.match(dockerfile, /sha256sum --check/);
  assert.match(dockerfile, /openjdk-17-jre-headless=17\.0\.19\+10-1~deb12u2/);
  assert.match(dockerfile, /chromium=150\.0\.7871\.100-1~deb12u1/);
  assert.match(
    dockerfile,
    /chromium-sandbox=150\.0\.7871\.100-1~deb12u1/,
  );
  assert.equal(
    (dockerfile.match(/^USER .+$/gm) ?? []).at(-1),
    "USER 10001:10001",
  );
  assert.doesNotMatch(dockerfile, /^HEALTHCHECK\b/m);
  assert.equal(
    (dockerfile.match(/^ENTRYPOINT .+$/gm) ?? []).at(-1),
    'ENTRYPOINT ["/usr/local/bin/pyrus-capsule-entrypoint"]',
  );
  assert.doesNotMatch(dockerfile, /^HEALTHCHECK NONE$/m);
  assert.doesNotMatch(dockerfile, /^\s*(VOLUME|EXPOSE)\b/m);
});

test("capsule restricts CPG clients and exposes only fixed host relays with RAM-only state", async () => {
  const dockerfile = await readFile(path.join(capsuleDir, "Dockerfile"), "utf8");
  const entrypoint = await readFile(
    path.join(capsuleDir, "pyrus-capsule-entrypoint"),
    "utf8",
  );
  const health = await readFile(
    path.join(capsuleDir, "pyrus-capsule-health"),
    "utf8",
  );
  const relay = await readFile(
    path.join(capsuleDir, "pyrus-capsule-relay.py"),
    "utf8",
  );
  const extensionManifest = await readFile(
    path.join(capsuleDir, "paper-only-extension", "manifest.json"),
    "utf8",
  );
  const extensionScript = await readFile(
    path.join(capsuleDir, "paper-only-extension", "paper-only.js"),
    "utf8",
  );

  assert.match(entrypoint, /readonly RUNTIME_DIR=\/run\/pyrus/);
  assert.match(entrypoint, /readonly LOG_DIR=\$\{RUNTIME_DIR\}\/logs/);
  assert.match(entrypoint, /Xvfb :99 -screen 0 1364x768x24 -nolisten tcp/);
  assert.match(
    entrypoint,
    /start_service vnc x11vnc[\s\S]*?-listen 127\.0\.0\.1/,
  );
  assert.match(
    entrypoint,
    /start_service novnc websockify[\s\S]*?0\.0\.0\.0:16080[\s\S]*?127\.0\.0\.1:5900/,
  );
  assert.match(
    entrypoint,
    /start_service cpg-relay \/usr\/local\/bin\/pyrus-capsule-relay[\s\S]*?15000[\s\S]*?5000/,
  );
  assert.match(entrypoint, /wait_for_cpg_login 60/);
  assert.match(
    entrypoint,
    /printf 'GET \/ HTTP\/1\.0\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3/,
  );
  assert.match(
    entrypoint,
    /start_service chromium chromium[\s\S]*?--user-data-dir="\$\{RUNTIME_DIR\}\/chromium"[\s\S]*?^  --app=http:\/\/localhost:5000\/$/m,
  );
  assert.doesNotMatch(entrypoint, /--incognito/);
  assert.doesNotMatch(entrypoint, /--load-extension|--disable-extensions-except/);
  assert.match(entrypoint, /ibgroup\.web\.core\.clientportal\.gw\.GatewayStart/);
  assert.match(entrypoint, /start_service watchdog watchdog/);
  assert.equal(entrypoint.match(/PYRUS_IBKR_CAPSULE_READY_V1/g)?.length, 1);
  assert.match(
    entrypoint,
    /^printf 'PYRUS_IBKR_CAPSULE_READY_V1\\n'$/m,
  );
  assert.match(entrypoint, /while sleep 10/);
  assert.match(
    entrypoint,
    /if \{ exec 3<>"\/dev\/tcp\/127\.0\.0\.1\/\$\{port\}"; \} 2>\/dev\/null; then/,
  );
  assert.match(dockerfile, /\)" = '127\.0\.0\.1'/);
  assert.match(dockerfile, /listenSsl:\\s\*true[\s\S]*listenSsl: false/);
  assert.doesNotMatch(dockerfile, /^\s+in_allow\b/m);
  assert.match(health, /127\.0\.0\.1/);
  assert.match(health, /5000/);
  assert.match(health, /5900/);
  assert.match(health, /15000/);
  assert.match(health, /16080/);
  assert.match(health, /\/proc\/net\/tcp/);
  assert.match(health, /0100007F/);
  assert.match(health, /listener_exists 00000000 5000/);
  assert.match(health, /listener_exists 00000000 15000/);
  assert.match(health, /listener_exists 0100007F 5900/);
  assert.match(health, /listener_exists 00000000 16080/);
  assert.match(
    health,
    /for service in supervisor xvfb vnc novnc cpg cpg-relay chromium/,
  );
  assert.doesNotMatch(health, /\/dev\/tcp/);
  assert.match(relay, /127\.0\.0\.1/);
  assert.match(relay, /socket\.create_connection/);
  assert.doesNotMatch(relay, /print\(|logging|sys\.stdout|sys\.stderr/);
  assert.match(dockerfile, /COPY --chown=10001:10001 paper-only-extension/);
  assert.match(extensionManifest, /"manifest_version"\s*:\s*3/);
  assert.match(extensionManifest, /http:\/\/localhost:5000\/\*/);
  assert.match(extensionScript, /\.xyz-paper-switch/);
  assert.match(extensionScript, /checked = true/);
  assert.match(extensionScript, /disabled = true/);
});

test("capsule forbids browser sandbox bypasses, debug logging, and credentials", async () => {
  const files = await Promise.all(
    [
      "Dockerfile",
      "pyrus-capsule-entrypoint",
      "pyrus-capsule-health",
      "pyrus-capsule-relay.py",
      "paper-only-extension/manifest.json",
      "paper-only-extension/paper-only.js",
    ].map(
      (name) => readFile(path.join(capsuleDir, name), "utf8"),
    ),
  );
  const source = files.join("\n");

  for (const forbidden of [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--remote-debugging",
    "SYS_ADMIN",
    "seccomp=unconfined",
    'level="DEBUG"',
    "IBKR_USERNAME",
    "IBKR_PASSWORD",
  ]) {
    assert(!source.includes(forbidden), `forbidden capsule content: ${forbidden}`);
  }
  assert.match(source, /<root level=\\?"INFO\\?">/);
});

test("capsule supervises a private CPG login observer that emits only a fixed marker", async () => {
  const dockerfile = await readFile(path.join(capsuleDir, "Dockerfile"), "utf8");
  const entrypoint = await readFile(
    path.join(capsuleDir, "pyrus-capsule-entrypoint"),
    "utf8",
  );
  const health = await readFile(
    path.join(capsuleDir, "pyrus-capsule-health"),
    "utf8",
  );
  const observer =
    entrypoint.match(/^observe_cpg_logins\(\) \{[\s\S]*?^\}$/m)?.[0] ?? "";
  const loginCondition =
    observer.match(/^\s*if (\[\[ .* \]\]); then$/m)?.[1] ?? "";
  const matchesLoginLine = (line: string): boolean =>
    spawnSync("bash", ["-c", `line=$1\n${loginCondition}`, "bash", line])
      .status === 0;

  assert.match(entrypoint, /start_service login-observer observe_cpg_logins/);
  assert.match(health, /for service in [^\n]*\blogin-observer\b/);
  assert.match(dockerfile, /<file>logs\/gw\.current\.log<\/file>/);
  assert.match(observer, /\$\{LOG_DIR\}\/gw\.current\.log/);
  assert.doesNotMatch(observer, /gw\.\*\.log|gw\.message/);
  assert.match(observer, /while IFS= read -r line/);
  assert.match(observer, /tail -n 0 -F "\$\{gateway_log\}"/);
  assert(loginCondition.startsWith('[[ "${line}" =~ ^'));
  assert(
    matchesLoginLine(
      "12:34:56.789 INFO  nioEventLoopGroup-3-1 GatewayHttpProxy     : Client login succeeds",
    ),
  );
  assert.equal(
    matchesLoginLine(
      "12:34:56.789 INFO  nioEventLoopGroup-3-1 SomeOtherLogger : ignored GatewayHttpProxy : Client login succeeds",
    ),
    false,
  );
  assert.equal(
    matchesLoginLine(
      "12:34:56.789 DEBUG nioEventLoopGroup-3-1 GatewayHttpProxy     : Client login succeeds",
    ),
    false,
  );
  assert.doesNotMatch(observer, /== \*"Client login succeeds"\*/);
  assert.match(
    observer,
    new RegExp(
      `printf '${LOGIN_COMPLETE_MARKER}\\\\n' >\\/proc\\/1\\/fd\\/1`,
    ),
  );
  assert.doesNotMatch(observer, /(?:echo|printf|tee)[^\n]*\$\{line\}/);
  assert.equal(entrypoint.match(new RegExp(LOGIN_COMPLETE_MARKER, "g"))?.length, 1);
});

test("capsule provenance records the exact official-source bytes", async () => {
  const readme = await readFile(path.join(capsuleDir, "README.md"), "utf8");

  assert(readme.includes(BASE_DIGEST));
  assert(readme.includes(CPG_SHA256));
  assert(readme.includes("20230424154245"));
  assert.match(readme, /not an IBKR-published checksum/i);
  assert.match(readme, /Replit development environment/i);
});

test("Chromium seccomp profile pins the narrow sandbox syscall additions", async () => {
  const bytes = await readFile(
    path.join(packageDir, "src", "chromium-seccomp.json"),
  );
  const profile = JSON.parse(bytes.toString("utf8")) as {
    defaultAction?: string;
    syscalls?: Array<Record<string, unknown>>;
  };
  const firstRule = profile.syscalls?.[0];
  const secondRule = profile.syscalls?.[1];
  const readme = await readFile(path.join(capsuleDir, "README.md"), "utf8");

  assert.equal(createHash("sha256").update(bytes).digest("hex"), SECCOMP_SHA256);
  assert.equal(profile.defaultAction, "SCMP_ACT_ERRNO");
  assert.deepEqual(firstRule, {
    comment:
      "Allow Chromium to create user namespaces; derived from Playwright v1.61.0",
    names: ["clone", "setns", "unshare"],
    action: "SCMP_ACT_ALLOW",
    args: [],
    includes: {},
    excludes: {},
  });
  assert.deepEqual(secondRule, {
    comment:
      "Allow Chromium to chroot inside its new user namespace while container capabilities remain dropped",
    names: ["chroot"],
    action: "SCMP_ACT_ALLOW",
    args: [],
    includes: {},
    excludes: {},
  });
  assert(readme.includes(SECCOMP_SHA256));
  assert.match(readme, /moby\/profiles\/refs\/tags\/seccomp\/v0\.2\.3/);
  assert.match(readme, /playwright\.dev\/docs\/docker/);
});
