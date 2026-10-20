import jwt from "jsonwebtoken";
import { env } from "./env";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let cached: { token: string; expiresAt: number } | null = null;

/** Service-account access token: sign a short-lived JWT with the account's private key and
 * trade it for a bearer token. Cached until a minute before expiry. */
async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: env.googleServiceAccountEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 },
    env.googlePrivateKey,
    { algorithm: "RS256" }
  );

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`Google auth failed (${res.status})`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

/** Column A of the configured sheet, one string per row. Row N of the sheet is index N-1;
 * blank rows come back as "". */
export async function readSheetColumn(): Promise<string[]> {
  const token = await getAccessToken();
  const range = encodeURIComponent(env.googleSheetTab ? `'${env.googleSheetTab}'!A:A` : "A:A");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.googleSheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Google Sheets read failed (${res.status})`);
  const body = (await res.json()) as { values?: string[][] };
  return (body.values ?? []).map((row) => row[0] ?? "");
}
