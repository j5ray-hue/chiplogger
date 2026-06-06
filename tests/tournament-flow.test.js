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

test("tournament average stack uses all starting chips divided by players remaining", () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(extractFunction("calculateTournamentAverageStack"), context);

  assert.equal(context.calculateTournamentAverageStack(30000, 100, 25), 120000);
  assert.equal(context.calculateTournamentAverageStack(30000, 100, 0), 0);
});

test("tournament hand chip amounts use one-decimal K, M, and B units", () => {
  const context = {};
  vm.createContext(context);
  [
    "formatMoney",
    "formatTournamentHandChipAmount"
  ].forEach((name) => vm.runInContext(extractFunction(name), context));

  assert.equal(context.formatTournamentHandChipAmount(999), "$999.00");
  assert.equal(context.formatTournamentHandChipAmount(1000), "$1.0K");
  assert.equal(context.formatTournamentHandChipAmount(1550), "$1.6K");
  assert.equal(context.formatTournamentHandChipAmount(999950), "$1.0M");
  assert.equal(context.formatTournamentHandChipAmount(1250000), "$1.3M");
  assert.equal(context.formatTournamentHandChipAmount(1250000000), "$1.3B");
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
    startingStack: 30000,
    buyIn: 100,
    madeMoney: true,
    cashOut: 725,
    placement: 3,
    profit: 625,
    location: "Cardroom",
    hands: [{
      id: "hand-1",
      tournamentInfo: {
        smallBlind: 500,
        bigBlind: 1000,
        playersRemaining: 21,
        placesPaid: 12,
        averageStack: 120000
      }
    }]
  };

  const description = context.serializeTournamentChangeDescription(tournament);
  const restored = context.parseTournamentChangeDescription(description);

  assert.equal(restored.title, tournament.title);
  assert.equal(restored.numberPlayers, 84);
  assert.equal(restored.startingStack, 30000);
  assert.equal(restored.madeMoney, true);
  assert.equal(restored.cashOut, 725);
  assert.equal(restored.placement, 3);
  assert.equal(restored.profit, 625);
  assert.equal(restored.hands.length, 1);
  assert.equal(restored.hands[0].tournamentInfo.bigBlind, 1000);
});

test("the tournament UI exposes the requested home, form, and analytics controls", () => {
  assert.match(
    pokerHtml,
    /id="homeHandBtn"[\s\S]*id="homeBankrollBtn"[\s\S]*id="homeTournamentBtn"/
  );
  assert.match(
    pokerHtml,
    /id="homeBankrollBtn"[\s\S]*class="home-widget-chart-wrap"[\s\S]*id="homeBankrollSparkline"/
  );
  assert.match(
    pokerHtml,
    /id="tournamentPlayers"[\s\S]*id="tournamentStartingStack"[\s\S]*id="tournamentBuyIn"[\s\S]*id="tournamentMoneyResult"/
  );
  assert.match(
    pokerHtml,
    /id="tournamentCashRow"[\s\S]*id="tournamentCashOut"[\s\S]*id="tournamentPlacement"/
  );
  assert.match(
    pokerHtml,
    /id="analyticsTypeSelect"[\s\S]*Cash game analytics[\s\S]*Tournament analytics[\s\S]*Combined analytics/
  );
  assert.match(
    pokerHtml,
    /function buildTournamentAnalyticsPresentation[\s\S]*function buildCombinedAnalyticsPresentation/
  );
  assert.doesNotMatch(pokerHtml, /Tournament analytics will be added soon|Combined analytics will be added soon/);
  assert.match(pokerHtml, /id="tournamentHandInfo"[\s\S]*id="tournamentHandSmallBlind"[\s\S]*id="tournamentHandBigBlind"/);
  assert.match(pokerHtml, /id="tournamentHandPlayersRemaining"[\s\S]*id="tournamentHandPlacesPaid"[\s\S]*id="tournamentHandAverageStack"/);
  assert.match(pokerHtml, /function openAddHandForTournament/);
  assert.match(pokerHtml, /tournaments\.forEach\(\(tournament, tournamentIndex\) =>/);
  assert.match(pokerHtml, /formatCurrentHandChipAmount\(handSeatStacks\[i\]/);
  assert.match(pokerHtml, /formatCurrentHandChipAmount\(Number\(committed\)/);
  assert.doesNotMatch(pokerHtml, /The add tournament hands feature will be added soon\./);
});
