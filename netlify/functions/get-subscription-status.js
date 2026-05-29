const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const supabaseUrl = process.env.SUPABASE_URL || "https://gaobxnzfiogklkoueldd.supabase.co";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;
const adminSupabase = (supabaseUrl && supabaseServiceRoleKey)
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

function normalizePremiumValue(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "premium" || normalized === "paid";
}

async function syncPremiumFlag(userId, premiumValue) {
  if (!userId) return;
  console.log("[get-subscription-status] syncPremiumFlag");

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

async function getProfilePremiumAccess(userId, stripeHasSubscription) {
  const { data, error } = await adminSupabase
    .from("profiles")
    .select("premium, manual_premium")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`Supabase profile lookup failed: ${error.message}`);
  }
  return Boolean(
    stripeHasSubscription ||
    normalizePremiumValue(data?.premium) ||
    normalizePremiumValue(data?.manual_premium)
  );
}

async function lookupSubscriptionForEmail(email) {
  console.log("[get-subscription-status] stripe.customers.list");
  const customers = await stripe.customers.list({ email, limit: 10 });
  for (const customer of customers.data || []) {
    console.log("[get-subscription-status] stripe.subscriptions.list");
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: "all",
      limit: 10
    });
    const activeSubscription = (subscriptions.data || []).find((subscription) => {
      const status = String(subscription.status || "").trim().toLowerCase();
      return ACTIVE_STATUSES.has(status);
    });
    if (activeSubscription) {
      return {
        hasSubscription: true,
        status: String(activeSubscription.status || "").toLowerCase(),
        customerId: customer.id,
        subscriptionId: activeSubscription.id
      };
    }
  }
  return {
    hasSubscription: false,
    status: "none",
    customerId: "",
    subscriptionId: ""
  };
}

exports.handler = async (event) => {
  console.log("[get-subscription-status] handler start");
  console.log("[get-subscription-status] config check");
  if (event.httpMethod !== "POST") {
    console.error("[get-subscription-status] returning 405: method not allowed");
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  if (!stripe || !adminSupabase) {
    console.error("[get-subscription-status] returning 500: missing server configuration", {
      hasStripeSecretKey: Boolean(process.env.STRIPE_SECRET_KEY),
      hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
      hasSupabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      hasStripeClient: Boolean(stripe),
      hasAdminSupabase: Boolean(adminSupabase)
    });
    return { statusCode: 500, body: JSON.stringify({ error: "Missing server configuration" }) };
  }

  console.log("[get-subscription-status] auth header/token check");
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    console.error("[get-subscription-status] returning 401: missing auth token");
    return { statusCode: 401, body: JSON.stringify({ error: "Missing auth token" }) };
  }

  console.log("[get-subscription-status] adminSupabase.auth.getUser");
  const { data: authData, error: authErr } = await adminSupabase.auth.getUser(token);
  if (authErr || !authData?.user) {
    console.error("[get-subscription-status] returning 401: invalid auth token", authErr ? authErr.message : "");
    return { statusCode: 401, body: JSON.stringify({ error: "Invalid auth token" }) };
  }

  const user = authData.user;
  const email = String(user.email || "").trim();
  if (!email) {
    console.log("[get-subscription-status] no email on user, syncing free plan");
    await syncPremiumFlag(user.id, false);
    const hasPremiumAccess = await getProfilePremiumAccess(user.id, false);
    console.log("[get-subscription-status] successful return: free plan with no email");
    return {
      statusCode: 200,
      body: JSON.stringify({ hasSubscription: hasPremiumAccess, status: "none", customerId: "", subscriptionId: "" })
    };
  }

  try {
    console.log("[get-subscription-status] lookupSubscriptionForEmail");
    const result = await lookupSubscriptionForEmail(email);
    await syncPremiumFlag(user.id, result.hasSubscription);
    result.hasSubscription = await getProfilePremiumAccess(user.id, result.hasSubscription);
    console.log("[get-subscription-status] successful return");
    return {
      statusCode: 200,
      body: JSON.stringify(result)
    };
  } catch (err) {
    console.error("[get-subscription-status] subscription lookup failed");
    console.error("[get-subscription-status] message:", err && err.message ? err.message : err);
    console.error("[get-subscription-status] stack:", err && err.stack ? err.stack : "(no stack trace available)");
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/plain" },
      body: err && err.message ? err.message : "Could not verify subscription."
    };
  }
};
