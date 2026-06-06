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

test("bankroll changes are sorted by date with undated changes kept last", () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(extractFunction("sortBankrollChangesChronologically"), context);

  const changes = [
    { id: "newer", dateMs: Date.parse("2026-06-05") },
    { id: "undated-a", dateMs: null },
    { id: "older", dateMs: Date.parse("2026-05-01") },
    { id: "same-day", dateMs: Date.parse("2026-06-05") },
    { id: "undated-b", dateMs: null }
  ];
  const ordered = context.sortBankrollChangesChronologically(changes, (change) => change.dateMs);

  assert.deepEqual(
    ordered.map((change) => change.id),
    ["older", "newer", "same-day", "undated-a", "undated-b"]
  );
});

test("bankroll timeline recalculates balances in chronological order", () => {
  const context = {
    UNKNOWN: "unknown",
    startingBankroll: 100,
    bankroll: 0,
    bankrollTimeline: [],
    bankrollChanges: [
      {
        id: "newer-deposit",
        amount: 200,
        type: "manual",
        manualDate: "June 5, 2026"
      },
      {
        id: "older-withdrawal",
        amount: -200,
        type: "manual",
        manualDate: "May 1, 2026"
      }
    ],
    sessions: [],
    tournaments: [],
    bankrollChart: null,
    bankrollChangesTableWrap: null,
    homeBankrollSparkline: null
  };
  vm.createContext(context);
  [
    "floorBankrollAtZero",
    "parseSessionDate",
    "bankrollChangeDateMsForSort",
    "sortBankrollChangesChronologically",
    "recomputeBankroll"
  ].forEach((name) => vm.runInContext(extractFunction(name), context));

  context.recomputeBankroll();

  assert.equal(context.bankroll, 200);
  assert.deepEqual(
    context.bankrollTimeline.slice(1).map((entry) => ({
      date: entry.chartDate.toISOString().slice(0, 10),
      amount: entry.amount,
      autoTopUpAmount: entry.autoTopUpAmount
    })),
    [
      { date: "2026-05-01", amount: 0, autoTopUpAmount: 100 },
      { date: "2026-06-05", amount: 200, autoTopUpAmount: 0 }
    ]
  );
});
