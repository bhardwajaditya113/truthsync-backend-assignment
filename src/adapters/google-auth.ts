import { createSign } from "node:crypto";
import { z } from "zod";
import { fetchProvider } from "./http.js";

export type GoogleCredentials =
  | { kind: "oauth"; clientId: string; clientSecret: string; refreshToken: string }
  | { kind: "service_account"; clientEmail: string; privateKey: string };

const tokenSchema = z.object({ access_token: z.string() });
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

export async function getGoogleAccessToken(credentials: GoogleCredentials,
  scope = "https://www.googleapis.com/auth/calendar.readonly"): Promise<string> {
  let body: URLSearchParams;
  if (credentials.kind === "oauth") {
    body = new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken, grant_type: "refresh_token" });
  } else {
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
      iss: credentials.clientEmail, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600
    })}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(credentials.privateKey).toString("base64url");
    body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` });
  }
  const response = await fetchProvider("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body
  });
  if (!response.ok) throw new Error(`Google OAuth token exchange failed (${response.status})`);
  return tokenSchema.parse(await response.json()).access_token;
}
