import type { Config } from "../config.js";
import type { SourceAdapter } from "../domain/types.js";
import { DemoAdapter } from "./demo.js";
import { GoogleCalendarAdapter } from "./google-calendar.js";
import { HubSpotAdapter } from "./hubspot.js";
import { StripeAdapter } from "./stripe.js";

export function createAdapters(config: Config): SourceAdapter[] {
  if (config.DEMO_MODE) return [new DemoAdapter("hubspot"), new DemoAdapter("stripe"), new DemoAdapter("google_calendar")];
  const missing = [
    ["HUBSPOT_ACCESS_TOKEN", config.HUBSPOT_ACCESS_TOKEN], ["STRIPE_SECRET_KEY", config.STRIPE_SECRET_KEY],
    ["GOOGLE_CLIENT_ID", config.GOOGLE_CLIENT_ID], ["GOOGLE_CLIENT_SECRET", config.GOOGLE_CLIENT_SECRET],
    ["GOOGLE_REFRESH_TOKEN", config.GOOGLE_REFRESH_TOKEN]
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`Missing integration configuration: ${missing.join(", ")}`);
  return [
    new HubSpotAdapter(config.HUBSPOT_ACCESS_TOKEN!, config.HUBSPOT_CURRENCY),
    new StripeAdapter(config.STRIPE_SECRET_KEY!),
    new GoogleCalendarAdapter(config.GOOGLE_CLIENT_ID!, config.GOOGLE_CLIENT_SECRET!, config.GOOGLE_REFRESH_TOKEN!, config.GOOGLE_CALENDAR_ID)
  ];
}
