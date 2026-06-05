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
  isHandTablePhoneLayout: () => true
};

vm.createContext(context);
[
  "getHandTablePhoneSeatMetrics",
  "getHandTableFeltMetrics",
  "getHandTableSeatRingRadiusFallback",
  "getHandTableFeltShape",
  "handTableFeltPerimeterLength",
  "handTableFeltPerimeterBoundaryAt",
  "handTableFeltPerimeterSlotPoint",
  "handTableEllipsePoint",
  "handTableSeatRingPosition",
  "clampPhoneHandActionRowToVisual",
  "formatPhoneHandSeatChipAmount"
].forEach((name) => vm.runInContext(extractFunction(name), context));

function phoneTableAspect(viewportWidth, playerCount) {
  if (viewportWidth <= 310) {
    if (playerCount > 17) return 0.36;
    if (playerCount > 14) return 0.42;
    if (playerCount > 10) return 0.52;
    return 0.65;
  }
  if (viewportWidth <= 340) {
    if (playerCount > 17) return 0.42;
    if (playerCount > 14) return 0.52;
    if (playerCount > 10) return 0.55;
    return 0.75;
  }
  if (playerCount > 17) return 0.55;
  if (playerCount > 14) return 0.68;
  if (playerCount > 10) return 0.65;
  return 0.82;
}

function pointIsInsideFelt(x, y, width, height) {
  const { cx, cy, capR, straightHalf, horizontal } =
    context.getHandTableFeltShape(width, height);
  if (horizontal) {
    if (x >= cx - straightHalf && x <= cx + straightHalf) {
      return Math.abs(y - cy) <= capR + 1e-6;
    }
    const capX = x < cx ? cx - straightHalf : cx + straightHalf;
    return Math.hypot(x - capX, y - cy) <= capR + 1e-6;
  }
  if (y >= cy - straightHalf && y <= cy + straightHalf) {
    return Math.abs(x - cx) <= capR + 1e-6;
  }
  const capY = y < cy ? cy - straightHalf : cy + straightHalf;
  return Math.hypot(x - cx, y - capY) <= capR + 1e-6;
}

test("phone player labels stay on the felt and do not overlap", () => {
  const feltBoundaryFailures = [];
  const labelCollisions = [];
  const centerCollisions = [];
  [296, 320, 351, 390, 430].forEach((viewportWidth) => {
    for (let playerCount = 2; playerCount <= 20; playerCount += 1) {
      const aspect = phoneTableAspect(viewportWidth, playerCount);
      const visualWidth = viewportWidth - 30;
      const feltWidth = visualWidth - 24;
      const feltHeight = (visualWidth / aspect) - 24;
      const totalSlots = playerCount + 1;
      const metrics = context.getHandTablePhoneSeatMetrics(totalSlots);
      const felt = {
        getBoundingClientRect: () => ({ width: feltWidth, height: feltHeight })
      };
      const labels = [];
      const centerWidth = Math.min(viewportWidth * 0.38, 110);
      const centerContent = {
        left: (feltWidth - centerWidth) / 2,
        right: (feltWidth + centerWidth) / 2,
        top: (feltHeight - 100) / 2,
        bottom: (feltHeight + 100) / 2
      };

      for (let slot = 1; slot < totalSlots; slot += 1) {
        const point = context.handTableSeatRingPosition(slot, totalSlots, felt);
        const centerX = (point.xPct / 100) * feltWidth;
        const centerY = (point.yPct / 100) * feltHeight;
        const label = {
          left: centerX - (metrics.width / 2),
          right: centerX + (metrics.width / 2),
          top: centerY - (metrics.height / 2),
          bottom: centerY + (metrics.height / 2)
        };
        const corners = [
          [label.left, label.top],
          [label.right, label.top],
          [label.left, label.bottom],
          [label.right, label.bottom]
        ];
        corners.forEach(([x, y]) => {
          if (!pointIsInsideFelt(x, y, feltWidth, feltHeight)) {
            feltBoundaryFailures.push(`${viewportWidth}px/${playerCount}p/slot${slot}`);
          }
        });
        const centerOverlapX =
          Math.min(label.right, centerContent.right) -
          Math.max(label.left, centerContent.left);
        const centerOverlapY =
          Math.min(label.bottom, centerContent.bottom) -
          Math.max(label.top, centerContent.top);
        if (centerOverlapX > 0.5 && centerOverlapY > 0.5) {
          centerCollisions.push(`${viewportWidth}px/${playerCount}p/slot${slot}`);
        }
        labels.push(label);
      }

      labels.forEach((left, leftIndex) => {
        labels.slice(leftIndex + 1).forEach((right, rightOffset) => {
          const overlapX =
            Math.min(left.right, right.right) - Math.max(left.left, right.left);
          const overlapY =
            Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
          if (overlapX > 0.5 && overlapY > 0.5) {
            labelCollisions.push(
              `${viewportWidth}px/${playerCount}p/slots${leftIndex + 1}-${leftIndex + rightOffset + 2}`
            );
          }
        });
      });
    }
  });
  assert.deepEqual(feltBoundaryFailures, [], "player labels extend outside the felt");
  assert.deepEqual(labelCollisions, [], "player labels overlap each other");
  assert.deepEqual(centerCollisions, [], "player labels overlap the center content band");
});

test("phone render mounts action controls above the acting seat", () => {
  assert.match(
    pokerHtml,
    /if \(allowedSeatActions\.length \|\| pendingShowdownSeat === i\)/
  );
  assert.doesNotMatch(
    pokerHtml,
    /if \(!phoneLayout && allowedSeatActions\.length\)/
  );
  assert.match(pokerHtml, /hand-seat-action-row-phone/);
  assert.match(
    pokerHtml,
    /\(phoneLayout \? handTableVisual : handTableFelt\)\.appendChild\(actionRow\)/
  );
  assert.match(
    pokerHtml,
    /clampPhoneHandActionRowToVisual\(actionRow, handTableVisual\)/
  );
});

test("phone stack and equity stay centered and wrap within the seat width", () => {
  assert.match(
    pokerHtml,
    /\.hand-table-felt \.hand-seat \.hand-seat-details \{\s*display: flex;\s*flex-direction: column;\s*align-items: center;/
  );
  assert.match(
    pokerHtml,
    /\.hand-table-felt \.hand-seat \.hand-seat-meta-row \{[\s\S]*?flex-wrap: wrap;[\s\S]*?width: 100%;\s*max-width: 100%;/
  );
});

test("phone stack amounts stay short at every magnitude", () => {
  assert.equal(context.formatPhoneHandSeatChipAmount(0), "$0");
  assert.equal(context.formatPhoneHandSeatChipAmount(200), "$200");
  assert.equal(context.formatPhoneHandSeatChipAmount(200.5), "$200.5");
  assert.equal(context.formatPhoneHandSeatChipAmount(999.99), "$999.99");
  assert.equal(context.formatPhoneHandSeatChipAmount(1000), "$1k");
  assert.equal(context.formatPhoneHandSeatChipAmount(23500), "$23.5k");
  assert.equal(context.formatPhoneHandSeatChipAmount(999950), "$1m");
  assert.equal(context.formatPhoneHandSeatChipAmount(1250000), "$1.3m");
  assert.equal(context.formatPhoneHandSeatChipAmount(1e100), "$1e+100");
});

test("phone action controls stay on-screen for a left-edge UTG seat", () => {
  const actionRow = {
    style: { left: "5%" },
    getBoundingClientRect: () => ({ width: 149 })
  };
  const visual = {
    getBoundingClientRect: () => ({ width: 364 })
  };

  context.clampPhoneHandActionRowToVisual(actionRow, visual);

  const centerX = Number.parseFloat(actionRow.style.left);
  assert.ok(centerX >= (149 / 2) + 6);
  assert.ok(centerX <= 364 - (149 / 2) - 6);
});
