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

test("tournament bankroll profit subtracts the buy-in for misses and cashes", () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(extractFunction("calculateTournamentProfit"), context);

  assert.equal(context.calculateTournamentProfit(100, 0, false), -100);
  assert.equal(context.calculateTournamentProfit(100, 350, true), 250);
});

test("tournament metadata survives bankroll description persistence", () => {
  const context = {
    UNKNOWN: "Unknown",
    TOURNAMENT_METADATA_PREFIX: "__CHIPLOGGER_TOURNAMENT__:"
  };
  vm.createContext(context);
  [
    "tournamentMetadataPayload",
    "formatTournamentDescription",
    "serializeTournamentChangeDescription",
    "parseTournamentChangeDescription"
  ].forEach((name) => vm.runInContext(extractFunction(name), context));

  const tournament = {
    title: "Friday Deepstack",
    date: "June 5, 2026",
    timeStarted: "7:00 PM",
    timeEnded: "11:30 PM",
    duration: "4h 30m",
    durationMinutes: 270,
    gameType: "No-Limit Texas Hold'em",
    numberPlayers: 84,
    buyIn: 100,
    madeMoney: true,
    cashOut: 725,
    placement: 3,
    profit: 625,
    location: "Cardroom"
  };

  const description = context.serializeTournamentChangeDescription(tournament);
  const restored = context.parseTournamentChangeDescription(description);

  assert.equal(restored.title, tournament.title);
  assert.equal(restored.numberPlayers, 84);
  assert.equal(restored.madeMoney, true);
  assert.equal(restored.cashOut, 725);
  assert.equal(restored.placement, 3);
  assert.equal(restored.profit, 625);
});

test("the tournament UI exposes the requested home, form, and analytics controls", () => {
  assert.match(
    pokerHtml,
    /id="homeHandBtn"[\s\S]*id="homeBankrollBtn"[\s\S]*id="homeTournamentBtn"/
  );
  assert.match(
    pokerHtml,
    /id="tournamentPlayers"[\s\S]*id="tournamentBuyIn"[\s\S]*id="tournamentMoneyResult"/
  );
  assert.match(
    pokerHtml,
    /id="tournamentCashRow"[\s\S]*id="tournamentCashOut"[\s\S]*id="tournamentPlacement"/
  );
  assert.match(
    pokerHtml,
    /id="analyticsTypeSelect"[\s\S]*Cash game analytics[\s\S]*Tournament analytics/
  );
  assert.match(
    pokerHtml,
    /The add tournament hands feature will be added soon\./
  );
});
