import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Play, RefreshCw } from "lucide-react";
// @ts-expect-error JavaScript request boundary imported into TypeScript context
import { fetchWithNetworkError } from "../platform/fetchWithNetworkError.js";

// @ts-expect-error JSX module imported into TypeScript context
import { CSS_COLOR, FONT_WEIGHTS, RADII } from "../../lib/uiTokens.jsx";

type OvernightTimeframe = "15m" | "30m" | "1h" | "4h";

type CreateOvernightResponse = {
  studyId: string;
  jobId: string;
  status: "queued";
};

type OvernightResult = {
  id: string;
  timeframe: string;
  sampleCount: number;
  eligibleSampleCount: number;
  buyStateCount: number;
  validReturnCoveragePct: number | null;
  buyStateFrequencyPct: number | null;
  expectancyPct: number | null;
  medianReturnPct: number | null;
  winRatePct: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  payoffRatio: number | null;
  stdReturnPct: number | null;
  tStat: number | null;
  ci95LowPct: number | null;
  ci95HighPct: number | null;
  rank: number | null;
  winnerStatus: "winner" | "tie" | "insufficient_sample" | string;
  pairwiseSummary: Record<string, unknown> | null;
  dataQuality: Record<string, unknown> | null;
};

type OvernightResultsResponse = {
  studyId: string;
  status: string;
  progressPercent: number;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  startsAt: string;
  endsAt: string;
  symbols: string[];
  parameters: Record<string, unknown>;
  results: OvernightResult[];
};

type OvernightSample = {
  id: string;
  symbol: string;
  sessionDate: string;
  timeframe: string;
  status: string;
  signalAvailableAt: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  returnPct: number | null;
};

type OvernightSamplesResponse = {
  studyId: string;
  limit: number;
  nextCursor: string | null;
  samples: OvernightSample[];
};

const TIMEFRAMES: OvernightTimeframe[] = ["15m", "30m", "1h", "4h"];

const panelStyle = {
  display: "grid",
  gap: 16,
  padding: 16,
  borderRadius: RADII.sm,
  border: `1px solid ${CSS_COLOR.border}`,
  background: CSS_COLOR.bg1,
  color: CSS_COLOR.text,
} as const;

const controlStyle = {
  width: "100%",
  minHeight: 34,
  borderRadius: RADII.xs,
  border: `1px solid ${CSS_COLOR.border}`,
  background: CSS_COLOR.bg0,
  color: CSS_COLOR.text,
  padding: "7px 9px",
  fontFamily: "IBM Plex Mono, monospace",
  fontSize: 12,
} as const;

function defaultDateInput(daysAgo: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "--";
}

function formatPercent(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`
    : "--";
}

function terminalStatus(status: string | null | undefined): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithNetworkError(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return payload as T;
}

export function OvernightExpectancyPanel() {
  const [studyId, setStudyId] = useState<string | null>(null);
  const [startsOn, setStartsOn] = useState(defaultDateInput(730));
  const [endsOn, setEndsOn] = useState(defaultDateInput(0));
  const [selectedTimeframes, setSelectedTimeframes] =
    useState<OvernightTimeframe[]>(TIMEFRAMES);
  const [sampleTimeframe, setSampleTimeframe] = useState<OvernightTimeframe>("15m");

  const resultsQuery = useQuery({
    queryKey: ["overnight-expectancy", studyId],
    enabled: Boolean(studyId),
    queryFn: ({ signal }) =>
      jsonRequest<OvernightResultsResponse>(
        `/api/backtests/overnight-expectancy/${studyId}`,
        { signal },
      ),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && !terminalStatus(status) ? 5000 : false;
    },
  });

  const samplesQuery = useQuery({
    queryKey: ["overnight-expectancy-samples", studyId, sampleTimeframe],
    enabled: Boolean(studyId) && resultsQuery.data?.status === "completed",
    queryFn: ({ signal }) =>
      jsonRequest<OvernightSamplesResponse>(
        `/api/backtests/overnight-expectancy/${studyId}/samples?timeframe=${sampleTimeframe}&status=valid&limit=20`,
        { signal },
      ),
    staleTime: 30_000,
  });

  const createStudy = useMutation({
    mutationFn: () => {
      const timeframes =
        selectedTimeframes.length > 0 ? selectedTimeframes : TIMEFRAMES;
      return jsonRequest<CreateOvernightResponse>(
        "/api/backtests/overnight-expectancy",
        {
          method: "POST",
          body: JSON.stringify({
            name: `Overnight Expectancy ${startsOn} to ${endsOn}`,
            signalTimeframes: timeframes,
            startsAt: new Date(`${startsOn}T00:00:00.000Z`).toISOString(),
            endsAt: new Date(`${endsOn}T23:59:59.999Z`).toISOString(),
            persistSamples: true,
          }),
        },
      );
    },
    onSuccess: (created) => {
      setStudyId(created.studyId);
    },
  });

  const results = resultsQuery.data?.results ?? [];
  const topResult = results[0] ?? null;
  const progressPercent = resultsQuery.data?.progressPercent ?? 0;
  const status = resultsQuery.data?.status ?? (studyId ? "queued" : "idle");
  const universeCount = resultsQuery.data?.symbols.length ?? null;

  const timeframeSet = useMemo(
    () => new Set<OvernightTimeframe>(selectedTimeframes),
    [selectedTimeframes],
  );

  const toggleTimeframe = (timeframe: OvernightTimeframe) => {
    setSelectedTimeframes((current) => {
      if (current.includes(timeframe)) {
        return current.filter((item) => item !== timeframe);
      }
      return [...current, timeframe].sort(
        (left, right) => TIMEFRAMES.indexOf(left) - TIMEFRAMES.indexOf(right),
      );
    });
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section style={panelStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 16,
                fontWeight: FONT_WEIGHTS.label,
                color: CSS_COLOR.text,
              }}
            >
              Overnight Expectancy
            </div>
            <div
              style={{
                marginTop: 4,
                fontFamily: "IBM Plex Mono, monospace",
                fontSize: 11,
                color: CSS_COLOR.textDim,
              }}
            >
              {status.toUpperCase()} · {Math.max(0, Math.min(100, progressPercent))}%
              {universeCount != null ? ` · ${universeCount.toLocaleString()} symbols` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={() => resultsQuery.refetch()}
            disabled={!studyId || resultsQuery.isFetching}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              minHeight: 34,
              padding: "0 12px",
              borderRadius: RADII.xs,
              border: `1px solid ${CSS_COLOR.border}`,
              background: CSS_COLOR.bg2,
              color: CSS_COLOR.textSec,
              opacity: !studyId || resultsQuery.isFetching ? 0.55 : 1,
              cursor: !studyId || resultsQuery.isFetching ? "default" : "pointer",
            }}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
          }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 11, color: CSS_COLOR.textDim }}>Start</span>
            <input
              type="date"
              value={startsOn}
              onChange={(event) => setStartsOn(event.currentTarget.value)}
              style={controlStyle}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 11, color: CSS_COLOR.textDim }}>End</span>
            <input
              type="date"
              value={endsOn}
              onChange={(event) => setEndsOn(event.currentTarget.value)}
              style={controlStyle}
            />
          </label>
          <div style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 11, color: CSS_COLOR.textDim }}>Signals</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {TIMEFRAMES.map((timeframe) => (
                <button
                  key={timeframe}
                  type="button"
                  onClick={() => toggleTimeframe(timeframe)}
                  style={{
                    minWidth: 48,
                    minHeight: 34,
                    borderRadius: RADII.xs,
                    border: `1px solid ${
                      timeframeSet.has(timeframe)
                        ? CSS_COLOR.borderFocus
                        : CSS_COLOR.border
                    }`,
                    background: timeframeSet.has(timeframe)
                      ? CSS_COLOR.accentActiveBg
                      : CSS_COLOR.bg0,
                    color: timeframeSet.has(timeframe)
                      ? CSS_COLOR.text
                      : CSS_COLOR.textDim,
                    fontFamily: "IBM Plex Mono, monospace",
                    cursor: "pointer",
                  }}
                >
                  {timeframe}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button
              type="button"
              onClick={() => createStudy.mutate()}
              disabled={createStudy.isPending || selectedTimeframes.length === 0}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                width: "100%",
                minHeight: 36,
                borderRadius: RADII.xs,
                border: `1px solid ${CSS_COLOR.borderFocus}`,
                background: CSS_COLOR.accent,
                color: CSS_COLOR.onAccent,
                fontWeight: FONT_WEIGHTS.label,
                opacity:
                  createStudy.isPending || selectedTimeframes.length === 0 ? 0.6 : 1,
                cursor:
                  createStudy.isPending || selectedTimeframes.length === 0
                    ? "default"
                    : "pointer",
              }}
            >
              <Play size={14} />
              Queue Study
            </button>
          </div>
        </div>

        {(createStudy.error || resultsQuery.data?.errorMessage) && (
          <div
            style={{
              border: `1px solid ${CSS_COLOR.red}`,
              background: CSS_COLOR.redBg,
              color: CSS_COLOR.text,
              borderRadius: RADII.xs,
              padding: "10px 12px",
              fontSize: 12,
            }}
          >
            {createStudy.error instanceof Error
              ? createStudy.error.message
              : resultsQuery.data?.errorMessage}
          </div>
        )}
      </section>

      <section style={panelStyle}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 10,
          }}
        >
          <Metric label="Leader" value={topResult?.timeframe ?? "--"} />
          <Metric
            label="Expectancy"
            value={formatPercent(topResult?.expectancyPct, 3)}
            tone={(topResult?.expectancyPct ?? 0) >= 0 ? "positive" : "negative"}
          />
          <Metric
            label="Samples"
            value={topResult?.sampleCount.toLocaleString() ?? "--"}
          />
          <Metric
            label="Win Rate"
            value={formatPercent(topResult?.winRatePct, 1)}
          />
        </div>

        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "separate",
              borderSpacing: 0,
              minWidth: 860,
              fontSize: 12,
            }}
          >
            <thead>
              <tr>
                {[
                  "Rank",
                  "TF",
                  "Expectancy",
                  "CI 95%",
                  "N",
                  "Buy Freq",
                  "Win",
                  "Payoff",
                  "t-stat",
                  "Result",
                ].map((header) => (
                  <th
                    key={header}
                    style={{
                      padding: "8px 10px",
                      textAlign: "left",
                      color: CSS_COLOR.textDim,
                      borderBottom: `1px solid ${CSS_COLOR.border}`,
                      fontWeight: FONT_WEIGHTS.medium,
                    }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    style={{
                      padding: "18px 10px",
                      color: CSS_COLOR.textDim,
                      textAlign: "center",
                    }}
                  >
                    {studyId ? "Pending results" : "No study queued"}
                  </td>
                </tr>
              ) : (
                results.map((row) => (
                  <tr key={row.id}>
                    <td style={cellStyle}>{row.rank ?? "--"}</td>
                    <td style={{ ...cellStyle, fontFamily: "IBM Plex Mono, monospace" }}>
                      {row.timeframe}
                    </td>
                    <td style={cellStyle}>{formatPercent(row.expectancyPct, 3)}</td>
                    <td style={cellStyle}>
                      {formatPercent(row.ci95LowPct, 3)} /{" "}
                      {formatPercent(row.ci95HighPct, 3)}
                    </td>
                    <td style={cellStyle}>{row.sampleCount.toLocaleString()}</td>
                    <td style={cellStyle}>
                      {formatPercent(row.buyStateFrequencyPct, 1)}
                    </td>
                    <td style={cellStyle}>{formatPercent(row.winRatePct, 1)}</td>
                    <td style={cellStyle}>{formatNumber(row.payoffRatio, 2)}</td>
                    <td style={cellStyle}>{formatNumber(row.tStat, 2)}</td>
                    <td style={cellStyle}>{row.winnerStatus.replaceAll("_", " ")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section style={panelStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: FONT_WEIGHTS.label,
              marginRight: "auto",
            }}
          >
            Sample Audit
          </div>
          <select
            value={sampleTimeframe}
            onChange={(event) =>
              setSampleTimeframe(event.currentTarget.value as OvernightTimeframe)
            }
            style={{ ...controlStyle, width: 110 }}
          >
            {TIMEFRAMES.map((timeframe) => (
              <option key={timeframe} value={timeframe}>
                {timeframe}
              </option>
            ))}
          </select>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              minWidth: 720,
              borderCollapse: "separate",
              borderSpacing: 0,
              fontSize: 12,
            }}
          >
            <thead>
              <tr>
                {["Symbol", "Session", "Signal At", "Entry", "Exit", "Return"].map(
                  (header) => (
                    <th key={header} style={headCellStyle}>
                      {header}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {(samplesQuery.data?.samples ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...cellStyle, textAlign: "center" }}>
                    {resultsQuery.data?.status === "completed"
                      ? "No valid samples"
                      : "Samples available after completion"}
                  </td>
                </tr>
              ) : (
                samplesQuery.data!.samples.map((sample) => (
                  <tr key={sample.id}>
                    <td style={cellStyle}>{sample.symbol}</td>
                    <td style={cellStyle}>{sample.sessionDate}</td>
                    <td style={cellStyle}>
                      {sample.signalAvailableAt
                        ? new Date(sample.signalAvailableAt).toLocaleString()
                        : "--"}
                    </td>
                    <td style={cellStyle}>{formatNumber(sample.entryPrice, 2)}</td>
                    <td style={cellStyle}>{formatNumber(sample.exitPrice, 2)}</td>
                    <td style={cellStyle}>{formatPercent(sample.returnPct, 3)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const cellStyle = {
  padding: "9px 10px",
  color: CSS_COLOR.textSec,
  borderBottom: `1px solid ${CSS_COLOR.border}`,
  whiteSpace: "nowrap",
} as const;

const headCellStyle = {
  ...cellStyle,
  color: CSS_COLOR.textDim,
  fontWeight: FONT_WEIGHTS.medium,
} as const;

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  const color =
    tone === "positive"
      ? CSS_COLOR.green
      : tone === "negative"
        ? CSS_COLOR.red
        : CSS_COLOR.text;
  return (
    <div
      style={{
        minHeight: 74,
        borderRadius: RADII.xs,
        border: `1px solid ${CSS_COLOR.border}`,
        background: CSS_COLOR.bg0,
        padding: "12px 14px",
        display: "grid",
        alignContent: "center",
        gap: 5,
      }}
    >
      <div style={{ color: CSS_COLOR.textDim, fontSize: 11 }}>{label}</div>
      <div
        style={{
          color,
          fontSize: 18,
          fontWeight: FONT_WEIGHTS.label,
          fontFamily: "IBM Plex Mono, monospace",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export default OvernightExpectancyPanel;
