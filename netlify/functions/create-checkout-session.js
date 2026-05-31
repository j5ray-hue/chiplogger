const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const getAppOrigin = require("../../shared/get-app-origin.cjs");

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripePriceId = process.env.STRIPE_PRICE_ID;
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

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!stripe || !adminSupabase || !stripePriceId) {
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
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

    const origin = getAppOrigin(event);
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
};
