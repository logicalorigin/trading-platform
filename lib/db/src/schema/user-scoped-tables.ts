import type { PgTable } from "drizzle-orm/pg-core";
import { brokerAccountsTable, brokerConnectionsTable } from "./broker";
import { robinhoodUserCredentialsTable } from "./robinhood";
import { schwabUserCredentialsTable } from "./schwab";
import { snapTradeUserCredentialsTable } from "./snaptrade";

// Single source of truth for the tables whose rows belong to one app user and
// therefore MUST carry an `app_user_id` column and MUST be filtered by it on
// every read and stamped on every write.
//
// The schema-parity test (user-scoped-tables.test.ts) fails CI if a table listed
// here lacks the column. The app-side scoped-db lint and the two-user isolation
// integration test both enumerate from this list. When a table gains its
// `app_user_id` column in a migration, add it here in the SAME change.
//
// NOTE: as of Slice 1 this covers only the tables that are already user-scoped
// (broker connections/accounts + the per-broker credential vaults). Slice 3
// migrations append shadow_accounts, watchlists, user_preference_profiles, and
// algo_deployments once their columns land.
export const USER_SCOPED_TABLES: readonly PgTable[] = [
  brokerConnectionsTable,
  brokerAccountsTable,
  snapTradeUserCredentialsTable,
  robinhoodUserCredentialsTable,
  schwabUserCredentialsTable,
];
