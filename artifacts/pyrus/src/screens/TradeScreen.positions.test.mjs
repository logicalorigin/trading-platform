import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const tradeScreenSource = readSource("./TradeScreen.jsx");
const tradeOrderTicketSource = readSource(
  "../features/trade/TradeOrderTicket.jsx",
);
const accountPositionsPanelSource = readSource("./account/PositionsPanel.jsx");
const platformAppSource = readSource("../features/platform/PlatformApp.jsx");
const accountScreenSource = readSource("./AccountScreen.jsx");

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
  assert.match(
    tradeScreenSource,
    /requestTicketAssetMode\(symPing\.assetMode\)/,
  );
  assert.match(tradeScreenSource, /requestTicketAssetMode\(mode\)/);
  assert.doesNotMatch(
    tradeScreenSource,
    /setTicketAssetModeRequest\(\{ mode: symPing\.assetMode, nonce: symPing\.n \}\)/,
  );
});
