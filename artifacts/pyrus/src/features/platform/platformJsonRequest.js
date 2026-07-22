import { parseRetryAfterMs } from "./queryDefaults.js";
import { fetchWithNetworkError } from "./fetchWithNetworkError.js";

export const platformJsonRequest = async (
  path,
  { method = "GET", body, signal, timeoutMs = 0, csrfToken } = {},
) => {
  const controller =
    timeoutMs > 0 && typeof AbortController !== "undefined"
      ? new AbortController()
      : null;
  let abortCause = null;
  const abortFromCaller = () => {
    if (!controller || controller.signal.aborted) return;
    abortCause = "caller";
    controller.abort();
  };
  if (controller && signal) {
    if (signal.aborted) {
      abortFromCaller();
    } else {
      signal.addEventListener("abort", abortFromCaller, { once: true });
    }
  }
  const timeoutId =
    controller && timeoutMs > 0 && !controller.signal.aborted
      ? window.setTimeout(() => {
          if (controller.signal.aborted) return;
          abortCause = "timeout";
          controller.abort();
        }, timeoutMs)
      : null;

  try {
    const response = await fetchWithNetworkError(path, {
      method,
      signal: controller?.signal ?? signal,
      headers: {
        ...(body == null ? {} : { "Content-Type": "application/json" }),
        ...(csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())
          ? { "X-CSRF-Token": csrfToken }
          : {}),
      },
      body: body == null ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      let payload = null;
      try {
        payload = await response.json();
        message =
          payload?.detail || payload?.message || payload?.error || message;
      } catch (error) {
        if (error?.name === "AbortError") throw error;
      }
      const requestError = new Error(message);
      requestError.status = response.status;
      requestError.code = payload?.code || null;
      requestError.payload = payload;
      requestError.retryAfterMs = parseRetryAfterMs(
        response.headers?.get?.("retry-after"),
      );
      throw requestError;
    }

    if (response.status === 204) {
      return null;
    }

    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      const canceled =
        abortCause === "caller" ||
        (abortCause !== "timeout" && Boolean(signal?.aborted));
      const abortError = new Error(
        canceled ? "Request canceled." : `Request timed out after ${timeoutMs}ms`,
      );
      // Tag the abort source so retry/cancellation policies do not have to
      // parse the message string.
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
    signal?.removeEventListener("abort", abortFromCaller);
  }
};
