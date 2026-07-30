import type { Config } from "../config.js";
import type { SourceAdapter } from "../domain/types.js";
import { DemoAdapter } from "./demo.js";
import { GoogleCalendarAdapter } from "./google-calendar.js";
import { HubSpotAdapter } from "./hubspot.js";
import { StripeAdapter } from "./stripe.js";
import type { GoogleCredentials } from "./google-auth.js";

export function getGoogleCredentials(config: Config): GoogleCredentials | null {
  if (config.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const raw = Buffer.from(config.GOOGLE_SERVICE_ACCOUNT_JSON, "base64").toString("utf8");
    const key = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (!key.client_email || !key.private_key) throw new Error("Invalid GOOGLE_SERVICE_ACCOUNT_JSON");
    return { kind: "service_account", clientEmail: key.client_email, privateKey: key.private_key };
  }
  if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_REFRESH_TOKEN) {
    return { kind: "oauth", clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET, refreshToken: config.GOOGLE_REFRESH_TOKEN };
  }
  return null;
}

export function createAdapters(config: Config): SourceAdapter[] {
  if (config.DEMO_MODE) return [new DemoAdapter("hubspot"), new DemoAdapter("stripe"), new DemoAdapter("google_calendar")];
  const googleCredentials = getGoogleCredentials(config);
  const missing = [
    ["HUBSPOT_ACCESS_TOKEN", config.HUBSPOT_ACCESS_TOKEN], ["STRIPE_SECRET_KEY", config.STRIPE_SECRET_KEY],
    ["GOOGLE_CREDENTIALS", googleCredentials]
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`Missing integration configuration: ${missing.join(", ")}`);
  return [
    new HubSpotAdapter(config.HUBSPOT_ACCESS_TOKEN!, config.HUBSPOT_CURRENCY),
    new StripeAdapter(config.STRIPE_SECRET_KEY!),
    new GoogleCalendarAdapter(googleCredentials!, config.GOOGLE_CALENDAR_ID)
  ];
}
