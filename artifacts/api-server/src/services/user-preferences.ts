import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db, userPreferenceProfilesTable } from "@workspace/db";
import { requireCurrentAppUserId } from "./app-user-context";
import {
  DEFAULT_USER_PREFERENCES,
  USER_PREFERENCES_PROFILE_KEY,
  USER_PREFERENCES_VERSION,
  deepMergeRecords,
  normalizeUserPreferences,
  type UserPreferences,
} from "./user-preferences-model";

type PreferenceSource = "database" | "fallback";

type PreferenceSnapshot = {
  profileKey: string;
  version: number;
  preferences: UserPreferences;
  source: PreferenceSource;
  updatedAt: string;
};

const readRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const fallbackFile = (userId: string) =>
  process.env["PYRUS_USER_PREFERENCES_FILE"] ||
  join(tmpdir(), "pyrus", `user-preferences-${userId}.json`);

const readFallback = (userId: string): PreferenceSnapshot => {
  try {
    const parsed = JSON.parse(readFileSync(fallbackFile(userId), "utf8")) as unknown;
    const record = readRecord(parsed);
    return {
      profileKey:
        typeof record.profileKey === "string" && record.profileKey
          ? record.profileKey
          : USER_PREFERENCES_PROFILE_KEY,
      version: USER_PREFERENCES_VERSION,
      preferences: normalizeUserPreferences(record.preferences),
      source: "fallback",
      updatedAt:
        typeof record.updatedAt === "string" && record.updatedAt
          ? record.updatedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return {
      profileKey: USER_PREFERENCES_PROFILE_KEY,
      version: USER_PREFERENCES_VERSION,
      preferences: DEFAULT_USER_PREFERENCES,
      source: "fallback",
      updatedAt: new Date(0).toISOString(),
    };
  }
};

const writeFallback = (
  userId: string,
  preferences: UserPreferences,
): PreferenceSnapshot => {
  const updatedAt = new Date().toISOString();
  const snapshot: PreferenceSnapshot = {
    profileKey: USER_PREFERENCES_PROFILE_KEY,
    version: USER_PREFERENCES_VERSION,
    preferences,
    source: "fallback",
    updatedAt,
  };
  const file = fallbackFile(userId);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      {
        profileKey: snapshot.profileKey,
        version: snapshot.version,
        preferences: snapshot.preferences,
        updatedAt: snapshot.updatedAt,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  return snapshot;
};

const toSnapshot = (row: {
  profileKey: string;
  version: number;
  preferences: Record<string, unknown>;
  updatedAt: Date;
}): PreferenceSnapshot => ({
  profileKey: row.profileKey,
  version: USER_PREFERENCES_VERSION,
  preferences: normalizeUserPreferences(row.preferences),
  source: "database",
  updatedAt: row.updatedAt.toISOString(),
});

// Per-user (Slice 5.4): the snapshot cache and in-flight read dedupe are keyed by
// app user id so one user's preferences can never be served to another. A single
// shared cache slot would leak across users under the previously-global singleton.
const cachedPreferenceSnapshots = new Map<string, PreferenceSnapshot>();
const preferenceSnapshotReadPromises = new Map<
  string,
  Promise<PreferenceSnapshot>
>();

export function __clearUserPreferencesCacheForTests(): void {
  cachedPreferenceSnapshots.clear();
  preferenceSnapshotReadPromises.clear();
}

async function loadUserPreferencesSnapshot(
  userId: string,
): Promise<PreferenceSnapshot> {
  try {
    const rows = await db
      .select()
      .from(userPreferenceProfilesTable)
      .where(
        and(
          eq(userPreferenceProfilesTable.appUserId, userId),
          eq(userPreferenceProfilesTable.profileKey, USER_PREFERENCES_PROFILE_KEY),
        ),
      )
      .limit(1);
    if (rows[0]) {
      return toSnapshot(rows[0]);
    }
    const [created] = await db
      .insert(userPreferenceProfilesTable)
      .values({
        appUserId: userId,
        profileKey: USER_PREFERENCES_PROFILE_KEY,
        version: USER_PREFERENCES_VERSION,
        preferences: DEFAULT_USER_PREFERENCES,
      })
      .returning();
    return toSnapshot(created);
  } catch {
    return readFallback(userId);
  }
}

export async function getUserPreferencesSnapshot(): Promise<PreferenceSnapshot> {
  const userId = requireCurrentAppUserId();
  const cached = cachedPreferenceSnapshots.get(userId);
  if (cached) {
    return cached;
  }
  const inflight = preferenceSnapshotReadPromises.get(userId);
  if (inflight) {
    return inflight;
  }

  const promise = loadUserPreferencesSnapshot(userId)
    .then((snapshot) => {
      cachedPreferenceSnapshots.set(userId, snapshot);
      return snapshot;
    })
    .finally(() => {
      preferenceSnapshotReadPromises.delete(userId);
    });
  preferenceSnapshotReadPromises.set(userId, promise);
  return promise;
}

export async function updateUserPreferencesSnapshot(
  input: unknown,
): Promise<PreferenceSnapshot> {
  const userId = requireCurrentAppUserId();
  const patch = readRecord(input);
  const current = await getUserPreferencesSnapshot();
  const merged = deepMergeRecords(
    current.preferences as unknown as Record<string, unknown>,
    patch,
  );
  const preferences = normalizeUserPreferences(merged, { strict: true });

  try {
    const [updated] = await db
      .insert(userPreferenceProfilesTable)
      .values({
        appUserId: userId,
        profileKey: USER_PREFERENCES_PROFILE_KEY,
        version: USER_PREFERENCES_VERSION,
        preferences,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        // Conflict on the per-user partial-unique (one row per user), so a repeat
        // save updates the caller's own row instead of colliding.
        target: userPreferenceProfilesTable.appUserId,
        targetWhere: sql`${userPreferenceProfilesTable.appUserId} is not null`,
        set: {
          version: USER_PREFERENCES_VERSION,
          preferences,
          updatedAt: new Date(),
        },
      })
      .returning();
    const snapshot = toSnapshot(updated);
    cachedPreferenceSnapshots.set(userId, snapshot);
    return snapshot;
  } catch {
    const snapshot = writeFallback(userId, preferences);
    cachedPreferenceSnapshots.set(userId, snapshot);
    return snapshot;
  }
}
