import {
  normalizeOnboardingProgress,
  type OnboardingProgress,
} from "./onboardingModel";

const KEY_PREFIX = "pyrus:onboarding:v1:";

export const pendingOnboardingStorageKey = (userId: string): string =>
  `${KEY_PREFIX}${encodeURIComponent(userId)}`;

const usableUserId = (userId: string): boolean =>
  typeof userId === "string" && userId.length > 0 && userId.length <= 256;

const serializeOnboardingProgress = (progress: unknown): string =>
  JSON.stringify(normalizeOnboardingProgress(progress));

export const readPendingOnboardingProgress = (
  userId: string,
): OnboardingProgress | null => {
  if (!usableUserId(userId) || typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(
      pendingOnboardingStorageKey(userId),
    );
    return value ? normalizeOnboardingProgress(JSON.parse(value)) : null;
  } catch {
    return null;
  }
};

export const writePendingOnboardingProgress = (
  userId: string,
  progress: unknown,
): boolean => {
  if (!usableUserId(userId) || typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      pendingOnboardingStorageKey(userId),
      serializeOnboardingProgress(progress),
    );
    return true;
  } catch {
    return false;
  }
};

export const clearPendingOnboardingProgress = (
  userId: string,
  confirmedProgress?: unknown,
): boolean => {
  if (!usableUserId(userId) || typeof window === "undefined") return false;
  try {
    const key = pendingOnboardingStorageKey(userId);
    if (confirmedProgress !== undefined) {
      const current = window.localStorage.getItem(key);
      if (
        current === null ||
        serializeOnboardingProgress(JSON.parse(current)) !==
          serializeOnboardingProgress(confirmedProgress)
      ) {
        return false;
      }
    }
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};
