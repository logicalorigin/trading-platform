export const platformJsonRequest = async (
  path,
  { method = "GET", body, timeoutMs = 8_000 } = {},
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
      signal: controller?.signal,
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
      throw new Error(`Request timed out after ${timeoutMs}ms`);
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
