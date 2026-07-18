import type { BrokerAccountInclusionResponse } from "@workspace/api-client-react";

export type ConnectAccountReadiness = {
  status: "empty" | "blocked" | "ready";
  satisfied: boolean;
  accountCount: number;
  includedAccountCount: number;
  verifiedAccountCount: number;
  blockerCodes: string[];
};

export const deriveConnectAccountReadiness = (
  response: BrokerAccountInclusionResponse | null | undefined,
): ConnectAccountReadiness => {
  const accounts = response?.accounts ?? [];
  const includedAccounts = accounts.filter(
    (account) => account.includedInTrading,
  );
  const verifiedAccounts = accounts.filter(
    (account) => account.connectionVerified,
  );
  const satisfied = verifiedAccounts.length > 0;

  return {
    status: accounts.length === 0 ? "empty" : satisfied ? "ready" : "blocked",
    satisfied,
    accountCount: accounts.length,
    includedAccountCount: includedAccounts.length,
    verifiedAccountCount: verifiedAccounts.length,
    blockerCodes: [
      ...new Set(
        includedAccounts.flatMap((account) => account.executionBlockers),
      ),
    ],
  };
};
