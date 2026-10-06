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
};
