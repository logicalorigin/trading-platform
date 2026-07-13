import { HttpError } from "../lib/errors";
import type { AuthenticatedSession } from "./auth";

// Slice 7: entitlement policy. The launch token (Slice 6) carries an optional
// `entitlements` array + `plan` which are stored on `users`; this module is the
// single place that turns that captured data into access decisions. Business
// policy lives here beside broker-provider-classification — lib/db only stores
// the opaque text[]. See SPEC_multitenant-onboarding-ibkr.md §5.5 / §6 / Q5.

// Canonical entitlement keys (string values match the schema comment: "broker_connect").
export const ENTITLEMENTS = {
  // May connect a sanctioned aggregator broker (Robinhood / Schwab / SnapTrade).
  BROKER_CONNECT: "broker_connect",
  // May use the IBKR Client Portal connector. Additionally gated by the SPEC §6
  // compliance kill-switch (isIbkrMemberConnectEnabled); never plan-granted.
  IBKR_ACCESS: "ibkr_access",
} as const;

export type Entitlement = (typeof ENTITLEMENTS)[keyof typeof ENTITLEMENTS];

// Paid plans that imply broker_connect when a launch token carries a plan but no
// explicit entitlements array. The one tunable business knob — adjust when the
// parent site's plan names are finalized. ibkr_access is NEVER plan-granted.
const BROKER_CONNECT_PLANS = new Set(["pro", "premium", "plus", "paid"]);

// Sanitize a raw entitlements claim into a clean string[]: array-guard, keep only
// non-empty trimmed strings, dedupe. Unknown keys are preserved (not gated on,
// but kept for audit fidelity) rather than silently dropped.
export function normalizeEntitlements(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

// Fallback entitlements when a launch token has a known paid plan but no explicit
// entitlements array, so a plan-only token isn't silently unentitled. Never
// grants ibkr_access (compliance — that must be explicit in the token).
export function defaultEntitlementsForPlan(plan: string | null): string[] {
  const normalized = (plan ?? "").trim().toLowerCase();
  return BROKER_CONNECT_PLANS.has(normalized)
    ? [ENTITLEMENTS.BROKER_CONNECT]
    : [];
}

// Resolve the entitlements to persist for a launch / re-launch. The token's
// `entitlements` claim is the source of truth: an EXPLICIT array — including an
// empty `[]`, a deliberate "this user has zero entitlements" signal from the
// trusted parent — is honored verbatim. Only when the claim is ABSENT (not an
// array) do we derive a plan default, from the EFFECTIVE plan (this token's
// plan, else the stored plan on re-launch) so a bare re-launch of a paid user
// re-grants the plan default instead of silently wiping their access. The plan
// path never yields ibkr_access (compliance — that must be explicit in a token).
export function resolveLaunchEntitlements(input: {
  claim: unknown;
  tokenPlan: string | null;
  existingPlan?: string | null;
}): string[] {
  if (Array.isArray(input.claim)) return normalizeEntitlements(input.claim);
  return defaultEntitlementsForPlan(input.tokenPlan ?? input.existingPlan ?? null);
}

// Fail-closed entitlement check with admin bypass. Admins (platform operators)
// implicitly hold every entitlement; members must carry the key explicitly.
export function sessionHasEntitlement(
  session: AuthenticatedSession,
  key: Entitlement,
): boolean {
  if (session.user.role === "admin") return true;
  return session.user.entitlements.includes(key);
}

// SPEC §6 compliance kill-switch. IBKR CPG for non-admin members stays OFF until
// the IBKR ToS/OAuth-approval question is resolved, regardless of entitlement.
export function isIbkrMemberConnectEnabled(): boolean {
  return (
    (process.env["IBKR_MEMBER_CONNECT_ENABLED"] ?? "").trim().toLowerCase() ===
    "true"
  );
}

export function sessionCanAccessIbkrPortal(
  session: AuthenticatedSession,
): boolean {
  return (
    session.user.role === "admin" ||
    (isIbkrMemberConnectEnabled() &&
      sessionHasEntitlement(session, ENTITLEMENTS.IBKR_ACCESS))
  );
}

export function assertIbkrPortalAccess(session: AuthenticatedSession): void {
  if (sessionCanAccessIbkrPortal(session)) return;
  throw new HttpError(403, "IBKR connections are not available.", {
    code: "ibkr_member_connect_disabled",
  });
}
