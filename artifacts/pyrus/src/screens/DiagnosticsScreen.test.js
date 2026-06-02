import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const diagnosticsSource = () =>
  readFileSync(new URL("./DiagnosticsScreen.jsx", import.meta.url), "utf8");

test("diagnostics overview memory card uses memory signal instead of broad resource pressure", () => {
  const source = diagnosticsSource();

  assert.match(source, /const memoryOverviewSeverity\s*=/);
  assert.match(
    source,
    /<MetricCard label="Memory" value=\{String\(footerSignal\.level \|\| "normal"\)\.toUpperCase\(\)\}/,
  );
  assert.doesNotMatch(
    source,
    /<MetricCard label="Memory" value=\{String\(resourcePressureMetrics\.pressureLevel/,
  );
  assert.doesNotMatch(
    source,
    /footerMemoryMetrics\?\.level \|\|\s*resourcePressureMetrics\.clientPressureLevel \|\|\s*resourcePressureMetrics\.pressureLevel/,
  );
});
