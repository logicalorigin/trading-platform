# Signal Forward-Return Dataset

Task 11 defines the first stable dataset contract for evaluating Pyrus signals against later price movement. The dataset is advisory analytics only: it must not be imported by broker, order, automation, or live-trading gate code.

## Version

- `signal-forward-return-v1`

Changing row fields, status semantics, default horizons, or return calculations requires a new dataset version or a migration note in this document.

## Defaults

- Default horizons: `1`, `3`, and `6` bars.
- Return basis: close-to-close from the selected entry bar to the horizon exit bar.
- Entry bar: the first bar whose `startsAt` is at or after the signal timestamp.
- Direction adjustment:
  - `long`: `(exitClose - entryClose) / entryClose`
  - `short`: `(entryClose - exitClose) / entryClose`
- Favorable excursion is positive when movement helps the signal direction.
- Adverse excursion is negative when movement hurts the signal direction.
- Hit label is `true` when direction-adjusted return is greater than zero, `false` when complete but non-positive, and `null` when the window is incomplete or invalid.

## Row Contract

Each row represents one signal and includes:

- Signal identity: `signalId`, `signalAt`, `symbol`, `direction`.
- Signal metadata: `score`, `sourceStrategy`, `sourceProfile`, `sourceTimeframe`.
- Entry context: `entryBarAt`, `entryPrice`.
- Status: `complete`, `partial`, or `invalid`.
- Reasons: explicit machine-readable reason codes for missing score, missing bars, incomplete windows, duplicate signals, overlapping forward windows, mixed symbols, and session-boundary alignment.
- Windows: one result per horizon with realized return, adverse excursion, favorable excursion, hit/miss label, expected/available bars, and status/reason fields.

## Reason Semantics

- `score_missing`: signal has no finite score.
- `missing_symbol_bars`: no bars exist for the signal symbol.
- `missing_entry_bar`: no bar exists at or after the signal timestamp.
- `entry_bar_after_signal`: entry was aligned to a later bar.
- `session_boundary_aligned_to_next_bar`: entry bar is on a later UTC session date than the signal timestamp.
- `duplicate_signal`: another row has the same symbol, timestamp, source profile, source strategy, and timeframe.
- `overlapping_signal_window`: a prior signal for the same symbol/source overlaps the maximum configured horizon.
- `incomplete_forward_window`: at least one horizon lacks enough bars after entry.
- `mixed_symbol_dataset`: input contains more than one signal symbol.

## Non-Goals

- No broker dependency.
- No order generation.
- No automation gating.
- No product-facing recommendation wording.
