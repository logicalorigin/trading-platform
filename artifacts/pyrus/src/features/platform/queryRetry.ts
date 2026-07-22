type RequestFailure = {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  timedOut?: unknown;
};

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429]);

const isRequestTimeout = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const failure = error as RequestFailure;
  return (
    failure.name === "TimeoutError" ||
    failure.code === "request_timeout" ||
    failure.timedOut === true
  );
};

const isRequestCancellation = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const failure = error as RequestFailure;
  return failure.name === "AbortError" || failure.code === "request_canceled";
};

const isRetryableRequestFailure = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const failure = error as RequestFailure;
  if (
    failure.code === "request_network" ||
    failure.code === "network_error" ||
    failure.name === "NetworkError"
  ) {
    return true;
  }
  const status = Number(failure.status);
  return (
    Number.isInteger(status) &&
    (RETRYABLE_HTTP_STATUSES.has(status) || (status >= 500 && status <= 599))
  );
};

export const retryUnlessTimeout =
  (maxRetries: number) => (failureCount: number, error: unknown): boolean =>
    !isRequestTimeout(error) &&
    !isRequestCancellation(error) &&
    isRetryableRequestFailure(error) &&
    failureCount < maxRetries;
