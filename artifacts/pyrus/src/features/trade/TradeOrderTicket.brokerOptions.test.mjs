import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./TradeOrderTicket.jsx", import.meta.url),
  "utf8",
);

test("keeps the established equity and option brokers as defaults", () => {
  assert.match(
    source,
    /const \[equityBroker, setEquityBroker\] = useState\("snaptrade"\)/,
  );
  assert.match(
    source,
    /const \[optionBroker, setOptionBroker\] = useState\("ibkr"\)/,
  );
  assert.match(
    source,
    /const liveBrokerRoute = ticketIsShares \? equityBroker : optionBroker/,
  );
});

test("shows all requested option brokers and keeps direct lanes separate from equity", () => {
  assert.match(source, /ariaLabel="Options broker"/);
  for (const broker of ["ibkr", "snaptrade", "robinhood", "schwab"]) {
    assert.match(source, new RegExp(`value: "${broker}"`));
  }
  assert.match(
    source,
    /!executionIsShadow && ticketIsShares && liveBrokerRoute === "snaptrade"/,
  );
  assert.match(
    source,
    /!executionIsShadow && ticketIsOptions && optionBroker !== "ibkr"/,
  );
});

test("routes direct option review and submit before the unchanged IBKR gates", () => {
  const previewStart = source.indexOf("const previewOrder = async () => {");
  const directPreview = source.indexOf(
    "if (liveUsesBrokerOption) {",
    previewStart,
  );
  const ibkrPreviewGate = source.indexOf("if (!brokerConfigured) {", previewStart);
  const submitStart = source.indexOf("const submitOrder = async () => {");
  const directSubmit = source.indexOf(
    "if (liveUsesBrokerOption) {",
    submitStart,
  );
  const ibkrSubmitGate = source.indexOf(
    "await submitIbkrLiveOrderAfterGate({",
    submitStart,
  );

  assert.ok(directPreview > previewStart && directPreview < ibkrPreviewGate);
  assert.ok(directSubmit > submitStart && directSubmit < ibkrSubmitGate);
  assert.match(source, /reviewBrokerOptionOrderRequest/);
  assert.match(source, /placeBrokerOptionOrderRequest/);
});

test("blocks non-IBKR option sells without broker-specific position context", () => {
  assert.match(
    source,
    /positionEffect: side === "BUY" \? "open" : null/,
  );
  assert.match(
    source,
    /Non-IBKR option sells require broker-specific position context and are not enabled\./,
  );
});

test("passes exact chain identity and contract economics to direct option brokers", () => {
  assert.match(
    source,
    /contractSymbol:\s*selectedContractMeta\?\.ticker\s*\|\|\s*selectedContractMeta\?\.providerContractId/,
  );
  assert.match(source, /multiplier: selectedContractMeta\?\.multiplier/);
  assert.match(
    source,
    /sharesPerContract: selectedContractMeta\?\.sharesPerContract/,
  );
});

test("wires Schwab readiness, sync, equity preview, and equity submit", () => {
  assert.match(source, /useGetSchwabReadiness/);
  assert.match(source, /useSyncSchwabConnections/);
  assert.match(source, /buildSchwabEquityOrderDraft/);
  assert.match(source, /previewSchwabEquityOrderRequest/);
  assert.match(source, /submitSchwabEquityOrderRequest/);
});
