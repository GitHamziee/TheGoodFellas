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

/** Phone: exactly 9 digits (or 10 too, where `allowed` says so — Retention leads come from
 * US sheets). Returns "555-234-567" / "555-234-5678", or null if the length isn't allowed. */
export function normalizeUsPhone(value: unknown, allowed: readonly number[] = [9]): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (!/^\d+$/.test(digits) || !allowed.includes(digits.length)) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export const INVALID_PHONE_MESSAGE = "Phone number must be exactly 9 digits";
export const INVALID_RETENTION_PHONE_MESSAGE = "Phone number must be 10 digits";

/** Zipcode: exactly 5 digits. */
export function isValidZip(value: unknown): value is string {
  return typeof value === "string" && /^\d{5}$/.test(value.trim());
}

export const INVALID_ZIP_MESSAGE = "Zipcode must be exactly 5 digits";
