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

async function setPremiumFlag(adminSupabase, userId, premiumValue) {
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

export async function onRequest(context) {
  const { request, env = {} } = context;
  const { stripe, stripeWebhookSecret, adminSupabase } = getRuntime(env);

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!stripe || !adminSupabase || !stripeWebhookSecret) {
    return new Response("Missing server configuration", { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe signature", { status: 400 });
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
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  try {
    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;
      const userId = session?.metadata?.supabase_user_id;
      await setPremiumFlag(adminSupabase, userId, true);
    }

    if (
      stripeEvent.type === "customer.subscription.deleted" ||
      stripeEvent.type === "customer.subscription.paused"
    ) {
      const subscription = stripeEvent.data.object;
      const userId = subscription?.metadata?.supabase_user_id;
      await setPremiumFlag(adminSupabase, userId, false);
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    return new Response(`Server Error: ${err.message}`, { status: 500 });
  }
}
