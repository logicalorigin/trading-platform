import express, {
  Router,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";

import { HttpError } from "../lib/errors";
import { createIbkrGatewayHostRequestVerifier } from "../services/ibkr-gateway-host-auth";
import {
  heartbeatIbkrGatewayHost,
  registerIbkrGatewayHost,
} from "../services/ibkr-gateway-session-store";
import { noteIbkrGatewayFleetHostReady } from "../services/ibkr-portal-gateway-manager";

export const IBKR_GATEWAY_HOSTS_MOUNT =
  "/api/internal/ibkr/gateway-hosts";

const identityDigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const sha256DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const capsuleLeaseProtocolVersionSchema = z.union([
  z.literal(0),
  z.literal(1),
]);
const registrationBodySchema = z
  .object({
    workloadIdentityDigest: identityDigestSchema,
    controlOrigin: z.string().min(1).max(2_048),
    imageDigest: sha256DigestSchema,
    runtimeSpecDigest: sha256DigestSchema,
    runtimeAttestationDigest: sha256DigestSchema,
    capsuleLeaseProtocolVersion: capsuleLeaseProtocolVersionSchema,
    failureDomain: z.string().min(1).max(128),
    measuredSlotCapacity: z.number().int().min(1).max(20),
  })
  .strict();
const heartbeatBodySchema = z
  .object({
    verifiedWorkloadIdentityDigest: identityDigestSchema,
    runtimeAttestationDigest: sha256DigestSchema,
  })
  .strict();

type LifecycleHost = {
  heartbeatExpiresAt: Date;
  id: string;
  status: string;
};

type LifecycleRouteDependencies = {
  heartbeatHost: (
    input: z.infer<typeof heartbeatBodySchema> & { hostId: string },
  ) => Promise<LifecycleHost | null>;
  registerHost: (
    input: z.infer<typeof registrationBodySchema> & { hostId: string },
  ) => Promise<LifecycleHost | null>;
  onHostReady: (hostId: string) => void;
  verifyRequest: ReturnType<typeof createIbkrGatewayHostRequestVerifier>;
};

function invalidRequest(message = "Invalid host lifecycle request."): HttpError {
  return new HttpError(400, message, {
    code: "ibkr_gateway_host_request_invalid",
  });
}

function parseBody<T>(req: Request, schema: z.ZodType<T>): T {
  if (!req.is("application/json")) {
    throw new HttpError(415, "Unsupported media type", {
      code: "ibkr_gateway_host_media_type_unsupported",
    });
  }
  if (!Buffer.isBuffer(req.body)) throw invalidRequest();

  let value: unknown;
  try {
    value = JSON.parse(req.body.toString("utf8"));
  } catch {
    throw invalidRequest();
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidRequest();
  return parsed.data;
}

function hostIdFrom(req: Request): string {
  const hostId = req.params["hostId"];
  return typeof hostId === "string" ? hostId : "";
}

function requireHostAuthentication(
  req: Request,
  hostId: string,
  verifyRequest: LifecycleRouteDependencies["verifyRequest"],
): void {
  if (
    !verifyRequest({
      body: Buffer.isBuffer(req.body) ? req.body : undefined,
      headers: req.headers,
      hostId,
      method: req.method,
      path: req.originalUrl,
    })
  ) {
    throw new HttpError(401, "Invalid host credentials", {
      code: "ibkr_gateway_host_auth_invalid",
    });
  }
}

function sendHostState(res: Response, host: LifecycleHost): void {
  res.json({
    hostId: host.id,
    status: host.status,
    heartbeatExpiresAt: host.heartbeatExpiresAt.toISOString(),
  });
}

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void handler(req, res).catch(next);
  };
}

export function createIbkrGatewayHostLifecycleRouter(
  dependencies: Partial<LifecycleRouteDependencies> = {},
): Router {
  const heartbeatHost =
    dependencies.heartbeatHost ?? heartbeatIbkrGatewayHost;
  const onHostReady =
    dependencies.onHostReady ?? noteIbkrGatewayFleetHostReady;
  const registerHost = dependencies.registerHost ?? registerIbkrGatewayHost;
  const verifyRequest =
    dependencies.verifyRequest ?? createIbkrGatewayHostRequestVerifier();
  const router = Router();

  router.post(
    "/:hostId/register",
    asyncRoute(async (req, res) => {
      const hostId = hostIdFrom(req);
      requireHostAuthentication(req, hostId, verifyRequest);
      const body = parseBody(req, registrationBodySchema);
      const host = await registerHost({ hostId, ...body });
      if (!host || host.id !== hostId) {
        throw new HttpError(409, "Host registration rejected", {
          code: "ibkr_gateway_host_registration_rejected",
        });
      }
      onHostReady(hostId);
      sendHostState(res, host);
    }),
  );

  router.post(
    "/:hostId/heartbeat",
    asyncRoute(async (req, res) => {
      const hostId = hostIdFrom(req);
      requireHostAuthentication(req, hostId, verifyRequest);
      const body = parseBody(req, heartbeatBodySchema);
      const host = await heartbeatHost({ hostId, ...body });
      if (!host || host.id !== hostId) {
        throw new HttpError(409, "Host heartbeat rejected", {
          code: "ibkr_gateway_host_heartbeat_rejected",
        });
      }
      onHostReady(hostId);
      sendHostState(res, host);
    }),
  );

  router.use((_req, res) => {
    res.status(404).type("application/problem+json").json({
      type: "https://pyrus.local/problems/not-found",
      title: "Not found",
      status: 404,
    });
  });
  return router;
}

export function mountIbkrGatewayHostLifecycleRoutes(
  app: Express,
  dependencies: Partial<LifecycleRouteDependencies> = {},
): void {
  app.use(
    IBKR_GATEWAY_HOSTS_MOUNT,
    express.raw({ type: "application/json", limit: "16kb" }),
    createIbkrGatewayHostLifecycleRouter(dependencies),
  );
}
