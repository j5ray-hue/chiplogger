const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const pokerHtml = fs.readFileSync(path.join(__dirname, "..", "poker.html"), "utf8");

function extractFunction(name) {
  const marker = `    function ${name}`;
  const start = pokerHtml.indexOf(marker);
  if (start < 0) throw new Error(`Could not find ${name} in poker.html`);
  const argsStart = pokerHtml.indexOf("(", start);
  let argsDepth = 0;
  let argsEnd = -1;
  for (let index = argsStart; index < pokerHtml.length; index += 1) {
    if (pokerHtml[index] === "(") argsDepth += 1;
    if (pokerHtml[index] === ")") {
      argsDepth -= 1;
      if (argsDepth === 0) {
        argsEnd = index;
        break;
      }
    }
  }
  const bodyStart = pokerHtml.indexOf("{", argsEnd);
  let depth = 0;
  for (let index = bodyStart; index < pokerHtml.length; index += 1) {
    if (pokerHtml[index] === "{") depth += 1;
    if (pokerHtml[index] === "}") {
      depth -= 1;
      if (depth === 0) return pokerHtml.slice(start, index + 1);
    }
  }
  throw new Error(`Could not parse ${name} in poker.html`);
}

function buildCompletionContext(overrides = {}) {
  const context = {
    handStageIndex: 4,
    handBoardCards: {
      flop: ["2c", "3d", "4h"],
      turn: ["9s"],
      river: ["Kc"]
    },
    handStreetNeedSeats: [],
    isHandWonByFoldEnough: () => false,
    getHandActionCount: () => 8,
    getActiveHandSeatIndices: () => [0, 1],
    getCurrentHandWinnerSeatIndices: () => [],
    ...overrides
  };
  vm.createContext(context);
  vm.runInContext(extractFunction("isHandConcludedEnough"), context);
  return context;
}

test("a river hand without a verified result remains a draft", () => {
  const context = buildCompletionContext();

  assert.equal(context.isHandConcludedEnough(), false);
});

test("a river hand is complete once winner resolution succeeds", () => {
  const context = buildCompletionContext({
    getCurrentHandWinnerSeatIndices: () => [1]
  });

  assert.equal(context.isHandConcludedEnough(), true);
});

test("a resolved winner still remains a draft while river action is pending", () => {
  const context = buildCompletionContext({
    handStreetNeedSeats: [0],
    getCurrentHandWinnerSeatIndices: () => [1]
  });

  assert.equal(context.isHandConcludedEnough(), false);
});

test("fold wins remain complete without showdown cards", () => {
  const context = buildCompletionContext({
    handStageIndex: 2,
    handBoardCards: { flop: ["", "", ""], turn: [""], river: [""] },
    isHandWonByFoldEnough: () => true,
    getHandActionCount: () => 1
  });

  assert.equal(context.isHandConcludedEnough(), true);
});

test("legacy draft classification verifies the stored result", () => {
  const context = {
    getStoredHandWinnerSeatIndices: (hand) => hand.verifiedWinners || []
  };
  vm.createContext(context);
  vm.runInContext(extractFunction("isHandDraft"), context);

  assert.equal(context.isHandDraft({ draft: true, verifiedWinners: [0] }), true);
  assert.equal(context.isHandDraft({ draft: false, verifiedWinners: [] }), false);
  assert.equal(context.isHandDraft({ winnerSeatIndex: 0, verifiedWinners: [] }), true);
  assert.equal(context.isHandDraft({ winnerSeatIndex: null, verifiedWinners: [1] }), false);
});

test("draft reload preserves reconstructed action state for showdown prompts", () => {
  assert.match(
    pokerHtml,
    /const savedHandIsDraft = isHandDraft\(hand\);[\s\S]*?rebuildHandStateForStreet\(savedStageIndex\);[\s\S]*?if \(!savedHandIsDraft\) \{\s*handCurrentActorIndex = null;\s*handStreetNeedSeats = \[\];/
  );
});

test("draft saves do not persist a provisional winner", () => {
  assert.match(
    pokerHtml,
    /const handIsDraft = !isHandConcludedEnough\(\);\s*const resolvedWinnerSeatIndices = getCurrentHandWinnerSeatIndices\(\);\s*const winnerSeatIndices = handIsDraft \? \[\] : resolvedWinnerSeatIndices;/
  );
});
