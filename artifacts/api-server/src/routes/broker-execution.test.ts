import assert from "node:assert/strict";
import { once } from "node:events";
import test, { beforeEach } from "node:test";
import type { AddressInfo } from "node:net";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  usersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import app from "../app";
import { createAuthSession } from "../services/auth";
import { ingestSnapTradeAccountHistory } from "../services/snaptrade-account-history";
import {
  beginSchwabConnectCustody,
  storeSchwabTokens,
} from "../services/schwab-user-custody";
import {
  deriveSnapTradeUserId,
  loadSnapTradeUserCredential,
  recordSnapTradeUserCredential,
} from "../services/snaptrade-user-custody";
import { AUTH_CSRF_HEADER, __resetAuthRateLimitsForTests } from "./auth";

beforeEach(() => {
  __resetAuthRateLimitsForTests();
});

type AuthRouteBody = {
  user: {
    id: string;
  };
  csrfToken: string;
};

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");

async function withServer<T>(
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${address.port}/api`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function withSnapTradeEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previousClientId = process.env["SNAPTRADE_CLIENTID"];
  const previousApiKey = process.env["SNAPTRADE_API_KEY"];
  process.env["SNAPTRADE_CLIENTID"] = "client-123";
  process.env["SNAPTRADE_API_KEY"] = "consumer-secret";
  try {
    return await fn();
  } finally {
    if (previousClientId === undefined) {
      delete process.env["SNAPTRADE_CLIENTID"];
    } else {
      process.env["SNAPTRADE_CLIENTID"] = previousClientId;
    }
    if (previousApiKey === undefined) {
      delete process.env["SNAPTRADE_API_KEY"];
    } else {
      process.env["SNAPTRADE_API_KEY"] = previousApiKey;
    }
  }
}

async function withSchwabEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previousAppKey = process.env["SCHWAB_APP_KEY"];
  const previousAppSecret = process.env["SCHWAB_APP_SECRET"];
  const previousRedirectBaseUrl = process.env["SCHWAB_OAUTH_REDIRECT_BASE_URL"];
  process.env["SCHWAB_APP_KEY"] = "app-key-abc";
  process.env["SCHWAB_APP_SECRET"] = "app-secret-xyz";
  process.env["SCHWAB_OAUTH_REDIRECT_BASE_URL"] = "https://pyrus.example";
  try {
    return await fn();
  } finally {
    if (previousAppKey === undefined) {
      delete process.env["SCHWAB_APP_KEY"];
    } else {
      process.env["SCHWAB_APP_KEY"] = previousAppKey;
    }
    if (previousAppSecret === undefined) {
      delete process.env["SCHWAB_APP_SECRET"];
    } else {
      process.env["SCHWAB_APP_SECRET"] = previousAppSecret;
    }
    if (previousRedirectBaseUrl === undefined) {
      delete process.env["SCHWAB_OAUTH_REDIRECT_BASE_URL"];
    } else {
      process.env["SCHWAB_OAUTH_REDIRECT_BASE_URL"] = previousRedirectBaseUrl;
    }
  }
}

async function withCredentialEncryptionEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previousKey = process.env["PYRUS_CREDENTIAL_ENCRYPTION_KEY"];
  const previousVersion = process.env["PYRUS_CREDENTIAL_ENCRYPTION_KEY_VERSION"];
  process.env["PYRUS_CREDENTIAL_ENCRYPTION_KEY"] = TEST_ENCRYPTION_KEY;
  process.env["PYRUS_CREDENTIAL_ENCRYPTION_KEY_VERSION"] = "test-v1";
  try {
    return await fn();
  } finally {
    if (previousKey === undefined) {
      delete process.env["PYRUS_CREDENTIAL_ENCRYPTION_KEY"];
    } else {
      process.env["PYRUS_CREDENTIAL_ENCRYPTION_KEY"] = previousKey;
    }
    if (previousVersion === undefined) {
      delete process.env["PYRUS_CREDENTIAL_ENCRYPTION_KEY_VERSION"];
    } else {
      process.env["PYRUS_CREDENTIAL_ENCRYPTION_KEY_VERSION"] = previousVersion;
    }
  }
}

async function withBootstrapToken<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"];
  process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"] = "setup-token";
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"];
    } else {
      process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"] = previous;
    }
  }
}

test("SnapTrade readiness route requires authentication before probing", async () => {
  await withSnapTradeEnv(async () =>
    withServer(async (baseUrl) => {
      const previousFetch = globalThis.fetch;
      let called = false;
      globalThis.fetch = (async () => {
        called = true;
        throw new Error("fetch should not run");
      }) as typeof fetch;
      try {
        const response = await previousFetch(
          `${baseUrl}/broker-execution/snaptrade/readiness`,
        );

        assert.equal(response.status, 401);
        assert.equal(called, false);
      } finally {
        globalThis.fetch = previousFetch;
      }
    }),
  );
});

test("SnapTrade routes reject authenticated non-admin sessions", async () => {
  await withSnapTradeEnv(async () =>
    withTestDb(async () =>
      withServer(async (baseUrl) => {
        const previousFetch = globalThis.fetch;
        let called = false;
        globalThis.fetch = (async () => {
          called = true;
          throw new Error("upstream fetch should not run for non-admin");
        }) as typeof fetch;
        try {
          const [member] = await db
            .insert(usersTable)
            .values({
              email: "member@example.com",
              passwordHash: "unused-hash",
              role: "member",
            })
            .returning();
          const session = await createAuthSession({ userId: member!.id });
          const cookie = `pyrus_session=${session.sessionToken}`;

          const readiness = await previousFetch(
            `${baseUrl}/broker-execution/snaptrade/readiness`,
            { headers: { cookie } },
          );
          assert.equal(readiness.status, 403);
          const readinessBody = (await readiness.json()) as { code?: string };
          // Slice 7: a member without the broker_connect entitlement is rejected
          // by the entitlement guard (was admin_required before Slice 7).
          assert.equal(readinessBody.code, "entitlement_required");
          assert.equal(called, false);

          const brokerages = await previousFetch(
            `${baseUrl}/broker-execution/snaptrade/brokerages`,
            { headers: { cookie } },
          );
          assert.equal(brokerages.status, 403);
          assert.equal(called, false);

          const submit = await previousFetch(
            `${baseUrl}/broker-execution/snaptrade/accounts/acct-1/orders`,
            {
              method: "POST",
              headers: {
                cookie,
                "content-type": "application/json",
                [AUTH_CSRF_HEADER]: session.csrfToken,
              },
              body: JSON.stringify({ confirm: true }),
            },
          );
          assert.equal(submit.status, 403);
          // Trade submit is admin-only (requireAdminCsrf) — a member is stopped
          // by the ADMIN guard, not the entitlement guard.
          assert.equal(
            ((await submit.json()) as { code?: string }).code,
            "admin_required",
          );
          assert.equal(called, false);
        } finally {
          globalThis.fetch = previousFetch;
        }
      }),
    ),
  );
});

test("trade submission stays admin-only even for a broker_connect member", async () => {
  // Regression guard: the connect/read lifecycle is requireEntitlement,
  // but order submission must remain requireAdminCsrf. Without this, a future
  // edit copying the sibling entitlement guard onto the submit routes would let
  // any paid member place live orders — and every other test would stay green.
  await withSnapTradeEnv(async () =>
    withTestDb(async () =>
      withServer(async (baseUrl) => {
        const previousFetch = globalThis.fetch;
        let called = false;
        globalThis.fetch = (async () => {
          called = true;
          throw new Error("upstream fetch should not run for a non-admin submit");
        }) as typeof fetch;
        try {
          const [member] = await db
            .insert(usersTable)
            .values({
              email: "broker-connect-member@example.com",
              passwordHash: "unused",
              role: "member",
              entitlements: ["broker_connect"],
            })
            .returning();
          const session = await createAuthSession({ userId: member!.id });
          const headers = {
            cookie: `pyrus_session=${session.sessionToken}`,
            "content-type": "application/json",
            [AUTH_CSRF_HEADER]: session.csrfToken,
          };

          for (const path of [
            "/broker-execution/snaptrade/accounts/acct-1/orders/impact",
            "/broker-execution/snaptrade/accounts/acct-1/orders",
          ]) {
            const resp = await previousFetch(`${baseUrl}${path}`, {
              method: "POST",
              headers,
              body: JSON.stringify({ confirm: true }),
            });
            assert.equal(resp.status, 403);
            assert.equal(
              ((await resp.json()) as { code?: string }).code,
              "admin_required",
              `${path} must reject a broker_connect member with admin_required`,
            );
          }
          assert.equal(called, false);
        } finally {
          globalThis.fetch = previousFetch;
        }
      }),
    ),
  );
});

test("SnapTrade connect lifecycle is gated by the broker_connect entitlement", async () => {
  await withSnapTradeEnv(async () =>
    withTestDb(async () =>
      withServer(async (baseUrl) => {
        const previousFetch = globalThis.fetch;
        // Stub the SnapTrade client probe so an entitled caller's readiness resolves 200.
        globalThis.fetch = (async () =>
          new Response(
            JSON.stringify({
              slug: "s",
              name: "n",
              redirect_uri: "",
              can_access_trades: true,
              can_access_holdings: true,
              can_access_account_history: true,
              can_access_reference_data: true,
              can_access_portfolio_management: false,
              can_access_orders: true,
              allowed_brokerages: [],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )) as typeof fetch;
        try {
          const readinessUrl = `${baseUrl}/broker-execution/snaptrade/readiness`;

          // Member WITHOUT the entitlement → blocked with entitlement_required.
          const [plain] = await db
            .insert(usersTable)
            .values({
              email: "st-plain@example.com",
              passwordHash: "unused",
              role: "member",
            })
            .returning();
          const plainSession = await createAuthSession({ userId: plain!.id });
          const blocked = await previousFetch(readinessUrl, {
            headers: { cookie: `pyrus_session=${plainSession.sessionToken}` },
          });
          assert.equal(blocked.status, 403);
          assert.equal(
            ((await blocked.json()) as { code?: string }).code,
            "entitlement_required",
          );

          // Member WITH broker_connect → passes the guard and reaches the handler.
          const [entitled] = await db
            .insert(usersTable)
            .values({
              email: "st-entitled@example.com",
              passwordHash: "unused",
              role: "member",
              entitlements: ["broker_connect"],
            })
            .returning();
          const entitledSession = await createAuthSession({
            userId: entitled!.id,
          });
          const allowed = await previousFetch(readinessUrl, {
            headers: { cookie: `pyrus_session=${entitledSession.sessionToken}` },
          });
          assert.equal(allowed.status, 200);
        } finally {
          globalThis.fetch = previousFetch;
        }
      }),
    ),
  );
});

test("IBKR portal stays off for members without the compliance flag (SPEC §6)", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const previousFlag = process.env["IBKR_MEMBER_CONNECT_ENABLED"];
      delete process.env["IBKR_MEMBER_CONNECT_ENABLED"];
      try {
        const readinessUrl = `${baseUrl}/broker-execution/ibkr-portal/readiness`;

        // A member WITH ibkr_access is STILL blocked while the kill-switch is
        // off — the compliance flag is required, not just the entitlement.
        const [entitled] = await db
          .insert(usersTable)
          .values({
            email: "ibkr-member@example.com",
            passwordHash: "unused",
            role: "member",
            entitlements: ["ibkr_access"],
          })
          .returning();
        const entitledSession = await createAuthSession({ userId: entitled!.id });
        const entitledResp = await fetch(readinessUrl, {
          headers: { cookie: `pyrus_session=${entitledSession.sessionToken}` },
        });
        assert.equal(entitledResp.status, 403);
        assert.equal(
          ((await entitledResp.json()) as { code?: string }).code,
          "ibkr_member_connect_disabled",
        );

        // A plain member is likewise blocked.
        const [plain] = await db
          .insert(usersTable)
          .values({
            email: "ibkr-plain@example.com",
            passwordHash: "unused",
            role: "member",
          })
          .returning();
        const plainSession = await createAuthSession({ userId: plain!.id });
        const plainResp = await fetch(readinessUrl, {
          headers: { cookie: `pyrus_session=${plainSession.sessionToken}` },
        });
        assert.equal(plainResp.status, 403);
        assert.equal(
          ((await plainResp.json()) as { code?: string }).code,
          "ibkr_member_connect_disabled",
        );
      } finally {
        if (previousFlag === undefined) {
          delete process.env["IBKR_MEMBER_CONNECT_ENABLED"];
        } else {
          process.env["IBKR_MEMBER_CONNECT_ENABLED"] = previousFlag;
        }
      }
    }),
  );
});

test("IBKR portal opens for admins (bypass) and for flag-on members with ibkr_access (SPEC §6 allow path)", async () => {
  // The deny-path test above proves the gate stays shut; this pins the two ALLOW
  // branches so a refactor that drops the admin short-circuit or inverts the flag
  // check (locking everyone out after compliance approval) fails loudly.
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const previousFlag = process.env["IBKR_MEMBER_CONNECT_ENABLED"];
      const readinessUrl = `${baseUrl}/broker-execution/ibkr-portal/readiness`;
      try {
        // Admin bypasses the §6 kill-switch even while the flag is OFF.
        delete process.env["IBKR_MEMBER_CONNECT_ENABLED"];
        const [admin] = await db
          .insert(usersTable)
          .values({
            email: "ibkr-admin@example.com",
            passwordHash: "unused",
            role: "admin",
          })
          .returning();
        const adminSession = await createAuthSession({ userId: admin!.id });
        const adminResp = await fetch(readinessUrl, {
          headers: { cookie: `pyrus_session=${adminSession.sessionToken}` },
        });
        // Gate opened: the readiness handler ran (200), not the 403 §6 block.
        assert.equal(adminResp.status, 200);

        // Member WITH ibkr_access AND the flag ON passes the gate.
        process.env["IBKR_MEMBER_CONNECT_ENABLED"] = "true";
        const [member] = await db
          .insert(usersTable)
          .values({
            email: "ibkr-enabled-member@example.com",
            passwordHash: "unused",
            role: "member",
            entitlements: ["ibkr_access"],
          })
          .returning();
        const memberSession = await createAuthSession({ userId: member!.id });
        const memberResp = await fetch(readinessUrl, {
          headers: { cookie: `pyrus_session=${memberSession.sessionToken}` },
        });
        assert.equal(memberResp.status, 200);
      } finally {
        if (previousFlag === undefined) {
          delete process.env["IBKR_MEMBER_CONNECT_ENABLED"];
        } else {
          process.env["IBKR_MEMBER_CONNECT_ENABLED"] = previousFlag;
        }
      }
    }),
  );
});

test("SnapTrade readiness route returns sanitized client status for authenticated users", async () => {
  await withBootstrapToken(async () =>
    withSnapTradeEnv(async () =>
      withTestDb(async () =>
        withServer(async (baseUrl) => {
          const previousFetch = globalThis.fetch;
          globalThis.fetch = (async () =>
            new Response(
              JSON.stringify({
                slug: "internal-client-slug",
                name: "Internal Client Name",
                redirect_uri: "",
                can_access_trades: true,
                can_access_holdings: true,
                can_access_account_history: true,
                can_access_reference_data: true,
                can_access_portfolio_management: false,
                can_access_orders: true,
                allowed_brokerages: [
                  {
                    slug: "PUBLIC",
                    display_name: "Public",
                    enabled: true,
                    allows_trading: true,
                    maintenance_mode: false,
                    is_degraded: false,
                  },
                ],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            )) as typeof fetch;
          try {
            const bootstrapResponse = await previousFetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";
            const bootstrapBody = (await bootstrapResponse.json()) as AuthRouteBody;
            assert.equal(typeof bootstrapBody.csrfToken, "string");
            await recordSnapTradeUserCredential({
              appUserId: bootstrapBody.user.id,
              snapTradeUserId: deriveSnapTradeUserId(bootstrapBody.user.id),
              userSecret: "snaptrade-user-secret",
              encryptionKey: TEST_ENCRYPTION_KEY,
              now: new Date("2026-06-26T23:45:00.000Z"),
            });

            const response = await previousFetch(
              `${baseUrl}/broker-execution/snaptrade/readiness`,
              { headers: { cookie } },
            );
            assert.equal(response.status, 200);
            const bodyText = await response.text();
            const body = JSON.parse(bodyText) as {
              provider: string;
              configured: boolean;
              status: string;
              clientInfo: { canAccessOrders: boolean };
              brokerages: { total: number; allowsTrading: number };
              user: {
                registered: boolean;
                snapTradeUserIdPresent: boolean;
                userSecretStored: boolean;
                nextAction: string;
              };
            };

            assert.equal(body.provider, "snaptrade");
            assert.equal(body.configured, true);
            assert.equal(body.status, "research_required");
            assert.equal(body.clientInfo.canAccessOrders, true);
            assert.deepEqual(body.brokerages, { total: 1, enabled: 1, allowsTrading: 1, degradedOrMaintenance: 0 });
            assert.deepEqual(body.user, {
              registered: true,
              status: "registered",
              snapTradeUserIdPresent: true,
              userSecretStored: true,
              registeredAt: "2026-06-26T23:45:00.000Z",
              disabledAt: null,
              nextAction: "generate_connection_portal",
            });
            assert.doesNotMatch(bodyText, /consumer-secret|client-123|Internal Client Name|PUBLIC|snaptrade-user-secret|pyrus-/);
          } finally {
            globalThis.fetch = previousFetch;
          }
        }),
      ),
    ),
  );
});

test("IBKR OAuth readiness route requires authentication", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/broker-execution/ibkr/oauth/readiness`,
    );

    assert.equal(response.status, 401);
  });
});

test("IBKR OAuth readiness route returns sanitized hosted-connect status for authenticated users", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () =>
      withServer(async (baseUrl) => {
        const previousConsumerKey = process.env["IBKR_OAUTH_CONSUMER_KEY"];
        const previousSigningKey = process.env["IBKR_OAUTH_SIGNING_KEY"];
        const previousCallbackUrl = process.env["IBKR_OAUTH_CALLBACK_URL"];
        process.env["IBKR_OAUTH_CONSUMER_KEY"] = "consumer-key";
        process.env["IBKR_OAUTH_SIGNING_KEY"] = "private-signing-key";
        process.env["IBKR_OAUTH_CALLBACK_URL"] =
          "https://pyrus.example.com/api/broker-execution/ibkr/oauth/callback";
        try {
          const bootstrapResponse = await fetch(`${baseUrl}/auth/bootstrap`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: "owner@example.com",
              password: "correct horse battery staple",
              bootstrapToken: "setup-token",
            }),
          });
          assert.equal(bootstrapResponse.status, 200);
          const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";

          const response = await fetch(
            `${baseUrl}/broker-execution/ibkr/oauth/readiness`,
            { headers: { cookie } },
          );
          assert.equal(response.status, 200);
          const bodyText = await response.text();
          const body = JSON.parse(bodyText) as {
            provider: string;
            configured: boolean;
            status: string;
            executionDecision: { decisionCode: string };
            credentials: {
              consumerKeyPresent: boolean;
              signingKeyPresent: boolean;
              callbackUrlPresent: boolean;
              thirdPartyApprovalRecorded: boolean;
              encryptionKeyPresent: boolean;
              dhParamPresent: boolean;
              accessTokenPresent: boolean;
              accessTokenSecretPresent: boolean;
            };
            requirements: {
              localGatewayRequired: boolean;
              clientPortalGatewayCustomerPath: boolean;
            };
          };

          assert.equal(body.provider, "ibkr_oauth");
          assert.equal(body.configured, true);
          assert.equal(body.status, "approval_required");
          assert.equal(
            body.executionDecision.decisionCode,
            "PROVIDER_COMPLIANCE_REVIEW_REQUIRED",
          );
          assert.deepEqual(body.credentials, {
            consumerKeyPresent: true,
            signingKeyPresent: true,
            callbackUrlPresent: true,
            thirdPartyApprovalRecorded: false,
            encryptionKeyPresent: false,
            dhParamPresent: false,
            accessTokenPresent: false,
            accessTokenSecretPresent: false,
          });
          assert.equal(body.requirements.localGatewayRequired, false);
          assert.equal(body.requirements.clientPortalGatewayCustomerPath, false);
          assert.doesNotMatch(
            bodyText,
            /consumer-key|private-signing-key|pyrus\.example\.com/,
          );
        } finally {
          if (previousConsumerKey === undefined) {
            delete process.env["IBKR_OAUTH_CONSUMER_KEY"];
          } else {
            process.env["IBKR_OAUTH_CONSUMER_KEY"] = previousConsumerKey;
          }
          if (previousSigningKey === undefined) {
            delete process.env["IBKR_OAUTH_SIGNING_KEY"];
          } else {
            process.env["IBKR_OAUTH_SIGNING_KEY"] = previousSigningKey;
          }
          if (previousCallbackUrl === undefined) {
            delete process.env["IBKR_OAUTH_CALLBACK_URL"];
          } else {
            process.env["IBKR_OAUTH_CALLBACK_URL"] = previousCallbackUrl;
          }
        }
      }),
    ),
  );
});

test("SnapTrade current-user registration requires authentication before provider call", async () => {
  await withSnapTradeEnv(async () =>
    withCredentialEncryptionEnv(async () =>
      withServer(async (baseUrl) => {
        const previousFetch = globalThis.fetch;
        let called = false;
        globalThis.fetch = (async () => {
          called = true;
          throw new Error("fetch should not run");
        }) as typeof fetch;
        try {
          const response = await previousFetch(
            `${baseUrl}/broker-execution/snaptrade/users/current`,
            { method: "POST" },
          );

          assert.equal(response.status, 401);
          assert.equal(called, false);
        } finally {
          globalThis.fetch = previousFetch;
        }
      }),
    ),
  );
});

test("SnapTrade current-user registration requires CSRF before provider call", async () => {
  await withBootstrapToken(async () =>
    withSnapTradeEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async () =>
          withServer(async (baseUrl) => {
            const bootstrapResponse = await fetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";

            const previousFetch = globalThis.fetch;
            let called = false;
            globalThis.fetch = (async () => {
              called = true;
              throw new Error("fetch should not run");
            }) as typeof fetch;
            try {
              const response = await previousFetch(
                `${baseUrl}/broker-execution/snaptrade/users/current`,
                { method: "POST", headers: { cookie } },
              );

              assert.equal(response.status, 403);
              assert.equal(called, false);
            } finally {
              globalThis.fetch = previousFetch;
            }
          }),
        ),
      ),
    ),
  );
});

test("SnapTrade Connection Portal route requires authentication before provider call", async () => {
  await withSnapTradeEnv(async () =>
    withCredentialEncryptionEnv(async () =>
      withServer(async (baseUrl) => {
        const previousFetch = globalThis.fetch;
        let called = false;
        globalThis.fetch = (async () => {
          called = true;
          throw new Error("fetch should not run");
        }) as typeof fetch;
        try {
          const response = await previousFetch(
            `${baseUrl}/broker-execution/snaptrade/connection-portal`,
            { method: "POST", headers: { "content-type": "application/json" } },
          );

          assert.equal(response.status, 401);
          assert.equal(called, false);
        } finally {
          globalThis.fetch = previousFetch;
        }
      }),
    ),
  );
});

test("SnapTrade Connection Portal route requires CSRF before provider call", async () => {
  await withBootstrapToken(async () =>
    withSnapTradeEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async () =>
          withServer(async (baseUrl) => {
            const bootstrapResponse = await fetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";

            const previousFetch = globalThis.fetch;
            let called = false;
            globalThis.fetch = (async () => {
              called = true;
              throw new Error("fetch should not run");
            }) as typeof fetch;
            try {
              const response = await previousFetch(
                `${baseUrl}/broker-execution/snaptrade/connection-portal`,
                {
                  method: "POST",
                  headers: { cookie, "content-type": "application/json" },
                  body: JSON.stringify({ broker: "INTERACTIVE-BROKERS-FLEX" }),
                },
              );

              assert.equal(response.status, 403);
              assert.equal(called, false);
            } finally {
              globalThis.fetch = previousFetch;
            }
          }),
        ),
      ),
    ),
  );
});

test("SnapTrade sync route requires authentication before provider call", async () => {
  await withSnapTradeEnv(async () =>
    withCredentialEncryptionEnv(async () =>
      withServer(async (baseUrl) => {
        const previousFetch = globalThis.fetch;
        let called = false;
        globalThis.fetch = (async () => {
          called = true;
          throw new Error("fetch should not run");
        }) as typeof fetch;
        try {
          const response = await previousFetch(
            `${baseUrl}/broker-execution/snaptrade/sync`,
            { method: "POST" },
          );

          assert.equal(response.status, 401);
          assert.equal(called, false);
        } finally {
          globalThis.fetch = previousFetch;
        }
      }),
    ),
  );
});

test("SnapTrade portfolio route requires authentication before provider call", async () => {
  await withSnapTradeEnv(async () =>
    withCredentialEncryptionEnv(async () =>
      withServer(async (baseUrl) => {
        const previousFetch = globalThis.fetch;
        let called = false;
        globalThis.fetch = (async () => {
          called = true;
          throw new Error("fetch should not run");
        }) as typeof fetch;
        try {
          const response = await previousFetch(
            `${baseUrl}/broker-execution/snaptrade/accounts/local-account-id/portfolio`,
          );

          assert.equal(response.status, 401);
          assert.equal(called, false);
        } finally {
          globalThis.fetch = previousFetch;
        }
      }),
    ),
  );
});

test("SnapTrade recent orders route requires authentication before provider call", async () => {
  await withSnapTradeEnv(async () =>
    withCredentialEncryptionEnv(async () =>
      withServer(async (baseUrl) => {
        const previousFetch = globalThis.fetch;
        let called = false;
        globalThis.fetch = (async () => {
          called = true;
          throw new Error("fetch should not run");
        }) as typeof fetch;
        try {
          const response = await previousFetch(
            `${baseUrl}/broker-execution/snaptrade/accounts/local-account-id/orders/recent`,
          );

          assert.equal(response.status, 401);
          assert.equal(called, false);
        } finally {
          globalThis.fetch = previousFetch;
        }
      }),
    ),
  );
});

test("SnapTrade account symbol search route requires authentication before provider call", async () => {
  await withSnapTradeEnv(async () =>
    withCredentialEncryptionEnv(async () =>
      withServer(async (baseUrl) => {
        const previousFetch = globalThis.fetch;
        let called = false;
        globalThis.fetch = (async () => {
          called = true;
          throw new Error("fetch should not run");
        }) as typeof fetch;
        try {
          const response = await previousFetch(
            `${baseUrl}/broker-execution/snaptrade/accounts/local-account-id/symbols/search?query=AAPL`,
          );

          assert.equal(response.status, 401);
          assert.equal(called, false);
        } finally {
          globalThis.fetch = previousFetch;
        }
      }),
    ),
  );
});

test("SnapTrade account history route requires authentication before provider call", async () => {
  await withSnapTradeEnv(async () =>
    withCredentialEncryptionEnv(async () =>
      withServer(async (baseUrl) => {
        const previousFetch = globalThis.fetch;
        let called = false;
        globalThis.fetch = (async () => {
          called = true;
          throw new Error("fetch should not run");
        }) as typeof fetch;
        try {
          const response = await previousFetch(
            `${baseUrl}/broker-execution/snaptrade/accounts/local-account-id/history?range=ALL`,
          );

          assert.equal(response.status, 401);
          assert.equal(called, false);
        } finally {
          globalThis.fetch = previousFetch;
        }
      }),
    ),
  );
});

test("SnapTrade sync route requires CSRF before provider call", async () => {
  await withBootstrapToken(async () =>
    withSnapTradeEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async () =>
          withServer(async (baseUrl) => {
            const bootstrapResponse = await fetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";

            const previousFetch = globalThis.fetch;
            let called = false;
            globalThis.fetch = (async () => {
              called = true;
              throw new Error("fetch should not run");
            }) as typeof fetch;
            try {
              const response = await previousFetch(
                `${baseUrl}/broker-execution/snaptrade/sync`,
                { method: "POST", headers: { cookie } },
              );

              assert.equal(response.status, 403);
              assert.equal(called, false);
            } finally {
              globalThis.fetch = previousFetch;
            }
          }),
        ),
      ),
    ),
  );
});

test("SnapTrade portfolio route returns sanitized balances and positions", async () => {
  await withBootstrapToken(async () =>
    withSnapTradeEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async ({ db }) =>
          withServer(async (baseUrl) => {
            const previousFetch = globalThis.fetch;
            const bootstrapResponse = await previousFetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";
            const bootstrapBody = (await bootstrapResponse.json()) as AuthRouteBody;
            const snapTradeUserId = deriveSnapTradeUserId(bootstrapBody.user.id);
            await recordSnapTradeUserCredential({
              appUserId: bootstrapBody.user.id,
              snapTradeUserId,
              userSecret: "snaptrade-user-secret",
              encryptionKey: TEST_ENCRYPTION_KEY,
            });
            const [connection] = await db
              .insert(brokerConnectionsTable)
              .values({
                appUserId: bootstrapBody.user.id,
                name: "snaptrade:auth-ibkr-1",
                connectionType: "broker",
                brokerProvider: "snaptrade",
                mode: "live",
                status: "connected",
                capabilities: ["accounts", "positions", "snaptrade"],
              })
              .returning({ id: brokerConnectionsTable.id });
            const [account] = await db
              .insert(brokerAccountsTable)
              .values({
                appUserId: bootstrapBody.user.id,
                connectionId: connection.id,
                providerAccountId: "snaptrade:acct-ibkr-1",
                displayName: "Main IBKR",
                mode: "live",
                baseCurrency: "USD",
                lastSyncedAt: "2026-07-01T19:10:00.000Z",
              })
              .returning({ id: brokerAccountsTable.id });

            const requestedPaths: string[] = [];
            globalThis.fetch = (async (url, init) => {
              const requestUrl = new URL(String(url));
              requestedPaths.push(requestUrl.pathname);
              assert.equal(init?.method, "GET");
              assert.equal(requestUrl.searchParams.get("clientId"), "client-123");
              assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
              assert.equal(
                requestUrl.searchParams.get("userSecret"),
                "snaptrade-user-secret",
              );
              assert.ok(
                (new Headers(init?.headers).get("Signature") ?? "").length > 20,
              );

              if (
                requestUrl.pathname ===
                "/api/v1/accounts/acct-ibkr-1/balances"
              ) {
                return new Response(
                  JSON.stringify([
                    {
                      currency: { code: "USD" },
                      cash: 500,
                      buying_power: 750,
                    },
                  ]),
                  { status: 200, headers: { "content-type": "application/json" } },
                );
              }

              if (
                requestUrl.pathname ===
                "/api/v1/accounts/acct-ibkr-1/positions/all"
              ) {
                return new Response(
                  JSON.stringify({
                    results: [
                      {
                        instrument: {
                          kind: "stock",
                          symbol: "MSFT",
                          raw_symbol: "MSFT",
                          description: "Microsoft Corporation",
                          currency: "USD",
                        },
                        units: "2",
                        price: "400",
                        cost_basis: "390",
                        currency: "USD",
                      },
                    ],
                    data_freshness: { as_of: "2026-07-01T19:31:00.000Z" },
                  }),
                  { status: 200, headers: { "content-type": "application/json" } },
                );
              }

              return new Response(JSON.stringify({ message: "unexpected path" }), {
                status: 404,
                headers: { "content-type": "application/json" },
              });
            }) as typeof fetch;
            try {
              const response = await previousFetch(
                `${baseUrl}/broker-execution/snaptrade/accounts/${account.id}/portfolio`,
                { headers: { cookie } },
              );
              assert.equal(response.status, 200);
              const bodyText = await response.text();
              const body = JSON.parse(bodyText) as {
                provider: string;
                account: { id: string; snapTradeAccountId: string };
                balances: Array<{ currency: string; cash: number }>;
                positions: Array<{
                  symbol: string;
                  assetClass: string;
                  marketValue: number;
                  unrealizedPnl: number;
                }>;
                totals: {
                  cash: number;
                  buyingPower: number;
                  positionMarketValue: number;
                  netLiquidation: number;
                  positionCount: number;
                };
                dataFreshness: { asOf: string };
              };

              assert.deepEqual(requestedPaths.sort(), [
                "/api/v1/accounts/acct-ibkr-1/balances",
                "/api/v1/accounts/acct-ibkr-1/positions/all",
              ]);
              assert.equal(body.provider, "snaptrade");
              assert.equal(body.account.id, account.id);
              assert.equal(body.account.snapTradeAccountId, "acct-ibkr-1");
              assert.deepEqual(body.balances, [
                { currency: "USD", cash: 500, buyingPower: 750 },
              ]);
              assert.deepEqual(body.positions, [
                {
                  snapTradePositionId: "stock:MSFT",
                  symbol: "MSFT",
                  rawSymbol: "MSFT",
                  description: "Microsoft Corporation",
                  instrumentKind: "stock",
                  assetClass: "equity",
                  quantity: 2,
                  side: "long",
                  price: 400,
                  averagePurchasePrice: 390,
                  marketValue: 800,
                  costBasis: 780,
                  unrealizedPnl: 20,
                  currency: "USD",
                  cashEquivalent: false,
                  optionContract: null,
                },
              ]);
              assert.deepEqual(body.totals, {
                cash: 500,
                buyingPower: 750,
                positionMarketValue: 800,
                netLiquidation: 1300,
                positionCount: 1,
              });
              assert.equal(body.dataFreshness.asOf, "2026-07-01T19:31:00.000Z");
              assert.doesNotMatch(
                bodyText,
                /consumer-secret|client-123|snaptrade-user-secret|pyrus-/,
              );
            } finally {
              globalThis.fetch = previousFetch;
            }
          }),
        ),
      ),
    ),
  );
});

test("SnapTrade account history route returns sanitized backfilled history", async () => {
  await withBootstrapToken(async () =>
    withSnapTradeEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async ({ db }) =>
          withServer(async (baseUrl) => {
            const previousFetch = globalThis.fetch;
            const bootstrapResponse = await previousFetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "history-route@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";
            const bootstrapBody = (await bootstrapResponse.json()) as AuthRouteBody;
            const snapTradeUserId = deriveSnapTradeUserId(bootstrapBody.user.id);
            await recordSnapTradeUserCredential({
              appUserId: bootstrapBody.user.id,
              snapTradeUserId,
              userSecret: "snaptrade-user-secret",
              encryptionKey: TEST_ENCRYPTION_KEY,
            });
            const [connection] = await db
              .insert(brokerConnectionsTable)
              .values({
                appUserId: bootstrapBody.user.id,
                name: "snaptrade:history-route",
                connectionType: "broker",
                brokerProvider: "snaptrade",
                mode: "live",
                status: "connected",
                capabilities: ["accounts", "positions", "snaptrade"],
              })
              .returning({ id: brokerConnectionsTable.id });
            const [account] = await db
              .insert(brokerAccountsTable)
              .values({
                appUserId: bootstrapBody.user.id,
                connectionId: connection.id,
                providerAccountId: "snaptrade:acct-history-route",
                displayName: "History Route Account",
                mode: "live",
                baseCurrency: "USD",
                lastSyncedAt: "2026-07-01T19:10:00.000Z",
              })
              .returning({ id: brokerAccountsTable.id });

            const requestedPaths: string[] = [];
            globalThis.fetch = (async (url, init) => {
              const requestUrl = new URL(String(url));
              requestedPaths.push(requestUrl.pathname);
              assert.equal(init?.method, "GET");
              assert.equal(requestUrl.searchParams.get("clientId"), "client-123");
              assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
              assert.equal(
                requestUrl.searchParams.get("userSecret"),
                "snaptrade-user-secret",
              );
              assert.ok(requestUrl.searchParams.get("timestamp"));
              assert.ok(
                (new Headers(init?.headers).get("Signature") ?? "").length > 20,
              );

              if (
                requestUrl.pathname ===
                "/api/v1/accounts/acct-history-route/activities"
              ) {
                assert.equal(requestUrl.searchParams.get("limit"), "1000");
                assert.equal(requestUrl.searchParams.get("offset"), "0");
                assert.equal(requestUrl.searchParams.get("endDate"), "2026-06-30");
                return new Response(
                  JSON.stringify({
                    data: [
                      {
                        id: "route-open",
                        symbol: {
                          symbol: "BLDP260821C00005000",
                          raw_symbol: "BLDP260821C00005000",
                          description: "BLDP Aug 21 2026 5 Call",
                          currency: { code: "USD" },
                        },
                        price: 0.8,
                        units: 2,
                        amount: -160,
                        currency: { code: "USD" },
                        type: "BUY",
                        option_type: "BUY_TO_OPEN",
                        description: "Bought BLDP calls",
                        trade_date: "2026-06-01T00:00:00.000Z",
                        settlement_date: "2026-06-02T00:00:00.000Z",
                        fee: 1,
                      },
                      {
                        id: "route-close",
                        symbol: {
                          symbol: "BLDP260821C00005000",
                          raw_symbol: "BLDP260821C00005000",
                          description: "BLDP Aug 21 2026 5 Call",
                          currency: { code: "USD" },
                        },
                        price: 1.25,
                        units: -2,
                        amount: 250,
                        currency: { code: "USD" },
                        type: "SELL",
                        option_type: "SELL_TO_CLOSE",
                        description: "Sold BLDP calls",
                        trade_date: "2026-06-15T00:00:00.000Z",
                        settlement_date: "2026-06-16T00:00:00.000Z",
                        fee: 1,
                      },
                    ],
                    pagination: { offset: 0, limit: 1000, total: 2 },
                  }),
                  { status: 200, headers: { "content-type": "application/json" } },
                );
              }

              if (
                requestUrl.pathname ===
                "/api/v1/accounts/acct-history-route/balanceHistory"
              ) {
                return new Response(
                  JSON.stringify({
                    history: [
                      { date: "2026-06-01", total_value: "1000.00" },
                      { date: "2026-06-15", total_value: "1090.00" },
                    ],
                    currency: "USD",
                  }),
                  { status: 200, headers: { "content-type": "application/json" } },
                );
              }

              return new Response(JSON.stringify({ message: "unexpected path" }), {
                status: 404,
                headers: { "content-type": "application/json" },
              });
            }) as typeof fetch;
            // Seed stored history the way the scheduler / connect-hook would, so the
            // stored-first read below has persisted data to serve. This is the live
            // SnapTrade pull that used to run inline in the read (and time out).
            await ingestSnapTradeAccountHistory({
              appUserId: bootstrapBody.user.id,
              accountId: account.id,
              to: "2026-06-30T00:00:00.000Z",
              now: new Date("2026-07-01T20:00:00.000Z"),
            });
            assert.deepEqual(
              [...new Set(requestedPaths)].sort(),
              [
                "/api/v1/accounts/acct-history-route/activities",
                "/api/v1/accounts/acct-history-route/balanceHistory",
              ],
            );
            requestedPaths.length = 0;
            try {
              const response = await previousFetch(
                `${baseUrl}/broker-execution/snaptrade/accounts/${account.id}/history?range=ALL&to=2026-06-30T00:00:00.000Z`,
                { headers: { cookie } },
              );
              assert.equal(response.status, 200);
              const bodyText = await response.text();
              const body = JSON.parse(bodyText) as {
                provider: string;
                account: { id: string; snapTradeAccountId: string };
                activities: Array<{ id: string; symbol: string | null }>;
                closedTrades: {
                  trades: Array<{
                    source: string;
                    symbol: string;
                    positionType: string;
                    avgOpen: number | null;
                    avgClose: number | null;
                    realizedPnl: number | null;
                  }>;
                  summary: { realizedPnl?: number };
                };
                equityHistory: {
                  range: string;
                  terminalPointSource: string | null;
                  points: Array<{ netLiquidation: number; source: string }>;
                };
                balanceHistory: { available: boolean; pointCount: number };
                backfill: { activitiesStored: number; balanceSnapshotsStored: number };
              };

              // Stored-first read: the response is served from persisted data
              // (seeded above). The route also fires a throttled background refresh,
              // so the read's live-call inventory is not asserted here.
              assert.equal(body.provider, "snaptrade");
              assert.equal(body.account.id, account.id);
              assert.equal(body.account.snapTradeAccountId, "acct-history-route");
              assert.equal(body.activities.length, 2);
              assert.equal(body.closedTrades.trades.length, 1);
              assert.equal(body.closedTrades.trades[0]?.source, "SNAPTRADE_ACTIVITY");
              assert.equal(body.closedTrades.trades[0]?.symbol, "BLDP");
              assert.equal(body.closedTrades.trades[0]?.positionType, "option");
              assert.equal(body.closedTrades.trades[0]?.avgOpen, 0.805);
              assert.equal(body.closedTrades.trades[0]?.avgClose, 1.245);
              assert.equal(body.closedTrades.trades[0]?.realizedPnl, 88);
              assert.equal(body.closedTrades.summary.realizedPnl, 88);
              assert.equal(body.equityHistory.range, "ALL");
              assert.equal(
                body.equityHistory.terminalPointSource,
                "snaptrade_balance_history",
              );
              assert.equal(body.equityHistory.points.length, 2);
              assert.equal(body.equityHistory.points[1]?.netLiquidation, 1090);
              assert.equal(
                body.equityHistory.points[1]?.source,
                "SNAPTRADE_BALANCE_HISTORY",
              );
              assert.equal(body.balanceHistory.available, true);
              assert.equal(body.balanceHistory.pointCount, 2);
              assert.equal(body.backfill.activitiesStored, 2);
              assert.equal(body.backfill.balanceSnapshotsStored, 2);
              assert.doesNotMatch(
                bodyText,
                /consumer-secret|client-123|snaptrade-user-secret|pyrus-/,
              );
            } finally {
              globalThis.fetch = previousFetch;
            }
          }),
        ),
      ),
    ),
  );
});

test("SnapTrade recent orders route returns sanitized realtime order status", async () => {
  await withBootstrapToken(async () =>
    withSnapTradeEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async ({ db }) =>
          withServer(async (baseUrl) => {
            const previousFetch = globalThis.fetch;
            const bootstrapResponse = await previousFetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";
            const bootstrapBody = (await bootstrapResponse.json()) as AuthRouteBody;
            const snapTradeUserId = deriveSnapTradeUserId(bootstrapBody.user.id);
            await recordSnapTradeUserCredential({
              appUserId: bootstrapBody.user.id,
              snapTradeUserId,
              userSecret: "snaptrade-user-secret",
              encryptionKey: TEST_ENCRYPTION_KEY,
            });
            const [connection] = await db
              .insert(brokerConnectionsTable)
              .values({
                appUserId: bootstrapBody.user.id,
                name: "snaptrade:recent-orders-connection",
                connectionType: "broker",
                brokerProvider: "snaptrade",
                mode: "live",
                status: "connected",
                capabilities: ["accounts", "positions", "snaptrade", "orders"],
              })
              .returning({ id: brokerConnectionsTable.id });
            const [account] = await db
              .insert(brokerAccountsTable)
              .values({
                appUserId: bootstrapBody.user.id,
                connectionId: connection.id,
                providerAccountId: "snaptrade:acct-route-recent",
                displayName: "Main IBKR",
                mode: "live",
                accountStatus: "open",
                baseCurrency: "USD",
                capabilities: [
                  "accounts",
                  "positions",
                  "snaptrade",
                  "orders",
                  "executions",
                  "execution-ready",
                ],
                executionBlockers: [],
                lastSyncedAt: "2026-07-01T19:10:00.000Z",
              })
              .returning({ id: brokerAccountsTable.id });

            const requestedUrls: string[] = [];
            globalThis.fetch = (async (url, init) => {
              requestedUrls.push(String(url));
              const requestUrl = new URL(String(url));
              assert.equal(
                requestUrl.pathname,
                "/api/v1/accounts/acct-route-recent/recentOrders",
              );
              assert.equal(requestUrl.searchParams.get("clientId"), "client-123");
              assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
              assert.equal(
                requestUrl.searchParams.get("userSecret"),
                "snaptrade-user-secret",
              );
              assert.equal(requestUrl.searchParams.get("only_executed"), "false");
              assert.equal(init?.method, "GET");
              assert.ok(
                (new Headers(init?.headers).get("Signature") ?? "").length > 20,
              );
              return new Response(
                JSON.stringify({
                  orders: [
                    {
                      brokerage_order_id: "broker-order-route-2",
                      status: "PARTIAL",
                      universal_symbol: {
                        id: "2bcd7cc3-e922-4976-bce1-9858296801c3",
                        symbol: "AAPL",
                        raw_symbol: "AAPL",
                        description: "Apple Inc.",
                      },
                      action: "BUY",
                      total_quantity: "5",
                      open_quantity: "3",
                      canceled_quantity: "0",
                      filled_quantity: "2",
                      execution_price: "181.7",
                      limit_price: "182.5",
                      stop_price: null,
                      order_type: "Limit",
                      time_in_force: "Day",
                      time_placed: "2026-07-01T20:29:30.000Z",
                      time_updated: "2026-07-01T20:30:00.000Z",
                      account: {
                        id: "acct-route-recent",
                        number: "U8888888",
                      },
                    },
                  ],
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              );
            }) as typeof fetch;
            try {
              const response = await previousFetch(
                `${baseUrl}/broker-execution/snaptrade/accounts/${account.id}/orders/recent`,
                { headers: { cookie } },
              );
              assert.equal(response.status, 200);
              const bodyText = await response.text();
              const body = JSON.parse(bodyText) as {
                provider: string;
                account: { id: string; snapTradeAccountId: string };
                orders: Array<{
                  brokerageOrderId: string | null;
                  status: string;
                  symbol: string | null;
                  totalQuantity: number | null;
                  filledQuantity: number | null;
                }>;
              };

              assert.equal(requestedUrls.length, 1);
              assert.equal(body.provider, "snaptrade");
              assert.equal(body.account.id, account.id);
              assert.equal(body.account.snapTradeAccountId, "acct-route-recent");
              assert.equal(body.orders.length, 1);
              assert.equal(body.orders[0]?.brokerageOrderId, "broker-order-route-2");
              assert.equal(body.orders[0]?.status, "PARTIAL");
              assert.equal(body.orders[0]?.symbol, "AAPL");
              assert.equal(body.orders[0]?.totalQuantity, 5);
              assert.equal(body.orders[0]?.filledQuantity, 2);
              assert.doesNotMatch(
                bodyText,
                /consumer-secret|snaptrade-user-secret|client-123|U8888888|pyrus-/,
              );
            } finally {
              globalThis.fetch = previousFetch;
            }
          }),
        ),
      ),
    ),
  );
});

test("SnapTrade account symbol search route returns sanitized account-scoped symbols", async () => {
  await withBootstrapToken(async () =>
    withSnapTradeEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async ({ db }) =>
          withServer(async (baseUrl) => {
            const previousFetch = globalThis.fetch;
            const bootstrapResponse = await previousFetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "symbol-search-route@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";
            const bootstrapBody = (await bootstrapResponse.json()) as AuthRouteBody;
            const snapTradeUserId = deriveSnapTradeUserId(bootstrapBody.user.id);
            await recordSnapTradeUserCredential({
              appUserId: bootstrapBody.user.id,
              snapTradeUserId,
              userSecret: "snaptrade-user-secret",
              encryptionKey: TEST_ENCRYPTION_KEY,
            });
            const [connection] = await db
              .insert(brokerConnectionsTable)
              .values({
                appUserId: bootstrapBody.user.id,
                name: "snaptrade:symbol-search-connection",
                connectionType: "broker",
                brokerProvider: "snaptrade",
                mode: "live",
                status: "connected",
                capabilities: ["accounts", "positions", "snaptrade", "orders"],
              })
              .returning({ id: brokerConnectionsTable.id });
            const [account] = await db
              .insert(brokerAccountsTable)
              .values({
                appUserId: bootstrapBody.user.id,
                connectionId: connection.id,
                providerAccountId: "snaptrade:acct-route-symbols",
                displayName: "Main IBKR",
                mode: "live",
                accountStatus: "open",
                baseCurrency: "USD",
                capabilities: [
                  "accounts",
                  "positions",
                  "snaptrade",
                  "orders",
                  "executions",
                  "execution-ready",
                ],
                executionBlockers: [],
                lastSyncedAt: "2026-07-01T19:10:00.000Z",
              })
              .returning({ id: brokerAccountsTable.id });

            const requestedBodies: Array<Record<string, unknown>> = [];
            globalThis.fetch = (async (url, init) => {
              const requestUrl = new URL(String(url));
              assert.equal(
                requestUrl.pathname,
                "/api/v1/accounts/acct-route-symbols/symbols",
              );
              assert.equal(requestUrl.searchParams.get("clientId"), "client-123");
              assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
              assert.equal(
                requestUrl.searchParams.get("userSecret"),
                "snaptrade-user-secret",
              );
              assert.equal(init?.method, "POST");
              assert.ok(
                (new Headers(init?.headers).get("Signature") ?? "").length > 20,
              );
              requestedBodies.push(JSON.parse(String(init?.body)));
              return new Response(
                JSON.stringify([
                  {
                    id: "2bcd7cc3-e922-4976-bce1-9858296801c3",
                    symbol: "AAPL",
                    raw_symbol: "AAPL",
                    description: "Apple Inc.",
                    currency: { code: "USD" },
                    exchange: {
                      code: "NASDAQ",
                      mic_code: "XNAS",
                      name: "Nasdaq",
                      suffix: null,
                    },
                    type: { code: "cs", description: "Common Stock" },
                    account: {
                      id: "acct-route-symbols",
                      number: "U2222222",
                    },
                  },
                ]),
                { status: 200, headers: { "content-type": "application/json" } },
              );
            }) as typeof fetch;
            try {
              const response = await previousFetch(
                `${baseUrl}/broker-execution/snaptrade/accounts/${account.id}/symbols/search?query=AAPL`,
                { headers: { cookie } },
              );
              assert.equal(response.status, 200);
              const bodyText = await response.text();
              const body = JSON.parse(bodyText) as {
                provider: string;
                query: string;
                account: { id: string; snapTradeAccountId: string };
                symbols: Array<{
                  id: string;
                  symbol: string;
                  rawSymbol: string | null;
                  currencyCode: string | null;
                  exchangeMicCode: string | null;
                }>;
                bestMatch: { id: string; symbol: string } | null;
              };

              assert.deepEqual(requestedBodies, [{ substring: "AAPL" }]);
              assert.equal(body.provider, "snaptrade");
              assert.equal(body.query, "AAPL");
              assert.equal(body.account.id, account.id);
              assert.equal(body.account.snapTradeAccountId, "acct-route-symbols");
              assert.equal(body.symbols.length, 1);
              assert.equal(body.symbols[0]?.symbol, "AAPL");
              assert.equal(body.symbols[0]?.rawSymbol, "AAPL");
              assert.equal(body.symbols[0]?.currencyCode, "USD");
              assert.equal(body.symbols[0]?.exchangeMicCode, "XNAS");
              assert.equal(body.bestMatch?.id, "2bcd7cc3-e922-4976-bce1-9858296801c3");
              assert.doesNotMatch(
                bodyText,
                /consumer-secret|snaptrade-user-secret|client-123|U2222222|pyrus-/,
              );
            } finally {
              globalThis.fetch = previousFetch;
            }
          }),
        ),
      ),
    ),
  );
});

test("SnapTrade Connection Portal route requires a registered SnapTrade user", async () => {
  await withBootstrapToken(async () =>
    withSnapTradeEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async () =>
          withServer(async (baseUrl) => {
            const bootstrapResponse = await fetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";
            const bootstrapBody = (await bootstrapResponse.json()) as AuthRouteBody;

            const previousFetch = globalThis.fetch;
            let called = false;
            globalThis.fetch = (async () => {
              called = true;
              throw new Error("fetch should not run");
            }) as typeof fetch;
            try {
              const response = await previousFetch(
                `${baseUrl}/broker-execution/snaptrade/connection-portal`,
                {
                  method: "POST",
                  headers: {
                    cookie,
                    "content-type": "application/json",
                    [AUTH_CSRF_HEADER]: bootstrapBody.csrfToken,
                  },
                  body: JSON.stringify({ broker: "INTERACTIVE-BROKERS-FLEX" }),
                },
              );

              assert.equal(response.status, 409);
              const bodyText = await response.text();
              assert.match(bodyText, /snaptrade_user_not_registered/);
              assert.equal(called, false);
            } finally {
              globalThis.fetch = previousFetch;
            }
          }),
        ),
      ),
    ),
  );
});

test("SnapTrade sync route returns sanitized synced brokerage inventory", async () => {
  await withBootstrapToken(async () =>
    withSnapTradeEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async () =>
          withServer(async (baseUrl) => {
            const previousFetch = globalThis.fetch;
            const bootstrapResponse = await previousFetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";
            const bootstrapBody = (await bootstrapResponse.json()) as AuthRouteBody;
            const snapTradeUserId = deriveSnapTradeUserId(bootstrapBody.user.id);
            await recordSnapTradeUserCredential({
              appUserId: bootstrapBody.user.id,
              snapTradeUserId,
              userSecret: "snaptrade-user-secret",
              encryptionKey: TEST_ENCRYPTION_KEY,
              now: new Date("2026-07-01T18:45:00.000Z"),
            });

            const requestedPaths: string[] = [];
            globalThis.fetch = (async (url, init) => {
              const requestUrl = new URL(String(url));
              requestedPaths.push(requestUrl.pathname);
              assert.equal(init?.method, "GET");
              assert.equal(requestUrl.searchParams.get("clientId"), "client-123");
              assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
              assert.equal(
                requestUrl.searchParams.get("userSecret"),
                "snaptrade-user-secret",
              );
              assert.ok(
                (new Headers(init?.headers).get("Signature") ?? "").length > 20,
              );

              if (requestUrl.pathname === "/api/v1/authorizations") {
                return new Response(
                  JSON.stringify([
                    {
                      id: "auth-ibkr-1",
                      type: "trade",
                      disabled: false,
                      brokerage: {
                        slug: "INTERACTIVE-BROKERS-FLEX",
                        name: "Interactive Brokers",
                        allows_trading: true,
                      },
                    },
                  ]),
                  { status: 200, headers: { "content-type": "application/json" } },
                );
              }

              if (requestUrl.pathname === "/api/v1/accounts") {
                return new Response(
                  JSON.stringify([
                    {
                      id: "acct-ibkr-1",
                      brokerage_authorization: "auth-ibkr-1",
                      number: "U1234567",
                      institution_name: "Interactive Brokers",
                      balance: { currency: { code: "USD" } },
                      status: "open",
                    },
                  ]),
                  { status: 200, headers: { "content-type": "application/json" } },
                );
              }

              return new Response(JSON.stringify({ message: "unexpected path" }), {
                status: 404,
                headers: { "content-type": "application/json" },
              });
            }) as typeof fetch;
            try {
              const response = await previousFetch(
                `${baseUrl}/broker-execution/snaptrade/sync`,
                {
                  method: "POST",
                  headers: {
                    cookie,
                    [AUTH_CSRF_HEADER]: bootstrapBody.csrfToken,
                  },
                },
              );
              assert.equal(response.status, 200);
              const bodyText = await response.text();
              const body = JSON.parse(bodyText) as {
                provider: string;
                syncedAt: string;
                connections: Array<{
                  provider: string;
                  snapTradeConnectionId: string;
                  brokerageName: string;
                  connectionType: string;
                  tradeEnabled: boolean | null;
                  executionReady: boolean;
                  executionBlockers: string[];
                  accountCount: number;
                }>;
                accounts: Array<{
                  snapTradeAccountId: string;
                  displayName: string;
                  brokerageName: string | null;
                  status: string | null;
                  baseCurrency: string;
                  executionReady: boolean;
                  executionBlockers: string[];
                }>;
                totals: {
                  upstreamConnections: number;
                  upstreamAccounts: number;
                  storedConnections: number;
                  storedAccounts: number;
                };
              };

              // The sync route also kicks off a fire-and-forget history backfill
              // (refreshSnapTradeAccountHistoryForUser), which pulls per-account
              // /activities + /balanceHistory asynchronously. Those are a separate
              // concern; assert only the sync-proper inventory so this stays
              // deterministic regardless of whether the backfill has fired yet.
              const syncRequestPaths = requestedPaths.filter(
                (path) =>
                  !/^\/api\/v1\/accounts\/[^/]+\/(activities|balanceHistory)$/.test(
                    path,
                  ),
              );
              assert.deepEqual(syncRequestPaths.sort(), [
                "/api/v1/accounts",
                "/api/v1/authorizations",
              ]);
              assert.equal(body.provider, "snaptrade");
              assert.equal(typeof body.syncedAt, "string");
              assert.equal(body.connections.length, 1);
              assert.equal(body.connections[0]?.provider, "snaptrade");
              assert.equal(
                body.connections[0]?.snapTradeConnectionId,
                "auth-ibkr-1",
              );
              assert.equal(body.connections[0]?.connectionType, "trade");
              assert.equal(body.connections[0]?.tradeEnabled, true);
              assert.equal(body.connections[0]?.executionReady, true);
              assert.deepEqual(body.connections[0]?.executionBlockers, []);
              assert.equal(body.connections[0]?.accountCount, 1);
              assert.equal(body.accounts.length, 1);
              assert.equal(body.accounts[0]?.snapTradeAccountId, "acct-ibkr-1");
              assert.equal(
                body.accounts[0]?.displayName,
                "Interactive Brokers account ...4567",
              );
              assert.equal(body.accounts[0]?.status, "open");
              assert.equal(body.accounts[0]?.baseCurrency, "USD");
              assert.equal(body.accounts[0]?.executionReady, true);
              assert.deepEqual(body.accounts[0]?.executionBlockers, []);
              assert.deepEqual(body.totals, {
                upstreamConnections: 1,
                upstreamAccounts: 1,
                storedConnections: 1,
                storedAccounts: 1,
              });
              assert.doesNotMatch(
                bodyText,
                /consumer-secret|client-123|snaptrade-user-secret|pyrus-|U1234567/,
              );
            } finally {
              globalThis.fetch = previousFetch;
            }
          }),
        ),
      ),
    ),
  );
});

test("SnapTrade current-user registration stores credentials and returns sanitized readiness", async () => {
  await withBootstrapToken(async () =>
    withSnapTradeEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async () =>
          withServer(async (baseUrl) => {
            const previousFetch = globalThis.fetch;
            const bootstrapResponse = await previousFetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";
            const bootstrapBody = (await bootstrapResponse.json()) as AuthRouteBody;
            const snapTradeUserId = deriveSnapTradeUserId(bootstrapBody.user.id);
            const requestedUrls: string[] = [];
            const requestedBodies: string[] = [];

            globalThis.fetch = (async (url, init) => {
              requestedUrls.push(String(url));
              requestedBodies.push(String(init?.body ?? ""));
              assert.equal(init?.method, "POST");
              assert.ok(
                (new Headers(init?.headers).get("Signature") ?? "").length > 20,
              );
              return new Response(
                JSON.stringify({
                  userId: snapTradeUserId,
                  userSecret: "snaptrade-user-secret",
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              );
            }) as typeof fetch;
            try {
              const response = await previousFetch(
                `${baseUrl}/broker-execution/snaptrade/users/current`,
                {
                  method: "POST",
                  headers: {
                    cookie,
                    [AUTH_CSRF_HEADER]: bootstrapBody.csrfToken,
                  },
                },
              );
              assert.equal(response.status, 201);
              const bodyText = await response.text();
              const body = JSON.parse(bodyText) as {
                provider: string;
                created: boolean;
                user: {
                  registered: boolean;
                  status: string;
                  snapTradeUserIdPresent: boolean;
                  userSecretStored: boolean;
                  registeredAt: string | null;
                  disabledAt: string | null;
                  nextAction: string;
                };
              };

              assert.equal(requestedUrls.length, 1);
              assert.match(
                requestedUrls[0] ?? "",
                /^https:\/\/api\.snaptrade\.com\/api\/v1\/snapTrade\/registerUser\?/,
              );
              assert.doesNotMatch(requestedUrls[0] ?? "", /consumer-secret/);
              assert.deepEqual(JSON.parse(requestedBodies[0] ?? "{}"), {
                userId: snapTradeUserId,
              });
              assert.deepEqual(body, {
                provider: "snaptrade",
                created: true,
                user: {
                  registered: true,
                  status: "registered",
                  snapTradeUserIdPresent: true,
                  userSecretStored: true,
                  registeredAt: body.user.registeredAt,
                  disabledAt: null,
                  nextAction: "generate_connection_portal",
                },
              });
              assert.equal(typeof body.user.registeredAt, "string");
              assert.doesNotMatch(
                bodyText,
                /consumer-secret|client-123|snaptrade-user-secret|pyrus-/,
              );

              const credential = await loadSnapTradeUserCredential({
                appUserId: bootstrapBody.user.id,
                encryptionKey: TEST_ENCRYPTION_KEY,
              });
              assert.deepEqual(credential, {
                snapTradeUserId,
                userSecret: "snaptrade-user-secret",
              });
            } finally {
              globalThis.fetch = previousFetch;
            }
          }),
        ),
      ),
    ),
  );
});

test("SnapTrade Connection Portal route returns a sanitized short-lived portal URL", async () => {
  await withBootstrapToken(async () =>
    withSnapTradeEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async () =>
          withServer(async (baseUrl) => {
            const previousFetch = globalThis.fetch;
            const bootstrapResponse = await previousFetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";
            const bootstrapBody = (await bootstrapResponse.json()) as AuthRouteBody;
            const snapTradeUserId = deriveSnapTradeUserId(bootstrapBody.user.id);
            await recordSnapTradeUserCredential({
              appUserId: bootstrapBody.user.id,
              snapTradeUserId,
              userSecret: "snaptrade-user-secret",
              encryptionKey: TEST_ENCRYPTION_KEY,
              now: new Date("2026-07-01T18:45:00.000Z"),
            });

            const requestedUrls: string[] = [];
            const requestedBodies: string[] = [];
            globalThis.fetch = (async (url, init) => {
              requestedUrls.push(String(url));
              requestedBodies.push(String(init?.body ?? ""));
              assert.equal(init?.method, "POST");
              assert.ok(
                (new Headers(init?.headers).get("Signature") ?? "").length > 20,
              );
              return new Response(
                JSON.stringify({
                  redirectURI:
                    "https://app.snaptrade.com/snapTrade/redeemToken?token=portal-token&sessionId=session-123",
                  sessionId: "session-123",
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              );
            }) as typeof fetch;
            try {
              const response = await previousFetch(
                `${baseUrl}/broker-execution/snaptrade/connection-portal`,
                {
                  method: "POST",
                  headers: {
                    cookie,
                    "content-type": "application/json",
                    [AUTH_CSRF_HEADER]: bootstrapBody.csrfToken,
                  },
                  body: JSON.stringify({ broker: "INTERACTIVE-BROKERS-FLEX" }),
                },
              );
              assert.equal(response.status, 200);
              const bodyText = await response.text();
              const body = JSON.parse(bodyText) as {
                provider: string;
                redirectUri: string;
                sessionId: string;
                expiresAt: string;
                requestedConnectionType: string;
                connectionPortalVersion: string;
                broker: string | null;
                reconnect: string | null;
              };

              assert.equal(requestedUrls.length, 1);
              const requestUrl = new URL(requestedUrls[0] ?? "");
              assert.equal(requestUrl.origin, "https://api.snaptrade.com");
              assert.equal(requestUrl.pathname, "/api/v1/snapTrade/login");
              assert.equal(requestUrl.searchParams.get("clientId"), "client-123");
              assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
              assert.equal(
                requestUrl.searchParams.get("userSecret"),
                "snaptrade-user-secret",
              );
              assert.doesNotMatch(requestedUrls[0] ?? "", /consumer-secret/);
              assert.deepEqual(JSON.parse(requestedBodies[0] ?? "{}"), {
                broker: "INTERACTIVE-BROKERS-FLEX",
                connectionType: "trade-if-available",
                connectionPortalVersion: "v4",
                showCloseButton: true,
              });
              assert.equal(body.provider, "snaptrade");
              assert.equal(
                body.redirectUri,
                "https://app.snaptrade.com/snapTrade/redeemToken?token=portal-token&sessionId=session-123",
              );
              assert.equal(body.sessionId, "session-123");
              assert.equal(body.requestedConnectionType, "trade-if-available");
              assert.equal(body.connectionPortalVersion, "v4");
              assert.equal(body.broker, "INTERACTIVE-BROKERS-FLEX");
              assert.equal(body.reconnect, null);
              assert.equal(typeof body.expiresAt, "string");
              assert.doesNotMatch(
                bodyText,
                /consumer-secret|snaptrade-user-secret|pyrus-/,
              );
            } finally {
              globalThis.fetch = previousFetch;
            }
          }),
        ),
      ),
    ),
  );
});

test("SnapTrade equity submit route requires CSRF before provider calls", async () => {
  await withBootstrapToken(async () =>
    withSnapTradeEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async () =>
          withServer(async (baseUrl) => {
            const previousFetch = globalThis.fetch;
            let called = false;
            const bootstrapResponse = await previousFetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";

            globalThis.fetch = (async () => {
              called = true;
              throw new Error("fetch should not run");
            }) as typeof fetch;
            try {
              const response = await previousFetch(
                `${baseUrl}/broker-execution/snaptrade/accounts/local-account-id/orders`,
                {
                  method: "POST",
                  headers: {
                    cookie,
                    "content-type": "application/json",
                  },
                  body: JSON.stringify({
                    confirm: true,
                    action: "BUY",
                    symbol: "AAPL",
                    orderType: "Market",
                    timeInForce: "Day",
                    units: 1,
                  }),
                },
              );

              assert.equal(response.status, 403);
              assert.equal(called, false);
            } finally {
              globalThis.fetch = previousFetch;
            }
          }),
        ),
      ),
    ),
  );
});

test("SnapTrade equity submit route places a sanitized confirmed order", async () => {
  await withBootstrapToken(async () =>
    withSnapTradeEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async ({ db }) =>
          withServer(async (baseUrl) => {
            const previousFetch = globalThis.fetch;
            const bootstrapResponse = await previousFetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";
            const bootstrapBody = (await bootstrapResponse.json()) as AuthRouteBody;
            const snapTradeUserId = deriveSnapTradeUserId(bootstrapBody.user.id);
            await recordSnapTradeUserCredential({
              appUserId: bootstrapBody.user.id,
              snapTradeUserId,
              userSecret: "snaptrade-user-secret",
              encryptionKey: TEST_ENCRYPTION_KEY,
              now: new Date("2026-07-01T18:45:00.000Z"),
            });

            const [connection] = await db
              .insert(brokerConnectionsTable)
              .values({
                appUserId: bootstrapBody.user.id,
                name: "snaptrade:route-submit-connection",
                connectionType: "broker",
                brokerProvider: "snaptrade",
                mode: "live",
                status: "connected",
                capabilities: ["accounts", "positions", "snaptrade", "orders"],
              })
              .returning({ id: brokerConnectionsTable.id });
            const [account] = await db
              .insert(brokerAccountsTable)
              .values({
                appUserId: bootstrapBody.user.id,
                connectionId: connection.id,
                providerAccountId: "snaptrade:acct-route-submit",
                displayName: "Main IBKR",
                mode: "live",
                accountStatus: "open",
                baseCurrency: "USD",
                capabilities: [
                  "accounts",
                  "positions",
                  "snaptrade",
                  "orders",
                  "executions",
                  "execution-ready",
                ],
                executionBlockers: [],
                lastSyncedAt: "2026-07-01T19:10:00.000Z",
              })
              .returning({ id: brokerAccountsTable.id });

            const requestedUrls: string[] = [];
            const requestedBodies: string[] = [];
            globalThis.fetch = (async (url, init) => {
              requestedUrls.push(String(url));
              requestedBodies.push(String(init?.body ?? ""));
              const requestUrl = new URL(String(url));
              assert.equal(requestUrl.pathname, "/api/v1/trade/place");
              assert.equal(requestUrl.searchParams.get("clientId"), "client-123");
              assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
              assert.equal(
                requestUrl.searchParams.get("userSecret"),
                "snaptrade-user-secret",
              );
              assert.equal(init?.method, "POST");
              assert.ok(
                (new Headers(init?.headers).get("Signature") ?? "").length > 20,
              );
              return new Response(
                JSON.stringify({
                  brokerage_order_id: "broker-order-route-1",
                  status: "ACCEPTED",
                  universal_symbol: {
                    id: "2bcd7cc3-e922-4976-bce1-9858296801c3",
                    symbol: "AAPL",
                    raw_symbol: "AAPL",
                  },
                  action: "BUY",
                  order_type: "Market",
                  time_in_force: "Day",
                  units: 1,
                  account: {
                    id: "acct-route-submit",
                    number: "U9999999",
                  },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              );
            }) as typeof fetch;
            try {
              const response = await previousFetch(
                `${baseUrl}/broker-execution/snaptrade/accounts/${account.id}/orders`,
                {
                  method: "POST",
                  headers: {
                    cookie,
                    "content-type": "application/json",
                    [AUTH_CSRF_HEADER]: bootstrapBody.csrfToken,
                  },
                  body: JSON.stringify({
                    confirm: true,
                    action: "BUY",
                    symbol: "AAPL",
                    orderType: "Market",
                    timeInForce: "Day",
                    units: 1,
                  }),
                },
              );
              assert.equal(response.status, 200);
              const bodyText = await response.text();
              const body = JSON.parse(bodyText) as {
                provider: string;
                account: { id: string; snapTradeAccountId: string };
                order: {
                  brokerageOrderId: string | null;
                  status: string;
                  symbol: string | null;
                  units: number | null;
                };
              };

              assert.equal(requestedUrls.length, 1);
              assert.deepEqual(JSON.parse(requestedBodies[0] ?? "{}"), {
                account_id: "acct-route-submit",
                action: "BUY",
                universal_symbol_id: null,
                symbol: "AAPL",
                order_type: "Market",
                time_in_force: "Day",
                trading_session: "REGULAR",
                expiry_date: null,
                price: null,
                stop: null,
                units: 1,
                notional_value: null,
                client_order_id: null,
              });
              assert.equal(body.provider, "snaptrade");
              assert.equal(body.account.id, account.id);
              assert.equal(body.account.snapTradeAccountId, "acct-route-submit");
              assert.equal(body.order.brokerageOrderId, "broker-order-route-1");
              assert.equal(body.order.status, "ACCEPTED");
              assert.equal(body.order.symbol, "AAPL");
              assert.equal(body.order.units, 1);
              assert.doesNotMatch(
                bodyText,
                /consumer-secret|snaptrade-user-secret|client-123|U9999999|pyrus-/,
              );
            } finally {
              globalThis.fetch = previousFetch;
            }
          }),
        ),
      ),
    ),
  );
});

function schwabProviderFetch(payloads: {
  accountNumbers: unknown;
  accounts: unknown;
}): typeof fetch {
  return async (url, init) => {
    const requestUrl = new URL(String(url));
    if (
      requestUrl.origin === "https://api.schwabapi.com" &&
      requestUrl.pathname === "/v1/oauth/token"
    ) {
      assert.equal(init?.method, "POST");
      assert.ok((new Headers(init?.headers).get("Authorization") ?? "").startsWith("Basic "));
      return new Response(
        JSON.stringify({
          access_token: "schwab-access-1",
          refresh_token: "schwab-refresh-1",
          expires_in: 1800,
          scope: "api",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (
      requestUrl.origin === "https://api.schwabapi.com" &&
      requestUrl.pathname === "/trader/v1/accounts/accountNumbers"
    ) {
      return new Response(JSON.stringify(payloads.accountNumbers), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (
      requestUrl.origin === "https://api.schwabapi.com" &&
      requestUrl.pathname === "/trader/v1/accounts"
    ) {
      return new Response(JSON.stringify(payloads.accounts), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected Schwab fetch: ${requestUrl.toString()}`);
  };
}

const SCHWAB_ONE_ACCOUNT_NUMBERS = [
  { accountNumber: "12345678", hashValue: "ABC123HASH" },
];
const SCHWAB_ONE_ACCOUNT = [
  { securitiesAccount: { accountNumber: "12345678", type: "MARGIN" } },
];

test("Schwab readiness route requires authentication before returning status", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/broker-execution/schwab/readiness`);
    assert.equal(response.status, 401);
  });
});

test("Schwab readiness route returns sanitized readiness status for authenticated users", async () => {
  await withBootstrapToken(async () =>
    withSchwabEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async () =>
          withServer(async (baseUrl) => {
            const bootstrapResponse = await fetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";

            const response = await fetch(
              `${baseUrl}/broker-execution/schwab/readiness`,
              { headers: { cookie } },
            );
            assert.equal(response.status, 200);
            const bodyText = await response.text();
            const body = JSON.parse(bodyText) as {
              provider: string;
              configured: boolean;
              status: string;
              user: {
                connected: boolean;
                status: string;
                nextAction: string;
                executionBlockers: string[];
              };
            };

            assert.equal(body.provider, "schwab");
            assert.equal(body.configured, true);
            assert.equal(body.status, "research_required");
            assert.equal(body.user.connected, false);
            assert.equal(body.user.status, "not_connected");
            assert.equal(body.user.nextAction, "start_connect");
            assert.deepEqual(body.user.executionBlockers, []);
            assert.doesNotMatch(bodyText, /app-key-abc|app-secret-xyz/);
          }),
        ),
      ),
    ),
  );
});

test("Schwab readiness route flags broker_reauth when user refresh token is near expiry", async () => {
  await withBootstrapToken(async () =>
    withSchwabEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async () =>
          withServer(async (baseUrl) => {
            const now = new Date("2026-07-02T18:00:00.000Z");
            const bootstrapResponse = await fetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";
            const bootstrapBody = (await bootstrapResponse.json()) as AuthRouteBody;

            await beginSchwabConnectCustody({
              appUserId: bootstrapBody.user.id,
              oauthState: "state-1",
              encryptionKey: TEST_ENCRYPTION_KEY,
              now,
            });
            await storeSchwabTokens({
              appUserId: bootstrapBody.user.id,
              accessToken: "fresh-access",
              refreshToken: "refresh-1",
              accessTokenExpiresAt: new Date(now.getTime() + 1_800_000),
              refreshTokenExpiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000),
              scope: "api",
              encryptionKey: TEST_ENCRYPTION_KEY,
              now,
            });

            const response = await fetch(
              `${baseUrl}/broker-execution/schwab/readiness`,
              { headers: { cookie } },
            );
            assert.equal(response.status, 200);
            const bodyText = await response.text();
            const body = JSON.parse(bodyText) as {
              user: {
                connected: boolean;
                status: string;
                nextAction: string;
                executionBlockers: string[];
              };
            };

            assert.equal(body.user.connected, true);
            assert.equal(body.user.status, "connected");
            assert.equal(body.user.nextAction, "reconnect");
            assert.deepEqual(body.user.executionBlockers, ["broker_reauth"]);
            assert.doesNotMatch(bodyText, /fresh-access|refresh-1|app-secret-xyz/);
          }),
        ),
      ),
    ),
  );
});

test("Schwab connect route requires CSRF before starting OAuth", async () => {
  await withBootstrapToken(async () =>
    withSchwabEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async () =>
          withServer(async (baseUrl) => {
            const bootstrapResponse = await fetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";

            const response = await fetch(
              `${baseUrl}/broker-execution/schwab/connect`,
              { method: "POST", headers: { cookie } },
            );
            assert.equal(response.status, 403);
          }),
        ),
      ),
    ),
  );
});

test("Schwab connect route returns an authorization URL", async () => {
  await withBootstrapToken(async () =>
    withSchwabEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async () =>
          withServer(async (baseUrl) => {
            const bootstrapResponse = await fetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";
            const bootstrapBody = (await bootstrapResponse.json()) as AuthRouteBody;

            const response = await fetch(
              `${baseUrl}/broker-execution/schwab/connect`,
              {
                method: "POST",
                headers: { cookie, [AUTH_CSRF_HEADER]: bootstrapBody.csrfToken },
              },
            );
            assert.equal(response.status, 200);
            const bodyText = await response.text();
            const body = JSON.parse(bodyText) as {
              provider: string;
              authorizationUrl: string;
              state: string;
              redirectUri: string;
            };

            assert.equal(body.provider, "schwab");
            const authorizationUrl = new URL(body.authorizationUrl);
            assert.equal(
              `${authorizationUrl.origin}${authorizationUrl.pathname}`,
              "https://api.schwabapi.com/v1/oauth/authorize",
            );
            assert.equal(authorizationUrl.searchParams.get("client_id"), "app-key-abc");
            assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
            assert.equal(authorizationUrl.searchParams.get("scope"), "api");
            assert.equal(authorizationUrl.searchParams.get("state"), body.state);
            assert.equal(
              body.redirectUri,
              "https://pyrus.example/api/broker-execution/schwab/oauth/callback",
            );
            assert.doesNotMatch(bodyText, /app-secret-xyz/);
          }),
        ),
      ),
    ),
  );
});

test("Schwab oauth callback redirects to schwab=denied when consent is denied or params are missing", async () => {
  await withBootstrapToken(async () =>
    withSchwabEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async () =>
          withServer(async (baseUrl) => {
            const bootstrapResponse = await fetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";

            const denied = await fetch(
              `${baseUrl}/broker-execution/schwab/oauth/callback?error=access_denied`,
              { headers: { cookie }, redirect: "manual" },
            );
            assert.equal(denied.status, 302);
            assert.equal(
              denied.headers.get("location"),
              "/?screen=settings&schwab=denied",
            );

            const missingParams = await fetch(
              `${baseUrl}/broker-execution/schwab/oauth/callback`,
              { headers: { cookie }, redirect: "manual" },
            );
            assert.equal(missingParams.status, 302);
            assert.equal(
              missingParams.headers.get("location"),
              "/?screen=settings&schwab=denied",
            );
          }),
        ),
      ),
    ),
  );
});

test("Schwab oauth callback completes the connection and redirects to schwab=connected", async () => {
  await withBootstrapToken(async () =>
    withSchwabEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async () =>
          withServer(async (baseUrl) => {
            const previousFetch = globalThis.fetch;
            const bootstrapResponse = await previousFetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";
            const bootstrapBody = (await bootstrapResponse.json()) as AuthRouteBody;

            const connectResponse = await previousFetch(
              `${baseUrl}/broker-execution/schwab/connect`,
              {
                method: "POST",
                headers: { cookie, [AUTH_CSRF_HEADER]: bootstrapBody.csrfToken },
              },
            );
            assert.equal(connectResponse.status, 200);
            const connectBody = (await connectResponse.json()) as { state: string };

            globalThis.fetch = schwabProviderFetch({
              accountNumbers: SCHWAB_ONE_ACCOUNT_NUMBERS,
              accounts: SCHWAB_ONE_ACCOUNT,
            }) as typeof fetch;
            try {
              const callback = await previousFetch(
                `${baseUrl}/broker-execution/schwab/oauth/callback?code=auth-code-1&state=${connectBody.state}`,
                { headers: { cookie }, redirect: "manual" },
              );
              assert.equal(callback.status, 302);
              assert.equal(
                callback.headers.get("location"),
                "/?screen=settings&schwab=connected",
              );
            } finally {
              globalThis.fetch = previousFetch;
            }
          }),
        ),
      ),
    ),
  );
});

test("Schwab oauth callback redirects to schwab=error when the exchange fails", async () => {
  await withBootstrapToken(async () =>
    withSchwabEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async () =>
          withServer(async (baseUrl) => {
            const bootstrapResponse = await fetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";

            // No connect was ever started, so this state can never be pending.
            const callback = await fetch(
              `${baseUrl}/broker-execution/schwab/oauth/callback?code=auth-code-1&state=never-issued-state`,
              { headers: { cookie }, redirect: "manual" },
            );
            assert.equal(callback.status, 302);
            assert.equal(
              callback.headers.get("location"),
              "/?screen=settings&schwab=error",
            );
          }),
        ),
      ),
    ),
  );
});

test("Schwab sync route requires CSRF before syncing", async () => {
  await withBootstrapToken(async () =>
    withSchwabEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async () =>
          withServer(async (baseUrl) => {
            const bootstrapResponse = await fetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";

            const response = await fetch(`${baseUrl}/broker-execution/schwab/sync`, {
              method: "POST",
              headers: { cookie },
            });
            assert.equal(response.status, 403);
          }),
        ),
      ),
    ),
  );
});

test("Schwab sync route returns sanitized synced Schwab accounts", async () => {
  await withBootstrapToken(async () =>
    withSchwabEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async () =>
          withServer(async (baseUrl) => {
            const previousFetch = globalThis.fetch;
            const bootstrapResponse = await previousFetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";
            const bootstrapBody = (await bootstrapResponse.json()) as AuthRouteBody;

            const connectResponse = await previousFetch(
              `${baseUrl}/broker-execution/schwab/connect`,
              {
                method: "POST",
                headers: { cookie, [AUTH_CSRF_HEADER]: bootstrapBody.csrfToken },
              },
            );
            assert.equal(connectResponse.status, 200);
            const connectBody = (await connectResponse.json()) as { state: string };

            globalThis.fetch = schwabProviderFetch({
              accountNumbers: SCHWAB_ONE_ACCOUNT_NUMBERS,
              accounts: SCHWAB_ONE_ACCOUNT,
            }) as typeof fetch;
            try {
              const callback = await previousFetch(
                `${baseUrl}/broker-execution/schwab/oauth/callback?code=auth-code-1&state=${connectBody.state}`,
                { headers: { cookie }, redirect: "manual" },
              );
              assert.equal(callback.status, 302);

              const response = await previousFetch(
                `${baseUrl}/broker-execution/schwab/sync`,
                {
                  method: "POST",
                  headers: { cookie, [AUTH_CSRF_HEADER]: bootstrapBody.csrfToken },
                },
              );
              assert.equal(response.status, 200);
              const bodyText = await response.text();
              const body = JSON.parse(bodyText) as {
                provider: string;
                connections: Array<{
                  provider: string;
                  executionReady: boolean;
                  executionBlockers: string[];
                  accountCount: number;
                }>;
                accounts: Array<{
                  schwabAccountHash: string;
                  displayName: string;
                  executionReady: boolean;
                  executionBlockers: string[];
                }>;
                totals: {
                  upstreamAccounts: number;
                  storedConnections: number;
                  storedAccounts: number;
                };
              };

              assert.equal(body.provider, "schwab");
              assert.equal(body.connections.length, 1);
              assert.equal(body.connections[0]?.executionReady, false);
              assert.ok(
                body.connections[0]?.executionBlockers.includes(
                  "schwab.order_tooling_unverified",
                ),
              );
              assert.equal(body.accounts.length, 1);
              assert.equal(body.accounts[0]?.schwabAccountHash, "ABC123HASH");
              assert.equal(body.accounts[0]?.executionReady, false);
              assert.ok(!body.accounts[0]?.displayName.includes("12345678"));
              assert.ok(body.accounts[0]?.displayName.includes("...5678"));
              assert.deepEqual(body.totals, {
                upstreamAccounts: 1,
                storedConnections: 1,
                storedAccounts: 1,
              });
              assert.doesNotMatch(bodyText, /12345678|app-secret-xyz/);
            } finally {
              globalThis.fetch = previousFetch;
            }
          }),
        ),
      ),
    ),
  );
});

test("Schwab equity order routes require CSRF before order handling", async () => {
  await withBootstrapToken(async () =>
    withSchwabEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async () =>
          withServer(async (baseUrl) => {
            const previousFetch = globalThis.fetch;
            let called = false;
            const bootstrapResponse = await previousFetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";

            globalThis.fetch = (async () => {
              called = true;
              throw new Error("fetch should not run");
            }) as typeof fetch;
            try {
              for (const path of [
                "/broker-execution/schwab/accounts/local-account-id/orders/preview",
                "/broker-execution/schwab/accounts/local-account-id/orders",
                "/broker-execution/schwab/accounts/local-account-id/orders/cancel",
              ]) {
                const response = await previousFetch(`${baseUrl}${path}`, {
                  method: "POST",
                  headers: {
                    cookie,
                    "content-type": "application/json",
                  },
                  body: JSON.stringify({
                    confirm: true,
                    orderId: "order-1",
                    symbol: "AAPL",
                    action: "BUY",
                    quantity: 1,
                    orderType: "Market",
                    timeInForce: "Day",
                  }),
                });
                assert.equal(response.status, 403);
              }
              assert.equal(called, false);
            } finally {
              globalThis.fetch = previousFetch;
            }
          }),
        ),
      ),
    ),
  );
});

test("Schwab equity order routes stay blocked behind execution readiness", async () => {
  await withBootstrapToken(async () =>
    withSchwabEnv(async () =>
      withCredentialEncryptionEnv(async () =>
        withTestDb(async ({ db }) =>
          withServer(async (baseUrl) => {
            const previousFetch = globalThis.fetch;
            let called = false;
            const bootstrapResponse = await previousFetch(`${baseUrl}/auth/bootstrap`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.com",
                password: "correct horse battery staple",
                bootstrapToken: "setup-token",
              }),
            });
            assert.equal(bootstrapResponse.status, 200);
            const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";
            const bootstrapBody = (await bootstrapResponse.json()) as AuthRouteBody;

            const [connection] = await db
              .insert(brokerConnectionsTable)
              .values({
                appUserId: bootstrapBody.user.id,
                name: "schwab:route-order-connection",
                connectionType: "broker",
                brokerProvider: "schwab",
                mode: "live",
                status: "connected",
                capabilities: ["accounts", "positions", "schwab"],
              })
              .returning({ id: brokerConnectionsTable.id });
            const [account] = await db
              .insert(brokerAccountsTable)
              .values({
                appUserId: bootstrapBody.user.id,
                connectionId: connection.id,
                providerAccountId: "schwab:ABC123HASH",
                displayName: "Schwab ...5678",
                mode: "live",
                accountStatus: "open",
                baseCurrency: "USD",
                capabilities: ["accounts", "positions", "schwab"],
                executionBlockers: ["schwab.order_tooling_unverified"],
                lastSyncedAt: "2026-07-06T17:10:00.000Z",
              })
              .returning({ id: brokerAccountsTable.id });

            globalThis.fetch = (async () => {
              called = true;
              throw new Error("fetch should not run while execution is blocked");
            }) as typeof fetch;
            try {
              const requests = [
                {
                  path: `/broker-execution/schwab/accounts/${account.id}/orders/preview`,
                  body: {
                    symbol: "AAPL",
                    action: "BUY",
                    quantity: 1,
                    orderType: "Market",
                    timeInForce: "Day",
                  },
                },
                {
                  path: `/broker-execution/schwab/accounts/${account.id}/orders`,
                  body: {
                    confirm: true,
                    symbol: "AAPL",
                    action: "BUY",
                    quantity: 1,
                    orderType: "Market",
                    timeInForce: "Day",
                  },
                },
                {
                  path: `/broker-execution/schwab/accounts/${account.id}/orders/cancel`,
                  body: { orderId: "schwab-order-1" },
                },
              ];

              for (const request of requests) {
                const response = await previousFetch(`${baseUrl}${request.path}`, {
                  method: "POST",
                  headers: {
                    cookie,
                    "content-type": "application/json",
                    [AUTH_CSRF_HEADER]: bootstrapBody.csrfToken,
                  },
                  body: JSON.stringify(request.body),
                });
                assert.equal(response.status, 409);
                const text = await response.text();
                assert.match(text, /schwab_account_execution_blocked/);
                assert.doesNotMatch(text, /ABC123HASH|app-secret-xyz|schwab-access/);
              }
              assert.equal(called, false);
            } finally {
              globalThis.fetch = previousFetch;
            }
          }),
        ),
      ),
    ),
  );
});
