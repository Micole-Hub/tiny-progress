"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const domains = ["backend/domain.js", "github-page/domain.js", "gas/TPDomain.gs"];
// The GAS source is tested in Node using a deterministic clock stub.
global.Utilities = {formatDate: (_date, _zone, format) => format === "yyyy-MM-dd" ? "2026-10-22" : ""};
let passed = 0;
for (const filename of domains) {
  const D = require(path.join(root, filename));
  const name = path.basename(filename);
  function notes(s, w, good, adjust = "", savedAt = "2026-10-22T07:00:00.000Z") {
    const n = D.clone(s);
    n.reflections[w] = {good, adjust, savedAt, updatedAt:"2026-10-22T08:00:00.000Z"};
    return n;
  }
  // Available even if the weekly tasks have not been completed.
  let current = D.empty("2026-10-22");
  let next = D.acceptWebState(current, notes(current,1,"星期四也能寫，不必等週末"));
  assert.equal(next.reflections[1].good,"星期四也能寫，不必等週末");
  // After saving, editing is permitted without resetting first saved time.
  const edit = notes(next,1,"想到就繼續補充","下週再練習");
  next = D.acceptWebState(next, edit);
  assert.equal(next.reflections[1].good,"想到就繼續補充");
  assert.equal(next.reflections[1].savedAt,"2026-10-22T07:00:00.000Z");
  // The history task data is still protected, while notes can be amended.
  const s = D.empty("2026-10-22");
  const task = D.add(s,"封存的任務");
  D.archive(s,1,"date");
  const historical = D.acceptWebState(s, notes(s,1,"已封存後補寫心得"));
  assert.equal(historical.reflections[1].good,"已封存後補寫心得");
  const changedTask = D.clone(historical);
  changedTask.tasks.find(t => t.id === task.id).title = "試圖改寫封存任務";
  assert.throws(()=>D.acceptWebState(historical,changedTask), /封存/);
  // No silent deletion or timestamp reset of a note that's already been saved.
  const deleted = D.clone(historical);
  delete deleted.reflections[1];
  assert.throws(()=>D.acceptWebState(historical, deleted), /首次儲存時間/);
  const changedTime = D.clone(historical);
  changedTime.reflections[1].savedAt = "2026-10-23T07:00:00.000Z";
  assert.throws(()=>D.acceptWebState(historical, changedTime), /首次儲存時間/);
  // Limit is about content size, never about which weekday the user saved it.
  const overlong = D.clone(historical);
  overlong.reflections[1].good = "x".repeat(81);
  assert.throws(()=>D.acceptWebState(historical, overlong), /感想格式/);
  console.log(`PASS ${name}: any-day write, edits, archived-note updates, history safety`);
  passed++;
}
const page = fs.readFileSync(path.join(root,"script.js"),"utf8");
const html = fs.readFileSync(path.join(root,"index.html"),"utf8");
const css = fs.readFileSync(path.join(root,"style.css"),"utf8");
assert(!page.includes('data-footprint-next'));
assert(/<button\b[^>]*id="footprintEntry"[^>]*>[\s\S]*?本週足跡[\s\S]*?<\/button>/.test(html));
assert(css.includes('--bg: #e9f0e8'));
assert(css.includes('linear-gradient(180deg, #f1f5ef 0px, var(--bg) 390px)'));
console.log("PASS UI: no early archive button, note entry, pale sage page background");
console.log(`${passed+1} weekly-reflection groups passed`);
