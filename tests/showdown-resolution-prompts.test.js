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

const emptyActions = () => ({ preflop: [], flop: [], turn: [], river: [] });

function buildContext(overrides = {}) {
  const context = {
    handSetupConfirmed: true,
    handStreetNeedSeats: [],
    handSeatStacks: [100, 100, 100],
    handSeatCards: [[], [], []],
    handStreetActions: emptyActions(),
    getCurrentStreetKey: () => "river",
    isCurrentStreetBoardReady: () => true,
    getActiveHandSeatIndices: () => [0, 1, 2],
    getCurrentShowdownEligibleSeats: () => [0, 1, 2],
    getHandGameCardCount: () => 2,
    getStreetKeysForGame: () => ["preflop", "flop", "turn", "river"],
    ...overrides
  };
  vm.createContext(context);
  [
    "parseOptionalSeatIndex",
    "uniqueSeatIndices",
    "seatHasCompleteShowdownHand",
    "orderShowdownSeatsByActionRecency",
    "getPendingShowdownSeatIndices"
  ].forEach((name) => vm.runInContext(extractFunction(name), context));
  return context;
}

test("showdown prompts follow action recency with the latest actor last", () => {
  const actions = emptyActions();
  actions.preflop.push({ seatIndex: 2, action: "call" });
  actions.flop.push({ seatIndex: 0, action: "check" });
  actions.river.push({ seatIndex: 1, action: "check" });
  const context = buildContext({ handStreetActions: actions });

  assert.deepEqual(
    Array.from(context.orderShowdownSeatsByActionRecency([0, 1, 2], actions, 3)),
    [2, 0, 1]
  );
});

test("only unresolved river showdown seats are prompted", () => {
  const actions = emptyActions();
  actions.river.push(
    { seatIndex: 0, action: "check" },
    { seatIndex: 1, action: "check" },
    { seatIndex: 2, action: "check" }
  );
  const card = (rank, suit) => ({ rank, suit });
  const context = buildContext({
    handStreetActions: actions,
    handSeatCards: [
      [],
      [card("A", "s")],
      [card("K", "s"), card("K", "h")]
    ]
  });

  assert.deepEqual(Array.from(context.getPendingShowdownSeatIndices()), [0, 1]);

  context.handSeatCards[0] = [card("Q", "s"), card("Q", "h")];
  assert.deepEqual(Array.from(context.getPendingShowdownSeatIndices()), [1]);

  context.handStreetNeedSeats = [0];
  assert.deepEqual(Array.from(context.getPendingShowdownSeatIndices()), []);
});

test("showdown hand completeness requires every hole card for the game", () => {
  const card = (rank, suit) => ({ rank, suit });
  const context = buildContext();
  const seats = [
    [card("A", "s")],
    [card("A", "s"), card("K", "s")],
    [card("A", "s"), card("K", "s"), card("Q", "s"), card("J", "s")]
  ];

  assert.equal(context.seatHasCompleteShowdownHand(0, seats, 2), false);
  assert.equal(context.seatHasCompleteShowdownHand(1, seats, 2), true);
  assert.equal(context.seatHasCompleteShowdownHand(1, seats, 4), false);
  assert.equal(context.seatHasCompleteShowdownHand(2, seats, 4), true);
});

test("showdown controls expose muck and setup-preserving hand assignment", () => {
  assert.match(pokerHtml, /muckBtn\.textContent = "Muck"/);
  assert.match(pokerHtml, /assignBtn\.textContent = "Assign hand"/);
  assert.match(
    pokerHtml,
    /openHandStackEditor\(i, \{ preserveSetup: true, focusCards: true \}\)/
  );
  assert.match(pokerHtml, /const eq = seatMuckedOnCurrentStreet \? 0 : seatEquityPct\(i\)/);
});
