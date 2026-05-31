const test = require("node:test");
const assert = require("node:assert/strict");

const getAppOrigin = require("../shared/get-app-origin.cjs");

test("prefers the request URL origin over the Origin header", () => {
  const origin = getAppOrigin({
    url: "https://app.chiplogger.com/create-checkout-session",
    headers: {
      origin: "https://evil.example"
    }
  });

  assert.equal(origin, "https://app.chiplogger.com");
});

test("supports Netlify rawUrl requests", () => {
  const origin = getAppOrigin({
    rawUrl: "https://preview.chiplogger.com/.netlify/functions/create-checkout-session",
    headers: {
      host: "ignored.example"
    }
  });

  assert.equal(origin, "https://preview.chiplogger.com");
});

test("falls back to the production origin when parsing fails", () => {
  const origin = getAppOrigin({
    url: "not a valid url",
    headers: {
      origin: "https://malicious.example"
    }
  });

  assert.equal(origin, "https://chiplogger.com");
});
