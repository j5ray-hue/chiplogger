const { createClient } = require("@supabase/supabase-js");

const ADMIN_EMAIL = "jadenbray@gmail.com";
const DEFAULT_SUPABASE_URL = "https://gaobxnzfiogklkoueldd.supabase.co";

const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePremiumValue(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "premium" || normalized === "paid";
}

function normalizeSubscriptionStatus(value) {
  return String(value || "").trim().toLowerCase();
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

function resolveCurrentPlan(profile) {
  const override = getDeveloperPlanOverride(profile);
  if (override) return override;
  return normalizePremiumValue(profile?.premium) ? "premium" : "free";
}

function createId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.random() * 16 | 0;
    const v = ch === "x" ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
}

function clampMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function legacyDateStringFromOffset(offsetDays = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - offsetDays);
  const month = date.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  return `${month} ${day}, ${year}`;
}

function randomChoice(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function countSavedLocations(value) {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.length;
    } catch (_) {
      return 0;
    }
  }
  return 0;
}

function isMissingSavedLocationsColumnError(error) {
  const message = String(error && error.message ? error.message : error || "").toLowerCase();
  return message.includes("saved_locations") && (message.includes("schema cache") || message.includes("column"));
}

async function getAuthedUser(request) {
  const authHeader = request.headers.authorization || request.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return { error: jsonResponse({ error: "Missing auth token" }, 401) };
  }
  const { data: authData, error: authErr } = await adminSupabase.auth.getUser(token);
  if (authErr || !authData?.user) {
    return { error: jsonResponse({ error: "Invalid auth token" }, 401) };
  }
  const user = authData.user;
  if (normalizeEmail(user.email) !== ADMIN_EMAIL) {
    return { error: jsonResponse({ error: "Developer tools are only enabled for your personal account." }, 403) };
  }
  return { user };
}

async function getProfileRow(userId) {
  const selectColumns = "user_id, name, phone, premium, manual_premium, starting_bankroll, saved_locations";
  const baseColumns = "user_id, name, phone, premium, manual_premium, starting_bankroll";
  const { data, error } = await adminSupabase
    .from("profiles")
    .select(selectColumns)
    .eq("user_id", userId)
    .maybeSingle();
  if (!error) {
    return data || null;
  }
  if (isMissingSavedLocationsColumnError(error)) {
    const fallback = await adminSupabase
      .from("profiles")
      .select(baseColumns)
      .eq("user_id", userId)
      .maybeSingle();
    if (fallback.error) {
      throw new Error(`Supabase profile lookup failed: ${fallback.error.message}`);
    }
    return fallback.data || null;
  }
  throw new Error(`Supabase profile lookup failed: ${error.message}`);
}

async function updateProfileRow(userId, patch) {
  const { data: existing, error: existingErr } = await adminSupabase
    .from("profiles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existingErr) {
    throw new Error(`Supabase profile lookup failed: ${existingErr.message}`);
  }
  if (existing) {
    const { error } = await adminSupabase.from("profiles").update(patch).eq("user_id", userId);
    if (error) throw new Error(`Supabase profile update failed: ${error.message}`);
    return;
  }
  const { error } = await adminSupabase.from("profiles").insert({
    user_id: userId,
    name: patch.name ?? "",
    phone: patch.phone ?? "",
    premium: patch.premium ?? false,
    manual_premium: patch.manual_premium ?? false,
    starting_bankroll: patch.starting_bankroll ?? 0
  });
  if (error) throw new Error(`Supabase profile insert failed: ${error.message}`);
}

function buildSeedBundle(userId, index, totalCount, mode, handsPerSession) {
  const gameTypes = ["Texas Hold'em", "Pot Limit Omaha", "No Limit Hold'em"];
  const stakes = ["$1/$2", "$2/$5", "$2/$4", "$5/$10", "$1/$3"];
  const locations = ["Home Game", "The Lodge", "MGM Grand", "Bellagio", "Aria", "Casino Night"];
  const titles = ["Session", "Cash Game", "Home Game", "Table Time", "Late Night Grind"];
  const titleSuffix = `${index + 1}`;
  const date = legacyDateStringFromOffset(index % 14);
  const startHour = `${String(6 + ((index * 2) % 7)).padStart(2, "0")}:00 PM`;
  const endHour = `${String(9 + ((index * 2) % 4)).padStart(2, "0")}:30 PM`;
  const buyIn = clampMoney(100 + (Math.random() * 700));
  const swing = mode === "sample"
    ? 120
    : Math.round((Math.random() * 2 - 0.45) * 300);
  const cashOut = clampMoney(buyIn + swing);
  const profit = clampMoney(cashOut - buyIn);
  const gameType = gameTypes[index % gameTypes.length];
  const stake = stakes[(index + totalCount) % stakes.length];
  const location = locations[(index * 2 + totalCount) % locations.length];
  const sessionId = createId();
  const handRows = [];
  const handCount = mode === "sample"
    ? 1
    : Math.max(1, Number.isFinite(handsPerSession) ? handsPerSession : 3);

  for (let handIndex = 0; handIndex < handCount; handIndex += 1) {
    const handProfit = handIndex === 0 ? profit : clampMoney((Math.random() * 2 - 0.65) * 90);
    const handName = `${titles[index % titles.length]} ${titleSuffix}.${handIndex + 1}`;
    handRows.push({
      user_id: userId,
      session_id: sessionId,
      name: handName,
      summary: `${gameType} at ${stake} ${handProfit >= 0 ? "wins" : "loses"} ${Math.abs(handProfit).toFixed(2)}`,
      hand: {
        name: handName,
        summary: `${gameType} at ${stake} ${handProfit >= 0 ? "wins" : "loses"} ${Math.abs(handProfit).toFixed(2)}`,
        mode,
        result: handProfit,
        table: location,
        notes: `Seeded by developer tools on ${new Date().toISOString()}`
      }
    });
  }

  return {
    session: {
      session_id: sessionId,
      user_id: userId,
      title: `${titles[index % titles.length]} ${titleSuffix}`,
      date,
      time_started: startHour,
      time_ended: endHour,
      duration: "3h 30m",
      duration_minutes: 210,
      game_type: gameType,
      stake,
      buy_in: buyIn,
      cash_out: cashOut,
      profit,
      bankroll_change_id: null,
      location
    },
    hands: handRows,
    bankrollChange: {
      user_id: userId,
      amount: profit,
      description: `${titles[index % titles.length]} ${titleSuffix} · ${gameType} · ${stake}`,
      type: "session",
      session_id: sessionId,
      manual_date: null
    }
  };
}

async function insertSessions(sessionRows) {
  const baseRows = sessionRows.map((row) => ({
    session_id: row.session_id,
    user_id: row.user_id,
    title: row.title,
    date: row.date,
    time_started: row.time_started,
    time_ended: row.time_ended,
    duration: row.duration,
    duration_minutes: row.duration_minutes,
    game_type: row.game_type,
    stake: row.stake,
    buy_in: row.buy_in,
    cash_out: row.cash_out,
    profit: row.profit,
    bankroll_change_id: row.bankroll_change_id
  }));
  const withLocation = baseRows.map((row, index) => ({
    ...row,
    location: sessionRows[index].location
  }));
  let { data, error } = await adminSupabase.from("sessions").insert(withLocation).select("session_id");
  if (error && String(error.message || "").toLowerCase().includes("location")) {
    ({ data, error } = await adminSupabase.from("sessions").insert(baseRows).select("session_id"));
  }
  if (error) {
    throw new Error(`Supabase session insert failed: ${error.message}`);
  }
  return data || [];
}

async function insertHands(handRows) {
  if (!handRows.length) return [];
  const { data, error } = await adminSupabase.from("hands").insert(handRows).select("id, session_id");
  if (error) {
    throw new Error(`Supabase hand insert failed: ${error.message}`);
  }
  return data || [];
}

async function insertBankrollChanges(bankrollRows) {
  if (!bankrollRows.length) return [];
  const { data, error } = await adminSupabase.from("bankroll_changes").insert(bankrollRows).select("change_id, session_id");
  if (error) {
    throw new Error(`Supabase bankroll insert failed: ${error.message}`);
  }
  return data || [];
}

async function countRows(table, column, userId = null) {
  let query = adminSupabase
    .from(table)
    .select(column, { count: "exact", head: true });
  if (userId) {
    query = query.eq("user_id", userId);
  }
  const { count, error } = await query;
  if (error) {
    throw new Error(`Supabase ${table} count failed: ${error.message}`);
  }
  return Number(count || 0);
}

async function buildSummary(user) {
  const profile = await getProfileRow(user.id);
  const [sessions, hands, bankrollChanges] = await Promise.all([
    countRows("sessions", "session_id", user.id).catch(() => 0),
    countRows("hands", "id", user.id).catch(() => 0),
    countRows("bankroll_changes", "change_id", user.id).catch(() => 0)
  ]);
  const savedLocations = countSavedLocations(profile?.saved_locations);
  const currentPlan = resolveCurrentPlan(profile);
  const override = getDeveloperPlanOverride(profile);
  return {
    ok: true,
    profile: {
      user_id: user.id,
      email: user.email || "",
      name: profile?.name || "",
      phone: profile?.phone || "",
      premium: Boolean(profile?.premium),
      manual_premium: Boolean(profile?.manual_premium),
      subscription_status: override ? (override === "premium" ? "developer_premium" : "developer_free") : null,
      current_plan: currentPlan,
      starting_bankroll: Number(profile?.starting_bankroll || 0),
      saved_locations: Array.isArray(profile?.saved_locations)
        ? profile.saved_locations
        : typeof profile?.saved_locations === "string"
          ? (() => { try { const parsed = JSON.parse(profile.saved_locations); return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; } })()
          : []
    },
    plan: {
      currentPlan,
      override: override || "none"
    },
    counts: {
      sessions,
      hands,
      bankrollChanges,
      savedLocations
    }
  };
}

async function handleSetPlanOverride(user, plan) {
  const normalized = String(plan || "").trim().toLowerCase();
  if (normalized !== "developer_free" && normalized !== "developer_premium") {
    throw new Error("Plan must be developer_free or developer_premium.");
  }
  const premium = normalized === "developer_premium";
  await updateProfileRow(user.id, {
    premium,
    manual_premium: true
  });
  return buildSummary(user);
}

async function handleClearPlanOverride(user) {
  await updateProfileRow(user.id, {
    premium: false,
    manual_premium: false,
  });
  return buildSummary(user);
}

async function handleSeedData(user, body = {}, mode = "random") {
  const sessionCount = Math.max(1, Math.min(100, Number.parseInt(body.sessionCount, 10) || 1));
  const handsPerSession = Math.max(1, Math.min(10, Number.parseInt(body.handsPerSession, 10) || 3));
  const bundles = Array.from({ length: sessionCount }, (_, index) => buildSeedBundle(user.id, index, sessionCount, mode, handsPerSession));
  const sessionRows = bundles.map((bundle) => bundle.session);
  const handRows = bundles.flatMap((bundle) => bundle.hands);
  const bankrollRows = bundles.map((bundle) => bundle.bankrollChange);
  const insertedSessions = await insertSessions(sessionRows);
  const insertedChanges = await insertBankrollChanges(bankrollRows);
  const changeIdBySession = new Map(insertedChanges.map((row) => [row.session_id, row.change_id]));
  await Promise.all(sessionRows.map((row) => {
    const changeId = changeIdBySession.get(row.session_id);
    if (!changeId) return Promise.resolve();
    return adminSupabase
      .from("sessions")
      .update({ bankroll_change_id: changeId })
      .eq("session_id", row.session_id);
  }));
  await insertHands(handRows);
  return {
    ...(await buildSummary(user)),
    inserted: {
      sessions: insertedSessions.length,
      hands: handRows.length,
      bankrollChanges: insertedChanges.length
    }
  };
}

async function handleClearAccountData(user) {
  const profile = await getProfileRow(user.id);
  const [existingSessions, existingHands, existingChanges] = await Promise.all([
    countRows("sessions", "session_id", user.id).catch(() => 0),
    countRows("hands", "id", user.id).catch(() => 0),
    countRows("bankroll_changes", "change_id", user.id).catch(() => 0)
  ]);
  const existingSavedLocations = countSavedLocations(profile?.saved_locations);
  const { error: unlinkErr } = await adminSupabase
    .from("sessions")
    .update({ bankroll_change_id: null })
    .eq("user_id", user.id);
  if (unlinkErr) {
    throw new Error(`Supabase account cleanup failed: ${unlinkErr.message}`);
  }
  const { error: handsErr } = await adminSupabase.from("hands").delete().eq("user_id", user.id);
  if (handsErr) {
    throw new Error(`Supabase account cleanup failed: ${handsErr.message}`);
  }
  const { error: changesErr } = await adminSupabase.from("bankroll_changes").delete().eq("user_id", user.id);
  if (changesErr) {
    throw new Error(`Supabase account cleanup failed: ${changesErr.message}`);
  }
  const { error: sessionsErr } = await adminSupabase.from("sessions").delete().eq("user_id", user.id);
  if (sessionsErr) {
    throw new Error(`Supabase account cleanup failed: ${sessionsErr.message}`);
  }
  try {
    await updateProfileRow(user.id, {
      starting_bankroll: 0,
      saved_locations: []
    });
  } catch (err) {
    const message = String(err && err.message ? err.message : err || "").toLowerCase();
    if (message.includes("saved_locations") && (message.includes("column") || message.includes("schema cache"))) {
      await updateProfileRow(user.id, {
        starting_bankroll: 0
      });
    } else {
      throw err;
    }
  }
  return {
    ...(await buildSummary(user)),
    removed: {
      sessions: existingSessions,
      hands: existingHands,
      bankrollChanges: existingChanges,
      savedLocations: existingSavedLocations
    }
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!adminSupabase) {
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch (_) {
    body = {};
  }

  const authResult = await getAuthedUser({
    headers: {
      authorization: event.headers.authorization || event.headers.Authorization || ""
    }
  });
  if (authResult.error) return authResult.error;
  const { user } = authResult;
  const action = String(body.action || "").trim();

  try {
    if (action === "summary") {
      return jsonResponse(await buildSummary(user), 200);
    }
    if (action === "set-plan-override") {
      return jsonResponse(await handleSetPlanOverride(user, body.plan), 200);
    }
    if (action === "clear-plan-override") {
      return jsonResponse(await handleClearPlanOverride(user), 200);
    }
    if (action === "seed-sample-data") {
      return jsonResponse(await handleSeedData(user, body, "sample"), 200);
    }
    if (action === "seed-random-data") {
      return jsonResponse(await handleSeedData(user, body, "random"), 200);
    }
    if (action === "clear-account-data") {
      return jsonResponse(await handleClearAccountData(user), 200);
    }
    return jsonResponse({ error: "Unknown developer action" }, 400);
  } catch (err) {
    console.error("[admin-tools] action failed");
    console.error("[admin-tools] message:", err && err.message ? err.message : err);
    console.error("[admin-tools] stack:", err && err.stack ? err.stack : "(no stack trace available)");
    return jsonResponse({ error: err && err.message ? err.message : "Developer action failed." }, 500);
  }
};
