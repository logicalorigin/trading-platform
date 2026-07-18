import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capsuleDir = path.join(packageDir, "capsule");
const dockerignorePath = path.join(capsuleDir, ".dockerignore");
const supervisorPath = path.join(capsuleDir, "pyrus-capsule-supervisor.py");
const BASE_DIGEST =
  "sha256:1def178129dfb5f24db43afbf2fcac04530012e3264ba4ff81c71184e17a9ee4";
const CPG_SHA256 =
  "2f2d380b2f9424520ff5f9c11fe45e82ef39459329ac056258a3274bea6f76f9";
const CPG_CERT_SHA256 =
  "13daf89a0712b962c3ecaa5ede344100aee0d3b5dec5a79abd7602a812eda3be";
const CPG_SPKI_SHA256 = "QoH2+wIocE83ZkR4/oyn5ru2JtE+/ZrYS9brNjujldU=";
const SECCOMP_SHA256 =
  "19f1c5b65ff8280092de391959775201004f2c58eae2983612c028c6256a5b54";
const LOGIN_COMPLETE_MARKER = "PYRUS_IBKR_CAPSULE_LOGIN_COMPLETE_V1";
const CHILD_EXIT_MARKER = "PYRUS_IBKR_CAPSULE_CHILD_EXIT_V1";
const STARTUP_FAILURE_MARKER = "PYRUS_IBKR_CAPSULE_STARTUP_FAILURE_V1";

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
  assert.match(dockerfile, /chromium-common=150\.0\.7871\.100-1~deb12u1/);
  assert.match(
    dockerfile,
    /chromium-sandbox=150\.0\.7871\.100-1~deb12u1/,
  );
  assert.match(dockerfile, /nftables=1\.0\.6-2\+deb12u2/);
  assert.equal(
    (dockerfile.match(/^USER .+$/gm) ?? []).at(-1),
    "USER 10001:10001",
  );
  assert.doesNotMatch(dockerfile, /^HEALTHCHECK\b/m);
  assert.equal(
    (dockerfile.match(/^ENTRYPOINT .+$/gm) ?? []).at(-1),
    'ENTRYPOINT ["/usr/local/bin/pyrus-capsule-supervisor.py"]',
  );
  assert.match(
    dockerfile,
    /COPY --chmod=0555 pyrus-capsule-supervisor\.py \/usr\/local\/bin\/pyrus-capsule-supervisor\.py/,
  );
  assert.doesNotMatch(dockerfile, /pyrus-capsule-lease-grant/);
  assert.doesNotMatch(dockerfile, /^HEALTHCHECK NONE$/m);
  assert.doesNotMatch(dockerfile, /^\s*(VOLUME|EXPOSE)\b/m);
});

test("capsule build context admits only the reviewed immutable inputs", async () => {
  const lines = (await readFile(dockerignorePath, "utf8"))
    .split(/\r?\n/u)
    .filter(Boolean);

  assert(lines.includes("*"));
  for (const input of [
    ".dockerignore",
    "Dockerfile",
    "chromium-managed-policy.json",
    "paper-only-extension/",
    "paper-only-extension/manifest.json",
    "paper-only-extension/paper-only.js",
    "pyrus-capsule-entrypoint",
    "pyrus-capsule-health",
    "pyrus-capsule-relay.py",
    "pyrus-capsule-supervisor.py",
  ]) {
    assert(lines.includes(`!${input}`), `missing build-context input ${input}`);
  }
  assert.equal(lines.includes("!pyrus-capsule-lease-grant.py"), false);
  assert.equal(lines.includes("!README.md"), false);
});

test("capsule PID 1 lease supervisor is non-dumpable and accepts only authenticated bridge grants", async () => {
  const supervisor = await readFile(supervisorPath, "utf8");

  assert.match(supervisor, /PR_SET_DUMPABLE\s*=\s*4/);
  assert.match(supervisor, /ctypes\.CDLL\(None,\s*use_errno=True\)/);
  assert.match(supervisor, /\/proc\/sys\/kernel\/random\/boot_id/);
  assert.match(supervisor, /time\.CLOCK_BOOTTIME/);
  assert.match(supervisor, /time\.clock_gettime_ns/);
  assert.doesNotMatch(supervisor, /time\.monotonic_ns\(\)/);
  assert.match(supervisor, /LEASE_CONTROL_PORT\s*=\s*17000/);
  assert.match(supervisor, /socket\.AF_INET/);
  assert.match(supervisor, /hmac\.compare_digest/);
  assert.match(supervisor, /PYRUS_IBKR_CAPSULE_LEASE_CONTROL_KEY/);
  assert.doesNotMatch(supervisor, /SO_PEERCRED/);
  assert.match(supervisor, /PYRUS_IBKR_CAPSULE_MARKER_FD/);
  assert.match(supervisor, /marker_fd\s*=\s*os\.dup\(1\)/);
  assert.match(supervisor, /pass_fds=\(marker_fd,\)/);
  assert.match(supervisor, /os\.close\(marker_fd\)/);
  assert.match(supervisor, /start_new_session=True/);
  assert.match(supervisor, /os\.killpg/);
  assert.match(supervisor, /signal\.SIGTERM/);
  assert.match(supervisor, /signal\.SIGKILL/);
  assert.match(supervisor, /PYRUS_IBKR_CAPSULE_LEASE_GRANTED_V1/);
  assert.match(supervisor, /effective_uid\s*!=\s*0/);
  assert.match(supervisor, /"user": WORKLOAD_UID/);
  assert.match(supervisor, /"group": WORKLOAD_GID/);
  assert.match(supervisor, /"extra_groups": \(\)/);
  const main = supervisor.slice(supervisor.indexOf("def main()"));
  assert(
    main.indexOf("install_egress_firewall()") <
      main.indexOf("drop_setup_capabilities()"),
  );
  assert(
    main.indexOf("drop_setup_capabilities()") <
      main.indexOf("run_supervisor(state, control_key)"),
  );
  assert.doesNotMatch(supervisor, /socket_path|\/run\/pyrus\/.*\.sock/);
});

test("capsule supervisor requires root PID 1 and drops the workload identity", () => {
  const probe = String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("capsule_supervisor", sys.argv[1])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

identity = module.workload_identity(0)
rejected = False
try:
    module.workload_identity(module.WORKLOAD_UID)
except module.GrantRejected:
    rejected = True

print(json.dumps({"identity": identity, "nonrootRejected": rejected}))
`;
  const result = spawnSync("python3", ["-c", probe, supervisorPath], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    identity: {
      extra_groups: [],
      group: 10001,
      user: 10001,
    },
    nonrootRejected: true,
  });
});

test("capsule egress permits only public IPv4 web traffic", () => {
  const probe = String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("capsule_supervisor", sys.argv[1])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

blocked = [
    "0.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.0.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "2001:4860:4860::8888",
]
ruleset = module.egress_ruleset()
result = {
    "blocked": [
        module.egress_destination_allowed(address, 443, "tcp")
        for address in blocked
    ],
    "publicDatabase": module.egress_destination_allowed(
        "1.1.1.1", 5432, "tcp"
    ),
    "publicDns": module.egress_destination_allowed("1.1.1.1", 53, "udp"),
    "publicHttp": module.egress_destination_allowed("1.1.1.1", 80, "tcp"),
    "publicHttps": module.egress_destination_allowed("1.1.1.1", 443, "tcp"),
    "retainedCapabilityMask": module._capability_mask(
        module.RETAINED_CAPABILITIES
    ),
    "ruleset": ruleset,
}
print(json.dumps(result))
`;
  const result = spawnSync("python3", ["-c", probe, supervisorPath], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const policy = JSON.parse(result.stdout) as {
    blocked: boolean[];
    publicDatabase: boolean;
    publicDns: boolean;
    publicHttp: boolean;
    publicHttps: boolean;
    retainedCapabilityMask: number;
    ruleset: string;
  };
  assert(policy.blocked.every((allowed) => !allowed));
  assert.equal(policy.publicDatabase, false);
  assert.equal(policy.publicDns, false);
  assert.equal(policy.publicHttp, true);
  assert.equal(policy.publicHttps, true);
  assert.equal(policy.retainedCapabilityMask, 0xe0);
  assert.match(policy.ruleset, /^add table inet pyrus_egress/m);
  assert.match(policy.ruleset, /^flush table inet pyrus_egress/m);
  assert.match(policy.ruleset, /policy drop/);
  assert.match(policy.ruleset, /meta nfproto ipv6 drop/);
  assert.match(
    policy.ruleset,
    /meta skuid 10001 tcp dport 17000 drop/,
  );
  assert(
    policy.ruleset.indexOf("meta skuid 10001 tcp dport 17000 drop") <
      policy.ruleset.indexOf('oifname "lo" accept'),
  );
  assert.match(policy.ruleset, /tcp dport \{ 80, 443 \} accept/);
  assert.match(policy.ruleset, /169\.254\.0\.0\/16/);
});

test("capsule lease transport authenticates the exact framed grant", () => {
  const probe = String.raw`
import hashlib
import hmac
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("capsule_supervisor", sys.argv[1])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

key = module.parse_control_key("ab" * 32)
payload = json.dumps({
    "version": 1,
    "bootId": "11111111-1111-4111-8111-111111111111",
    "fenceHash": "c" * 24,
    "controlAttemptId": "22222222-2222-4222-8222-222222222222",
    "grantNotAfterNs": "3000",
}, separators=(",", ":")).encode("utf-8")
mac = hmac.new(key, payload, hashlib.sha256).hexdigest().encode("ascii")
frame = mac + b" " + payload + b"\n"

def signed(value):
    signature = hmac.new(key, value, hashlib.sha256).hexdigest().encode("ascii")
    return signature + b" " + value + b"\n"

def rejected(callback):
    try:
        callback()
    except module.GrantRejected:
        return True
    return False

grant = module.parse_authenticated_grant(frame, key)
print(json.dumps({
    "grant": grant._asdict(),
    "shortKeyRejected": rejected(lambda: module.parse_control_key("ab" * 31)),
    "uppercaseKeyRejected": rejected(lambda: module.parse_control_key("AB" * 32)),
    "wrongMacRejected": rejected(
        lambda: module.parse_authenticated_grant(b"0" * 64 + frame[64:], key)
    ),
    "tamperRejected": rejected(
        lambda: module.parse_authenticated_grant(
            frame.replace(b'"version":1', b'"version":2'),
            key,
        )
    ),
    "extraLineRejected": rejected(
        lambda: module.parse_authenticated_grant(frame + b"\n", key)
    ),
    "missingNewlineRejected": rejected(
        lambda: module.parse_authenticated_grant(frame[:-1], key)
    ),
    "oversizedRejected": rejected(
        lambda: module.parse_authenticated_grant(
            b"0" * (module.MAX_MESSAGE_BYTES + 1),
            key,
        )
    ),
    "shortMacRejected": rejected(
        lambda: module.parse_authenticated_grant(frame[1:], key)
    ),
    "uppercaseMacRejected": rejected(
        lambda: module.parse_authenticated_grant(
            frame[:64].upper() + frame[64:],
            key,
        )
    ),
    "invalidUtf8Rejected": rejected(
        lambda: module.parse_authenticated_grant(signed(b"\xff"), key)
    ),
    "authenticatedMalformedGrantRejected": rejected(
        lambda: module.parse_authenticated_grant(signed(b"{}"), key)
    ),
}))
`;
  const result = spawnSync("python3", ["-c", probe, supervisorPath], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    grant: {
      boot_id: "11111111-1111-4111-8111-111111111111",
      control_attempt_id: "22222222-2222-4222-8222-222222222222",
      fence_hash: "c".repeat(24),
      grant_not_after_ns: 3000,
      version: 1,
    },
    shortKeyRejected: true,
    uppercaseKeyRejected: true,
    wrongMacRejected: true,
    tamperRejected: true,
    extraLineRejected: true,
    missingNewlineRejected: true,
    oversizedRejected: true,
    shortMacRejected: true,
    uppercaseMacRejected: true,
    invalidUtf8Rejected: true,
    authenticatedMalformedGrantRejected: true,
  });
});

test("capsule lease parser and boot-time grant state fail closed", () => {
  const probe = String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("capsule_supervisor", sys.argv[1])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

boot_id = "11111111-1111-4111-8111-111111111111"
fence_hash = "a" * 24
first_attempt = "22222222-2222-4222-8222-222222222222"
second_attempt = "33333333-3333-4333-8333-333333333333"

def encoded(attempt, not_after, **extra):
    value = {
        "version": 1,
        "bootId": boot_id,
        "fenceHash": fence_hash,
        "controlAttemptId": attempt,
        "grantNotAfterNs": str(not_after),
    }
    value.update(extra)
    return json.dumps(value, separators=(",", ":"))

def rejected(callback):
    try:
        callback()
    except module.GrantRejected:
        return True
    return False

state = module.LeaseState(boot_id, fence_hash)
first = module.parse_grant(encoded(first_attempt, 1_000))
first_deadline = state.apply(first, 900)
same_deadline = state.apply(first, 901)
newer = module.parse_grant(encoded(second_attempt, 2_000))
second_deadline = state.apply(newer, 1_001)
equal_state = module.LeaseState(boot_id, fence_hash)
equal_state.apply(first, 900)
equal_state.apply(newer, 1_001)
equal_deadline = equal_state.apply(
    module.parse_grant(encoded(
        "44444444-4444-4444-8444-444444444444",
        2_000,
    )),
    1_004,
)

malformed = [
    encoded(first_attempt, 3_000, extra=True),
    encoded(first_attempt, 3_000).replace('"version":1', '"version":1,"version":1'),
    encoded(first_attempt, 3_000).replace('"version":1', '"version":2'),
    encoded(first_attempt, 3_000).replace('"grantNotAfterNs":"3000"', '"grantNotAfterNs":3000'),
    encoded(first_attempt, 3_000).replace('"grantNotAfterNs":"3000"', '"grantNotAfterNs":"03000"'),
]

print(json.dumps({
    "firstDeadline": first_deadline,
    "sameDeadline": same_deadline,
    "secondDeadline": second_deadline,
    "staleRejected": rejected(
        lambda: state.apply(module.parse_grant(encoded(first_attempt, 1_500)), 1_002)
    ),
    "sameAttemptChangedRejected": rejected(
        lambda: state.apply(module.parse_grant(encoded(second_attempt, 2_500)), 1_003)
    ),
    "equalDeadline": equal_deadline,
    "wrongBootRejected": rejected(
        lambda: state.apply(
            module.parse_grant(
                encoded(
                    "66666666-6666-4666-8666-666666666666",
                    3_000,
                ).replace(boot_id, "77777777-7777-4777-8777-777777777777")
            ),
            1_005,
        )
    ),
    "wrongFenceRejected": rejected(
        lambda: state.apply(
            module.parse_grant(
                encoded(
                    "88888888-8888-4888-8888-888888888888",
                    3_000,
                ).replace(fence_hash, "b" * 24)
            ),
            1_006,
        )
    ),
    "exactGrantExpiryRejected": rejected(lambda: state.apply(newer, 2_000)),
    "aliveBeforeDeadline": not state.expired(second_deadline - 1),
    "expiredAtDeadline": state.expired(second_deadline),
    "noRevival": rejected(
        lambda: state.apply(
            module.parse_grant(encoded(
                "55555555-5555-4555-8555-555555555555",
                second_deadline + 1_000,
            )),
            second_deadline,
        )
    ),
    "malformedRejected": all(
        rejected(lambda value=value: module.parse_grant(value))
        for value in malformed
    ),
}))
`;
  const result = spawnSync("python3", ["-c", probe, supervisorPath], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    firstDeadline: 120_000_001_000,
    sameDeadline: 120_000_001_000,
    secondDeadline: 120_000_002_000,
    staleRejected: true,
    sameAttemptChangedRejected: true,
    equalDeadline: 120_000_002_000,
    wrongBootRejected: true,
    wrongFenceRejected: true,
    exactGrantExpiryRejected: true,
    aliveBeforeDeadline: true,
    expiredAtDeadline: true,
    noRevival: true,
    malformedRejected: true,
  });
});

test("capsule PID 1 kills surviving workload process-group members", () => {
  const probe = String.raw`
import importlib.util
import json
import os
import signal
import subprocess
import sys

spec = importlib.util.spec_from_file_location("capsule_supervisor", sys.argv[1])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

os.setsid()
leader = subprocess.Popen(
    [sys.executable, "-c", "import time; time.sleep(60)"],
    process_group=0,
)
descendant = subprocess.Popen(
    [
        sys.executable,
        "-c",
        (
            "import signal,time;"
            "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
            "print('ready',flush=True);"
            "time.sleep(60)"
        ),
    ],
    process_group=leader.pid,
    stdout=subprocess.PIPE,
    text=True,
)
assert descendant.stdout.readline() == "ready\n"

def group_exists():
    try:
        os.killpg(leader.pid, 0)
        return True
    except ProcessLookupError:
        return False

module.TERMINATION_GRACE_SECONDS = 0.05
module.KILL_REAP_SECONDS = 1
try:
    module.terminate_workload(leader)
    survived = group_exists()
finally:
    if group_exists():
        os.killpg(leader.pid, signal.SIGKILL)
    for process in (leader, descendant):
        try:
            process.wait(timeout=1)
        except (ChildProcessError, subprocess.TimeoutExpired):
            pass

print(json.dumps({"descendantSurvived": survived}))
`;
  const result = spawnSync("python3", ["-c", probe, supervisorPath], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { descendantSurvived: false });
});

test("capsule hides Chromium's bad-flag infobar without weakening TLS or the sandbox", async () => {
  const [dockerfile, entrypoint, policyBytes] = await Promise.all([
    readFile(path.join(capsuleDir, "Dockerfile"), "utf8"),
    readFile(path.join(capsuleDir, "pyrus-capsule-entrypoint"), "utf8"),
    readFile(path.join(capsuleDir, "chromium-managed-policy.json"), "utf8"),
  ]);
  const policy = JSON.parse(policyBytes) as Record<string, unknown>;

  assert.deepEqual(policy, { CommandLineFlagSecurityWarningsEnabled: false });
  assert.match(
    dockerfile,
    /COPY --chmod=0444 chromium-managed-policy\.json \/etc\/chromium\/policies\/managed\/pyrus\.json/,
  );
  assert.match(entrypoint, /--ignore-certificate-errors-spki-list=/);
  assert.doesNotMatch(
    entrypoint,
    /--ignore-certificate-errors(?:[=\s]|$)|--no-sandbox|--disable-setuid-sandbox/,
  );
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
    /start_service cpg-relay \/usr\/local\/bin\/pyrus-capsule-relay[\s\S]*?15000[\s\S]*?5000[\s\S]*?"\$\{CPG_CERT_SHA256\}"/,
  );
  assert.match(entrypoint, /wait_for_cpg_login 15000 60/);
  assert(
    entrypoint.indexOf("start_service cpg-relay") <
      entrypoint.indexOf("wait_for_cpg_login 15000 60"),
    "expected the pinned TLS relay before the plaintext readiness probe",
  );
  assert.match(
    entrypoint,
    /printf 'GET \/ HTTP\/1\.0\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3/,
  );
  assert.match(
    entrypoint,
    /start_service chromium chromium[\s\S]*?--user-data-dir="\$\{RUNTIME_DIR\}\/chromium"[\s\S]*?--ignore-certificate-errors-spki-list="\$\{CPG_SPKI_SHA256\}"[\s\S]*?^  --app=https:\/\/localhost:5000\/$/m,
  );
  assert.match(entrypoint, /^  --window-position=0,0 \\$/m);
  assert.match(entrypoint, /^  --window-size=1364,768 \\$/m);
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
  assert.match(dockerfile, /grep -Fq 'listenSsl: true'/);
  assert.doesNotMatch(dockerfile, /listenSsl: false/);
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
  assert.match(relay, /ssl\.PROTOCOL_TLS_CLIENT/);
  assert.match(relay, /getpeercert\(binary_form=True\)/);
  assert.match(relay, /hashlib\.sha256/);
  assert.match(relay, /hmac\.compare_digest/);
  assert.doesNotMatch(relay, /print\(|logging|sys\.stdout|sys\.stderr/);
  assert.match(dockerfile, /COPY --chown=10001:10001 paper-only-extension/);
  assert.match(extensionManifest, /"manifest_version"\s*:\s*3/);
  assert.match(extensionManifest, /http:\/\/localhost:5000\/\*/);
  assert.match(extensionScript, /\.xyz-paper-switch/);
  assert.match(extensionScript, /checked = true/);
  assert.match(extensionScript, /disabled = true/);
});

test("capsule reports only bounded startup and child-exit markers", async () => {
  const entrypoint = await readFile(
    path.join(capsuleDir, "pyrus-capsule-entrypoint"),
    "utf8",
  );

  assert.match(entrypoint, /declare -A child_names=\(\)/);
  assert.match(
    entrypoint,
    /child_names\["\$\{pid\}"\]="\$\{name\}"/,
  );
  assert.match(
    entrypoint,
    /wait -n -p failed_pid "\$\{children\[@\]\}"/,
  );
  const markerStart = entrypoint.indexOf(
    `printf '${CHILD_EXIT_MARKER} name=%s status=%d\\n'`,
  );
  assert(markerStart >= 0);
  const markerBlock = entrypoint.slice(
    markerStart,
    entrypoint.indexOf("exit 1", markerStart),
  );
  assert.match(markerBlock, />&"\$\{MARKER_FD\}"/);
  assert.doesNotMatch(markerBlock, /LOG_DIR|\.log/);
  assert.match(entrypoint, /require_stage xvfb-path wait_for_path/);
  assert.match(entrypoint, /require_stage cpg-port wait_for_port/);
  assert.match(entrypoint, /require_stage cpg-login wait_for_cpg_login/);
  assert.match(entrypoint, /require_stage stack-health wait_until_healthy/);
  const startupMarkerStart = entrypoint.indexOf(
    `printf '${STARTUP_FAILURE_MARKER} stage=%s\\n'`,
  );
  assert(startupMarkerStart >= 0);
  const startupMarkerBlock = entrypoint.slice(
    startupMarkerStart,
    entrypoint.indexOf("exit 1", startupMarkerStart),
  );
  assert.match(startupMarkerBlock, />&"\$\{MARKER_FD\}"/);
  assert.doesNotMatch(startupMarkerBlock, /LOG_DIR|\.log/);
  assert.equal(
    entrypoint.match(new RegExp(CHILD_EXIT_MARKER, "g"))?.length,
    1,
  );
  assert.equal(
    entrypoint.match(new RegExp(STARTUP_FAILURE_MARKER, "g"))?.length,
    1,
  );
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
  const entrypoint = files[1] ?? "";

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
  assert.doesNotMatch(entrypoint, /--ignore-certificate-errors(?:[=\s]|$)/);
  assert(entrypoint.includes(`readonly CPG_CERT_SHA256=${CPG_CERT_SHA256}`));
  assert(entrypoint.includes(`readonly CPG_SPKI_SHA256='${CPG_SPKI_SHA256}'`));
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
    entrypoint,
    /readonly MARKER_FD=\$\{PYRUS_IBKR_CAPSULE_MARKER_FD:-\}/,
  );
  assert.match(entrypoint, /\/proc\/self\/fd\/\$\{MARKER_FD\}/);
  assert.match(
    observer,
    new RegExp(
      `printf '${LOGIN_COMPLETE_MARKER}\\\\n' >&"\\$\\{MARKER_FD\\}"`,
    ),
  );
  assert.doesNotMatch(observer, /\/proc\/1\/fd\/1/);
  assert.doesNotMatch(observer, /(?:echo|printf|tee)[^\n]*\$\{line\}/);
  assert.equal(entrypoint.match(new RegExp(LOGIN_COMPLETE_MARKER, "g"))?.length, 1);
});

test("capsule provenance records the exact official-source bytes", async () => {
  const readme = await readFile(path.join(capsuleDir, "README.md"), "utf8");

  assert(readme.includes(BASE_DIGEST));
  assert(readme.includes(CPG_SHA256));
  assert(readme.includes(CPG_CERT_SHA256));
  assert(readme.includes(CPG_SPKI_SHA256));
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
