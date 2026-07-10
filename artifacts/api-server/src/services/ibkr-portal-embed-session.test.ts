import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetIbkrPortalEmbedSessionsForTests,
  issueIbkrPortalEmbedGrant,
  readIbkrPortalEmbedSession,
  rememberIbkrPortalEmbedCookieNames,
  redeemIbkrPortalEmbedGrant,
  revokeIbkrPortalEmbedSessions,
} from "./ibkr-portal-embed-session";

test("IBKR embed grants are one-time, origin-bound, expiring, and revocable", () => {
  __resetIbkrPortalEmbedSessionsForTests();
  const now = 1_000_000;
  const appUserId = "11111111-1111-4111-8111-111111111111";
  const parentOrigin = "https://pyrus.example.test";
  const embedOrigin = "https://ibkr.example.test";
  const grant = issueIbkrPortalEmbedGrant(
    { appUserId, parentOrigin, embedOrigin },
    now,
  );

  assert.equal(
    redeemIbkrPortalEmbedGrant(grant.code, parentOrigin, now + 1),
    null,
  );
  const redeemed = redeemIbkrPortalEmbedGrant(
    grant.code,
    embedOrigin,
    now + 2,
  );
  assert.ok(redeemed);
  assert.equal(redeemed.appUserId, appUserId);
  assert.equal(redeemed.parentOrigin, parentOrigin);
  assert.equal(
    redeemIbkrPortalEmbedGrant(grant.code, embedOrigin, now + 3),
    null,
  );
  assert.equal(
    readIbkrPortalEmbedSession(
      `other=1; pyrus_ibkr_embed=${redeemed.sessionToken}`,
      parentOrigin,
      now + 4,
    ),
    null,
  );
  assert.equal(
    readIbkrPortalEmbedSession(
      `other=1; pyrus_ibkr_embed=${redeemed.sessionToken}`,
      embedOrigin,
      now + 4,
    )?.appUserId,
    appUserId,
  );
  assert.deepEqual(
    readIbkrPortalEmbedSession(
      `pyrus_ibkr_embed=${redeemed.sessionToken}`,
      embedOrigin,
      now + 4,
    )?.gatewayCookieNames,
    [],
  );
  rememberIbkrPortalEmbedCookieNames(
    `pyrus_ibkr_embed=${redeemed.sessionToken}`,
    embedOrigin,
    ["JSESSIONID", "URL_PARAM", "JSESSIONID"],
    now + 4,
  );
  assert.deepEqual(
    readIbkrPortalEmbedSession(
      `pyrus_ibkr_embed=${redeemed.sessionToken}`,
      embedOrigin,
      now + 4,
    )?.gatewayCookieNames,
    ["JSESSIONID", "URL_PARAM"],
  );
  assert.equal(
    readIbkrPortalEmbedSession(
      `pyrus_ibkr_embed=${redeemed.sessionToken}`,
      embedOrigin,
      redeemed.expiresAt,
    ),
    null,
  );

  const second = issueIbkrPortalEmbedGrant(
    { appUserId, parentOrigin, embedOrigin },
    now + 5,
  );
  assert.equal(
    readIbkrPortalEmbedSession(
      `pyrus_ibkr_embed=${redeemed.sessionToken}`,
      embedOrigin,
      now + 6,
    ),
    null,
  );
  const secondRedeemed = redeemIbkrPortalEmbedGrant(
    second.code,
    embedOrigin,
    now + 6,
  );
  assert.ok(secondRedeemed);
  revokeIbkrPortalEmbedSessions(appUserId);
  assert.equal(
    readIbkrPortalEmbedSession(
      `pyrus_ibkr_embed=${secondRedeemed.sessionToken}`,
      embedOrigin,
      now + 7,
    ),
    null,
  );

  const delayedGrant = issueIbkrPortalEmbedGrant(
    { appUserId, parentOrigin, embedOrigin },
    now,
  );
  assert.ok(
    redeemIbkrPortalEmbedGrant(
      delayedGrant.code,
      embedOrigin,
      now + 2 * 60_000,
    ),
    "a delayed browser handoff must survive a loaded connect response",
  );
  const expiredGrant = issueIbkrPortalEmbedGrant(
    { appUserId, parentOrigin, embedOrigin },
    now,
  );
  assert.equal(
    redeemIbkrPortalEmbedGrant(
      expiredGrant.code,
      embedOrigin,
      now + 5 * 60_000,
    ),
    null,
  );
  __resetIbkrPortalEmbedSessionsForTests();
});
