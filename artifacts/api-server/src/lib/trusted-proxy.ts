export function isTrustedLoopbackProxyPeer(
  remoteAddress: string | undefined,
): boolean {
  const normalized = remoteAddress?.trim().toLowerCase() ?? "";
  return (
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized) ||
    /^::ffff:127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}
