import assert from "node:assert/strict";
import test from "node:test";
import {
  parseScribeArtifactDocuments,
  selectScribeArtifactCleanup,
} from "./replit-scribe-artifacts";

const row = (
  id: string,
  artifactId: string,
  clock: number,
  state = "live",
) => ({
  id,
  lastChangedClock: clock,
  state: JSON.stringify({
    id,
    type: "iframe",
    x: clock,
    y: clock,
    props: {
      w: 100,
      h: 100,
      state,
      artifactId,
      ownerId: `owner-${clock}`,
      componentName: artifactId,
      artifactKind: "web",
    },
  }),
});

test("scribe artifact audit parses iframe artifact documents", () => {
  const artifacts = parseScribeArtifactDocuments([
    row("shape:artifact:old", "artifacts/legacy-preview", 1),
    row("shape:artifact:pyrus", "artifacts/pyrus", 2),
    {
      id: "shape:text",
      lastChangedClock: 3,
      state: JSON.stringify({ id: "shape:text", type: "text", props: {} }),
    },
  ]);

  assert.deepEqual(
    artifacts.map((artifact) => artifact.id),
    ["shape:artifact:old", "shape:artifact:pyrus"],
  );
  assert.equal(artifacts[1].artifactId, "artifacts/pyrus");
  assert.equal(artifacts[1].state, "live");
});

test("scribe artifact cleanup keeps newest live PYRUS iframe and selects stale live artifacts", () => {
  const artifacts = parseScribeArtifactDocuments([
    row("shape:artifact:legacy", "artifacts/legacy-preview", 5),
    row("shape:artifact:pyrus-old", "artifacts/pyrus", 10),
    row("shape:artifact:pyrus-new", "artifacts/pyrus", 11),
    row("shape:artifact:pyrus-closed", "artifacts/pyrus", 12, "closed"),
  ]);
  const selection = selectScribeArtifactCleanup(artifacts);

  assert.equal(selection.keepPrimaryId, "shape:artifact:pyrus-new");
  assert.deepEqual(
    selection.cleanup.map((artifact) => [artifact.id, artifact.reason]),
    [
      ["shape:artifact:legacy", "stale-live-artifact"],
      ["shape:artifact:pyrus-old", "duplicate-primary-artifact"],
    ],
  );
});
