import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const toastSource = readFileSync(
  new URL("./ToastStack.jsx", import.meta.url),
  "utf8",
);
const indexCss = readFileSync(
  new URL("../../index.css", import.meta.url),
  "utf8",
);

test("toast stack exposes one live region per visible message", () => {
  assert.match(toastSource, /orderToastsForDisplay\(toasts, maxVisible\)/);
  assert.doesNotMatch(toastSource, /data-testid="toast-stack"[\s\S]*?aria-live=/);
  assert.match(
    toastSource,
    /role=\{isAlertToastKind\(kind\) \? "alert" : "status"\}/,
  );
  assert.match(toastSource, /aria-atomic="true"/);
});

test("toast copy is bounded and dismiss remains touch accessible", () => {
  assert.match(toastSource, /className="ra-toast-body"/);
  assert.match(
    indexCss,
    /\.ra-toast-close\s*\{[\s\S]*?min-height:\s*24px;[\s\S]*?min-width:\s*24px;/,
  );
  assert.match(
    indexCss,
    /@media \(max-width: 1023px\)\s*\{[\s\S]*?\.ra-toast-close\s*\{[\s\S]*?min-height:\s*44px;[\s\S]*?min-width:\s*44px;/,
  );
});

test("toast activity can show accessible superscript broker bubbles", () => {
  assert.match(toastSource, /<BrokerLogoBubbles/);
  assert.match(toastSource, /brokers=\{toast\.brokers\}/);
  assert.match(toastSource, /maxVisible=\{3\}/);
});
