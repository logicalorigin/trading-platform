import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { db, userPreferenceProfilesTable } from "@workspace/db";
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

const fallbackFile = () =>
  process.env["RAYALGO_USER_PREFERENCES_FILE"] ||
  join(tmpdir(), "rayalgo", "user-preferences.json");

const readFallback = (): PreferenceSnapshot => {
  try {
    const parsed = JSON.parse(readFileSync(fallbackFile(), "utf8")) as unknown;
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

const writeFallback = (preferences: UserPreferences): PreferenceSnapshot => {
  const updatedAt = new Date().toISOString();
  const snapshot: PreferenceSnapshot = {
    profileKey: USER_PREFERENCES_PROFILE_KEY,
    version: USER_PREFERENCES_VERSION,
    preferences,
    source: "fallback",
    updatedAt,
  };
  const file = fallbackFile();
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

export async function getUserPreferencesSnapshot(): Promise<PreferenceSnapshot> {
  try {
    const rows = await db
      .select()
      .from(userPreferenceProfilesTable)
      .where(eq(userPreferenceProfilesTable.profileKey, USER_PREFERENCES_PROFILE_KEY))
      .limit(1);
    if (rows[0]) {
      return toSnapshot(rows[0]);
    }
    const [created] = await db
      .insert(userPreferenceProfilesTable)
      .values({
        profileKey: USER_PREFERENCES_PROFILE_KEY,
        version: USER_PREFERENCES_VERSION,
        preferences: DEFAULT_USER_PREFERENCES,
      })
      .returning();
    return toSnapshot(created);
  } catch {
    return readFallback();
  }
}

export async function updateUserPreferencesSnapshot(
  input: unknown,
): Promise<PreferenceSnapshot> {
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
        profileKey: USER_PREFERENCES_PROFILE_KEY,
        version: USER_PREFERENCES_VERSION,
        preferences,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userPreferenceProfilesTable.profileKey,
        set: {
          version: USER_PREFERENCES_VERSION,
          preferences,
          updatedAt: new Date(),
        },
      })
      .returning();
    return toSnapshot(updated);
  } catch {
    return writeFallback(preferences);
  }
}
