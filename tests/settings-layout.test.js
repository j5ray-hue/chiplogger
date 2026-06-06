const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const pokerHtml = fs.readFileSync(path.join(__dirname, "..", "poker.html"), "utf8");

function extractCssBlock(marker) {
  const start = pokerHtml.indexOf(marker);
  if (start < 0) throw new Error(`Could not find CSS block: ${marker}`);
  const bodyStart = pokerHtml.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < pokerHtml.length; index += 1) {
    if (pokerHtml[index] === "{") depth += 1;
    if (pokerHtml[index] === "}") {
      depth -= 1;
      if (depth === 0) return pokerHtml.slice(bodyStart + 1, index);
    }
  }
  throw new Error(`Could not parse CSS block: ${marker}`);
}

test("settings panels hug their content instead of stretching across the page", () => {
  assert.match(extractCssBlock(".settings-panel"), /width:\s*fit-content/);
  assert.match(extractCssBlock(".settings-panel"), /max-width:\s*100%/);
  assert.match(extractCssBlock(".settings-grid"), /width:\s*340px/);
  assert.match(extractCssBlock(".settings-locations"), /width:\s*520px/);
  assert.match(extractCssBlock(".payment-plan-card"), /width:\s*620px/);
});

test("payment settings use the outer settings panel as the only box", () => {
  assert.doesNotMatch(pokerHtml, /class="payment-plan-status"/);
  assert.match(
    pokerHtml,
    /id="paymentPanel" class="settings-panel"[\s\S]*id="paymentPlanBox" class="payment-plan-card"[\s\S]*class="payment-plan-status-title"/
  );
  assert.doesNotMatch(pokerHtml, /\.payment-plan-status\s*\{/);
});
