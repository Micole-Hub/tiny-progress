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

const themeCss = read("style.css");
const journeyCss = read("github-page/milestones.css");
const htmlUi = read("index.html");
const forest = themeCss.slice(themeCss.lastIndexOf("TinyProgress | Morandi forest from Just Free Slide"));
assert.ok(forest.length > 5000, "User-sourced Morandi forest theme missing");
for (const token of [
  "--bg: #EFF0EA", "--surface: #F4EBE4", "--surface-3: #CCD2CC",
  "--green-deep: #4E6E62", "--today: #976666", "--nav-coffee: #8C736F"
]) assert.ok(forest.includes(token), "Missing sourced color: " + token);
assert.match(journeyCss, /User-sourced Morandi forest/);
const paletteSource = read("script.js");
for (const color of ["#AAB8AB", "#D4B8B4", "#728A7A", "#8C736F", "#CCD2CC"])
  assert.ok(paletteSource.includes(color), "Missing sourced color option: " + color);
assert.match(paletteSource, /title: "莫蘭迪森林"/);
assert.match(paletteSource, /title: "深色經典"/);
assert.match(paletteSource, /fill="\\$\\{l\\.color\\}"/);
const themeManifest = JSON.parse(read("manifest.webmanifest"));
assert.equal(themeManifest.background_color, "#EFF0EA");
assert.equal(themeManifest.theme_color, "#4E6E62");
assert.match(htmlUi, /name="theme-color" content="#4E6E62"/);
assert.match(read("app-icon.svg"), /fill="#4E6E62"/);
assert.match(htmlUi, /id="homeModeControl"/);
console.log("PASS: user-sourced Morandi forest palette, tree colors, PWA theme, existing custom options");

console.log("NOTE: cloud save, LINE delivery, schedule, PWA install and multi-device sync still require QA integration tests.");
