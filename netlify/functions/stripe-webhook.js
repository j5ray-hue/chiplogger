const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const supabaseUrl = process.env.SUPABASE_URL || "https://gaobxnzfiogklkoueldd.supabase.co";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;
const adminSupabase = (supabaseUrl && supabaseServiceRoleKey)
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;

async function setPremiumFlag(userId, premiumValue) {
  if (!userId) return;
  const { error } = await adminSupabase
    .from("profiles")
    .upsert(
      {
        user_id: userId,
        premium: premiumValue
      },
      { onConflict: "user_id" }
    );
  if (error) {
    throw new Error(`Supabase profile upsert failed: ${error.message}`);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  if (!stripe || !adminSupabase || !stripeWebhookSecret) {
    return { statusCode: 500, body: "Missing server configuration" };
  }

  const signature = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  if (!signature) {
    return { statusCode: 400, body: "Missing stripe signature" };
  }

  let stripeEvent;
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : (event.body || "");
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret);
  } catch (err) {
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  try {
    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;
      const userId = session?.metadata?.supabase_user_id;
      await setPremiumFlag(userId, true);
    }

    if (
      stripeEvent.type === "customer.subscription.deleted" ||
      stripeEvent.type === "customer.subscription.paused"
    ) {
      const subscription = stripeEvent.data.object;
      const userId = subscription?.metadata?.supabase_user_id;
      await setPremiumFlag(userId, false);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    return { statusCode: 500, body: `Server Error: ${err.message}` };
  }
};
