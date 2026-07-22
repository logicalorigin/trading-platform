export function openBrokerPopup(url, _name) {
  const width = 480;
  const height = 760;
  const baseLeft = window.screenLeft ?? window.screenX ?? 0;
  const baseTop = window.screenTop ?? window.screenY ?? 0;
  const viewportW = window.outerWidth || width;
  const viewportH = window.outerHeight || height;
  const left = Math.round(baseLeft + Math.max(0, (viewportW - width) / 2));
  const top = Math.round(baseTop + Math.max(0, (viewportH - height) / 2));
  const popup = window.open(
    "",
    "_blank",
    `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
  );
  if (!popup) return null;

  try {
    popup.opener = null;
    if (popup.opener !== null) {
      throw new Error("Broker popup opener isolation failed");
    }
    popup.location.replace(url);
    return popup;
  } catch {
    try {
      popup.close();
    } catch {
      // Best-effort cleanup after the popup failed closed.
    }
    return null;
  }
}

export function watchBrokerPopup({
  popup,
  pollRef,
  originParamKey,
  onResult,
  onClose,
  timeoutMs = 5 * 60_000,
}) {
  if (pollRef.current) {
    window.clearInterval(pollRef.current);
  }
  const startedAt = Date.now();
  const stop = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };
  const close = () => {
    try {
      popup.close();
    } catch {
      // Best-effort cleanup after the watcher has finished.
    }
  };
  pollRef.current = window.setInterval(() => {
    if (Date.now() - startedAt > timeoutMs) {
      stop();
      close();
      onClose?.();
      return;
    }
    if (popup.closed) {
      stop();
      onClose?.();
      return;
    }
    if (!originParamKey) return;
    let outcome = null;
    try {
      const callbackUrl = new URL(popup.location.href);
      if (callbackUrl.origin === window.location.origin) {
        outcome = callbackUrl.searchParams.get(originParamKey);
      }
    } catch {
      // Cross-origin: popup is still on the provider's domain. Ignore.
    }
    if (outcome) {
      stop();
      close();
      onResult?.(outcome);
    }
  }, 400);
}
