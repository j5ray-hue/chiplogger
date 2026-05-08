const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripePriceId = process.env.STRIPE_PRICE_ID;
const supabaseUrl = process.env.SUPABASE_URL || "https://gaobxnzfiogklkoueldd.supabase.co";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;
const adminSupabase = (supabaseUrl && supabaseServiceRoleKey)
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  if (!stripe || !adminSupabase || !stripePriceId) {
    return { statusCode: 500, body: JSON.stringify({ error: "Missing server configuration" }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: "Missing auth token" }) };
  }

  const { data: authData, error: authErr } = await adminSupabase.auth.getUser(token);
  if (authErr || !authData?.user) {
    return { statusCode: 401, body: JSON.stringify({ error: "Invalid auth token" }) };
  }
  const user = authData.user;

  const origin = event.headers.origin || event.headers.Origin || "https://chiplogger.com";
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

  return {
    statusCode: 200,
    body: JSON.stringify({ url: checkoutSession.url })
  };
};
