import "dotenv/config";
import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey?.startsWith("sk_test_")) throw new Error("A Stripe test-mode STRIPE_SECRET_KEY is required");
const stripe = new Stripe(secretKey);

const definitions = [
  { key: "collected", amount: 12_900, refundTo: 0, description: "TruthSync collected payment" },
  { key: "refunded", amount: 5_000, refundTo: 5_000, description: "TruthSync fully refunded payment" },
  { key: "partial_refund", amount: 8_800, refundTo: 800, description: "TruthSync partially refunded payment" }
];

const existing = await stripe.charges.list({ limit: 100 });
const results = [];
for (const definition of definitions) {
  let charge = existing.data.find((item) => item.metadata.truthsyncSeedKey === definition.key);
  if (!charge) {
    charge = await stripe.charges.create({
      amount: definition.amount, currency: "usd", source: "tok_visa", description: definition.description,
      metadata: { truthsyncSeedKey: definition.key, seededBy: "truthsync-assessment" }
    });
  }
  if (charge.amount_refunded < definition.refundTo) {
    await stripe.refunds.create({ charge: charge.id, amount: definition.refundTo - charge.amount_refunded });
    charge = await stripe.charges.retrieve(charge.id);
  }
  results.push({ id: charge.id, status: charge.status, amount: charge.amount,
    amountRefunded: charge.amount_refunded, fullyRefunded: charge.refunded });
}
console.log(JSON.stringify({ charges: results, note: "Seed is idempotent by metadata.truthsyncSeedKey" }, null, 2));
