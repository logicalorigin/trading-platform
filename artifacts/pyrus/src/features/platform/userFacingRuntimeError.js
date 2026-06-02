const DEFAULT_TITLE = "Request unavailable";
const DEFAULT_DETAIL = "The request could not finish. Try again in a moment.";

const asText = (value) => (typeof value === "string" ? value.trim() : "");

const collectErrorText = (error) => {
  const values = [
    error?.message,
    error?.detail,
    error?.title,
    error?.body,
    error?.data?.message,
    error?.data?.detail,
    error?.response?.data?.message,
    error?.response?.data?.detail,
    error?.response?.statusText,
  ];

  return values.map(asText).filter(Boolean).join(" ");
};

const readStatus = (error) => {
  const status = Number(error?.status ?? error?.response?.status);
  return Number.isFinite(status) ? status : null;
};

const normalizeFallback = (fallback) => {
  if (typeof fallback === "string") {
    return { title: DEFAULT_TITLE, detail: fallback };
  }

  return {
    title: asText(fallback?.title) || DEFAULT_TITLE,
    detail: asText(fallback?.detail) || DEFAULT_DETAIL,
    rateLimitedTitle: asText(fallback?.rateLimitedTitle),
    safeQaTitle: asText(fallback?.safeQaTitle),
  };
};

export const describeUserFacingRuntimeError = (error, fallback = {}) => {
  const safeFallback = normalizeFallback(fallback);
  const status = readStatus(error);
  const text = collectErrorText(error);
  const normalized = text.toLowerCase();
  const routeLimited = Boolean(
    status === 429 ||
      normalized.includes("429") ||
      normalized.includes("too many requests") ||
      normalized.includes("route admission") ||
      normalized.includes("request shed"),
  );

  if (routeLimited) {
    return {
      title: safeFallback.rateLimitedTitle || "Request pacing active",
      detail:
        "PYRUS is pacing live data requests. Wait a moment or narrow the workload, then try again.",
      technicalDetail: text,
    };
  }

  const safeQaLimited = Boolean(
    normalized.includes("pyrusqa=safe") ||
      normalized.includes("safe qa") ||
      normalized.includes("safe browser qa") ||
      normalized.includes("safe-mode") ||
      normalized.includes("safe mode"),
  );

  if (safeQaLimited) {
    return {
      title: safeFallback.safeQaTitle || "Live data paused",
      detail: "Safe QA mode is limiting live requests for this screen.",
      technicalDetail: text,
    };
  }

  return {
    title: safeFallback.title,
    detail: safeFallback.detail,
    technicalDetail: text,
  };
};
