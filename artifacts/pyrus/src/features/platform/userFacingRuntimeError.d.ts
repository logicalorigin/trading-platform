export type UserFacingRuntimeErrorCopy = {
  title: string;
  detail: string;
  technicalDetail: string;
};

export type UserFacingRuntimeErrorFallback = {
  title?: string;
  detail?: string;
  rateLimitedTitle?: string;
  safeQaTitle?: string;
};

export function describeUserFacingRuntimeError(
  error: unknown,
  fallback?: string | UserFacingRuntimeErrorFallback,
): UserFacingRuntimeErrorCopy;
