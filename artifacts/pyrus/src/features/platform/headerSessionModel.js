const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const AUTH_PASSWORD_MIN_LENGTH = 12;

export function validateSignInInput({ email, password } = {}) {
  const normalizedEmail = String(email || "").trim();
  if (!normalizedEmail || !EMAIL_PATTERN.test(normalizedEmail)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (!String(password || "")) {
    return { ok: false, error: "Enter your password." };
  }
  return { ok: true, error: "" };
}

export function validateFirstRunInput({
  email,
  password,
  bootstrapToken,
} = {}) {
  const normalizedEmail = String(email || "").trim();
  if (!normalizedEmail || !EMAIL_PATTERN.test(normalizedEmail)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (String(password || "").length < AUTH_PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`,
    };
  }
  if (!String(bootstrapToken || "").trim()) {
    return { ok: false, error: "Enter the setup token from Secrets." };
  }
  return { ok: true, error: "" };
}

export function buildSignInBody({ email, password } = {}) {
  return {
    email: String(email || "").trim(),
    password: String(password || ""),
  };
}

export function buildFirstRunBody({
  email,
  displayName,
  password,
  bootstrapToken,
} = {}) {
  const body = {
    email: String(email || "").trim(),
    password: String(password || ""),
    bootstrapToken: String(bootstrapToken || "").trim(),
  };
  const normalizedDisplayName = String(displayName || "").trim();
  if (normalizedDisplayName) {
    body.displayName = normalizedDisplayName;
  }
  return body;
}

export function describeSessionUser(user) {
  if (!user) return "Signed out";
  return (
    String(user.displayName || "").trim() ||
    String(user.email || "").trim() ||
    "Signed in"
  );
}
