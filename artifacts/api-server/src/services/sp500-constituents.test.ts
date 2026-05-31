import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSp500ConstituentsCsv,
  sp500ConstituentToUniverseTicker,
} from "./sp500-constituents";

const SAMPLE_SP500_CSV = [
  "Symbol,Security,GICS Sector,GICS Sub-Industry,Headquarters Location,Date added,CIK,Founded",
  "MMM,3M,Industrials,Industrial Conglomerates,\"Saint Paul, Minnesota\",1957-03-04,66740,1902",
  "BRK-B,Berkshire Hathaway,Financials,Multi-Sector Holdings,\"Omaha, Nebraska\",2010-02-16,1067983,1839",
  ",Missing Symbol,Industrials,Testing,,2020-01-01,,",
].join("\n");

test("parses S&P 500 constituents CSV and normalizes share-class symbols", () => {
  const parsed = parseSp500ConstituentsCsv(SAMPLE_SP500_CSV);

  assert.deepEqual(
    parsed.records.map((record) => record.symbol),
    ["MMM", "BRK.B"],
  );
  assert.equal(parsed.skippedCount, 1);
  assert.equal(parsed.records[0]?.headquartersLocation, "Saint Paul, Minnesota");
});

test("maps S&P 500 constituents to pending universe catalog rows", () => {
  const [, record] = parseSp500ConstituentsCsv(SAMPLE_SP500_CSV).records;
  const ticker = sp500ConstituentToUniverseTicker(record);

  assert.equal(ticker.ticker, "BRK.B");
  assert.equal(ticker.market, "stocks");
  assert.equal(ticker.sector, "Financials");
  assert.equal(ticker.contractMeta?.listingSource, "sp500");
  assert.equal(ticker.contractMeta?.indexMemberships, "sp500");
});
