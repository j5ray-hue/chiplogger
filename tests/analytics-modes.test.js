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

test("analytics sections are collapsed by default with accessible toggles", () => {
  const sectionMatches = pokerHtml.match(
    /class="analytics-section" data-analytics-section="[^"]+" data-collapsed="true"/g
  ) || [];
  const toggleMatches = pokerHtml.match(
    /class="analytics-section-collapse-btn" aria-expanded="false"/g
  ) || [];

  assert.equal(sectionMatches.length, 5);
  assert.equal(toggleMatches.length, 5);
  assert.match(
    pokerHtml,
    /\.analytics-section\[data-collapsed="true"\] \.analytics-section-content\s*\{\s*display:\s*none/
  );
  assert.match(extractFunction("resetAnalyticsSectionsCollapsed"), /setAnalyticsSectionCollapsed\(section, true\)/);
});

test("tournament field and finish helpers bucket records correctly", () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(extractFunction("getTournamentFieldSizeLabel"), context);
  vm.runInContext(extractFunction("getTournamentFinishPercent"), context);

  assert.equal(context.getTournamentFieldSizeLabel(12), "< 20");
  assert.equal(context.getTournamentFieldSizeLabel(84), "50-99");
  assert.equal(context.getTournamentFieldSizeLabel(500), "500+");
  assert.equal(context.getTournamentFinishPercent({ numberPlayers: 100, placement: 5 }), 5);
  assert.equal(context.getTournamentFinishPercent({ numberPlayers: 0, placement: 1 }), null);
});

test("profit timelines sort mixed poker records by date", () => {
  const context = {
    sessions: [],
    parseSessionDate(record) {
      return record.date ? new Date(`${record.date} 00:00:00`) : null;
    }
  };
  vm.createContext(context);
  vm.runInContext(extractFunction("buildAllTimeProfitTimeline"), context);

  const timeline = context.buildAllTimeProfitTimeline([
    { id: "late", title: "Late cash", date: "June 10, 2026", profit: 100, analyticsType: "cash" },
    { id: "t1", title: "Early tournament", date: "June 2, 2026", profit: -50, analyticsType: "tournament" },
    { id: "mid", title: "Mid cash", date: "June 5, 2026", profit: 75, analyticsType: "cash" }
  ]);

  assert.deepEqual(
    Array.from(timeline, (entry) => entry.amount),
    [0, -50, 25, 125]
  );
  assert.equal(timeline[1].activityTitle, "Early tournament");
  assert.equal(timeline[1].sessionId, null);
  assert.equal(timeline[2].sessionId, "mid");
});

test("analytics renderer builds real cash, tournament, and combined presentations", () => {
  assert.match(
    extractFunction("buildAnalyticsDatasetForMode"),
    /mode === "tournament" \|\| mode === "combined"/
  );
  const tournamentPresentation = extractFunction("buildTournamentAnalyticsPresentation");
  assert.match(tournamentPresentation, /Tournament summary/);
  assert.match(tournamentPresentation, /Tournament outcomes/);
  assert.match(tournamentPresentation, /label: "ROI"/);
  assert.match(
    extractFunction("buildCombinedAnalyticsPresentation"),
    /Combined poker summary[\s\S]*Cash game profit[\s\S]*Tournament profit/
  );
  assert.match(
    extractFunction("renderAnalyticsDashboard"),
    /buildAnalyticsDatasetForMode\(analyticsMode\)[\s\S]*buildAnalyticsPresentation\(analyticsMode, model\)/
  );
});
