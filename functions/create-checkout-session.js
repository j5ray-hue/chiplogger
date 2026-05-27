import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://gaobxnzfiogklkoueldd.supabase.co";

function getRuntime(env) {
  const stripeSecretKey = env.STRIPE_SECRET_KEY;
  const stripePriceId = env.STRIPE_PRICE_ID;
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
    stripePriceId,
    adminSupabase
  };
}

export async function onRequest(context) {
  const { request, env = {} } = context;
  const { stripe, stripePriceId, adminSupabase } = getRuntime(env);

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }
  if (!stripe || !adminSupabase || !stripePriceId) {
    return new Response(JSON.stringify({ error: "Missing server configuration" }), { status: 500 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return new Response(JSON.stringify({ error: "Missing auth token" }), { status: 401 });
  }

  const { data: authData, error: authErr } = await adminSupabase.auth.getUser(token);
  if (authErr || !authData?.user) {
    return new Response(JSON.stringify({ error: "Invalid auth token" }), { status: 401 });
  }
  const user = authData.user;

  const origin = request.headers.get("origin") || "https://chiplogger.com";
  const successUrl = `${origin}/?checkout=success`;
  const cancelUrl = `${origin}/?checkout=cancel`;

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price: stripePriceId,
        quantity: 1
      }
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: user.email || undefined,
    subscription_data: {
      metadata: {
        supabase_user_id: user.id
      }
    },
    metadata: {
      supabase_user_id: user.id
    }
  });

  return new Response(JSON.stringify({ url: checkoutSession.url }), { status: 200 });
}
