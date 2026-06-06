const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const pokerHtml = fs.readFileSync(path.join(__dirname, "..", "poker.html"), "utf8");

function extractCssBlock(marker, startAt = 0) {
  const start = pokerHtml.indexOf(marker, startAt);
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

test("narrow desktop home keeps the app stage as the vertical scroll container", () => {
  const media = extractCssBlock("@media (max-width: 980px)");
  const stageRule = extractCssBlock(
    "body.app-session.home-layout .app-stage",
    pokerHtml.indexOf("@media (max-width: 980px)")
  );

  assert.match(media, /grid-template-columns:\s*1fr/);
  assert.match(stageRule, /height:\s*100dvh/);
  assert.match(stageRule, /overflow-y:\s*auto/);
  assert.doesNotMatch(stageRule, /height:\s*auto/);
});

test("home layout locks document scrolling only while the app stage can scroll", () => {
  const bodyRule = extractCssBlock("body.app-session.home-layout");
  const stageRule = extractCssBlock("body.app-session.home-layout .app-stage");

  assert.match(bodyRule, /overflow:\s*hidden/);
  assert.match(stageRule, /height:\s*100dvh/);
  assert.match(stageRule, /overflow-y:\s*auto/);
});
