import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./FlowScreen.jsx", import.meta.url), "utf8");

test("narrow Flow layouts never inherit the desktop filter panel as an open overlay", () => {
  assert.doesNotMatch(source, /HAS_PERSISTED_FLOW_FILTERS_OPEN/);
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*if \(isNarrowFlowLayout\) \{\s*setFiltersOpen\(false\);\s*\}\s*\}, \[isNarrowFlowLayout\]\);/,
  );
});

test("inline Flow filters keep the main column beside them and context below without a rail", () => {
  assert.match(
    source,
    /gridColumn:\s*showInlineFilterPanel \|\| showContextRail\s*\? "auto"\s*: "1 \/ -1"/,
  );
  assert.match(
    source,
    /<div\s+style=\{\{\s*display: "flex",\s*flexDirection: "column",\s*gap: sp\(6\),\s*minWidth: 0,\s*gridColumn: showContextRail \? "auto" : "1 \/ -1",\s*\}\}\s*>\s*\{shouldRenderDeferredPanels/,
  );
});

test("desktop side-card filter controls stack before their labels can overflow", () => {
  assert.match(
    source,
    /gridTemplateColumns: isMobileFlowLayout\s*\? "repeat\(2, minmax\(0, 1fr\)\)"\s*: "minmax\(0, 1fr\)"/,
  );
});

test("Flow feed failures, stale snapshots, and a disabled scanner expose recovery", () => {
  assert.match(source, /const flowTapeError = Boolean\(displayableFlowError\);/);
  assert.match(source, /data-testid="flow-recover-scanner"/);
  assert.match(source, /flowTapeError\s*\? "Flow source unavailable"/);
  assert.match(source, /variant=\{\s*flowTapeError\s*\? "error"/);
  assert.match(source, /staleFlowEvents \|\| flowQuality\?\.label === "Stale"/);
  assert.match(source, /!flowScannerEnabled\s*\? "Flow scanner paused"/);
});

test("Flow scanner provenance reflects observed provider and classification coverage", () => {
  const inferredConfidenceAssignments = source.match(
    /classificationConfidence:\s*inferPremiumClassificationConfidence\(classificationCoverage\),/g,
  );

  assert.equal(inferredConfidenceAssignments?.length, 2);
  assert.doesNotMatch(
    source,
    /classificationConfidence:\s*classificationCoverage > 0 \? "high" : "none"/,
  );
  assert.match(
    source,
    /providerSummary\?\.providers\?\.find\(\(provider\) => provider && provider !== "none"\)\s*\|\|\s*"unknown";/,
  );
});

test("Flow registers its workspace-settings listener once", () => {
  assert.equal(
    source.match(
      /window\.addEventListener\(\s*PYRUS_WORKSPACE_SETTINGS_EVENT,\s*handleWorkspaceSettings,?\s*\)/g,
    )?.length,
    1,
  );
  assert.equal(
    source.match(
      /window\.removeEventListener\(\s*PYRUS_WORKSPACE_SETTINGS_EVENT,\s*handleWorkspaceSettings,?\s*\)/g,
    )?.length,
    1,
  );
});

test("Flow validates persisted presets and scanner controls before use", () => {
  assert.match(source, /const normalizeFlowSavedScans = \(value\) =>/);
  assert.match(
    source,
    /useState\(\(\) =>\s*normalizeFlowSavedScans\(_initialState\.flowSavedScans\),?\s*\)/,
  );
  assert.match(
    source,
    /useState\(\(\) =>\s*normalizeFlowDensity\(_initialState\.flowDensity\),?\s*\)/,
  );
  assert.match(
    source,
    /useState\(\(\) =>\s*normalizeFlowRowsPerPage\(_initialState\.flowRowsPerPage\),?\s*\)/,
  );
  assert.match(source, /setDensity\(normalizeFlowDensity\(scan\.density\)\)/);
  assert.match(
    source,
    /setRowsPerPage\(normalizeFlowRowsPerPage\(scan\.rowsPerPage, rowsPerPage\)\)/,
  );
});

test("Flow only reports a copied contract after the clipboard write succeeds", () => {
  const handlerStart = source.indexOf("const handleCopyContract");
  const handlerEnd = source.indexOf("const handleTogglePinned", handlerStart);
  assert.notEqual(handlerStart, -1);
  assert.notEqual(handlerEnd, -1);

  const handlerSource = source.slice(handlerStart, handlerEnd);
  const writeIndex = handlerSource.indexOf(
    "await navigator.clipboard.writeText(contractLabel)",
  );
  const copiedIndex = handlerSource.indexOf("setCopiedEventId(contractEvent.id)");
  assert.match(handlerSource, /const handleCopyContract = async/);
  assert.ok(writeIndex >= 0, "clipboard write is awaited");
  assert.ok(copiedIndex > writeIndex, "copied state follows a successful write");
  assert.match(handlerSource, /catch \(_error\) \{\s*return;\s*\}/);
});

test("Flow saved presets use sibling native buttons instead of nested controls", () => {
  const presetsStart = source.indexOf("{savedScans.length ? (");
  const presetsEnd = source.indexOf("const columnDrawerPanel", presetsStart);
  const presetsSource = source.slice(presetsStart, presetsEnd);

  assert.doesNotMatch(presetsSource, /role="button"/);
  assert.match(
    presetsSource,
    /<button[\s\S]*?aria-label=\{`Load preset \$\{scan\.name\}`\}/,
  );
  assert.match(
    presetsSource,
    /<button[\s\S]*?aria-label=\{`Delete preset \$\{scan\.name\}`\}/,
  );
});

test("Flow mobile cards keep row selection separate from action buttons", () => {
  const cardStart = source.indexOf("const renderFlowMobileCard");
  const cardEnd = source.indexOf("const flowScannerStatusProps", cardStart);
  const cardSource = source.slice(cardStart, cardEnd);

  assert.doesNotMatch(
    cardSource,
    /data-testid="flow-row-card"[\s\S]{0,180}?role="button"/,
  );
  assert.match(
    cardSource,
    /<button[\s\S]*?aria-label=\{`View \$\{event\.ticker\} flow details`\}/,
  );
  assert.match(cardSource, /\{renderTapeCell\("actions", event\)\}/);
});
