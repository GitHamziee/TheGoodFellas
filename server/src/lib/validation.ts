export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Min 8 chars, at least one uppercase letter, at least one number. */
export function isValidPassword(password: unknown): password is string {
  return typeof password === "string" && password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password);
}
