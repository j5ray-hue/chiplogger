const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const pokerHtml = fs.readFileSync(path.join(__dirname, "..", "poker.html"), "utf8");
const winnerBlockStart = pokerHtml.indexOf("    function cardCodeFromObj");
const winnerBlockEnd = pokerHtml.indexOf("    function fullDeckCodes", winnerBlockStart);

if (winnerBlockStart < 0 || winnerBlockEnd < 0) {
  throw new Error("Could not find winner-resolution functions in poker.html");
}

const context = {
  handSeatStacks: [],
  handSeatCards: [],
  handSeatNicknames: [],
  handHeroSeatIndex: null,
  handBoardCards: { flop: [], turn: [], river: [] },
  getStreetKeysForGame: () => ["preflop", "flop", "turn", "river"],
  normalizePotBreakdown: (value) => value || null,
  getActiveHandSeatIndices: () => [],
  getCurrentNetPotBreakdown: () => null,
  getHandGameCardCount: () => 2
};

vm.createContext(context);
vm.runInContext(pokerHtml.slice(winnerBlockStart, winnerBlockEnd), context);

const card = (rank, suit) => ({ rank, suit });
const plain = (value) => JSON.parse(JSON.stringify(value));
const emptyActions = () => ({ preflop: [], flop: [], turn: [], river: [] });
const board = { flop: ["2c", "3d", "4h"], turn: ["9s"], river: ["Kc"] };

test("null seat values do not become seat zero", () => {
  assert.equal(context.parseOptionalSeatIndex(null, 2), null);
  assert.equal(context.parseOptionalSeatIndex("", 2), null);
  assert.equal(context.parseOptionalSeatIndex(0, 2), 0);

  const hand = {
    seatStacks: [100, 100],
    seatCards: [[], []],
    seatNicknames: ["Alice", "Bob"],
    heroSeatIndex: null,
    winnerSeatIndex: null,
    boardCards: { flop: [], turn: [], river: [] },
    streetActions: emptyActions()
  };

  assert.deepEqual(plain(context.getStoredHandWinnerSeatIndices(hand)), []);
  assert.equal(context.getStoredHandWinnerBannerText(hand), "");

  hand.streetActions.preflop.push({ seatIndex: null, action: "fold" });
  assert.deepEqual(plain(context.getStoredHandActiveSeats(hand, 2)), [0, 1]);
});

test("cards override a stale stored winner", () => {
  const hand = {
    seatStacks: [0, 0],
    seatCards: [
      [card("Q", "s"), card("Q", "h")],
      [card("K", "h"), card("K", "d")]
    ],
    seatNicknames: ["Alice", "Bob"],
    heroSeatIndex: null,
    winnerSeatIndex: 0,
    boardCards: board,
    streetActions: emptyActions()
  };

  assert.deepEqual(plain(context.getStoredHandWinnerSeatIndices(hand)), [1]);
  assert.equal(context.getStoredHandWinnerBannerText(hand), "Bob wins");
});

test("an incomplete active hand prevents a guessed showdown winner", () => {
  const hand = {
    seatStacks: [0, 0],
    seatCards: [[card("A", "s"), card("A", "h")], []],
    seatNicknames: ["Alice", "Bob"],
    heroSeatIndex: null,
    winnerSeatIndex: 0,
    boardCards: board,
    streetActions: emptyActions()
  };

  assert.deepEqual(plain(context.getStoredHandWinnerSeatIndices(hand)), []);
  assert.equal(context.getStoredHandWinnerBannerText(hand), "");
});

test("fold wins use the sole remaining player", () => {
  const hand = {
    seatStacks: [0, 0, 0],
    seatCards: [[], [], []],
    seatNicknames: ["Alice", "Hero", "Carol"],
    heroSeatIndex: 1,
    winnerSeatIndex: 0,
    boardCards: { flop: [], turn: [], river: [] },
    streetActions: {
      preflop: [
        { seatIndex: 0, action: "fold" },
        { seatIndex: 2, action: "fold" }
      ],
      flop: [],
      turn: [],
      river: []
    }
  };

  assert.deepEqual(plain(context.getStoredHandWinnerSeatIndices(hand)), [1]);
  assert.equal(context.getStoredHandWinnerBannerText(hand), "You win");
});

test("a showdown muck removes that seat and assigns the remaining winner", () => {
  const hand = {
    seatStacks: [0, 0],
    seatCards: [[card("A", "s"), card("A", "h")], []],
    seatNicknames: ["Alice", "Bob"],
    heroSeatIndex: null,
    winnerSeatIndex: null,
    boardCards: board,
    streetActions: {
      preflop: [],
      flop: [],
      turn: [],
      river: [{ seatIndex: 1, action: "muck", amount: null }]
    }
  };

  assert.deepEqual(plain(context.getStoredHandActiveSeats(hand, 2)), [0]);
  assert.deepEqual(plain(context.getStoredHandWinnerSeatIndices(hand)), [0]);
  assert.equal(context.getStoredHandWinnerBannerText(hand), "Alice wins");
});

test("board ties name every winner", () => {
  const hand = {
    seatStacks: [0, 0],
    seatCards: [
      [card("2", "c"), card("3", "c")],
      [card("4", "d"), card("5", "d")]
    ],
    seatNicknames: ["Alice", "Bob"],
    heroSeatIndex: null,
    winnerSeatIndex: 0,
    boardCards: { flop: ["As", "Ks", "Qs"], turn: ["Js"], river: ["Ts"] },
    streetActions: emptyActions()
  };

  assert.deepEqual(plain(context.getStoredHandWinnerSeatIndices(hand)), [0, 1]);
  assert.equal(context.getStoredHandWinnerBannerText(hand), "Alice and Bob win");
});

test("main and side pots can name different winners", () => {
  const hand = {
    seatStacks: [0, 0, 0],
    seatCards: [
      [card("A", "s"), card("5", "s")],
      [card("K", "h"), card("K", "d")],
      [card("9", "h"), card("9", "d")]
    ],
    seatNicknames: ["Shorty", "Deep", "Third"],
    heroSeatIndex: null,
    winnerSeatIndex: 0,
    boardCards: board,
    streetActions: emptyActions(),
    potBreakdown: {
      pots: [
        { amount: 300, seats: [0, 1, 2], eligibleSeats: [0, 1, 2], refundableSeatIndex: null },
        { amount: 400, seats: [1, 2], eligibleSeats: [1, 2], refundableSeatIndex: null }
      ],
      total: 700
    }
  };

  assert.deepEqual(plain(context.getStoredHandWinnerSeatIndices(hand)), [0, 1]);
  assert.equal(context.getStoredHandWinnerBannerText(hand), "Shorty and Deep win");
});

test("folded players are excluded even when their cards are strongest", () => {
  const hand = {
    seatStacks: [0, 0, 0],
    seatCards: [
      [card("A", "s"), card("A", "h")],
      [card("K", "h"), card("K", "d")],
      [card("Q", "h"), card("Q", "d")]
    ],
    seatNicknames: ["Folded", "Bob", "Carol"],
    heroSeatIndex: null,
    winnerSeatIndex: 0,
    boardCards: board,
    streetActions: {
      preflop: [{ seatIndex: 0, action: "fold" }],
      flop: [],
      turn: [],
      river: []
    }
  };

  assert.deepEqual(plain(context.getStoredHandWinnerSeatIndices(hand)), [1]);
  assert.equal(context.getStoredHandWinnerBannerText(hand), "Bob wins");
});

test("Omaha winners use exactly two hole cards", () => {
  const hand = {
    seatStacks: [0, 0],
    seatCards: [
      [card("T", "h"), card("9", "s"), card("8", "d"), card("7", "c")],
      [card("9", "h"), card("8", "h"), card("A", "s"), card("A", "d")]
    ],
    seatNicknames: ["Broadway", "Flush"],
    heroSeatIndex: null,
    winnerSeatIndex: 0,
    boardCards: { flop: ["Ah", "Kh", "Qh"], turn: ["Jh"], river: ["2c"] },
    streetActions: emptyActions()
  };

  assert.deepEqual(plain(context.getStoredHandWinnerSeatIndices(hand)), [1]);
  assert.equal(context.getStoredHandWinnerBannerText(hand), "Flush wins");
});
