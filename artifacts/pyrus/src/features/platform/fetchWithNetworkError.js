const NATIVE_FETCH_NETWORK_MESSAGES = new Set([
  "failed to fetch",
  "fetch failed",
  "load failed",
]);

const isNativeFetchNetworkError = (error) => {
  if (!error || typeof error !== "object") return false;
  if (error.name === "NetworkError") return true;
  if (error.name !== "TypeError") return false;
  const message = String(error.message || "")
    .trim()
    .toLowerCase();
  return (
    NATIVE_FETCH_NETWORK_MESSAGES.has(message) ||
    message.startsWith("networkerror when attempting to fetch resource")
  );
};

export const fetchWithNetworkError = async (input, init) => {
  try {
    return await fetch(input, init);
  } catch (cause) {
    if (!isNativeFetchNetworkError(cause)) throw cause;
    const error = new Error("Network request failed.");
    error.name = "NetworkError";
    error.code = "request_network";
    error.cause = cause;
    throw error;
  }
};
