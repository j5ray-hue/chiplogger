import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

function getRuntime(env) {
  const stripeSecretKey = env.STRIPE_SECRET_KEY;
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  const stripe = stripeSecretKey
    ? new Stripe(stripeSecretKey, { httpClient: Stripe.createFetchHttpClient() })
    : null;
  const adminSupabase = (supabaseUrl && supabaseServiceRoleKey)
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : null;

  return {
    stripe,
    adminSupabase
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function normalizePremiumValue(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "premium" || normalized === "paid";
}

function getDeveloperPlanOverride(subscriptionStatus) {
  if (subscriptionStatus && typeof subscriptionStatus === "object") {
    const profile = subscriptionStatus;
    if (normalizePremiumValue(profile?.manual_premium)) {
      return normalizePremiumValue(profile?.premium) ? "premium" : "free";
    }
    return null;
  }
  const normalized = normalizeSubscriptionStatus(subscriptionStatus);
  if (normalized === "developer_premium") return "premium";
  if (normalized === "developer_free") return "free";
  return null;
}

async function syncPremiumFlag(adminSupabase, userId, premiumValue) {
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

async function getProfilePremiumAccess(adminSupabase, userId, stripeHasSubscription) {
  const { data, error } = await adminSupabase
    .from("profiles")
    .select("premium, manual_premium")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`Supabase profile lookup failed: ${error.message}`);
  }
  const forcedPlan = getDeveloperPlanOverride(data);
  if (forcedPlan) {
    return forcedPlan === "premium";
  }
  return Boolean(
    stripeHasSubscription ||
    normalizePremiumValue(data?.premium) ||
    normalizePremiumValue(data?.manual_premium)
  );
}

async function lookupSubscriptionForEmail(stripe, email) {
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

export async function onRequest(context) {
  const { request, env = {} } = context;
  const runtime = getRuntime(env);
  const { stripe, adminSupabase } = runtime;

  console.log("[get-subscription-status] handler start");
  console.log("[get-subscription-status] config check");
  if (request.method !== "POST") {
    console.error("[get-subscription-status] returning 405: method not allowed");
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!stripe || !adminSupabase) {
    console.error("[get-subscription-status] returning 500: missing server configuration", {
      hasStripeSecretKey: Boolean(env.STRIPE_SECRET_KEY),
      hasSupabaseUrl: Boolean(env.SUPABASE_URL),
      hasSupabaseServiceRoleKey: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
      hasStripeClient: Boolean(stripe),
      hasAdminSupabase: Boolean(adminSupabase)
    });
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  console.log("[get-subscription-status] auth header/token check");
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    console.error("[get-subscription-status] returning 401: missing auth token");
    return jsonResponse({ error: "Missing auth token" }, 401);
  }

  console.log("[get-subscription-status] adminSupabase.auth.getUser");
  const { data: authData, error: authErr } = await adminSupabase.auth.getUser(token);
  if (authErr || !authData?.user) {
    console.error("[get-subscription-status] returning 401: invalid auth token", authErr ? authErr.message : "");
    return jsonResponse({ error: "Invalid auth token" }, 401);
  }

  const user = authData.user;
  const { data: profileData, error: profileErr } = await adminSupabase
    .from("profiles")
    .select("premium, manual_premium")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileErr) {
    throw new Error(`Supabase profile lookup failed: ${profileErr.message}`);
  }
  const forcedPlan = getDeveloperPlanOverride(profileData);
  if (forcedPlan) {
    const hasPremiumAccess = forcedPlan === "premium";
    await syncPremiumFlag(adminSupabase, user.id, hasPremiumAccess);
    console.log("[get-subscription-status] successful return: developer override");
    return jsonResponse({
      hasSubscription: hasPremiumAccess,
      status: hasPremiumAccess ? "developer_premium" : "developer_free",
      customerId: "",
      subscriptionId: ""
    }, 200);
  }

  const email = String(user.email || "").trim();
  if (!email) {
    console.log("[get-subscription-status] no email on user, syncing free plan");
    await syncPremiumFlag(adminSupabase, user.id, false);
    const hasPremiumAccess = await getProfilePremiumAccess(adminSupabase, user.id, false);
    console.log("[get-subscription-status] successful return: free plan with no email");
    return jsonResponse({ hasSubscription: hasPremiumAccess, status: "none", customerId: "", subscriptionId: "" }, 200);
  }

  try {
    console.log("[get-subscription-status] lookupSubscriptionForEmail");
    const result = await lookupSubscriptionForEmail(stripe, email);
    await syncPremiumFlag(adminSupabase, user.id, result.hasSubscription);
    result.hasSubscription = await getProfilePremiumAccess(adminSupabase, user.id, result.hasSubscription);
    console.log("[get-subscription-status] successful return");
    return jsonResponse(result, 200);
  } catch (err) {
    console.error("[get-subscription-status] subscription lookup failed");
    console.error("[get-subscription-status] message:", err && err.message ? err.message : err);
    console.error("[get-subscription-status] stack:", err && err.stack ? err.stack : "(no stack trace available)");
    return jsonResponse({ error: "Could not verify subscription." }, 500);
  }
}
