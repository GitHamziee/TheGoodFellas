/** What every service returns: data on success, or an error message + HTTP status (and an
 * optional machine-readable `code`, see api-response.ts) for the route to map onto a response. */
export type ServiceResult<T> =
  | { data: T; status?: never; code?: never }
  | { error: string; status: number; code?: string };
