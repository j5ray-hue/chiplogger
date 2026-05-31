module.exports = function normalizeSubscriptionStatus(value) {
  return String(value || "").trim().toLowerCase();
};
