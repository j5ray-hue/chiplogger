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

test("supports Cloudflare forwarded host requests", () => {
  const origin = getAppOrigin({
    url: "https://preview.chiplogger.com/create-checkout-session",
    headers: {
      "x-forwarded-host": "preview.chiplogger.com",
      "x-forwarded-proto": "https"
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
