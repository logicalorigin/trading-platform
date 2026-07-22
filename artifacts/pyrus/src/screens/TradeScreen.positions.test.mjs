import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const tradeScreenSource = readSource("./TradeScreen.jsx");
const tradePositionsPanelSource = readSource(
  "../features/trade/TradePositionsPanel.jsx",
);
const tradeOrderTicketSource = readSource(
  "../features/trade/TradeOrderTicket.jsx",
);
const accountPositionsPanelSource = readSource("./account/PositionsPanel.jsx");
const platformAppSource = readSource(
  "../features/platform/PlatformApp.jsx",
);
const accountScreenSource = readSource("./AccountScreen.jsx");
const algoScreenSource = readSource("./AlgoScreen.jsx");
const algoLivePageSource = readSource("./algo/AlgoLivePage.jsx");
const operationsPositionsSource = readSource(
  "./algo/OperationsPositionsTable.jsx",
);

test("trade consumers use the canonical account-position detail they need", () => {
  const tradeScreenQueryParams =
    /tradeBrokerAccountId \|\| "",\s*\{ mode: tradeBrokerAccountMode, liveQuotes: false, detail: "fast" \}/;
  const tradePositionsPanelQueryParams =
    /accountId \|\| "",\s*\{ mode: brokerAccountMode, liveQuotes: false, detail: "full" \}/;
  const heldContractsStart = tradeScreenSource.indexOf(
    "const heldContracts = useMemo",
  );
  const heldContractsBlock = tradeScreenSource.slice(
    heldContractsStart,
    heldContractsStart + 1_800,
  );

  assert.notEqual(heldContractsStart, -1);
  assert.match(tradeScreenSource, /\buseGetAccountPositions\b/);
  assert.doesNotMatch(tradeScreenSource, /\buseListPositions\b/);
  assert.match(tradeScreenSource, tradeScreenQueryParams);
  assert.match(tradePositionsPanelSource, tradePositionsPanelQueryParams);
  assert.match(heldContractsBlock, /position\.positionType === "option"/);
  assert.match(heldContractsBlock, /position\.marketDataSymbol/);
  assert.match(heldContractsBlock, /position\.optionContract\.underlying/);
  assert.match(heldContractsBlock, /entry:\s*position\.averageCost/);
  assert.doesNotMatch(heldContractsBlock, /position\.averagePrice/);
});

test("ticket refreshes canonical positions without dropping legacy observers", () => {
  assert.equal(
    [
      ...tradeOrderTicketSource.matchAll(
        /queryKey:\s*\[`\/api\/accounts\/\$\{accountId\}\/positions`\]/g,
      ),
    ].length,
    1,
  );
  assert.match(
    tradeOrderTicketSource,
    /queryKey:\s*\[`\/api\/accounts\/\$\{submittedAccountId\}\/positions`\]/,
  );
  assert.ok(
    [...tradeOrderTicketSource.matchAll(/queryKey:\s*\["\/api\/positions"\]/g)]
      .length >= 2,
  );
});

test("position Trade actions preserve asset mode and open the matching ticket", () => {
  assert.match(
    accountPositionsPanelSource,
    /const tradeIntent = buildPositionTradeIntent\(row\);/,
  );
  assert.match(
    accountPositionsPanelSource,
    /onJumpToChart\?\.\(row\.symbol, tradeIntent\)/,
  );
  assert.match(
    accountPositionsPanelSource,
    /disabled: !onJumpToChart \|\| !tradeIntent/,
  );
  assert.match(accountPositionsPanelSource, /exp: rawExpiry/);
  assert.match(
    accountScreenSource,
    /onJumpToChart=\{\(symbol, tradeIntent\) =>\s*onJumpToTrade\?\.\(symbol, tradeIntent\)\s*\}/,
  );
  assert.match(
    platformAppSource,
    /const handleAccountJumpToTrade = useCallback\(\s*\(symbol, tradeIntent = null\)/,
  );
  assert.match(
    platformAppSource,
    /handleSelectSymbol\(symbol, tradeIntent\)/,
  );
  assert.match(
    tradeScreenSource,
    /requestedAssetMode=\{ticketAssetModeRequest\?\.mode \?\? null\}/,
  );
  assert.match(
    tradeScreenSource,
    /requestedAssetModeNonce=\{ticketAssetModeRequest\?\.nonce \?\? 0\}/,
  );
  assert.match(
    tradeOrderTicketSource,
    /selectTicketAssetMode\(requestedAssetMode\)/,
  );
  assert.match(
    tradeScreenSource,
    /const requestTicketAssetMode = useCallback\([\s\S]*nonce: \(current\?\.nonce \|\| 0\) \+ 1/,
  );
  assert.match(tradeScreenSource, /requestTicketAssetMode\(symPing\.assetMode\)/);
  assert.match(tradeScreenSource, /requestTicketAssetMode\(mode\)/);
  assert.doesNotMatch(
    tradeScreenSource,
    /setTicketAssetModeRequest\(\{ mode: symPing\.assetMode, nonce: symPing\.n \}\)/,
  );
});

test("position Close preserves the account-bound review intent through the ticket handoff", () => {
  assert.match(accountPositionsPanelSource, /buildIbkrCloseReviewIntent/);
  assert.match(accountPositionsPanelSource, /closeReviewIntent: closeReview\.intent/);
  assert.match(accountScreenSource, /accountProvider=\{accountProviderScope\}/);
  assert.match(
    algoScreenSource,
    /positionManagementAccountProvider=\{\s*positionManagementAccountProvider\s*\}/,
  );
  assert.match(
    algoLivePageSource,
    /accountProvider=\{positionManagementAccountProvider\}/,
  );
  assert.match(
    operationsPositionsSource,
    /accountProvider=\{accountProvider\}/,
  );
  assert.match(
    platformAppSource,
    /closeReviewIntent: tradeIntent\?\.closeReviewIntent \|\| null/,
  );
  assert.match(tradeScreenSource, /requestTicketCloseReview\(symPing\.closeReviewIntent\)/);
  assert.match(tradeScreenSource, /requestTicketCloseReview\(closeReviewIntent\)/);
  assert.match(
    tradeScreenSource,
    /requestedCloseReviewIntent=\{ticketCloseReviewRequest\?\.intent \?\? null\}/,
  );
  assert.match(
    tradeScreenSource,
    /requestedCloseReviewNonce=\{ticketCloseReviewRequest\?\.nonce \?\? 0\}/,
  );
  assert.match(tradeScreenSource, /onExitCloseReview=\{exitTicketCloseReview\}/);
  assert.match(tradeOrderTicketSource, /getIbkrCloseReviewIntentIssue/);
  assert.match(tradeOrderTicketSource, /selectEquityBroker\("ibkr"\)/);
  assert.match(tradeOrderTicketSource, /setSelectedIbkrAccountId\(closeReview\.accountId\)/);
  assert.match(tradeOrderTicketSource, /setExecutionMode\("live"\)/);
  assert.match(tradeOrderTicketSource, /setOrderType\("LMT"\)/);
  assert.match(tradeOrderTicketSource, /setTif\("DAY"\)/);
  assert.match(platformAppSource, /primaryAccountProvider/);
  assert.match(tradeScreenSource, /accountProvider=\{accountProvider\}/);
  assert.match(tradeScreenSource, /const tradeBrokerAccountMode = directIbkrAccountSelected/);
  assert.match(tradeScreenSource, /void tradePositionsQuery\.refetch\(\)/);
  assert.match(tradeScreenSource, /requiredStrike=\{closeReviewRequiredStrike\}/);
  assert.match(tradeScreenSource, /preserveMissingContract=\{Boolean\(closeReviewRequiredStrike\)\}/);
});
