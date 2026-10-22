import { execSync } from "child_process";
import Rollbar from "rollbar";
import type { Request } from "express";
import { env } from "./env";

// The deployed commit, so an error can be tied to the push that introduced it. The VPS runs from a
// git checkout; anywhere git isn't available the field is just left off.
function gitSha(): string | undefined {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return undefined;
  }
}

// Prisma error messages quote the failing call, argument values included, e.g. `ssn: "123-45-6789"`.
// The quoted code is every line that starts with whitespace or the `→` marker; what's left is the
// "Invalid `prisma.lead.update()` invocation" header and the explanation.
function stripQuotedCode(message: string): string {
  return message
    .split("\n")
    .filter((line) => line.trim() && !/^[\s→]/.test(line))
    .join("\n");
}

function scrubException(trace: unknown): void {
  const exception = (trace as { exception?: { class?: string; message?: string; description?: string } } | undefined)
    ?.exception;
  if (!exception?.class?.startsWith("PrismaClient")) return;
  if (exception.message) exception.message = stripQuotedCode(exception.message);
  if (exception.description) exception.description = stripQuotedCode(exception.description);
}

// Error reporting. With no ROLLBAR_ACCESS_TOKEN (local dev, tests) it stays disabled and every
// call is a no-op, so nothing here needs guarding at the call site.
export const rollbar = new Rollbar({
  accessToken: env.rollbarAccessToken || undefined,
  enabled: Boolean(env.rollbarAccessToken),
  environment: env.rollbarEnvironment,
  captureUncaught: true,
  // Without this Rollbar keeps the process alive after an uncaught exception; report, then exit
  // as Node would have, so pm2 restarts it in a clean state.
  exitOnUncaughtException: true,
  captureUnhandledRejections: true,
  payload: { code_version: gitSha() },
  // Request bodies carry lead PII (SSN, bank, card, health), so only the field names leave the
  // server — enough to see what the request was trying to write, never the values. Rollbar puts
  // the body under the method name (data.POST / data.PATCH) or under data.body.
  transform: (data) => {
    const body = data.body as { trace?: unknown; trace_chain?: unknown[] } | undefined;
    scrubException(body?.trace);
    body?.trace_chain?.forEach(scrubException);

    const request = data.request as Record<string, unknown> | undefined;
    if (!request) return;
    for (const key of ["POST", "PUT", "PATCH", "DELETE", "body"]) {
      const value = request[key];
      if (value && typeof value === "object") request[key] = { fields: Object.keys(value) };
      else if (value !== undefined) request[key] = "[redacted]";
    }
  },
});

/** Reports a caught error that is logged and swallowed rather than reaching the Express error
 * middleware — background jobs, fire-and-forget notifications, auth lookups. */
export function reportError(err: unknown, req?: Request): void {
  rollbar.error(err instanceof Error ? err : String(err), req);
}
