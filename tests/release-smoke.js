"use strict";
// Run from the repository root: node tests/release-smoke.js
// No network, GAS, LINE messaging or cloud writes. A PASS does not replace E2E QA.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const html = read("index.html");
const sw = read("sw.js");
const server = read("backend/server.js");
const access = read("backend/access.js");
const gas = read("gas/Code.gs");
const files = [
  "script.js", "github-page/connection.js", "github-page/cycle-management.js",
  "github-page/domain.js", "github-page/milestones.js", "github-page/pwa.js",
  "sw.js", "backend/server.js", "backend/access.js", "backend/domain.js",
  "backend/line-cards.js", "backend/line-bot.js", "gas/Code.gs",
  "gas/TPDomain.gs", "gas/TinyProgressMissing.gs",
];
for (const file of files) {
  new vm.Script(read(file), { filename: file });
}
console.log("PASS: syntax parsed for browser, backend and GAS sources");
const linked = [...html.matchAll(/(?:href|src)="((?:style\.css|script\.js|github-page\/[^"]+\.(?:css|js))(?:\?[^"]*)?)"/g)]
  .map((match) => match[1]);
assert.ok(linked.length >= 9, "expected full homepage asset inventory");
for (const asset of linked) {
  const pathname = asset.split("?")[0];
  assert.ok(fs.existsSync(path.join(root, pathname)), "missing frontend asset: " + pathname);
  assert.ok(sw.includes(JSON.stringify("./" + asset)), "outdated PWA cache URL: " + asset);
}
console.log("PASS: PWA cached resources match the current homepage asset URLs");

assert.match(html, /<div class="app-shell" inert>/,
  "app shell must be inert before JS and login");
assert.match(html, /id="connectionGate"\s+class="connection-gate"\s+aria-label="雲端登入"\s*>/,
  "login gate must initially be shown, even if JS fails");
assert.match(html, /id="autoLoginLoading"[^>]*aria-live="polite">/,
  "initial authentication loader must be visible");
assert.match(html, /id="connectionForm" class="connection-card" hidden>/,
  "password form should not flash before session restore check");
assert.match(read("github-page/connection.js"), /document\.querySelector\("\.app-shell"\)\.inert = kind !== null/,
  "successful login must be able to unlock the app shell");
console.log("PASS: unauthenticated homepage starts locked until JS verifies session");

const connectionSource = read("github-page/connection.js");
const manageSource = connectionSource.match(/async function manage\(path, options = \{\}\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(manageSource, "cycle management request function must exist");
assert.match(manageSource, /if \(String\(options\.method \|\| "GET"\)\.toUpperCase\(\) === "GET"\)\s+return request\(path, options\)/,
  "GET cycle queries should not be blocked by pending writes");
assert.match(manageSource, /await flush\(\);[\s\S]*?dirty\(\) \|\| inflight \|\| paused \|\| pendingSave/,
  "cycle mutations must still wait for a safe, synchronized state");
console.log("PASS: cycle management reads work during pending saves; writes stay guarded");


assert.match(access, /app\.use\(\(req, res, next\)/);
assert.match(access, /x-line-signature/);
assert.match(access, /timingSafeEqual/);
assert.match(server, /Access\.install\(app, ACCESS/);
assert.match(server, /app\.post\("\/line\/webhook"/);
console.log("PASS: authentication and LINE signature checks are wired in source");
assert.match(server, /app\.post\("\/weeks\/postpone-current"[\s\S]*?status\(409\)/);
assert.match(gas, /if \(action === "postpone-current-week"\)\s*throw new Error/);
assert.match(read("script.js"), /function openReplanTask\(/);
console.log("PASS: retired day-based Week extension is blocked; task moving remains");
const D = require(path.join(root, "backend/domain.js"));
const Cards = require(path.join(root, "backend/line-cards.js"));
const Bot = require(path.join(root, "backend/line-bot.js"));
const state = D.empty("2026-10-26");
D.add(state, "測試整週任務", 1);
for (const kind of ["list", "monday", "footprint"]) {
  const card = Cards[kind](state, { week: 1, webUrl: "https://example.org/tiny-progress/" });
  assert.equal(card.type, "flex", kind + " must generate a LINE Flex message");
  assert.ok(card.altText && card.contents && card.contents.type === "bubble");
  assert.ok(JSON.stringify(card).length < 60000, kind + " card looks unexpectedly large");
}
const replies = Bot.respond(
  state,
  { source: { type: "user", userId: "Utest" }, message: { text: "清單" } },
  { webUrl: "https://example.org/tiny-progress/" }
);
assert.ok(Array.isArray(replies) && replies.length, "LINE text command should return messages");
console.log("PASS: LINE list, Monday, footprint cards and list command render locally");

const Milestones = require(path.join(root, "github-page/milestones.js"));
const journeyNode = {
  innerHTML: "", className: "",
  setAttribute() {}, querySelectorAll() { return []; }
};
const originalDocument = global.document;
try {
  global.document = { getElementById: (id) => id === "tpMilestones" ? journeyNode : null };
  const weeks = Array.from({ length: 12 }, (_, i) => ({
    number: i + 1, start: "2026-10-26", end: "2026-11-01",
    finished: false, leaves: i === 0 ? 3 : 0,
  }));
  Milestones.renderJourney({
    weeks, resting: true, currentWeek: 1, today: "2026-10-25",
    onReviewWeek() {},
  });
  assert.equal((journeyNode.innerHTML.match(/class="tp-journey-stop /g) || []).length, 12);
  assert.ok(!journeyNode.innerHTML.includes("data-journey-week="), "rest period cannot browse future History");
  assert.ok(journeyNode.innerHTML.includes("第一週結束後"), "no premature History during rest");
  weeks[0].finished = true;
  Milestones.renderJourney({
    weeks, resting: false, currentWeek: 2, today: "2026-11-02",
    onReviewWeek() {},
  });
  assert.equal((journeyNode.innerHTML.match(/data-journey-week=/g) || []).length, 1);
  assert.ok(journeyNode.innerHTML.includes("累積 3 片葉子"));
} finally {
  global.document = originalDocument;
}
assert.match(html, /id="historyArchiveSubtitle"/);
assert.match(html, /id="historyDirectionsWrap"/);
assert.match(read("script.js"), /historyWeekFinished\(week\)/);
assert.match(read("script.js"), /history-detail-layout/);
console.log("PASS: History renders only completed weeks, uses shared archive rules, and keeps its weekly journal layout");

const historyMarkSource = read("script.js").match(/function markHistorySelected\(\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(historyMarkSource, "history selection function must exist");
const exerciseHistorySelection = (week, cardWeeks) => {
  const selectedCards = cardWeeks.map(n => ({
    dataset: { historyWeek: String(n) },
    selected: null,
    ariaPressed: null,
    classList: { toggle(_name, value) { this.parent.selected = value; } },
    setAttribute(_name, value) { this.ariaPressed = value; },
  }));
  selectedCards.forEach(card => { card.classList.parent = card; });
  const historyGrid = { classList: {
    toggle(name, enabled) {
      assert.equal(name, "has-selection");
      assert.equal(enabled, week !== null);
    }
  }};
  const context = {
    historySelected: week,
    $: selector => {
      assert.equal(selector, "#historyGrid");
      return historyGrid;
    },
    $$: selector => {
      assert.equal(selector, "#historyGrid .history-card");
      return selectedCards;
    },
  };
  vm.runInNewContext(historyMarkSource + "\nmarkHistorySelected();", context);
  return selectedCards;
};
// Initial QA state can have zero completed weeks. It must not throw before login.
assert.equal(exerciseHistorySelection(null, []).length, 0);
const testedCards = exerciseHistorySelection(2, [1, 2, 3]);
assert.deepEqual(testedCards.map(c => c.selected), [false, true, false]);
assert.deepEqual(testedCards.map(c => c.ariaPressed), ["false", "true", "false"]);
console.log("PASS: History selection handles empty archive and multiple completed weeks without aborting login");



const hexInputIds = ["directionHexColor", "categoryHexColor", "categoryQuickHexColor"];
for (const id of hexInputIds) {
  assert.match(html, new RegExp('id="' + id + '"'), "HEX input missing: " + id);
}
assert.match(read("script.js"), /function normalizeHexColor\(value\)/);
assert.match(read("script.js"), /function bindCategoryCustomColor\(prefix, applyColor\)/);
assert.match(read("script.js"), /function bindDirectionColorInputs\(\)/);

const themeCss = read("style.css");
const journeyCss = read("github-page/milestones.css");
const htmlUi = read("index.html");
const clean = themeCss.slice(themeCss.lastIndexOf("QA: clean warm-paper base"));
assert.ok(clean.includes("background: #FFFEFA") && clean.includes("background: #F2F1EB"), "Warm white base missing");
assert.ok(!clean.includes("#976666") && !clean.includes("#D4B8B4"), "Rejected dusty rose theme survived");
assert.ok(journeyCss.includes("clean history journal") && !journeyCss.includes("#D4B8B4"), "History still has gray-pink fills");
const paletteSource = read("script.js");
assert.match(paletteSource, /function morandiTone\(hex\)/);
assert.match(paletteSource, /title: "莫蘭迪森林"/);
const paletteBlock = paletteSource.match(/const CATEGORY_PALETTE_GROUPS = \[([\s\S]*?)\n\];/);
assert.ok(paletteBlock, "category preset palettes are missing");
const presets = [...paletteBlock[1].matchAll(/\{ title: "([^"]+)", colors: \[([\s\S]*?)\]\s*\}/g)];
assert.deepEqual(presets.map((entry) => entry[1]), [
  "莫蘭迪森林", "晴空海岸", "暖陽果實", "馬卡龍果漾", "文青插畫",
], "category preset group names/order should match approved QA");
for (const group of presets) {
  assert.equal((group[2].match(/#[0-9A-Fa-f]{6}/g) || []).length, 12,
    group[1] + " should offer 12 colors");
}
assert.ok(!paletteBlock[1].includes('title: "明亮活力"'));
assert.ok(!paletteBlock[1].includes('title: "深色經典"'));
const uniqueColors = presets.flatMap(group => group[2].match(/#[0-9A-Fa-f]{6}/g) || []);
assert.equal(new Set(uniqueColors).size, 60, "the five palettes should offer 60 distinct colors");
const colorRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
for (const [name, swatches] of presets.map(([_, name, contents]) => [name, contents.match(/#[0-9A-Fa-f]{6}/g) || []])) {
  for (let i = 1; i < swatches.length; i++) {
    const before = colorRgb(swatches[i - 1]), after = colorRgb(swatches[i]);
    const distance = Math.hypot(...before.map((v, channel) => v - after[channel]));
    assert.ok(distance >= 60, name + ": adjacent swatches look too similar at " + (i - 1) + "/" + i);
  }
}

assert.match(paletteSource, /fill="\$\{morandiTone\(l\.color\)\}"/);
assert.match(paletteSource, /morandiTone\(categoryById\(t\.categoryId\)/);
const renderCards = read("backend/server.js");
const gasCards = read("gas/Code.gs");
const legacyCards = read("backend/line-cards.js");
assert.match(renderCards, /const LINE_TAG_PALETTE/);
assert.match(gasCards, /const TP_LINE_TAGS/);
assert.ok(!renderCards.includes('bg: "#F6E5E7"') && !gasCards.includes('bg: "#F2E4EF"'), "LINE card rose tags remain");
assert.match(legacyCards, /morandiTone\(D\.color\(s, t\)\)/);
assert.match(renderCards, /card: "#FFFEFA"/);
assert.match(gasCards, /card: "#FFFEFA"/);
const themeManifest = JSON.parse(read("manifest.webmanifest"));
assert.equal(themeManifest.background_color, "#F4F1EA");
assert.equal(themeManifest.theme_color, "#719478");
assert.match(htmlUi, /name="theme-color" content="#f4f1ea"/);
assert.match(htmlUi, /id="homeModeControl"/);
console.log("PASS: clean warm-paper theme, forest leaves and Morandi LINE card color assets");

console.log("NOTE: cloud save, LINE delivery, schedule, PWA install and multi-device sync still require QA integration tests.");
