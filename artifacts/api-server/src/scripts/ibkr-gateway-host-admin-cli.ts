import { parseArgs as parseNodeArgs } from "node:util";

const HOST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IDENTITY_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const IBKR_GATEWAY_HOST_ADMIN_USAGE = `Usage:
  ibkr-gateway-host-admin inspect --host-id=UUID
  ibkr-gateway-host-admin approve --host-id=UUID --workload-identity-digest=HEX --image-digest=SHA256 --runtime-spec-digest=SHA256 --runtime-attestation-digest=SHA256 --capsule-lease-protocol-version=0|1 --admission-slot-capacity=1..20 --execute
  ibkr-gateway-host-admin drain --host-id=UUID --execute
  ibkr-gateway-host-admin quarantine --host-id=UUID --execute`;

type HostStatus = "active" | "draining" | "quarantined";

export type OperatorHost = {
  admissionSlotCapacity: number;
  capsuleLeaseProtocolVersion: number;
  controlOrigin: string;
  failureDomain: string;
  heartbeatExpiresAt: Date;
  id: string;
  imageDigest: string;
  lastHeartbeatAt: Date;
  measuredSlotCapacity: number;
  runtimeAttestationDigest: string;
  runtimeSpecDigest: string;
  status: HostStatus;
  workloadIdentityDigest: string;
};

type OperatorHostState = {
  activeLeaseCount: number;
  host: OperatorHost;
};

type ApprovalInput = {
  admissionSlotCapacity: number;
  capsuleLeaseProtocolVersion: 0 | 1;
  hostId: string;
  imageDigest: string;
  runtimeAttestationDigest: string;
  runtimeSpecDigest: string;
  workloadIdentityDigest: string;
};

export type IbkrGatewayHostAdminDependencies = {
  approveHost: (input: ApprovalInput) => Promise<OperatorHost | null>;
  disableHost: (
    hostId: string,
    status: "draining" | "quarantined",
  ) => Promise<OperatorHost | null>;
  readHost: (hostId: string) => Promise<OperatorHostState | null>;
};

export type IbkrGatewayHostAdminCommand =
  | { action: "inspect"; hostId: string }
  | ({ action: "approve" } & ApprovalInput)
  | { action: "drain" | "quarantine"; hostId: string };

type ParsedAdminArgs = {
  positionals: string[];
  tokens: Array<{ kind: string; name?: string }>;
  values: Record<string, boolean | string | undefined>;
};

function invalidUsage(): never {
  throw new Error(IBKR_GATEWAY_HOST_ADMIN_USAGE);
}

function canonicalCapacity(value: string | undefined): number {
  if (!value || !/^(?:[1-9]|1[0-9]|20)$/.test(value)) invalidUsage();
  return Number(value);
}

function canonicalLeaseProtocolVersion(
  value: string | undefined,
): 0 | 1 {
  if (value !== "0" && value !== "1") invalidUsage();
  return Number(value) as 0 | 1;
}

export function parseIbkrGatewayHostAdminArgs(
  args: string[],
): IbkrGatewayHostAdminCommand | null {
  let parsed: ParsedAdminArgs;
  try {
    parsed = parseNodeArgs({
      args,
      allowPositionals: true,
      strict: true,
      tokens: true,
      options: {
        "admission-slot-capacity": { type: "string" },
        "capsule-lease-protocol-version": { type: "string" },
        execute: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        "host-id": { type: "string" },
        "image-digest": { type: "string" },
        "runtime-attestation-digest": { type: "string" },
        "runtime-spec-digest": { type: "string" },
        "workload-identity-digest": { type: "string" },
      },
    }) as ParsedAdminArgs;
  } catch {
    invalidUsage();
  }

  const optionCounts = new Map<string, number>();
  for (const token of parsed.tokens) {
    if (token.kind !== "option") continue;
    if (!token.name) invalidUsage();
    optionCounts.set(token.name, (optionCounts.get(token.name) ?? 0) + 1);
  }
  if ([...optionCounts.values()].some((count) => count > 1)) invalidUsage();
  if (parsed.values.help === true) {
    if (args.length !== 1) invalidUsage();
    return null;
  }
  if (parsed.positionals.length !== 1) invalidUsage();

  const action = parsed.positionals[0];
  const hostId = parsed.values["host-id"];
  if (typeof hostId !== "string" || !HOST_ID_PATTERN.test(hostId)) {
    invalidUsage();
  }
  const supplied = new Set(
    Object.entries(parsed.values)
      .filter(([, value]) => value !== undefined && value !== false)
      .map(([name]) => name),
  );
  const exactOptions = (...names: string[]) =>
    supplied.size === names.length && names.every((name) => supplied.has(name));

  if (action === "inspect") {
    if (!exactOptions("host-id")) invalidUsage();
    return { action, hostId };
  }
  if (action === "drain" || action === "quarantine") {
    if (!exactOptions("host-id", "execute") || parsed.values.execute !== true) {
      invalidUsage();
    }
    return { action, hostId };
  }
  if (action !== "approve") invalidUsage();

  const workloadIdentityDigest = parsed.values["workload-identity-digest"];
  const imageDigest = parsed.values["image-digest"];
  const runtimeSpecDigest = parsed.values["runtime-spec-digest"];
  const runtimeAttestationDigest =
    parsed.values["runtime-attestation-digest"];
  const capsuleLeaseProtocolVersion =
    parsed.values["capsule-lease-protocol-version"];
  const admissionSlotCapacity =
    parsed.values["admission-slot-capacity"];
  if (
    !exactOptions(
      "host-id",
      "workload-identity-digest",
      "image-digest",
      "runtime-spec-digest",
      "runtime-attestation-digest",
      "capsule-lease-protocol-version",
      "admission-slot-capacity",
      "execute",
    ) ||
    parsed.values.execute !== true ||
    typeof workloadIdentityDigest !== "string" ||
    !IDENTITY_DIGEST_PATTERN.test(workloadIdentityDigest) ||
    typeof imageDigest !== "string" ||
    !SHA256_DIGEST_PATTERN.test(imageDigest) ||
    typeof runtimeSpecDigest !== "string" ||
    !SHA256_DIGEST_PATTERN.test(runtimeSpecDigest) ||
    typeof runtimeAttestationDigest !== "string" ||
    !SHA256_DIGEST_PATTERN.test(runtimeAttestationDigest) ||
    typeof capsuleLeaseProtocolVersion !== "string" ||
    typeof admissionSlotCapacity !== "string"
  ) {
    invalidUsage();
  }
  return {
    action,
    admissionSlotCapacity: canonicalCapacity(admissionSlotCapacity),
    capsuleLeaseProtocolVersion: canonicalLeaseProtocolVersion(
      capsuleLeaseProtocolVersion,
    ),
    hostId,
    imageDigest,
    runtimeAttestationDigest,
    runtimeSpecDigest,
    workloadIdentityDigest,
  };
}

function operatorView(state: OperatorHostState, now: Date) {
  const { host } = state;
  return {
    admissionSlotCapacity: host.admissionSlotCapacity,
    activeLeaseCount: state.activeLeaseCount,
    capsuleLeaseProtocolVersion: host.capsuleLeaseProtocolVersion,
    controlOrigin: host.controlOrigin,
    failureDomain: host.failureDomain,
    heartbeatExpiresAt: host.heartbeatExpiresAt.toISOString(),
    heartbeatFresh: host.heartbeatExpiresAt.getTime() > now.getTime(),
    hostId: host.id,
    imageDigest: host.imageDigest,
    lastHeartbeatAt: host.lastHeartbeatAt.toISOString(),
    measuredSlotCapacity: host.measuredSlotCapacity,
    runtimeAttestationDigest: host.runtimeAttestationDigest,
    runtimeSpecDigest: host.runtimeSpecDigest,
    status: host.status,
    workloadIdentityDigest: host.workloadIdentityDigest,
  };
}

export async function runIbkrGatewayHostAdminCommand(
  command: IbkrGatewayHostAdminCommand,
  dependencies: IbkrGatewayHostAdminDependencies,
  options: {
    now?: () => Date;
    write?: (line: string) => void;
  } = {},
): Promise<boolean> {
  const now = options.now?.() ?? new Date();
  const write = options.write ?? ((line) => process.stdout.write(`${line}\n`));

  let result: OperatorHost | null = null;
  if (command.action === "inspect") {
    const state = await dependencies.readHost(command.hostId);
    if (!state) throw new Error("IBKR gateway host preconditions failed.");
    write(
      JSON.stringify({
        type: "ibkr_gateway_host_inspection",
        host: operatorView(state, now),
      }),
    );
    return true;
  } else if (command.action === "approve") {
    const { action: _action, ...input } = command;
    result = await dependencies.approveHost(input);
  } else {
    result = await dependencies.disableHost(
      command.hostId,
      command.action === "drain" ? "draining" : "quarantined",
    );
  }
  if (!result) throw new Error("IBKR gateway host preconditions failed.");
  const state = await dependencies.readHost(result.id);
  if (!state) throw new Error("IBKR gateway host preconditions failed.");
  write(
    JSON.stringify({
      type: "ibkr_gateway_host_mutation",
      action: command.action,
      host: operatorView(state, now),
    }),
  );
  return true;
}
