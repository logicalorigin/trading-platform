import assert from "node:assert/strict";
import test from "node:test";
import {
  nasdaqListedRecordToUniverseTicker,
  parseNasdaqListedDirectory,
} from "./nasdaq-symbol-directory";

const SAMPLE_DIRECTORY = [
  "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
  "AAPL|Apple Inc. Common Stock|Q|N|N|100|N|N",
  "QQQ|Invesco QQQ Trust|G|N|N|100|Y|N",
  "AACBU|Artius II Acquisition Inc. Unit|G|N|N|100|N|N",
  "TEST|Test Company Common Stock|S|Y|N|100|N|N",
  "HALT|Halted Company Common Stock|Q|N|D|100|N|N",
  "BLNK|Blank Status Common Stock|Q|N||100|N|N",
  "File Creation Time: 0430202613:32|||||||",
].join("\n");

test("parses NASDAQ listed symbols and applies stock-safe defaults", () => {
  const parsed = parseNasdaqListedDirectory(SAMPLE_DIRECTORY);

  assert.deepEqual(
    parsed.records.map((record) => record.symbol),
    ["AAPL", "BLNK"],
  );
  assert.equal(parsed.fileCreationTime, "0430202613:32");
  assert.equal(parsed.skippedCount, 4);
});

test("can include ETFs and test issues when requested", () => {
  const parsed = parseNasdaqListedDirectory(SAMPLE_DIRECTORY, {
    includeEtfs: true,
    includeTestIssues: true,
    includeNonCommonStock: true,
    normalFinancialStatusOnly: false,
  });

  assert.deepEqual(
    parsed.records.map((record) => record.symbol),
    ["AAPL", "QQQ", "AACBU", "TEST", "HALT", "BLNK"],
  );
});

test("maps NASDAQ records to pending universe catalog rows", () => {
  const [record] = parseNasdaqListedDirectory(SAMPLE_DIRECTORY).records;
  const ticker = nasdaqListedRecordToUniverseTicker(record);

  assert.equal(ticker.ticker, "AAPL");
  assert.equal(ticker.market, "stocks");
  assert.equal(ticker.normalizedExchangeMic, "XNAS");
  assert.equal(ticker.primaryExchange, "NASDAQ");
  assert.equal(ticker.providers.length, 0);
  assert.equal(ticker.providerContractId, null);
  assert.equal(ticker.contractMeta?.listingSource, "nasdaqtrader");
});
