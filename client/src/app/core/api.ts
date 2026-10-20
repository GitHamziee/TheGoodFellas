/** Success envelope every API route returns — `{ data, message? }`. */
export interface ApiSuccess<T> {
  data: T;
  message?: string;
}

/** The server's `{ error }` message from a failed HttpClient call, or `fallback` when the
 * response carried none (network failure, non-API error). */
export function apiErrorMessage(err: unknown, fallback: string): string {
  return (err as { error?: { error?: string } } | null | undefined)?.error?.error ?? fallback;
}
