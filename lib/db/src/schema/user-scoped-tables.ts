import type { PgTable } from "drizzle-orm/pg-core";
import {
  algoAccountControlsTable,
  algoDeploymentsTable,
  algoTargetExecutionsTable,
  algoTargetPositionsTable,
} from "./automation";
import { auditEventsTable } from "./audit";
import {
  brokerAccountsTable,
  brokerConnectionsTable,
  ibkrGatewaySessionsTable,
} from "./broker";
import { brokerOrderMutationsTable } from "./broker-order-mutations";
import { userPreferenceProfilesTable } from "./preferences";
import { robinhoodUserCredentialsTable } from "./robinhood";
import { schwabUserCredentialsTable } from "./schwab";
import { snapTradeUserCredentialsTable } from "./snaptrade";
import {
  taxAuditEventsTable,
  taxEventsTable,
  taxLotsTable,
  taxPreflightChecksTable,
  taxProfileAccountsTable,
  taxProfilesTable,
  taxReconciliationIssuesTable,
  taxReserveActionsTable,
  taxReserveBucketsTable,
  taxWashSaleMatchesTable,
} from "./tax";
import { shadowAccountsTable } from "./trading";
import { watchlistsTable } from "./watchlists";

// Single source of truth for the tables whose rows belong to one app user and
// therefore MUST carry an `app_user_id` column and MUST be filtered by it on
// every read and stamped on every write.
//
// The schema-parity test (user-scoped-tables.test.ts) fails CI if a registered
// table lacks the column or an exported table with the column is omitted. When
// a table gains `app_user_id` in a migration, add it here in the SAME change.
export const USER_SCOPED_TABLES: readonly PgTable[] = [
  algoDeploymentsTable,
  algoAccountControlsTable,
  algoTargetExecutionsTable,
  algoTargetPositionsTable,
  auditEventsTable,
  brokerConnectionsTable,
  brokerAccountsTable,
  brokerOrderMutationsTable,
  ibkrGatewaySessionsTable,
  snapTradeUserCredentialsTable,
  robinhoodUserCredentialsTable,
  schwabUserCredentialsTable,
  shadowAccountsTable,
  watchlistsTable,
  userPreferenceProfilesTable,
  taxProfilesTable,
  taxProfileAccountsTable,
  taxEventsTable,
  taxLotsTable,
  taxReconciliationIssuesTable,
  taxWashSaleMatchesTable,
  taxPreflightChecksTable,
  taxReserveBucketsTable,
  taxReserveActionsTable,
  taxAuditEventsTable,
];
