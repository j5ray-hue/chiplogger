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
  const bodyStart = pokerHtml.indexOf("{", start);
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

const context = {
  handSeatStacks: [],
  handSeatStartingStacks: [],
  handSeatCommitted: [],
  handSeatFolded: [],
  handSidePotInfo: null,
  handLastPotBreakdown: null,
  handPot: 0
};

vm.createContext(context);
[
  "parseOptionalSeatIndex",
  "uniqueSeatIndices",
  "getAllInSeatsForPotBreakdown",
  "buildSinglePotBreakdownFromCommitted",
  "buildPotBreakdownFromCommitted",
  "normalizePotBreakdown",
  "clonePotLayer",
  "sameSeatSet",
  "mergePotBreakdowns",
  "getCurrentHandSeatContributions",
  "currentStreetPotBreakdown",
  "applyRakeToPotBreakdown",
  "getHandFeltPotDisplayModelFromBreakdown",
  "commitHandReplayStreetPot"
].forEach((name) => vm.runInContext(extractFunction(name), context));

const plain = (value) => JSON.parse(JSON.stringify(value));

test("three different all-in stacks create one main pot, one side pot, and a refund", () => {
  const result = plain(context.buildPotBreakdownFromCommitted(
    [100, 200, 300],
    [false, false, false],
    null,
    [0, 1, 2]
  ));

  assert.deepEqual(result.pots, [
    { amount: 300, seats: [0, 1, 2], eligibleSeats: [0, 1, 2], refundableSeatIndex: null },
    { amount: 200, seats: [1, 2], eligibleSeats: [1, 2], refundableSeatIndex: null },
    { amount: 100, seats: [2], eligibleSeats: [2], refundableSeatIndex: 2 }
  ]);
  assert.equal(result.mainPot, 300);
  assert.equal(result.sidePot, 200);
  assert.equal(result.total, 500);
  assert.equal(result.refundTotal, 100);
});

test("after the unmatched excess is returned only the main and side pots remain", () => {
  const result = plain(context.buildPotBreakdownFromCommitted(
    [100, 200, 200],
    [false, false, false],
    null,
    [0, 1]
  ));

  assert.deepEqual(result.pots.map((pot) => pot.amount), [300, 200]);
  assert.equal(result.mainPot, 300);
  assert.equal(result.sidePot, 200);
  assert.equal(result.total, 500);
  assert.equal(result.refundTotal, 0);
});

test("four different all-in stacks create each required matched side pot", () => {
  const result = plain(context.buildPotBreakdownFromCommitted(
    [50, 100, 150, 200],
    [false, false, false, false],
    null,
    [0, 1, 2, 3]
  ));

  assert.deepEqual(result.pots.map((pot) => pot.amount), [200, 150, 100, 50]);
  assert.deepEqual(result.pots.map((pot) => pot.eligibleSeats), [
    [0, 1, 2, 3],
    [1, 2, 3],
    [2, 3],
    [3]
  ]);
  assert.equal(result.mainPot, 200);
  assert.equal(result.sidePot, 250);
  assert.equal(result.total, 450);
  assert.equal(result.refundTotal, 50);
});

test("folded players contribute chips but are not eligible to win a pot", () => {
  const result = plain(context.buildPotBreakdownFromCommitted(
    [100, 200, 200],
    [false, true, false],
    null,
    [0]
  ));

  assert.deepEqual(result.pots[0].eligibleSeats, [0, 2]);
  assert.deepEqual(result.pots[1].eligibleSeats, [2]);
});

test("folded blind thresholds merge into the main pot", () => {
  const gross = plain(context.buildPotBreakdownFromCommitted(
    [0, 0, 520, 150, 2, 3, 520, 0, 0],
    [true, true, false, false, true, true, false, true, true],
    null,
    [3, 6]
  ));
  const net = plain(context.applyRakeToPotBreakdown(gross, 6));
  const display = plain(context.getHandFeltPotDisplayModelFromBreakdown(net));

  assert.deepEqual(gross.pots.map((pot) => pot.amount), [455, 740]);
  assert.deepEqual(gross.pots.map((pot) => pot.eligibleSeats), [
    [2, 3, 6],
    [2, 6]
  ]);
  assert.equal(gross.mainPot, 455);
  assert.equal(gross.sidePot, 740);
  assert.equal(gross.total, 1195);
  assert.deepEqual(net.pots.map((pot) => pot.amount), [449, 740]);
  assert.equal(display.mainAmount, 449);
  assert.deepEqual(display.sidePots.map((pot) => pot.amount), [740]);
});

test("unequal bets do not become side pots before a player is all in", () => {
  context.handSeatStacks = [50, 100, 100];
  const result = plain(context.buildPotBreakdownFromCommitted(
    [50, 100, 100],
    [false, false, false],
    null,
    []
  ));

  assert.equal(result.pots.length, 1);
  assert.equal(result.mainPot, 250);
  assert.equal(result.sidePot, 0);
});

test("settlement returns an uncalled bet even when the bettor is not all in", () => {
  const result = plain(context.buildPotBreakdownFromCommitted(
    [100, 0],
    [false, true],
    null,
    [],
    true
  ));

  assert.equal(result.total, 0);
  assert.equal(result.refundTotal, 100);
  assert.equal(result.pots[0].refundableSeatIndex, 0);
});

test("replay settlement returns unmatched chips and commits only contestable pots", () => {
  const state = {
    seatCount: 3,
    seatStacks: [0, 0, 0],
    seatCommitted: [100, 200, 300],
    seatContributions: [100, 200, 300],
    seatFolded: [false, false, false],
    currentActorIndex: 2,
    streetCurrentBet: 300,
    pot: 0
  };

  context.commitHandReplayStreetPot(state);

  assert.deepEqual(plain(state.seatStacks), [0, 0, 100]);
  assert.deepEqual(plain(state.seatContributions), [100, 200, 200]);
  assert.deepEqual(plain(state.seatCommitted), [0, 0, 0]);
  assert.equal(state.pot, 500);
  assert.equal(state.currentActorIndex, null);
  assert.equal(state.streetCurrentBet, 0);
});

test("pot layers merge correctly when all-ins happen on a later street", () => {
  const base = {
    pots: [
      { amount: 150, seats: [0, 1, 2], eligibleSeats: [0, 1, 2], refundableSeatIndex: null }
    ]
  };
  const laterStreet = context.buildPotBreakdownFromCommitted(
    [50, 100, 100],
    [false, false, false],
    null,
    [0]
  );
  const merged = plain(context.mergePotBreakdowns(base, laterStreet, 400));

  assert.deepEqual(merged.pots.map((pot) => pot.amount), [300, 100]);
  assert.deepEqual(merged.pots.map((pot) => pot.eligibleSeats), [
    [0, 1, 2],
    [1, 2]
  ]);
  assert.equal(merged.mainPot, 300);
  assert.equal(merged.sidePot, 100);
  assert.equal(merged.total, 400);
});

test("the felt display excludes unmatched refunds from the side-pot list", () => {
  const breakdown = context.buildPotBreakdownFromCommitted(
    [100, 200, 300],
    [false, false, false],
    null,
    [0, 1, 2]
  );
  const display = plain(context.getHandFeltPotDisplayModelFromBreakdown(breakdown));

  assert.equal(display.mainAmount, 300);
  assert.deepEqual(display.sidePots.map((pot) => pot.amount), [200]);
  assert.equal(display.total, 500);
});

test("the exact nine-seat 2/3 hand rebuilds as one main pot and one side pot", () => {
  context.handSeatStartingStacks = [300, 300, 1000, 150, 300, 300, 520, 300, 300];
  context.handSeatStacks = [300, 300, 480, 0, 298, 297, 0, 300, 300];
  context.handSeatCommitted = Array.from({ length: 9 }, () => 0);
  context.handSeatFolded = [true, true, false, false, true, true, false, true, true];
  context.handSidePotInfo = {
    street: "preflop",
    allInSeatIndex: 3,
    threshold: 150
  };
  context.handPot = 1195;
  context.handLastPotBreakdown = {
    pots: [
      { amount: 4, seats: [2, 3, 4, 5, 6], eligibleSeats: [2, 3, 6], refundableSeatIndex: null },
      { amount: 4, seats: [2, 3, 5, 6], eligibleSeats: [2, 3, 6], refundableSeatIndex: null },
      { amount: 441, seats: [2, 3, 6], eligibleSeats: [2, 3, 6], refundableSeatIndex: null },
      { amount: 740, seats: [2, 6], eligibleSeats: [2, 6], refundableSeatIndex: null }
    ]
  };

  const gross = plain(context.currentStreetPotBreakdown());
  const net = plain(context.applyRakeToPotBreakdown(gross, 6));
  const display = plain(context.getHandFeltPotDisplayModelFromBreakdown(net));

  assert.deepEqual(gross.pots.map((pot) => pot.amount), [455, 740]);
  assert.equal(gross.mainPot, 455);
  assert.equal(gross.sidePot, 740);
  assert.equal(gross.total, 1195);
  assert.deepEqual(net.pots.map((pot) => pot.amount), [449, 740]);
  assert.equal(display.mainAmount, 449);
  assert.deepEqual(display.sidePots.map((pot) => pot.amount), [740]);
});
