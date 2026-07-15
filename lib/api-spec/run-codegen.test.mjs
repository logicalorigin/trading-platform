import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  normalizeStagedOutputs,
  publishStagedOutputs,
  validatePublishedOutputs,
} from "./run-codegen.mjs";
import {
  createValidationLock,
  removeValidationLock,
} from "../../scripts/run-validation-command.mjs";

const generatedRoots = ["generated/react", "generated/zod"];
const managedFiles = ["index.ts"];

async function put(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

async function text(root, relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function snapshots(recoveryRoot) {
  try {
    return (await readdir(recoveryRoot)).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pyrus-codegen-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const targetRoot = path.join(root, "live");
  const stagingRoot = path.join(root, "staging");
  const recoveryRoot = path.join(targetRoot, ".recovery");
  const lockFile = path.join(root, "validation.lock");
  await Promise.all([mkdir(targetRoot), mkdir(stagingRoot)]);
  return { targetRoot, stagingRoot, recoveryRoot, lockFile };
}

test("no-op publication validates without replacing managed files", async (t) => {
  const paths = await fixture(t);
  const productionRoots = [
    "lib/api-client-react/src/generated",
    "lib/api-zod/src/generated",
  ];
  const productionFiles = ["lib/api-zod/src/index.ts"];
  for (const relativePath of [
    "lib/api-client-react/src/generated/api.schemas.ts",
    "lib/api-zod/src/generated/api.ts",
  ]) {
    await put(paths.targetRoot, relativePath, "unchanged\n");
    await put(paths.stagingRoot, relativePath, "unchanged\n\n\n");
  }
  await put(paths.targetRoot, "lib/api-zod/src/index.ts", "unchanged index\n");
  await put(paths.stagingRoot, "lib/api-zod/src/index.ts", "unchanged index\n");
  await normalizeStagedOutputs(paths.stagingRoot);
  const targetPath = path.join(
    paths.targetRoot,
    "lib/api-client-react/src/generated/api.schemas.ts",
  );
  const before = await stat(targetPath, { bigint: true });
  let validations = 0;

  const result = await publishStagedOutputs({
    ...paths,
    generatedRoots: productionRoots,
    managedFiles: productionFiles,
    validate: async () => {
      validations += 1;
    },
  });

  const after = await stat(targetPath, { bigint: true });
  assert.deepEqual(result, { written: [], deleted: [] });
  assert.equal(validations, 1);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.deepEqual(await snapshots(paths.recoveryRoot), []);
  assert.equal(await pathExists(paths.lockFile), false);
});

test("delta publication is sorted and removes only stale managed files", async (t) => {
  const paths = await fixture(t);
  await put(paths.targetRoot, "generated/react/api.ts", "old\n");
  await put(paths.targetRoot, "generated/react/stale.ts", "stale\n");
  await put(paths.targetRoot, "generated/zod/api.ts", "same\n");
  await put(paths.targetRoot, "index.ts", "old index\n");
  await put(paths.targetRoot, "unmanaged.txt", "keep\n");

  await put(paths.stagingRoot, "generated/react/api.ts", "new\n");
  await put(paths.stagingRoot, "generated/react/nested/new.ts", "added\n");
  await put(paths.stagingRoot, "generated/zod/api.ts", "same\n");
  await put(paths.stagingRoot, "index.ts", "new index\n");

  const result = await publishStagedOutputs({
    ...paths,
    generatedRoots,
    managedFiles,
    validate: async () => {
      assert.equal(
        await text(paths.targetRoot, "generated/react/api.ts"),
        "new\n",
      );
      assert.equal(
        await pathExists(
          path.join(paths.targetRoot, "generated/react/stale.ts"),
        ),
        false,
      );
    },
  });

  assert.deepEqual(result, {
    written: [
      "generated/react/api.ts",
      "generated/react/nested/new.ts",
      "index.ts",
    ],
    deleted: ["generated/react/stale.ts"],
  });
  assert.equal(await text(paths.targetRoot, "unmanaged.txt"), "keep\n");
  assert.deepEqual(await snapshots(paths.recoveryRoot), []);
  assert.equal(await pathExists(paths.lockFile), false);
});

test("a held validation lock refuses publication before mutation", async (t) => {
  const paths = await fixture(t);
  await put(paths.targetRoot, "generated/react/api.ts", "old\n");
  await put(paths.targetRoot, "generated/zod/api.ts", "old\n");
  await put(paths.targetRoot, "index.ts", "old\n");
  await put(paths.stagingRoot, "generated/react/api.ts", "new\n");
  await put(paths.stagingRoot, "generated/zod/api.ts", "new\n");
  await put(paths.stagingRoot, "index.ts", "new\n");
  const owner = createValidationLock(paths.lockFile, "existing-validation");
  assert.equal(owner.acquired, true);
  t.after(() => removeValidationLock(paths.lockFile, owner.lockId));

  await assert.rejects(
    publishStagedOutputs({
      ...paths,
      generatedRoots,
      managedFiles,
      validate: async () => assert.fail("validation must not run"),
    }),
    /validation lock is held.*existing-validation/iu,
  );

  assert.equal(await text(paths.targetRoot, "generated/react/api.ts"), "old\n");
  assert.deepEqual(await snapshots(paths.recoveryRoot), []);
});

test("publication rejects symlink ancestors before reading or writing managed output", async (t) => {
  const paths = await fixture(t);
  const outsideRoot = path.join(path.dirname(paths.targetRoot), "outside");
  await put(outsideRoot, "react/api.ts", "outside old\n");
  await symlink(outsideRoot, path.join(paths.targetRoot, "generated"));
  await put(paths.targetRoot, "index.ts", "old index\n");
  await put(paths.stagingRoot, "generated/react/api.ts", "staged new\n");
  await put(paths.stagingRoot, "generated/zod/api.ts", "staged zod\n");
  await put(paths.stagingRoot, "index.ts", "new index\n");

  await assert.rejects(
    publishStagedOutputs({
      ...paths,
      generatedRoots,
      managedFiles,
      validate: async () => assert.fail("validation must not run"),
    }),
    /symbolic link.*generated/iu,
  );

  assert.equal(await text(outsideRoot, "react/api.ts"), "outside old\n");
  assert.deepEqual(await snapshots(paths.recoveryRoot), []);
  assert.equal(await pathExists(paths.lockFile), false);
});

test("validation failure restores changed deleted and newly created files", async (t) => {
  const paths = await fixture(t);
  await put(paths.targetRoot, "generated/react/api.ts", "old\n");
  await put(paths.targetRoot, "generated/react/stale.ts", "restore me\n");
  await put(paths.targetRoot, "generated/zod/api.ts", "old zod\n");
  await put(paths.targetRoot, "index.ts", "old index\n");

  await put(paths.stagingRoot, "generated/react/api.ts", "new\n");
  await put(paths.stagingRoot, "generated/react/new.ts", "remove me\n");
  await put(paths.stagingRoot, "generated/zod/api.ts", "new zod\n");
  await put(paths.stagingRoot, "index.ts", "new index\n");

  await assert.rejects(
    publishStagedOutputs({
      ...paths,
      generatedRoots,
      managedFiles,
      validate: async () => {
        throw new Error("focused validation failed");
      },
    }),
    /focused validation failed/u,
  );

  assert.equal(await text(paths.targetRoot, "generated/react/api.ts"), "old\n");
  assert.equal(
    await text(paths.targetRoot, "generated/react/stale.ts"),
    "restore me\n",
  );
  assert.equal(
    await pathExists(path.join(paths.targetRoot, "generated/react/new.ts")),
    false,
  );
  assert.equal(
    await text(paths.targetRoot, "generated/zod/api.ts"),
    "old zod\n",
  );
  assert.equal(await text(paths.targetRoot, "index.ts"), "old index\n");
  assert.deepEqual(await snapshots(paths.recoveryRoot), []);
  assert.equal(await pathExists(paths.lockFile), false);
});

test("rollback rejects an ancestor swapped to a symlink during validation", async (t) => {
  const paths = await fixture(t);
  const outsideRoot = path.join(
    path.dirname(paths.targetRoot),
    "rollback-outside",
  );
  const movedGenerated = path.join(
    paths.targetRoot,
    "generated-after-publication",
  );
  await put(paths.targetRoot, "generated/react/api.ts", "old\n");
  await put(paths.targetRoot, "generated/zod/api.ts", "old\n");
  await put(paths.targetRoot, "index.ts", "old\n");
  await put(paths.stagingRoot, "generated/react/api.ts", "new\n");
  await put(paths.stagingRoot, "generated/zod/api.ts", "new\n");
  await put(paths.stagingRoot, "index.ts", "new\n");
  await put(outsideRoot, "react/sentinel.txt", "do not delete\n");

  await assert.rejects(
    publishStagedOutputs({
      ...paths,
      generatedRoots,
      managedFiles,
      validate: async () => {
        await rename(path.join(paths.targetRoot, "generated"), movedGenerated);
        await symlink(outsideRoot, path.join(paths.targetRoot, "generated"));
        throw new Error("validation failed after path swap");
      },
    }),
    /rollback failed.*recovery snapshot retained/iu,
  );

  assert.equal(
    await text(outsideRoot, "react/sentinel.txt"),
    "do not delete\n",
  );
  assert.equal(await text(movedGenerated, "react/api.ts"), "new\n");
  assert.equal((await snapshots(paths.recoveryRoot)).length, 1);
  assert.equal(await pathExists(paths.lockFile), false);
});

test("snapshot cleanup rejects a recovery ancestor swapped during validation", async (t) => {
  const paths = await fixture(t);
  const movedRecovery = path.join(paths.targetRoot, ".recovery-moved");
  const outsideRecovery = path.join(
    path.dirname(paths.targetRoot),
    "cleanup-outside",
  );
  await put(paths.targetRoot, "generated/react/api.ts", "old\n");
  await put(paths.targetRoot, "generated/zod/api.ts", "old\n");
  await put(paths.targetRoot, "index.ts", "old\n");
  await put(paths.stagingRoot, "generated/react/api.ts", "new\n");
  await put(paths.stagingRoot, "generated/zod/api.ts", "new\n");
  await put(paths.stagingRoot, "index.ts", "new\n");

  await assert.rejects(
    publishStagedOutputs({
      ...paths,
      generatedRoots,
      managedFiles,
      validate: async () => {
        const [snapshot] = await snapshots(paths.recoveryRoot);
        assert.ok(snapshot);
        await rename(paths.recoveryRoot, movedRecovery);
        await put(
          outsideRecovery,
          `${snapshot}/sentinel.txt`,
          "do not delete\n",
        );
        await symlink(outsideRecovery, paths.recoveryRoot);
      },
    }),
    /symbolic link.*\.recovery/iu,
  );

  const [retainedSnapshot] = await readdir(movedRecovery);
  assert.match(retainedSnapshot, /^api-codegen-rollback-/u);
  assert.equal(
    await text(outsideRecovery, `${retainedSnapshot}/sentinel.txt`),
    "do not delete\n",
  );
  assert.equal(await text(paths.targetRoot, "generated/react/api.ts"), "new\n");
  assert.equal(await pathExists(paths.lockFile), false);
});

test("publication failure restores the complete snapshot before returning", async (t) => {
  const paths = await fixture(t);
  await put(paths.targetRoot, "generated/react/a.ts", "old first\n");
  await mkdir(path.join(paths.targetRoot, "generated/react/b.ts"), {
    recursive: true,
  });
  await put(paths.targetRoot, "generated/zod/api.ts", "old later\n");
  await put(paths.targetRoot, "index.ts", "old index\n");
  await put(paths.stagingRoot, "generated/react/a.ts", "new first\n");
  await put(paths.stagingRoot, "generated/react/b.ts", "blocked write\n");
  await put(paths.stagingRoot, "generated/zod/api.ts", "new later\n");
  await put(paths.stagingRoot, "index.ts", "new index\n");

  await assert.rejects(
    publishStagedOutputs({
      ...paths,
      generatedRoots,
      managedFiles,
      validate: async () => assert.fail("validation must not run"),
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    await text(paths.targetRoot, "generated/react/a.ts"),
    "old first\n",
  );
  assert.equal(
    (
      await stat(path.join(paths.targetRoot, "generated/react/b.ts"))
    ).isDirectory(),
    true,
  );
  assert.equal(
    await text(paths.targetRoot, "generated/zod/api.ts"),
    "old later\n",
  );
  assert.equal(await text(paths.targetRoot, "index.ts"), "old index\n");
  assert.deepEqual(await snapshots(paths.recoveryRoot), []);
  assert.equal(await pathExists(paths.lockFile), false);
});

for (const validationFailure of ["api-zod", "typecheck"]) {
  test(`${validationFailure} command failure restores published output`, async (t) => {
    const paths = await fixture(t);
    await put(paths.targetRoot, "generated/react/api.ts", "old\n");
    await put(paths.targetRoot, "generated/zod/api.ts", "old\n");
    await put(paths.targetRoot, "index.ts", "old\n");
    await put(paths.stagingRoot, "generated/react/api.ts", "new\n");
    await put(paths.stagingRoot, "generated/zod/api.ts", "new\n");
    await put(paths.stagingRoot, "index.ts", "new\n");
    const commands = [];

    await assert.rejects(
      publishStagedOutputs({
        ...paths,
        generatedRoots,
        managedFiles,
        validate: () =>
          validatePublishedOutputs(paths.targetRoot, (_command, args) => {
            commands.push(args);
            if (validationFailure === "api-zod" || args.includes("tsc")) {
              throw new Error(`${validationFailure} failed`);
            }
          }),
      }),
      new RegExp(`${validationFailure} failed`, "u"),
    );

    assert.equal(
      await text(paths.targetRoot, "generated/react/api.ts"),
      "old\n",
    );
    assert.deepEqual(
      commands,
      validationFailure === "api-zod"
        ? [["--filter", "@workspace/api-zod", "test"]]
        : [
            ["--filter", "@workspace/api-zod", "test"],
            ["exec", "tsc", "--build"],
          ],
    );
    assert.deepEqual(await snapshots(paths.recoveryRoot), []);
    assert.equal(await pathExists(paths.lockFile), false);
  });
}

test("rollback failure retains its recovery snapshot and reports its path", async (t) => {
  const paths = await fixture(t);
  await put(paths.targetRoot, "generated/react/api.ts", "old\n");
  await put(paths.targetRoot, "generated/zod/api.ts", "old\n");
  await put(paths.targetRoot, "index.ts", "old\n");
  await put(paths.stagingRoot, "generated/react/api.ts", "new\n");
  await put(paths.stagingRoot, "generated/zod/api.ts", "new\n");
  await put(paths.stagingRoot, "index.ts", "new\n");

  await assert.rejects(
    publishStagedOutputs({
      ...paths,
      generatedRoots,
      managedFiles,
      validate: async () => {
        const [snapshot] = await snapshots(paths.recoveryRoot);
        assert.ok(snapshot);
        const snapshotPath = path.join(paths.recoveryRoot, snapshot);
        for (const entry of await readdir(snapshotPath)) {
          if (entry !== "manifest.json") {
            await rm(path.join(snapshotPath, entry), {
              recursive: true,
              force: true,
            });
          }
        }
        throw new Error("validation caused rollback");
      },
    }),
    /rollback failed.*recovery snapshot retained at .*api-codegen-rollback-/iu,
  );

  const retained = await snapshots(paths.recoveryRoot);
  assert.equal(retained.length, 1);
  assert.match(retained[0], /^api-codegen-rollback-/u);
  assert.equal(await pathExists(paths.lockFile), false);
});

test("published validation runs the focused API-Zod test before typecheck", async () => {
  const calls = [];
  await validatePublishedOutputs("/repo", (command, args, options) => {
    calls.push({ command, args, options });
  });

  assert.deepEqual(
    calls.map(({ command, args }) => [command, args]),
    [
      ["pnpm", ["--filter", "@workspace/api-zod", "test"]],
      ["pnpm", ["exec", "tsc", "--build"]],
    ],
  );
  assert.equal(calls[1].options.cwd, "/repo");
  assert.equal(calls[1].options.env.NODE_OPTIONS, "--max-old-space-size=3072");
});
