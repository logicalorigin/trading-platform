const OPAQUE_CREDENTIAL_PATTERN =
  /(?:\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-[A-Za-z0-9_-]{16,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b)/u;
const NAMED_CREDENTIAL_ASSIGNMENT_PATTERN =
  /(?:^|[^a-z0-9])(?:api(?:[-_\s]|%2d|%5f)*key|access(?:[-_\s]|%2d|%5f)*token|authorization|client(?:[-_\s]|%2d|%5f)*secret|pass(?:word|phrase)|pgpassword|sslpassword|pwd|secret|token)\s*(?::|=|%3a|%3d)/iu;

export function hasOpaqueOperatorCredential(value: string): boolean {
  return OPAQUE_CREDENTIAL_PATTERN.test(value);
}

export function hasNamedOperatorCredential(value: string): boolean {
  return NAMED_CREDENTIAL_ASSIGNMENT_PATTERN.test(value);
}
