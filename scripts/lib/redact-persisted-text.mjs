import { getSystemErrorMap, stripVTControlCharacters } from "node:util";

const SYSTEM_ERROR_CODES = new Set(
  [...getSystemErrorMap().values()].map(([code]) => code),
);

function isDiagnosticCode(value) {
  return (
    /^[1-5]\d{2}$/.test(value) ||
    SYSTEM_ERROR_CODES.has(value) ||
    /^HTTP(?:\/(?:1(?:\.[01])?|2(?:\.0)?|3(?:\.0)?))?$/i.test(value)
  );
}

function hasUnescapedDelimiter(value, delimiter) {
  for (
    let index = value.indexOf(delimiter);
    index !== -1;
    index = value.indexOf(delimiter, index + delimiter.length)
  ) {
    if (index === 0 || value[index - 1] !== "\\") return true;
  }
  return false;
}

export function redactPersistedText(value) {
  let text = typeof value === "string" ? value : JSON.stringify(value ?? "");

  text = text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  text = stripVTControlCharacters(text).replace(/\r\n?/g, "\n");
  text = text.replace(/\p{Cf}/gu, "");
  text = text.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/gu,
    "",
  );

  text = text.replace(
    /-----BEGIN ((?:[A-Z0-9]+ )?PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,
    "-----BEGIN $1-----\n<redacted>\n-----END $1-----",
  );
  text = text.replace(
    /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/g,
    "-----BEGIN PGP PRIVATE KEY BLOCK-----\n<redacted>\n-----END PGP PRIVATE KEY BLOCK-----",
  );
  text = text.replace(
    /(^[ \t]*(?:[A-Za-z0-9_-]*(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|token|secret|password|passwd|pwd)|private[_-]?key|authorization[_-]?code|oauth[_-]?code|jwt|database_url)[ \t]*:[ \t]*[>|][-+]?[ \t]*(?:\r\n|\r|\n))((?:(?:[ \t]+[^\r\n]*|[ \t]*)(?:(?:\r\n|\r|\n)|$))+)/gim,
    (_match, header, body) =>
      `${header}${body.replace(/^([ \t]+).*$/gm, "$1<redacted>")}`,
  );
  text = text.replace(
    /\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss):\/\/[^\s"'`]+/gi,
    "$1://<redacted>",
  );
  text = text.replace(
    /\b([a-z][a-z0-9+.-]*):\/\/[^/\s@]+@[^\s"'`]+/gi,
    "$1://<redacted>",
  );
  text = text.replace(
    /((?:[?&]|&amp;)(?:X-Amz-(?:Credential|Signature|Security-Token)|AWSAccessKeyId)=)[^&#\s"'`]+/gi,
    "$1<redacted>",
  );
  text = text.replace(
    /(\b(?:proxy-)?authorization\b(?:\\+["']|["'])?\s*[:=]\s*(?:\\+["']|["'])?)(?:AWS4-HMAC-SHA256|Digest)\s+[^\r\n]+/gi,
    "$1<redacted>",
  );
  text = text.replace(
    /\b(?:AWS4-HMAC-SHA256\s+Credential=|Digest\s+username=)[^\r\n]+/gi,
    (match) => `${match.split(/[=\s]/, 1)[0]} <redacted>`,
  );
  text = text.replace(
    /\b(Bearer|Basic|JWT)\s+(["'])((?:\\[\s\S]|(?!\2)[^\\])*)\2/gi,
    "$1 <redacted>",
  );
  text = text.replace(
    /\b(Bearer|Basic|JWT)\s+(?:\\+["']|["'])[^\r\n]*$/gim,
    "$1 <redacted>",
  );
  text = text.replace(
    /\b(Bearer|Basic|JWT)\s+(?!authentication\b|token\b|scheme\b|credentials?\b)[A-Za-z0-9._~+/=-]+/gi,
    "$1 <redacted>",
  );
  text = text.replace(
    /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    "<redacted-jwt>",
  );
  text = text.replace(
    /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{20,255}|glpat-[A-Za-z0-9_-]{20,255}|xox[baprs]-[A-Za-z0-9-]{10,255}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,255}|sk_live_[A-Za-z0-9]{16,255}|npm_[A-Za-z0-9]{36,255}|pypi-[A-Za-z0-9_-]{50,255}|hf_[A-Za-z0-9]{20,255}|AIza[A-Za-z0-9_-]{35}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/g,
    "<redacted-provider-token>",
  );
  text = text.replace(
    /(\b(?:set-cookie|cookie)\b["']?\s*[:=]\s*)(["'])((?:\\[\s\S]|(?!\2)[^\\])*)\2/gi,
    "$1$2<redacted>$2",
  );
  text = text.replace(
    /(\b(?:set-cookie|cookie)\b["']?\s*[:=]\s*)[^\r\n]+/gi,
    "$1<redacted>",
  );
  text = text.replace(
    /(--(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|token|secret|password|passwd|pwd|cookie)\s+)(["'])((?:\\[\s\S]|(?!\2)[^\\])*)\2/gi,
    "$1$2<redacted>$2",
  );
  text = text.replace(
    /(--(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|token|secret|password|passwd|pwd|cookie)\s+)(?:\\+["']|["'])[^\r\n]*$/gim,
    "$1<redacted>",
  );
  text = text.replace(
    /(--(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|token|secret|password|passwd|pwd|cookie)\s+)[^\s"']+/gi,
    "$1<redacted>",
  );
  text = text.replace(
    /((?<!\\)(\\+["'])(?:[A-Za-z0-9_-]*(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|token|secret|password|passwd|pwd)|private[_-]?key|authorization[_-]?code|oauth[_-]?code|authorization|(?:set-)?cookie|jwt|database_url)\2\s*:\s*\2)([\s\S]*?)(?<!\\)\2/gi,
    "$1<redacted>$2",
  );
  text = text.replace(
    /((?<!\\)(\\+["'])code\2\s*:\s*\2)([\s\S]*?)(?<!\\)\2/gi,
    (match, prefix, quote, code) =>
      isDiagnosticCode(code) ? match : `${prefix}<redacted>${quote}`,
  );
  text = text.replace(
    /((?<!\\)(\\+["'])(?:[A-Za-z0-9_-]*(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|token|secret|password|passwd|pwd)|private[_-]?key|authorization[_-]?code|oauth[_-]?code|authorization|(?:set-)?cookie|jwt|database_url|code)\2\s*:\s*\2)([^\r\n]*)$/gim,
    (match, prefix, quote, remainder) =>
      hasUnescapedDelimiter(remainder, quote) ? match : `${prefix}<redacted>`,
  );
  text = text.replace(
    /(\b(?:proxy-)?authorization\b["']?\s*[:=]\s*)[^\r\n]+/gi,
    "$1<redacted>",
  );
  text = text.replace(
    /(\bcode\b["']?\s*[:=]\s*)(["'])((?:\\[\s\S]|(?!\2)[^\\])*)\2/gi,
    (match, prefix, quote, code) =>
      isDiagnosticCode(code) ? match : `${prefix}${quote}<redacted>${quote}`,
  );
  text = text.replace(
    /(\bcode\b["']?\s*[:=]\s*)(["'])(?:\\[^\r\n]|(?!\2)[^\r\n])*$/gim,
    "$1$2<redacted>",
  );
  text = text.replace(
    /(^[ \t]*(?:[A-Za-z0-9_-]*(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|token|secret|password|passwd|pwd)|private[_-]?key|authorization[_-]?code|oauth[_-]?code|jwt|database_url)[ \t]*:[ \t]*)(?![>|])[^\r\n#]+/gim,
    "$1<redacted>",
  );
  text = text.replace(
    /(\b(?:[A-Za-z0-9_-]*(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|token|secret|password|passwd|pwd)|private[_-]?key|authorization[_-]?code|oauth[_-]?code|jwt|database_url)\b["']?\s*[:=]\s*)(["'])((?:\\[\s\S]|(?!\2)[^\\])*)\2/gi,
    "$1$2<redacted>$2",
  );
  text = text.replace(
    /(\b(?:[A-Za-z0-9_-]*(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|token|secret|password|passwd|pwd)|private[_-]?key|authorization[_-]?code|oauth[_-]?code|jwt|database_url)\b["']?\s*[:=]\s*)(["'])(?:\\[^\r\n]|(?!\2)[^\r\n])*$/gim,
    "$1$2<redacted>",
  );
  text = text.replace(
    /(\b(?:[A-Za-z0-9_-]*(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|token|secret|password|passwd|pwd)|private[_-]?key|authorization[_-]?code|oauth[_-]?code|jwt|database_url)\b["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi,
    "$1<redacted>",
  );
  text = text.replace(
    /(\bcode\b["']?\s*[:=]\s*["']?)([^\s"',;&}]+)/gi,
    (match, prefix, code) =>
      isDiagnosticCode(code) ? match : `${prefix}<redacted>`,
  );
  return text;
}

export function redactPersistedValue(value) {
  if (typeof value === "string") return redactPersistedText(value);
  if (Array.isArray(value)) return value.map(redactPersistedValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactPersistedValue(entry),
      ]),
    );
  }
  return value;
}
