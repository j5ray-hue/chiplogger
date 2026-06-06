const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const pokerHtml = fs.readFileSync(path.join(__dirname, "..", "poker.html"), "utf8");

function extractFunction(name) {
  const markers = [`    function ${name}`, `    async function ${name}`];
  const start = markers
    .map((marker) => pokerHtml.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? -1;
  if (start < 0) throw new Error(`Could not find ${name} in poker.html`);
  const signatureEnd = pokerHtml.indexOf(")", start);
  const bodyStart = pokerHtml.indexOf("{", signatureEnd);
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

test("settings exposes Locations between General and Payment Plan", () => {
  assert.match(
    pokerHtml,
    /data-settings-panel="generalPanel">General[\s\S]*data-settings-panel="locationsPanel">Locations[\s\S]*data-settings-panel="paymentPanel">Payment Plan/
  );
  assert.match(
    pokerHtml,
    /id="locationsPanel"[\s\S]*id="settingsLocationInput"[\s\S]*id="settingsLocationAddBtn"[\s\S]*id="settingsLocationList"/
  );
});

test("cash and tournament pickers render from the same saved location source", () => {
  const cashRenderer = extractFunction("renderSessionLocationPickerList");
  const tournamentRenderer = extractFunction("renderTournamentLocationPickerList");
  const syncLocations = extractFunction("syncLocationDropdowns");

  assert.match(cashRenderer, /renderSavedLocationPickerOptions\(sessionLocationOptionsList/);
  assert.match(tournamentRenderer, /renderSavedLocationPickerOptions\(tournamentLocationOptionsList/);
  assert.match(syncLocations, /renderSessionLocationPickerList\(\)/);
  assert.match(syncLocations, /renderTournamentLocationPickerList\(\)/);
  assert.match(syncLocations, /renderSettingsLocationList\(\)/);
});

test("saved locations are trimmed, deduplicated, and sorted for every picker", () => {
  const context = {
    savedLocations: [" Bellagio ", "Aria", "Bellagio", "", "MGM Grand"]
  };
  vm.createContext(context);
  vm.runInContext(extractFunction("normalizeSavedLocationList"), context);
  vm.runInContext(extractFunction("getSavedLocationOptions"), context);

  assert.deepEqual(
    Array.from(context.getSavedLocationOptions()),
    ["Aria", "Bellagio", "MGM Grand"]
  );
});

test("deleting a saved location clears both active form selections", () => {
  const removeSavedLocation = extractFunction("removeSavedLocation");

  assert.match(removeSavedLocation, /setSessionLocationPickerSelection\(""\)/);
  assert.match(removeSavedLocation, /setTournamentLocationPickerSelection\(""\)/);
  assert.match(removeSavedLocation, /syncLocationDropdowns\(\)/);
  assert.match(removeSavedLocation, /queueSavedLocationsPersist\(\)/);
});
