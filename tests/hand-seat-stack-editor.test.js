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

test("unedited default stacks remain populated when adding cards", () => {
  const context = {
    handSeatStartingStacks: [200, 200, 200, 200, 200, 200],
    handSeatStacks: [200, 200, 200, 200, 199, 198]
  };
  vm.createContext(context);
  vm.runInContext(extractFunction("getHandStackEditorInputValue"), context);

  assert.equal(context.getHandStackEditorInputValue(4), "200");
});

test("empty seats keep an empty stack editor", () => {
  const context = {
    handSeatStartingStacks: [null],
    handSeatStacks: [null]
  };
  vm.createContext(context);
  vm.runInContext(extractFunction("getHandStackEditorInputValue"), context);

  assert.equal(context.getHandStackEditorInputValue(0), "");
});

test("adding cards to the small blind does not move the blind to the next seat", () => {
  const context = {
    handStageIndex: 0,
    handButtonSeatIndex: 3,
    handSeatStartingStacks: [200, 200, 200, 200, 200, 200],
    handSeatStacks: [200, 200, 200, 200, 199, 198],
    handSeatStackEdited: [false, false, false, false, false, false],
    handSeatCommitted: [0, 0, 0, 0, 1, 2],
    handSeatBlindPosted: [0, 0, 0, 0, 1, 2],
    handSeatFolded: [false, false, false, false, false, false],
    handStreetMaxCommit: 2,
    parseBlindAmountsFromStake: () => ({ sb: 1, bb: 2 })
  };
  vm.createContext(context);
  [
    "getHandStackEditorInputValue",
    "saveHandSeatStackValue",
    "getLiveSeatIndices",
    "applyBlindsFromButton"
  ].forEach((name) => vm.runInContext(extractFunction(name), context));

  const displayedStack = context.getHandStackEditorInputValue(4);
  context.saveHandSeatStackValue(4, displayedStack);
  context.applyBlindsFromButton();

  assert.deepEqual(
    Array.from(context.handSeatCommitted),
    [0, 0, 0, 0, 1, 2]
  );
});
