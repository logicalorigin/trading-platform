import type { QueryClient } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";

export const AUTH_SESSION_QUERY_KEY: readonly ["auth-session"];

export type AuthSessionUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  entitlements: string[];
};

export type AuthSessionPayload = {
  user: AuthSessionUser | null;
  csrfToken: string | null;
  expiresAt?: string;
};

export type AuthSessionValue = {
  user: AuthSessionUser | null;
  entitlements: string[];
  csrfToken: string | null;
  signedIn: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  isError: boolean;
  hasEntitlement: (key: string) => boolean;
  adoptSession: (session: AuthSessionPayload) => void;
  refresh: (options?: { clearUserCache?: boolean }) => Promise<void>;
};

export function applyAuthSessionTransition(
  queryClient: QueryClient,
  session: AuthSessionPayload,
): void;

export function clearUserScopedQueryCache(queryClient: QueryClient): void;

export function readAuthSession(options?: {
  signal?: AbortSignal;
}): Promise<AuthSessionPayload>;

export function postAuthJson(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<unknown>;

export function AuthProvider(props: { children?: ReactNode }): ReactElement;

export function useAuthSession(): AuthSessionValue;
