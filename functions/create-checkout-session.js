import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import getAppOrigin from "../shared/get-app-origin.cjs";

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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequest(context) {
  const { request, env = {} } = context;
  const { stripe, stripePriceId, adminSupabase } = getRuntime(env);

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!stripe || !adminSupabase || !stripePriceId) {
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return jsonResponse({ error: "Missing auth token" }, 401);
  }

  try {
    const { data: authData, error: authErr } = await adminSupabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return jsonResponse({ error: "Invalid auth token" }, 401);
    }
    const user = authData.user;

    const origin = getAppOrigin(request);
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

    return jsonResponse({ url: checkoutSession.url }, 200);
  } catch (err) {
    console.error("[create-checkout-session] checkout session creation failed");
    console.error("[create-checkout-session] message:", err && err.message ? err.message : err);
    console.error("[create-checkout-session] stack:", err && err.stack ? err.stack : "(no stack trace available)");
    return jsonResponse({ error: "Could not start checkout." }, 500);
  }
}
