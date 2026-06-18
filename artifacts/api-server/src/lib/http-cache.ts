function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.join(",");
  return value?.trim() ? value : null;
}

function ifNoneMatchContains(
  value: string | string[] | undefined,
  etag: string,
): boolean {
  const header = firstHeaderValue(value);
  if (!header) return false;
  return header
    .split(",")
    .map((part) => part.trim())
    .some((part) => part === "*" || part === etag);
}

function ifModifiedSinceMatches(
  value: string | string[] | undefined,
  lastModified: string | undefined,
): boolean {
  const header = firstHeaderValue(value);
  if (!header || !lastModified) return false;
  const requestTime = Date.parse(header);
  const resourceTime = Date.parse(lastModified);
  if (!Number.isFinite(requestTime) || !Number.isFinite(resourceTime)) {
    return false;
  }
  return requestTime >= resourceTime;
}

export function isHttpResourceNotModified(input: {
  etag: string;
  lastModified?: string;
  ifNoneMatch?: string | string[];
  ifModifiedSince?: string | string[];
}): boolean {
  if (firstHeaderValue(input.ifNoneMatch)) {
    return ifNoneMatchContains(input.ifNoneMatch, input.etag);
  }
  return ifModifiedSinceMatches(input.ifModifiedSince, input.lastModified);
}
