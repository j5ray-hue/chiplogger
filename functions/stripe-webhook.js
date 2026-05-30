import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://gaobxnzfiogklkoueldd.supabase.co";

function getRuntime(env) {
  const stripeSecretKey = env.STRIPE_SECRET_KEY;
  const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  const stripe = stripeSecretKey
    ? new Stripe(stripeSecretKey, { httpClient: Stripe.createFetchHttpClient() })
    : null;
  const adminSupabase = (supabaseUrl && supabaseServiceRoleKey)
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : null;

  return {
    stripe,
    stripeWebhookSecret,
    adminSupabase
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function getPremiumValueForStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "active" || normalized === "trialing" || normalized === "past_due";
}

async function setPremiumFlag(adminSupabase, userId, premiumValue) {
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

export async function onRequest(context) {
  const { request, env = {} } = context;
  const { stripe, stripeWebhookSecret, adminSupabase } = getRuntime(env);

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!stripe || !adminSupabase || !stripeWebhookSecret) {
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return jsonResponse({ error: "Missing stripe signature" }, 400);
  }

  let stripeEvent;
  try {
    const rawBody = await request.text();
    stripeEvent = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      stripeWebhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider()
    );
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
      await setPremiumFlag(adminSupabase, userId, true);
    }

    if (stripeEvent.type === "customer.subscription.created" || stripeEvent.type === "customer.subscription.updated") {
      const subscription = stripeEvent.data.object;
      const userId = subscription?.metadata?.supabase_user_id;
      if (userId) {
        await setPremiumFlag(adminSupabase, userId, getPremiumValueForStatus(subscription?.status));
      }
    }

    if (
      stripeEvent.type === "customer.subscription.deleted" ||
      stripeEvent.type === "customer.subscription.paused"
    ) {
      const subscription = stripeEvent.data.object;
      const userId = subscription?.metadata?.supabase_user_id;
      await setPremiumFlag(adminSupabase, userId, false);
    }

    return jsonResponse({ received: true }, 200);
  } catch (err) {
    console.error("[stripe-webhook] event handling failed");
    console.error("[stripe-webhook] message:", err && err.message ? err.message : err);
    console.error("[stripe-webhook] stack:", err && err.stack ? err.stack : "(no stack trace available)");
    return jsonResponse({ error: "Webhook processing failed" }, 500);
  }
}
