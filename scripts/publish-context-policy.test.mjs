import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  auditPublishContext,
  requiredPublishExclusions,
} from "./publish-context-policy.mjs";

function policyText(overrides = requiredPublishExclusions) {
  return `${overrides.join("\n")}\n`;
}

test("publication policy excludes nested generated data and secret file types", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "publish-context-policy-"));
  const excluded = [
    "artifacts/output/snapshot.bin",
    "scripts/scripts/reports/runtime.json",
    "nested/tmp/work.bin",
    "nested/cache/.env",
    "nested/keys/private.PeM",
    "nested/keys/private.kEy",
  ];
  for (const relPath of excluded) {
    const fullPath = path.join(root, relPath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, "private-data");
  }
  writeFileSync(path.join(root, ".env.example"), "PUBLIC_EXAMPLE=true\n");
  writeFileSync(path.join(root, "package.json"), "{}\n");

  const result = auditPublishContext({
    root,
    ignoreText: policyText(),
    limitBytes: 1_000_000,
  });

  assert.deepEqual(result.failures, []);
  assert.equal(result.includedFiles, 2);
  assert.ok(result.includedBytes < 100);
});

test("publication policy fails closed for missing rules and unexpected re-includes", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "publish-context-policy-"));
  writeFileSync(path.join(root, "package.json"), "{}\n");
  const missingRecursivePem = requiredPublishExclusions.filter(
    (entry) => entry !== "**/*.[pP][eE][mM]",
  );

  const missing = auditPublishContext({
    root,
    ignoreText: policyText(missingRecursivePem),
  });
  assert.match(missing.failures.join("\n"), /missing:.*\[pP\].*\[eE\].*\[mM\]/);

  const reinclude = auditPublishContext({
    root,
    ignoreText: `${policyText()}!nested/private.pem\n`,
  });
  assert.match(reinclude.failures.join("\n"), /unexpected rules/);
});

test("publication policy rejects extra exclusions and rule reordering", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "publish-context-policy-"));
  writeFileSync(path.join(root, "package.json"), "{}\n");

  const extraExclusion = auditPublishContext({
    root,
    ignoreText: `${policyText()}**\n`,
  });
  assert.match(extraExclusion.failures.join("\n"), /unexpected rules.*\*\*/);

  const reorderedRules = [...requiredPublishExclusions];
  const envExampleIndex = reorderedRules.indexOf("!.env.example");
  reorderedRules.splice(envExampleIndex, 1);
  reorderedRules.unshift("!.env.example");
  const reordered = auditPublishContext({
    root,
    ignoreText: policyText(reorderedRules),
  });
  assert.match(reordered.failures.join("\n"), /ordered publication policy/);
});

test("publication policy excludes common credential stores but retains sanitized root npm config", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "publish-context-policy-"));
  const excluded = [
    ".ssh/id_ed25519",
    ".aws/credentials",
    ".docker/config.json",
    ".kube/config",
    ".gnupg/private-keys-v1.d/key",
    ".netrc",
    ".pypirc",
    ".git-credentials",
    ".cargo/credentials",
    ".cargo/credentials.toml",
    "nested/.npmrc",
  ];
  for (const relPath of excluded) {
    const fullPath = path.join(root, relPath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, "private-data");
  }
  writeFileSync(path.join(root, ".npmrc"), "strict-peer-dependencies=false\n");
  writeFileSync(path.join(root, "package.json"), "{}\n");

  const result = auditPublishContext({
    root,
    ignoreText: policyText(),
    limitBytes: 1_000_000,
  });

  assert.deepEqual(result.failures, []);
  assert.equal(result.includedFiles, 2);
});

test("publication policy allows only the reviewed root npm config", () => {
  const unreviewedConfigs = [
    "//registry.npmjs.org/:_authToken=private-data\n",
    '"//registry.npmjs.org/:_authToken"=private-data\n',
    'key="-----BEGIN PRIVATE KEY-----\\nprivate-data\\n"\n',
    "registry=https://alice:private-data@registry.example/\n",
    "registry=https://registry.npmjs.org/\n",
  ];

  for (const npmConfig of unreviewedConfigs) {
    const root = mkdtempSync(path.join(os.tmpdir(), "publish-context-policy-"));
    writeFileSync(path.join(root, ".npmrc"), npmConfig);
    writeFileSync(path.join(root, "package.json"), "{}\n");

    const result = auditPublishContext({
      root,
      ignoreText: policyText(),
    });

    assert.match(
      result.failures.join("\n"),
      /root \.npmrc/,
    );
  }
});

test("publication policy rejects ambiguous credential filenames", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "publish-context-policy-"));
  writeFileSync(path.join(root, "private.Key"), "private-data");
  writeFileSync(path.join(root, "private.key\n"), "private-data");
  writeFileSync(path.join(root, "private.key "), "private-data");

  const result = auditPublishContext({
    root,
    ignoreText: policyText(),
  });

  assert.equal(
    result.failures.filter((failure) =>
      failure.includes("ambiguous credential filename"),
    ).length,
    3,
  );
});

test("publication policy rejects included symlinks and special path ambiguity", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "publish-context-policy-"));
  writeFileSync(path.join(root, "outside.txt"), "safe");
  symlinkSync("outside.txt", path.join(root, "included-link"));

  const result = auditPublishContext({ root, ignoreText: policyText() });
  assert.match(result.failures.join("\n"), /symbolic link.*included-link/);
});

test("publication policy enforces the configured context ceiling", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "publish-context-policy-"));
  writeFileSync(path.join(root, "large.bin"), Buffer.alloc(2_048));

  const result = auditPublishContext({
    root,
    ignoreText: policyText(),
    limitBytes: 1_024,
  });
  assert.match(result.failures.join("\n"), /above the 1024-byte release ceiling/);
});

test("workspace build and typecheck fail closed on the publication context audit", () => {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const rootPackage = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );
  const scripts = rootPackage.scripts ?? {};

  assert.equal(
    scripts["audit:publish-context"],
    "node scripts/check-publish-context.mjs",
  );
  assert.equal(
    scripts["audit:guards"]?.startsWith(
      "pnpm run audit:publish-context && ",
    ),
    true,
  );
  assert.equal(
    scripts.typecheck?.startsWith("pnpm run audit:publish-context && "),
    true,
  );
  assert.equal(
    scripts["build:pyrus-app"]?.startsWith("pnpm run audit:guards && "),
    true,
  );
  const checkerPath = path.join(repoRoot, "scripts/check-publish-context.mjs");
  assert.equal(
    existsSync(checkerPath),
    true,
  );
  const foreignCwd = mkdtempSync(
    path.join(os.tmpdir(), "publish-context-cwd-"),
  );
  try {
    const check = spawnSync(process.execPath, [checkerPath], {
      cwd: foreignCwd,
      encoding: "utf8",
    });
    assert.equal(check.status, 0, check.stderr);
    assert.match(
      check.stdout,
      /^\[check-publish-context\] \d+ bytes across \d+ files$/m,
    );
  } finally {
    rmSync(foreignCwd, { force: true, recursive: true });
  }
});
