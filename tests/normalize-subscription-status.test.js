const test = require("node:test");
const assert = require("node:assert/strict");

const normalizeSubscriptionStatus = require("../shared/normalize-subscription-status.cjs");

test("normalizes plan status values safely", () => {
  assert.equal(normalizeSubscriptionStatus(" Developer_Premium "), "developer_premium");
  assert.equal(normalizeSubscriptionStatus("developer_free"), "developer_free");
  assert.equal(normalizeSubscriptionStatus(null), "");
});
