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

function jsonResponse(body, status = 200) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

function getPremiumValueForStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "active" || normalized === "trialing" || normalized === "past_due";
}

async function setPremiumFlag(userId, premiumValue) {
  if (!userId) return;
  const { error } = await adminSupabase
    .from("profiles")
    .update({
      premium: premiumValue
    })
    .eq("user_id", userId);
  if (error) {
    throw new Error(`Supabase profile update failed: ${error.message}`);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!stripe || !adminSupabase || !stripeWebhookSecret) {
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  const signature = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  if (!signature) {
    return jsonResponse({ error: "Missing stripe signature" }, 400);
  }

  let stripeEvent;
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : (event.body || "");
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed");
    console.error("[stripe-webhook] message:", err && err.message ? err.message : err);
    console.error("[stripe-webhook] stack:", err && err.stack ? err.stack : "(no stack trace available)");
    return jsonResponse({ error: "Webhook signature verification failed" }, 400);
  }

  try {
    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;
      const userId = session?.metadata?.supabase_user_id;
      await setPremiumFlag(userId, true);
    }

    if (stripeEvent.type === "customer.subscription.created" || stripeEvent.type === "customer.subscription.updated") {
      const subscription = stripeEvent.data.object;
      const userId = subscription?.metadata?.supabase_user_id;
      if (userId) {
        await setPremiumFlag(userId, getPremiumValueForStatus(subscription?.status));
      }
    }

    if (
      stripeEvent.type === "customer.subscription.deleted" ||
      stripeEvent.type === "customer.subscription.paused"
    ) {
      const subscription = stripeEvent.data.object;
      const userId = subscription?.metadata?.supabase_user_id;
      await setPremiumFlag(userId, false);
    }

    return jsonResponse({ received: true }, 200);
  } catch (err) {
    console.error("[stripe-webhook] event handling failed");
    console.error("[stripe-webhook] message:", err && err.message ? err.message : err);
    console.error("[stripe-webhook] stack:", err && err.stack ? err.stack : "(no stack trace available)");
    return jsonResponse({ error: "Webhook processing failed" }, 500);
  }
};
