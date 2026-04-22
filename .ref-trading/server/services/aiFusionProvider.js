const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const ALLOWED_REGIMES = new Set(["risk_on", "risk_off", "chop", "unknown"]);
const ALLOWED_BIASES = new Set(["bullish", "bearish", "neutral"]);
const ALLOWED_ENTRY_FILTERS = new Set(["normal", "tight", "conservative", "off"]);

export function buildFusionInputs(store, options = {}) {
  const lookbackMinutes = clampNumber(options.lookbackMinutes, 5, 24 * 60, 240);
  const nowMs = Date.now();
  const fromIso = new Date(nowMs - lookbackMinutes * 60 * 1000).toISOString();

  const signals = store.listRayAlgoSignals({
    source: "all",
    from: fromIso,
    limit: 500,
  });
  const alerts = store.listTradingViewAlerts({
    since: fromIso,
    limit: 500,
  });

  const accounts = store
    .listAccounts()
    .slice(0, 50)
    .map((account) => ({
      accountId: account.accountId,
      broker: account.broker,
      mode: account.mode,
      summary: store.buildCachedAccountSummary(account.accountId),
    }));

  return {
    generatedAt: new Date(nowMs).toISOString(),
    lookbackMinutes,
    signalSummary: summarizeSignals(signals),
    alertSummary: summarizeAlerts(alerts),
    accountSummary: summarizeAccounts(accounts),
    recentSignals: signals.slice(0, 30).map(minifySignal),
    recentAlerts: alerts.slice(0, 30).map(minifyAlert),
  };
}

export function generateDryRunFusionContext({ inputs }) {
  const signal = inputs?.signalSummary || {};
  const alert = inputs?.alertSummary || {};
  const account = inputs?.accountSummary || {};

  const directionalScore =
    Number(signal.netDirectional || 0) * 0.75
    + Number(alert.netDirectional || 0) * 0.35;
  const convictionScore =
    (Number(signal.convictionMean || 0.5) - 0.5) * 1.8;
  const pnlScore = Number(account.unrealizedPnlPct || 0) * 0.1;

  const totalScore = directionalScore + convictionScore + pnlScore;
  const absScore = Math.abs(totalScore);

  let regime = "chop";
  if (absScore >= 1.25) {
    regime = totalScore > 0 ? "risk_on" : "risk_off";
  }

  const bias = absScore < 0.6
    ? "neutral"
    : totalScore > 0
      ? "bullish"
      : "bearish";

  const confidence = clampNumber(
    0.45
      + Math.min(0.35, absScore * 0.12)
      + Math.min(0.2, Number(signal.sampleSize || 0) / 400),
    0,
    1,
    0.55,
  );

  const riskMultiplier = clampNumber(
    regime === "chop"
      ? 0.85 + Math.min(0.1, confidence * 0.1)
      : regime === "risk_on"
        ? 1.0 + Math.min(0.2, confidence * 0.2)
        : 0.75 + Math.min(0.15, confidence * 0.1),
    0.5,
    1.5,
    1.0,
  );

  const entryFilter = confidence < 0.55
    ? "conservative"
    : confidence < 0.7
      ? "tight"
      : "normal";

  return {
    regime,
    bias,
    confidence,
    riskMultiplier,
    entryFilter,
    allowNewEntries: entryFilter !== "off",
    sentimentScore: clampNumber(totalScore / 3, -1, 1, 0),
    headline: "Dry-run fusion context",
    rationale: [
      `signals=${signal.sampleSize || 0} alerts=${alert.sampleSize || 0}`,
      `directionalScore=${round3(directionalScore)} convictionScore=${round3(convictionScore)} pnlScore=${round3(pnlScore)}`,
      `totalScore=${round3(totalScore)}`,
    ],
  };
}

export function normalizeFusionContext(rawContext, options = {}) {
  const now = new Date().toISOString();
  const ts = toNonEmptyString(options.ts) || now;
  const ttlSec = clampNumber(options.ttlSec, 10, 24 * 60 * 60, 180);
  const expiresAt = toNonEmptyString(options.expiresAt)
    || new Date(Date.now() + ttlSec * 1000).toISOString();
  const source = toNonEmptyString(options.source) || "unknown";
  const reason = toNonEmptyString(options.reason) || null;
  const providerMeta =
    options.providerMeta
    && typeof options.providerMeta === "object"
    && !Array.isArray(options.providerMeta)
      ? options.providerMeta
      : {};

  const raw = rawContext && typeof rawContext === "object" ? rawContext : {};

  const regimeCandidate = toNonEmptyString(raw.regime)?.toLowerCase() || "unknown";
  const regime = ALLOWED_REGIMES.has(regimeCandidate) ? regimeCandidate : "unknown";

  const biasCandidate = toNonEmptyString(raw.bias)?.toLowerCase() || "neutral";
  const bias = ALLOWED_BIASES.has(biasCandidate) ? biasCandidate : "neutral";

  const entryFilterCandidate = toNonEmptyString(raw.entryFilter)?.toLowerCase() || "normal";
  const entryFilter = ALLOWED_ENTRY_FILTERS.has(entryFilterCandidate)
    ? entryFilterCandidate
    : "normal";

  const confidence = clampNumber(raw.confidence, 0, 1, 0.5);
  const riskMultiplier = clampNumber(raw.riskMultiplier, 0.5, 1.5, 1.0);

  const sentimentScore = clampNumber(
    raw.sentimentScore,
    -1,
    1,
    bias === "bullish" ? 0.35 : bias === "bearish" ? -0.35 : 0,
  );

  return {
    contextId:
      toNonEmptyString(raw.contextId)
      || `aifusion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    runId: toNonEmptyString(options.runId) || null,
    ts,
    expiresAt,
    source,
    provider: toNonEmptyString(providerMeta.provider) || inferProvider(source),
    model: toNonEmptyString(providerMeta.model) || null,
    responseId: toNonEmptyString(providerMeta.responseId) || null,
    usage: sanitizeUsage(providerMeta.usage),
    reason,
    regime,
    bias,
    confidence,
    riskMultiplier,
    entryFilter,
    allowNewEntries: toBoolean(raw.allowNewEntries, entryFilter !== "off"),
    sentimentScore,
    headline: toNonEmptyString(raw.headline),
    rationale: normalizeStringArray(raw.rationale, 6),
    inputs:
      raw.inputs && typeof raw.inputs === "object" && !Array.isArray(raw.inputs)
        ? raw.inputs
        : null,
    updatedAt: now,
  };
}

export async function generateOpenAiFusionContext({ inputs, config }) {
  const apiKey =
    toNonEmptyString(process.env.AI_FUSION_OPENAI_API_KEY)
    || toNonEmptyString(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const model = toNonEmptyString(config.model) || "gpt-5-mini";

  const prompt = buildOpenAiPrompt(inputs);
  const payload = {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "You are a market context fusion engine.",
              "Return ONLY JSON with this schema:",
              '{"regime":"risk_on|risk_off|chop|unknown","bias":"bullish|bearish|neutral","confidence":0..1,"riskMultiplier":0.5..1.5,"entryFilter":"normal|tight|conservative|off","allowNewEntries":boolean,"sentimentScore":-1..1,"headline":string,"rationale":string[]}',
              "No markdown and no prose.",
            ].join(" "),
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ],
    temperature: 0.2,
    max_output_tokens: 500,
  };

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI request failed (${response.status}): ${truncate(rawText, 200)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("OpenAI response is not valid JSON");
  }

  const outputText = extractResponseText(parsed);
  const context = parseFirstJsonObject(outputText);
  if (!context || typeof context !== "object") {
    throw new Error("OpenAI output did not contain a valid JSON object");
  }

  return {
    context,
    meta: {
      provider: "openai",
      model: toNonEmptyString(parsed.model) || model,
      responseId: toNonEmptyString(parsed.id),
      usage: sanitizeUsage(parsed.usage),
    },
  };
}

function summarizeSignals(signals) {
  const rows = Array.isArray(signals) ? signals : [];
  let bullish = 0;
  let bearish = 0;
  let neutral = 0;
  let convictionTotal = 0;
  let convictionCount = 0;

  for (const row of rows) {
    const direction = String(row?.direction || "").toLowerCase();
    if (direction.startsWith("b")) {
      bullish += 1;
    } else if (direction.startsWith("s")) {
      bearish += 1;
    } else {
      neutral += 1;
    }

    const conviction = Number(row?.conviction);
    if (Number.isFinite(conviction)) {
      convictionTotal += conviction;
      convictionCount += 1;
    }
  }

  return {
    sampleSize: rows.length,
    bullish,
    bearish,
    neutral,
    netDirectional: bullish - bearish,
    convictionMean: convictionCount > 0 ? convictionTotal / convictionCount : 0.5,
  };
}

function summarizeAlerts(alerts) {
  const rows = Array.isArray(alerts) ? alerts : [];
  let bullish = 0;
  let bearish = 0;
  let neutral = 0;

  for (const row of rows) {
    const eventType = String(row?.eventType || "").toLowerCase();
    if (eventType === "heartbeat" || eventType === "status" || eventType === "debug") {
      continue;
    }

    const direction = String(row?.direction || row?.action || "").toLowerCase();
    if (direction.startsWith("b") || direction.includes("long")) {
      bullish += 1;
    } else if (direction.startsWith("s") || direction.includes("short")) {
      bearish += 1;
    } else {
      neutral += 1;
    }
  }

  return {
    sampleSize: rows.length,
    bullish,
    bearish,
    neutral,
    netDirectional: bullish - bearish,
  };
}

function summarizeAccounts(accounts) {
  const rows = Array.isArray(accounts) ? accounts : [];
  let equity = 0;
  let buyingPower = 0;
  let unrealizedPnl = 0;
  let count = 0;

  for (const row of rows) {
    const summary = row?.summary || {};
    const equityValue = Number(summary.equity);
    const buyingPowerValue = Number(summary.buyingPower);
    const unrealizedPnlValue = Number(summary.unrealizedPnl);

    if (Number.isFinite(equityValue)) {
      equity += equityValue;
    }
    if (Number.isFinite(buyingPowerValue)) {
      buyingPower += buyingPowerValue;
    }
    if (Number.isFinite(unrealizedPnlValue)) {
      unrealizedPnl += unrealizedPnlValue;
    }
    count += 1;
  }

  return {
    sampleSize: count,
    totalEquity: round2(equity),
    totalBuyingPower: round2(buyingPower),
    totalUnrealizedPnl: round2(unrealizedPnl),
    unrealizedPnlPct:
      Number.isFinite(equity) && Math.abs(equity) > 0.01
        ? round3(unrealizedPnl / equity)
        : 0,
  };
}

function minifySignal(row) {
  return {
    signalId: toNonEmptyString(row?.signalId),
    source: toNonEmptyString(row?.source),
    strategy: toNonEmptyString(row?.strategy),
    symbol: toNonEmptyString(row?.symbol),
    timeframe: toNonEmptyString(row?.timeframe),
    ts: toNonEmptyString(row?.ts || row?.barTime),
    direction: toNonEmptyString(row?.direction),
    conviction: Number.isFinite(Number(row?.conviction)) ? Number(row.conviction) : null,
    regime: toNonEmptyString(row?.regime),
  };
}

function minifyAlert(row) {
  return {
    alertId: toNonEmptyString(row?.alertId),
    symbol: toNonEmptyString(row?.symbol),
    timeframe: toNonEmptyString(row?.timeframe),
    eventType: toNonEmptyString(row?.eventType),
    direction: toNonEmptyString(row?.direction || row?.action),
    receivedAt: toNonEmptyString(row?.receivedAt),
    scriptName: toNonEmptyString(row?.scriptName),
    strategy: toNonEmptyString(row?.strategy),
  };
}

function buildOpenAiPrompt(inputs) {
  const payload = {
    generatedAt: inputs.generatedAt,
    lookbackMinutes: inputs.lookbackMinutes,
    signalSummary: inputs.signalSummary,
    alertSummary: inputs.alertSummary,
    accountSummary: inputs.accountSummary,
    recentSignals: inputs.recentSignals,
    recentAlerts: inputs.recentAlerts,
  };
  return `Fuse this data into a compact market context JSON for a trading supervisor:\n${JSON.stringify(payload)}`;
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const chunks = [];
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string" && part.text.trim()) {
        chunks.push(part.text);
      }
      if (typeof part?.output_text === "string" && part.output_text.trim()) {
        chunks.push(part.output_text);
      }
    }
  }

  if (chunks.length > 0) {
    return chunks.join("\n");
  }

  if (typeof payload?.content === "string" && payload.content.trim()) {
    return payload.content;
  }

  return "";
}

function parseFirstJsonObject(text) {
  const safe = String(text || "").trim();
  if (!safe) {
    return null;
  }

  const fenced = safe.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Continue with fallback parsing.
    }
  }

  try {
    return JSON.parse(safe);
  } catch {
    // Continue with fallback parsing.
  }

  for (let start = 0; start < safe.length; start += 1) {
    if (safe[start] !== "{") {
      continue;
    }
    let depth = 0;
    for (let end = start; end < safe.length; end += 1) {
      if (safe[end] === "{") {
        depth += 1;
      } else if (safe[end] === "}") {
        depth -= 1;
      }
      if (depth === 0) {
        const candidate = safe.slice(start, end + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          break;
        }
      }
    }
  }

  return null;
}

function sanitizeUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return null;
  }
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens);
  const totalTokens = Number(usage.total_tokens);
  const next = {};

  if (Number.isFinite(inputTokens)) {
    next.inputTokens = Math.max(0, Math.round(inputTokens));
  }
  if (Number.isFinite(outputTokens)) {
    next.outputTokens = Math.max(0, Math.round(outputTokens));
  }
  if (Number.isFinite(totalTokens)) {
    next.totalTokens = Math.max(0, Math.round(totalTokens));
  }

  return Object.keys(next).length ? next : null;
}

function inferProvider(source) {
  return String(source || "").toLowerCase().startsWith("openai") ? "openai" : "dry-run";
}

function normalizeStringArray(values, maxItems) {
  const rows = Array.isArray(values) ? values : [];
  const next = [];
  for (const value of rows) {
    const text = toNonEmptyString(value);
    if (!text) {
      continue;
    }
    next.push(text);
    if (next.length >= maxItems) {
      break;
    }
  }
  return next;
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (!text) {
      return fallback;
    }
    if (["1", "true", "yes", "y", "on"].includes(text)) {
      return true;
    }
    if (["0", "false", "no", "n", "off"].includes(text)) {
      return false;
    }
  }
  return fallback;
}

function toNonEmptyString(value) {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, num));
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function truncate(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}...`;
}
