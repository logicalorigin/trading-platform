import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const sourcePath = new URL("./bundleAudit.mjs", import.meta.url);

async function createFixture({
  assets = { "entry.js": "console.log('ok');" },
  indexHtml = '<script type="module" src="/assets/entry.js"></script>',
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "pyrus-bundle-audit-"));
  const scriptsDir = path.join(root, "scripts");
  const assetsDir = path.join(root, "dist", "public", "assets");
  await mkdir(scriptsDir, { recursive: true });
  await mkdir(assetsDir, { recursive: true });
  await copyFile(sourcePath, path.join(scriptsDir, "bundleAudit.mjs"));
  await writeFile(path.join(root, "dist", "public", "index.html"), indexHtml);
  await Promise.all(
    Object.entries(assets).map(([fileName, source]) =>
      writeFile(path.join(assetsDir, fileName), source),
    ),
  );
  return root;
}

function runAudit(root, maxKb = "350") {
  return spawnSync(process.execPath, [path.join(root, "scripts", "bundleAudit.mjs")], {
    encoding: "utf8",
    env: { BUNDLE_AUDIT_MAX_KB: maxKb },
  });
}

test("bundle audit rejects an invalid size budget", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = runAudit(root, "Infinity");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /positive finite number/i);
});

test("bundle audit fails when no JavaScript assets exist", async (t) => {
  const root = await createFixture({ assets: {} });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = runAudit(root);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no JavaScript assets/i);
});

test("bundle audit fails when the built entry chunk cannot be found", async (t) => {
  const root = await createFixture({ indexHtml: "<html></html>" });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = runAudit(root);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /entry module/i);
});

test("bundle audit ignores inline modules before the built entry", async (t) => {
  const root = await createFixture({
    indexHtml:
      '<script type="module">globalThis.booted = true;</script><script src="/assets/entry.js" type="module"></script>',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = runAudit(root);

  assert.equal(result.status, 0, result.stderr);
});

test("bundle audit accepts complete evidence within budget", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = runAudit(root);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Entry deferred chunk guard:\nok/);
});
