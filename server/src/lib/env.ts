import "dotenv/config";

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:4200",
  // Passed straight to Express's `app.set('trust proxy', ...)`. Leave unset when the server
  // is directly internet-facing (the safe default — req.ip is the real socket address, and
  // X-Forwarded-For is ignored so it can't be spoofed). Set this to "1" (one hop) or your
  // reverse proxy/load balancer's IP/CIDR once you know the deployment topology — getting
  // this wrong breaks IP whitelisting either by always seeing the proxy's IP or by trusting
  // a spoofable header.
  trustProxy: process.env.TRUST_PROXY,
  // Retention lead sheet sync — all three of ID, email and key must be set or the sync stays off.
  googleSheetId: process.env.GOOGLE_SHEET_ID ?? "",
  googleSheetTab: process.env.GOOGLE_SHEET_TAB ?? "",
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "",
  // The key's newlines arrive as literal "\n" when it's pasted into a single-line .env value.
  googlePrivateKey: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  // Date blocks older than this (yyyy-mm-dd) are ignored, so the first sync doesn't pull the
  // sheet's whole history into Admin's queue.
  googleSheetImportFrom: process.env.GOOGLE_SHEET_IMPORT_FROM ?? "",
  googleSheetSyncMinutes: Number(process.env.GOOGLE_SHEET_SYNC_MINUTES ?? 5),
};
