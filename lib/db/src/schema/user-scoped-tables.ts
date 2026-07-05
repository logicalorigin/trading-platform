import type { PgTable } from "drizzle-orm/pg-core";
import { brokerAccountsTable, brokerConnectionsTable } from "./broker";
import { userPreferenceProfilesTable } from "./preferences";
import { robinhoodUserCredentialsTable } from "./robinhood";
import { schwabUserCredentialsTable } from "./schwab";
import { snapTradeUserCredentialsTable } from "./snaptrade";
import { shadowAccountsTable } from "./trading";
import { watchlistsTable } from "./watchlists";

// Single source of truth for the tables whose rows belong to one app user and
// therefore MUST carry an `app_user_id` column and MUST be filtered by it on
// every read and stamped on every write.
//
// The schema-parity test (user-scoped-tables.test.ts) fails CI if a table listed
// here lacks the column. The app-side scoped-db lint and the two-user isolation
// integration test both enumerate from this list. When a table gains its
// `app_user_id` column in a migration, add it here in the SAME change.
//
// NOTE: broker connections/accounts + the per-broker credential vaults were
// scoped first; Slice 3 adds shadow_accounts, watchlists, and
// user_preference_profiles. algo_deployments joins when automation is scoped
// (Slice 5.5); saved_scans/alert_rules when they gain a service.
export const USER_SCOPED_TABLES: readonly PgTable[] = [
  brokerConnectionsTable,
  brokerAccountsTable,
  snapTradeUserCredentialsTable,
  robinhoodUserCredentialsTable,
  schwabUserCredentialsTable,
  shadowAccountsTable,
  watchlistsTable,
  userPreferenceProfilesTable,
];
