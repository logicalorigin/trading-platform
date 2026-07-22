import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./PhotonicsObservatory.jsx", import.meta.url),
  "utf8",
);
const researchApiSource = readFileSync(
  new URL("./lib/researchApi.js", import.meta.url),
  "utf8",
);
const calendarSource = readFileSync(
  new URL("./components/ResearchCalendarView.jsx", import.meta.url),
  "utf8",
);

const section = (start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
};

test("company-specific fundamentals ignore results from a previous company", () => {
  const peerTable = section("function PeerTable(", "function FilingsTab(");
  const detail = section("function Detail(", "/* ════════════════════════ MAIN APP");

  assert.match(peerTable, /let cancelled = false;/);
  assert.match(peerTable, /if \(cancelled\) return;\s*setFundData/);
  assert.match(peerTable, /return \(\) => \{\s*cancelled = true;\s*\};/);
  assert.match(detail, /if \(cancelled\) return;\s*setFocalFund/);
  assert.equal(
    source.match(/<Detail key=\{selCo\.t\}/g)?.length,
    3,
    "each detail host must remount company-owned state when the ticker changes",
  );
});

test("filing and transcript requests only commit the latest company or selection", () => {
  const filings = section("function FilingsTab(", "function companyToMarkdown(");

  assert.match(filings, /const transcriptRequestRef = useRef\(0\);/);
  assert.match(filings, /if \(cancelled\) return;\s*setFilings/);
  assert.match(filings, /if \(cancelled\) return;\s*setTranscriptList/);
  assert.match(filings, /transcriptRequestRef\.current !== requestId/);
  assert.match(filings, /cancelled = true;\s*transcriptRequestRef\.current \+= 1;/);
  assert.match(filings, /loadTranscript\(\);/);
});

test("theme changes invalidate quote refreshes before stale state can commit", () => {
  const main = source.slice(source.indexOf("export default function PhotonicsObservatory("));

  assert.match(main, /const activeThemeIdRef = useRef\(themeId\);/);
  assert.match(main, /const refreshRequestRef = useRef\(0\);/);
  assert.match(main, /activeThemeIdRef\.current !== themeId/);
  assert.match(main, /refreshRequestRef\.current !== requestId/);
  assert.match(main, /setThemeId=\{selectTheme\}/);
  assert.match(main, /selectTheme\("ai"\)/);
});

test("streamed prices do not suppress snapshot enrichment or reset the refresh cadence", () => {
  const main = source.slice(source.indexOf("export default function PhotonicsObservatory("));
  const refresh = section(
    "const refreshData = useCallback",
    "  useEffect(() => {\n    if (!researchLiveEnrichmentReady",
  );

  assert.match(source, /function hasResearchSnapshot\(entry\)/);
  assert.match(main, /const liveDataRef = useRef\(\{\}\);/);
  assert.match(refresh, /const currentLiveData = liveDataRef\.current;/);
  assert.match(refresh, /!hasResearchSnapshot\(currentLiveData\[ticker\]\)/);
  assert.doesNotMatch(refresh, /\}, \[liveData,/);
  assert.match(main, /liveDataRef\.current = next;/);
});

test("calendar requests and selections stay owned by the active theme", () => {
  assert.match(calendarSource, /let cancelled = false;/);
  assert.match(calendarSource, /if \(cancelled\) return;\s*if \(!data\)/);
  assert.match(calendarSource, /return \(\) => \{\s*cancelled = true;\s*\};/);

  const calendarHost = section(
    'view === "calendar" ?',
    ') : themeUniverse.length === 0 ?',
  );
  assert.match(calendarHost, /setSel\(ticker\);\s*setView\("graph"\);/);
  assert.doesNotMatch(calendarHost, /selectTheme\(/);
});

test("authored fallback financials are never labeled fetched or reported", () => {
  const valuation = section("function deriveValuationBaseCase(", "function genFinancials(");
  const generator = section("function genFinancials(", "/* ════════════════════════ SPARKLINE COMPONENT");
  const financials = section("function FinancialsTab(", "/* ════════════════════════ VALUATION TAB");
  const detailFinancials = section("function DetailFinancialsTab(", "function Detail(");
  const detail = section("function Detail(", "/* ════════════════════════ MAIN APP");

  assert.match(valuation, /financialsReported = false/);
  assert.match(valuation, /hasLiveFcf: financialsReported &&/);
  assert.match(valuation, /hasLiveGrowth: financialsReported &&/);
  assert.match(detail, /const financialsReported = Boolean\(focalFinancials\);/);
  assert.match(source, /financialsReported \? "reported-derived" : "authored-derived"/);
  assert.match(detail, /<DetailFinancialsTab[\s\S]{0,180}?financialsReported=\{financialsReported\}/);
  assert.match(detailFinancials, /Authored financial model/);
  assert.match(detailFinancials, /Reported quarterly EPS history is unavailable/);
  assert.match(detailFinancials, /fd=\{financialsReported \? fd : null\}/);
  assert.match(financials, /isEPS \? \(isFiniteNumber\(v\)/);
  assert.doesNotMatch(generator, /epsSeed|epsRand|qEPS\.push/);
  assert.doesNotMatch(source, /live-derived/);
  assert.doesNotMatch(source, /Segment\/operations data per most recent company filings/);
});

test("unknown display values are not fabricated and clipboard fallback verifies success", () => {
  const markdown = section("function companyToMarkdown(", "/* ════════════════════════ DETAIL PANEL");
  const overview = section("function OverviewTab(", "function BusinessTab(");
  const detail = section("function Detail(", "/* ═════════════════ VALUE STREAM SANKEY");

  assert.match(markdown, /const dailyPctLabel = isFiniteNumber\(dailyPct\)/);
  assert.doesNotMatch(markdown, /dailyPct\?\.toFixed\(2\) \|\| "0"/);
  assert.match(overview, /const epsValue = live\?\.eps \?\? co\.fin\?\.eps;/);
  assert.doesNotMatch(overview, /co\.fin\?\.eps \|\| 0/);
  assert.match(detail, /if \(!document\.execCommand\("copy"\)\)/);
  assert.match(detail, /finally \{\s*ta\?\.remove\(\);\s*\}/);
});

test("research does not retain the unpopulated peer-history prefetch island", () => {
  assert.doesNotMatch(researchApiSource, /backgroundPrefetchHist/);
  assert.doesNotMatch(source, /function PriceSparkline\(/);
  assert.doesNotMatch(source, /histPrefetchProgress|setHistPrefetchProgress/);
  assert.doesNotMatch(source, /liveHist=\{liveHist\}/);
  assert.doesNotMatch(source, />1M trend</);
});

test("research copy and component contracts match their interactive surface", () => {
  assert.match(source, /Select a peer ticker to switch focus/);
  assert.doesNotMatch(source, /Click a peer row to switch focus/);
  assert.doesNotMatch(calendarSource, /\{ cos, liveData,/);
  assert.doesNotMatch(researchApiSource, /fetchTranscript\(ticker, key,/);
});
