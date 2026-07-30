import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  SYNC_ADMIN_TOKEN: z.string().min(8),
  DEMO_MODE: z.string().default("false").transform((v) => v === "true"),
  HUBSPOT_ACCESS_TOKEN: z.string().optional(),
  HUBSPOT_CURRENCY: z.string().length(3).default("usd"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().default("primary"),
  STRIPE_SECRET_KEY: z.string().optional()
});

export type Config = z.infer<typeof schema>;
export const config = schema.parse(process.env);
