import "dotenv/config";

const token = process.env.HUBSPOT_ACCESS_TOKEN;
if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN is required");

async function hubspot(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HubSpot ${init.method ?? "GET"} ${path} failed (${response.status}): ${JSON.stringify(body)}`);
  return body as { id?: string; results?: Array<{ id: string }> };
}

async function upsertByProperty(object: "contacts" | "deals", property: string, value: string,
  properties: Record<string, string>) {
  const search = await hubspot(`/crm/v3/objects/${object}/search`, {
    method: "POST", body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: property, operator: "EQ", value }] }], limit: 1
    })
  });
  const existingId = search.results?.[0]?.id;
  return existingId
    ? hubspot(`/crm/v3/objects/${object}/${existingId}`, { method: "PATCH", body: JSON.stringify({ properties }) })
    : hubspot(`/crm/v3/objects/${object}`, { method: "POST", body: JSON.stringify({ properties }) });
}

const contacts = [
  { email: "truthsync.alice@example.com", firstname: "Alice", lastname: "Collected" },
  { email: "truthsync.bob@example.com", firstname: "Bob", lastname: "Pending" },
  { email: "truthsync.cara@example.com", firstname: "Cara", lastname: "Failed" }
];
const deals = [
  { dealname: "TruthSync Collected Invoice", amount: "149.99", dealstage: "closedwon", pipeline: "default", closedate: "2026-07-28T10:00:00Z" },
  { dealname: "TruthSync Pending Invoice", amount: "80.00", dealstage: "appointmentscheduled", pipeline: "default", closedate: "2026-07-29T10:00:00Z" },
  { dealname: "TruthSync Failed Invoice", amount: "45.00", dealstage: "closedlost", pipeline: "default", closedate: "2026-07-30T10:00:00Z" }
];

const contactResults = [];
for (const contact of contacts) contactResults.push(await upsertByProperty("contacts", "email", contact.email, contact));
const dealResults = [];
for (const deal of deals) dealResults.push(await upsertByProperty("deals", "dealname", deal.dealname, deal));
console.log(JSON.stringify({
  contacts: contactResults.map((result) => result.id),
  deals: dealResults.map((result) => result.id),
  note: "Seed is idempotent by email/dealname"
}, null, 2));
