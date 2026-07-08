# WO-P1-T3 Report

Observed:
- `quoteCacheByProviderContractId` accepted stream quotes by provider contract id and did not evict on unsubscribe or retained-demand expiry.
- A late stream poll could reinsert a quote after the last subscriber unsubscribed.

Change:
- Added cache liveness checks backed by active subscribers and retained snapshot demands.
- Pruned cache entries when subscribers unsubscribe and when retained snapshot demand is removed, released, or expires.
- Rejected non-demanded stream/test cache writes.
- Preserved existing synchronous snapshot cache reuse with a bounded retained buffer of 1,000 entries above live demand; active-demand entries are not evicted by the cap.

Steady-RSS spot check:
- The focused subscribe -> quote -> unsubscribe churn unit exercised 250 unique provider contract ids and `cachedQuoteCount` returned to `0` after every unsubscribe, so cache size did not grow monotonically across churn.
- Node RSS spot check for that churn unit: `rssStart=113020928 rssEnd=118263808 delta=5242880`.

Verification:
```text
$ pnpm --filter @workspace/api-server exec tsx -e '<subscribe/quote/unsubscribe churn unit>'
bridge option quote cache churn unit: PASS
```

```text
$ pnpm --filter @workspace/api-server exec tsx -e '<subscribe/quote/unsubscribe churn unit with process.memoryUsage().rss>'
bridge option quote cache churn rss unit: PASS rssStart=113020928 rssEnd=118263808 delta=5242880
```

```text
$ pnpm --filter @workspace/api-server exec tsx --test src/services/bridge-option-quote-stream.test.ts
✔ algo operations automation live quote snapshots use Massive OPRA quotes (7.184974ms)
✔ unconfigured Massive option snapshots report Massive runtime unavailable (0.543094ms)
✔ off-hours upstream-unavailable option fetch does not record a connection error (1.274635ms)
✔ a genuine upstream error still records a connection error (0.52379ms)
✔ account monitor can refresh stale cached option quotes with a bounded timeout (2.474854ms)
✔ option stream generic Output exceeded error does not shed scanner demand (172.763918ms)
✔ a transient option-stream timeout does not shed the scanner or tear down the chunk (157.540587ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1068.125593
```
