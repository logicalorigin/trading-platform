export const platformJsonRequest = async (
  path,
  { method = "GET", body, signal, timeoutMs = 0 } = {},
) => {
  const controller =
    timeoutMs > 0 && typeof AbortController !== "undefined"
      ? new AbortController()
      : null;
  const timeoutId =
    controller && timeoutMs > 0
      ? window.setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : null;

  let response;
  try {
    response = await fetch(path, {
      method,
      signal: signal || controller?.signal,
      headers:
        body == null
          ? undefined
          : {
              "Content-Type": "application/json",
            },
      body: body == null ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      const canceled = Boolean(signal?.aborted);
      const abortError = new Error(
        canceled ? "Request canceled." : `Request timed out after ${timeoutMs}ms`,
      );
      // Tag the cause so callers can treat a timeout (idempotent retry is safe)
      // differently from a hard failure, without parsing the message string.
      abortError.code = canceled ? "request_canceled" : "request_timeout";
      if (!canceled) {
        abortError.timedOut = true;
      }
      throw abortError;
    }
    throw error;
  } finally {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
    }
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let payload = null;
    try {
      payload = await response.json();
      message =
        payload?.detail || payload?.message || payload?.error || message;
    } catch (error) {}
    const requestError = new Error(message);
    requestError.status = response.status;
    requestError.code = payload?.code || null;
    requestError.payload = payload;
    throw requestError;
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};
