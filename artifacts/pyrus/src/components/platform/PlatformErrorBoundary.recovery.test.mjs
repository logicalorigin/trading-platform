import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const boundarySource = readFileSync(
  new URL("./PlatformErrorBoundary.tsx", import.meta.url),
  "utf8",
);
const indexCss = readFileSync(
  new URL("../../index.css", import.meta.url),
  "utf8",
);

test("error fallback announces the failure and puts keyboard recovery first", () => {
  assert.match(boundarySource, /role="alert"/);
  assert.match(boundarySource, /aria-labelledby=\{titleId\}/);
  assert.match(boundarySource, /ref=\{retryButtonRef\}/);
  assert.match(boundarySource, /retryButtonRef\.current\?\.focus\(\)/);
});

test("error fallback actions preserve touch and desktop target contracts", () => {
  assert.match(
    boundarySource,
    /className="platform-error-boundary-action ra-touch-target-y"/,
  );
  assert.match(
    boundarySource,
    /className="platform-error-boundary-summary ra-touch-target-y"/,
  );
  assert.match(
    indexCss,
    /\.ra-touch-target-y\s*\{[\s\S]*?min-height:\s*24px !important;/,
  );
  assert.match(
    indexCss,
    /\.ra-shell\[data-viewport="phone"\] \.ra-touch-target-y,[\s\S]*?\.ra-shell\[data-viewport="tablet"\] \.ra-touch-target-y\s*\{[\s\S]*?min-height:\s*44px !important;/,
  );
});
