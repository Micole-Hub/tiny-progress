const D = window.TPDomain;
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS = {
  mon: "一",
  tue: "二",
  wed: "三",
  thu: "四",
  fri: "五",
  sat: "六",
  sun: "日",
};
// Clean Morandi accents: foliage / olive / fog blue / sand. No dusty rose.
const PALETTE = [
  "#829D86", "#90AA9B", "#8FA6B5", "#A5A98C",
  "#B3A080", "#9DA7B2", "#76958A", "#A9BBA6",
  "#A49E85", "#99A8A4", "#9D9FB4", "#B8AD91",
];
// Display colors are intentionally separate from cloud-stored HEX values.
// Original category/direction settings and archived data stay editable.
const MORANDI_LEAF_TONES = [
  ["#A58E72", "#BBAA8A"], // warm sand
  ["#999875", "#B0AE86"], // olive
  ["#78977E", "#A1B59D"], // foliage
  ["#779995", "#9AB4B0"], // eucalyptus
  ["#8198AD", "#A2B4C4"], // fog blue
  ["#9695A7", "#B1B0C2"], // mist violet
];
function morandiTone(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(String(hex || ""))) return "#9AAE97";
  const normalized = hex.toUpperCase();
  // A displayed Morandi color must remain identical on repeated rendering.
  if (PALETTE.includes(normalized) || MORANDI_LEAF_TONES.some(pair => pair.includes(normalized)))
    return normalized;
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min;
  let hue = 0;
  if (delta) {
    const n = rgb.indexOf(max);
    hue = 60 * (n === 0 ? ((rgb[1] - rgb[2]) / delta) % 6
      : n === 1 ? (rgb[2] - rgb[0]) / delta + 2
      : (rgb[0] - rgb[1]) / delta + 4);
    if (hue < 0) hue += 360;
  }
  // Reds and pinks become warm sand instead of the unwanted dusty-rose shade.
  const group = hue < 25 || hue >= 330 ? 0
    : hue < 72 ? 1 : hue < 170 ? 2
      : hue < 207 ? 3 : hue < 273 ? 4 : 5;
  return MORANDI_LEAF_TONES[group][(max + min) / 2 >= 0.63 ? 1 : 0];
}
const CATEGORY_PALETTE_GROUPS = [
  { title: "莫蘭迪森林", colors: [
    "#829D86", "#90AA9B", "#8FA6B5", "#A5A98C", "#B3A080", "#9DA7B2",
    "#76958A", "#A9BBA6", "#A49E85", "#99A8A4", "#9D9FB4", "#B8AD91",
  ] },
  { title: "柔和粉彩", colors: [
    "#9FC3DE", "#EFB8CF", "#E7CE72", "#E3B48A", "#A9CB9F", "#C8B9E6",
    "#D4A99C", "#91B4A2", "#AEB8D3", "#D5C09C", "#B5A3C9", "#BEC9B2",
  ] },
  { title: "自然霧色", colors: [
    "#7F9C87", "#6E9F92", "#A5BB8E", "#C3AD86", "#BA8E81", "#C8A2A5",
    "#A58EA9", "#819CAD", "#B7B39B", "#9FADAB", "#8BA3C7", "#CAAEA5",
  ] },
  // Bright macaron colors are for color selection; tree leaves retain Morandi rendering.
  { title: "馬卡龍果漾", colors: [
    "#F39BAA", "#FFB3A4", "#F4B27E", "#F6CF71", "#E9DF84", "#A9D68E",
    "#7CCFA6", "#6ED1CE", "#85C7ED", "#96ACEF", "#BAA1EA", "#E7A2D6",
  ] },
  { title: "文青日常", colors: [
    "#C77558", "#DA966D", "#D3AF58", "#AFA660", "#8BA674", "#6D9B7A",
    "#5C9B97", "#679AAE", "#7596BC", "#857FB3", "#AD84A9", "#A97C5D",
  ] },
];
function normalizeHexColor(value) {
  const input = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(input)) return input.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(input))
    return ("#" + [...input.slice(1)].map((c) => c + c).join("")).toUpperCase();
  return null;
}
function renderCategoryPresetPalette(containerId, selected, onChoose) {
  const container = $("#" + containerId);
  const current = normalizeHexColor(selected) || "#9FC3DE";
  container.innerHTML = CATEGORY_PALETTE_GROUPS.map((group) =>
    `<div class="category-palette-group"><span class="category-palette-group-title">${group.title}</span>` +
    `<div class="category-color-grid">${group.colors.map((color) =>
      `<button type="button" class="category-color-option ${color === current ? "is-selected" : ""}"` +
      ` style="--swatch:${color}" data-preset-color="${color}"` +
      ` aria-label="選擇 ${color}" aria-pressed="${String(color === current)}" title="${color}"></button>`
    ).join("")}</div></div>`
  ).join("");
  container.onclick = (e) => {
    const swatch = e.target.closest("[data-preset-color]");
    if (swatch && container.contains(swatch)) onChoose(swatch.dataset.presetColor);
  };
}
function updateCategoryColorInputs(prefix, selected, showInvalid = false) {
  const valid = normalizeHexColor(selected);
  const hexInput = $("#" + prefix + "HexColor");
  const preview = $("#" + prefix + "ColorPreview");
  const native = $("#" + prefix + "NativeColor");
  const error = $("#" + prefix + "HexError");
  if (valid) {
    hexInput.value = valid;
    native.value = valid;
    preview.style.backgroundColor = valid;
  }
  error.hidden = !showInvalid;
  hexInput.setAttribute("aria-invalid", String(showInvalid));
  const submit = prefix === "categoryQuick" ? $("#applyCategoryColor") : $("#categoryForm .primary-button");
  if (submit) submit.disabled = showInvalid;
}
function bindCategoryCustomColor(prefix, applyColor) {
  const native = $("#" + prefix + "NativeColor");
  const hex = $("#" + prefix + "HexColor");
  native.addEventListener("input", () => applyColor(native.value));
  hex.addEventListener("input", () => {
    // 輸入過程只接受完整的六位 HEX，避免剛打完三位時提前轉成縮寫色而打斷輸入。
    const parsed = /^#[0-9a-f]{6}$/i.test(hex.value.trim())
      ? normalizeHexColor(hex.value)
      : null;
    const error = $("#" + prefix + "HexError");
    const invalid = !parsed;
    error.hidden = !invalid;
    hex.setAttribute("aria-invalid", String(invalid));
    const button = prefix === "categoryQuick" ? $("#applyCategoryColor") : $("#categoryForm .primary-button");
    if (button) button.disabled = invalid;
    if (parsed) {
      applyColor(parsed);
    }
  });
  hex.addEventListener("blur", () => {
    const parsed = normalizeHexColor(hex.value);
    if (parsed) applyColor(parsed);
  });
}
const NEUTRAL_LEAF = "#9eb29a";
const REASONS = ["時間不夠", "事情太大", "忘記了", "不想做了"];

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
function localIso(d = new Date()) {
  const y = d.getFullYear(),
    m = String(d.getMonth() + 1).padStart(2, "0"),
    day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function dateFromIso(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
let TODAY = D.today();
function mondayOfIso(iso) {
  const d = dateFromIso(iso),
    day = d.getDay(),
    diff = day === 0 ? -6 : 1 - day;
  return localIso(addDays(d, diff));
}
let CYCLE_START_YMD = D.monday(TODAY),
  CYCLE_WEEK_STARTS = null,
  CYCLE_WEEK_RANGES = null;
function calendarWeekFor(iso = TODAY) {
  if (CYCLE_WEEK_STARTS?.length === 12)
    return Math.max(
      1,
      CYCLE_WEEK_STARTS.reduce((n, start, i) => (start <= iso ? i + 1 : n), 1),
    );
  const start = dateFromIso(CYCLE_START_YMD),
    day = dateFromIso(iso);
  if (day < start) return 1;
  const diff = Math.floor((day - start) / 86400000);
  return Math.max(1, Math.min(12, Math.floor(diff / 7) + 1));
}
let CURRENT_WEEK = calendarWeekFor(TODAY);
function weekDateMap(week) {
  const range = CYCLE_WEEK_RANGES?.[Number(week) - 1];
  const start =
    range?.start ||
    CYCLE_WEEK_STARTS?.[Number(week) - 1] ||
    D.addDays(CYCLE_START_YMD, (Number(week) - 1) * 7);
  const n = range
    ? Math.round((Date.parse(range.end) - Date.parse(start)) / 86400000) + 1
    : 7;
  return Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      DAY_KEYS[i] || "extra" + i,
      D.addDays(start, i),
    ]),
  );
}
function dayLabel(date) {
  return ["日", "一", "二", "三", "四", "五", "六"][dateFromIso(date).getDay()];
}
function treeWeek() {
  return state.selectedWeek || CURRENT_WEEK;
}

function occurrence(id, date = "") {
  return { id, date, done: false, doneDate: "" };
}
function recurringTask(
  id,
  title,
  categoryId,
  frequency,
  targetCount,
  week = CURRENT_WEEK,
  assignedDates = [],
) {
  const dates = weekDateMap(week);
  const occ = Array.from({ length: targetCount }, (_, i) =>
    occurrence(
      `${id}-o${i + 1}`,
      frequency === "daily" ? dates[DAY_KEYS[i]] || "" : assignedDates[i] || "",
    ),
  );
  return {
    id,
    week,
    title,
    categoryId,
    goal: "",
    status: "active",
    focusDate: "",
    done: false,
    doneDate: "",
    note: "",
    recurringRuleId: `rr-${id}`,
    frequency,
    targetCount,
    occurrences: occ,
  };
}
// 正式版只讀取雲端資料；不再內建獨立的示範任務庫。

let state = loadState();
// Lens preference lives on this device, not in the authoritative task database.
try {
  const preference = localStorage.getItem("tp-view-preference");
  if (preference === "week" || preference === "day") state.mode = preference;
} catch {}
// 只控制休息期 UI，與雲端儲存的週次及任務資料分離。
let restPlannerOpen = false;
let quickAddOpen = false;
// 休息日的日曆日期獨立於 12 週任務，切換箭頭不會更動雲端計畫。
state.unfinishedReasons = state.unfinishedReasons || {};
state.tankReviewed = state.tankReviewed || {};
state.weekMeta = state.weekMeta || {};
state.footprintDeferred = state.footprintDeferred || {};
function syncGoals() {
  state.cycle.goals = state.cycle.directions.map((d) => d.name);
}
syncGoals();

let lastListKey = null,
  prevDone = null,
  justToggled = null,
  justAdded = null,
  treeIntro = true,
  activeFalls = [];
const flyingKeys = new Set(),
  growKeys = new Set();
let actionOccIds = [],
  dupAllowed = false,
  pendingNoteOccId = "",
  pendingNoteOccIds = [],
  historySelected = null,
  footprintWeek = null;
let actionTaskId = null,
  actionOccurrenceId = null,
  pendingNoteTaskId = null,
  editingTaskId = null,
  editingTaskOccurrenceId = null,
  editingRecurringId = null,
  editingCategoryId = null,
  categoryPickColor = PALETTE[0],
  categoryQuickTargetId = null,
  categoryQuickColor = PALETTE[0];

function loadState() {
  return TPConnection.initial();
}
function saveState() {
  TPConnection.save(state);
}
// The cycle start is authoritative. After changing a future start date, an older
// server snapshot may still contain weekStarts/weekRanges for the previous date.
// Align those calendars for display only; never mutate the saved cycle or tasks.
function alignedCycleDates(items, firstStart, mapItem) {
  if (!Array.isArray(items) || !items.length) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(firstStart || "")) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(CYCLE_START_YMD || "")))
    return items;
  const shiftDays = Math.round(
    (Date.parse(CYCLE_START_YMD) - Date.parse(firstStart)) / 86400000,
  );
  if (!Number.isFinite(shiftDays) || shiftDays === 0) return items;
  return items.map((item) => mapItem(item, shiftDays));
}
function refreshClock() {
  TODAY = D.today();
  CYCLE_START_YMD = state.cycle.startDate;
  const rawStarts = state.cycle.weekStarts;
  const rawRanges = state.cycle.weekRanges;
  CYCLE_WEEK_STARTS = alignedCycleDates(
    rawStarts,
    rawStarts?.[0],
    (date, days) => D.addDays(date, days),
  );
  CYCLE_WEEK_RANGES = alignedCycleDates(
    rawRanges,
    rawRanges?.[0]?.start,
    (range, days) => ({
      ...range,
      start: range.start ? D.addDays(range.start, days) : range.start,
      end: range.end ? D.addDays(range.end, days) : range.end,
    }),
  );
  CURRENT_WEEK = calendarWeekFor(TODAY);
}
function categoryById(id) {
  return state.categories.find((c) => c.id === id);
}
function taskColor(t) {
  return morandiTone(categoryById(t.categoryId)?.color || NEUTRAL_LEAF);
}
function activeTasks(week = state.selectedWeek) {
  return state.tasks.filter((t) => t.week === week && t.status === "active");
}
function rowIds(row) {
  return row?.dataset?.occurrenceIds
    ? row.dataset.occurrenceIds.split(",").filter(Boolean)
    : [];
}
function isRecurring(t) {
  return Boolean(t.recurringRuleId && Array.isArray(t.occurrences));
}
function occurrenceDoneCount(t) {
  return isRecurring(t)
    ? t.occurrences.filter((o) => o.done).length
    : t.done
      ? 1
      : 0;
}
function taskTarget(t) {
  return isRecurring(t) ? t.targetCount : 1;
}
function taskDone(t) {
  return occurrenceDoneCount(t) >= taskTarget(t);
}
function syncTaskDone(t) {
  t.done = taskDone(t);
  t.doneDate = t.done
    ? t.occurrences
        ?.filter((o) => o.done)
        .map((o) => o.doneDate)
        .filter(Boolean)
        .sort()
        .at(-1) ||
      t.doneDate ||
      TODAY
    : "";
}
function currentLeafRecords(week = CURRENT_WEEK) {
  const out = [];
  activeTasks(week).forEach((t) => {
    if (isRecurring(t))
      t.occurrences
        .filter((o) => o.done)
        .forEach((o) =>
          out.push({
            key: `${t.id}:${o.id}`,
            color: taskColor(t),
            title: t.title,
            date: o.doneDate,
            taskId: t.id,
            rec: true,
            target: t.targetCount,
            note: o.note || "",
            noteEnabled: o.noteEnabledAtCompletion,
          }),
        );
    else if (t.done)
      out.push({
        key: `${t.id}`,
        color: taskColor(t),
        title: t.title,
        date: t.doneDate,
        taskId: t.id,
        note: t.note,
        noteEnabled: t.noteEnabledAtCompletion,
      });
  });
  return out;
}
function currentCompletedUnits(week = CURRENT_WEEK) {
  return currentLeafRecords(week).length;
}
function currentTotalUnits(week = CURRENT_WEEK) {
  return activeTasks(week).reduce((n, t) => n + taskTarget(t), 0);
}
function isWeekComplete(week) {
  const tasks = activeTasks(week);
  return tasks.length > 0 && tasks.every(taskDone);
}
function weekMetaFor(week) {
  const key = String(Number(week));
  state.weekMeta[key] = state.weekMeta[key] || {
    archivedAt: "",
    archiveReason: "",
    autoArchived: false,
  };
  return state.weekMeta[key];
}
function isWeekArchived(week) {
  return Boolean(weekMetaFor(week).archivedAt);
}
function archiveWeek(week, reason = "review") {
  D.archive(state, Number(week), reason);
  return weekMetaFor(week);
}
function autoArchivePastWeeks() {
  for (let w = 1; w < CURRENT_WEEK; w++)
    if (!isWeekArchived(w)) archiveWeek(w, "date");
  const lastDates = weekDateMap(12),
    cycleEnd = lastDates.sun;
  if (compareIsoDate(TODAY, cycleEnd) > 0 && !isWeekArchived(12))
    archiveWeek(12, "date");
}
function compareIsoDate(a, b) {
  return String(a).slice(0, 10).localeCompare(String(b).slice(0, 10));
}
function highestUnlockedWeek() {
  return D.highest(state);
}
function isWeekUnlocked(week) {
  return Number(week) <= highestUnlockedWeek();
}
function canEnterWeek(week) {
  week = Number(week);
  // Before a cycle starts, its 12 weeks may be browsed without unlocking tasks.
  if (isCycleResting()) return week >= 1 && week <= 12;
  return (
    week >= 1 &&
    week <= 12 &&
    isWeekUnlocked(week) &&
    (!isWeekArchived(week) || week === CURRENT_WEEK)
  );
}
function defaultDateForWeek(week) {
  const dates = Object.values(weekDateMap(week));
  return Number(week) === CURRENT_WEEK && dates.includes(TODAY)
    ? TODAY
    : dates[0];
}
function currentWeekDefaultDate() {
  return defaultDateForWeek(CURRENT_WEEK);
}
function normalizeSelectedWeek() {
  state.selectedWeek = Number(state.selectedWeek) || CURRENT_WEEK;
  if (!canEnterWeek(state.selectedWeek)) state.selectedWeek = CURRENT_WEEK;
  const dates = Object.values(weekDateMap(state.selectedWeek));
  if (!dates.includes(state.selectedDate))
    state.selectedDate = defaultDateForWeek(state.selectedWeek);
}
function weekLifecycle(week) {
  week = Number(week);
  if (isWeekArchived(week)) return "archived";
  if (week > CURRENT_WEEK) return isWeekUnlocked(week) ? "planning" : "locked";
  if (week < CURRENT_WEEK) return "archived";
  if (compareIsoDate(TODAY, CYCLE_START_YMD) < 0) return "planning";
  return isWeekComplete(week) ? "review" : "active";
}
function guardWeekEditable(
  week,
  message = "這一週已封存，只能在 History 查看",
) {
  if (isWeekArchived(week)) {
    showToast(message);
    return false;
  }
  return true;
}
// View switch selection must repaint independently of cloud and History.
function syncViewModeButtons() {
  document.querySelectorAll("#homeModeControl [data-mode]").forEach((button) => {
    const selected = button.dataset.mode === state.mode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}
function renderAll() {
  syncViewModeButtons();
  refreshClock();
  syncRecurringTasks();
  autoArchivePastWeeks();
  normalizeSelectedWeek();
  syncFootprintState();
  renderHeader();
  renderDirection();
  renderHome();
  renderHistory();
  renderSettings();
  saveState();
}
function renderHeader() {
  $("#historyCycleLabel").textContent = `12 週回顧 · Cycle ${state.cycle.number}`;
  $("#homeEyebrow").textContent = `12 週計畫 · Cycle ${state.cycle.number}`;
}
function directionLeafCounts(weekFilter = () => true) {
  const counts = {},
    ds = state.cycle.directions;
  ds.forEach((d) => (counts[d.name] = 0));
  const directionFor = (t) => {
    const links = state.cycle.directionLinks || {};
    return isWeekArchived(t.week) &&
      Object.prototype.hasOwnProperty.call(links, t.id)
      ? ds.find((d) => d.id === links[t.id])
      : ds.find((d) => d.name === t.goal);
  };
  state.tasks.forEach((t) => {
    if (!weekFilter(Number(t.week))) return;
    const d = directionFor(t);
    if (t.status === "active" && d) counts[d.name] += occurrenceDoneCount(t);
  });
  flyingKeys.forEach((k) => {
    const [tid, oid] = k.split(":"),
      t = state.tasks.find((x) => String(x.id) === tid),
      d = t && directionFor(t);
    if (!t || !weekFilter(Number(t.week)) || t.status !== "active" || !d) return;
    const completed = oid
      ? t.occurrences?.find((o) => o.id === oid)?.done
      : t.done;
    if (completed) counts[d.name]--;
  });
  return counts;
}
function renderDirection() {
  syncGoals();
  // The 12-week plan goal (cycles.theme) is not a water tank. Display it
  // separately from cycle.directions and never overwrite state here.
  const currentGoal = TPConnection.cycleTheme?.() || state.cycle.direction;
  $("#directionText").textContent = currentGoal;
  const settingsGoal = $("#settingsCycleGoal");
  if (settingsGoal) settingsGoal.textContent = currentGoal || "尚未設定本輪目標";
  const ds = state.cycle.directions,
    counts = directionLeafCounts(),
    el = $("#directionTags");
  if (
    el.children.length !== ds.length ||
    [...el.children].some((c, i) => c.dataset.id !== ds[i].id)
  )
    el.innerHTML = ds
      .map(
        (d) =>
          `<div class="tank" data-id="${d.id}"><div class="tank-fill"></div><span class="tank-name"></span><span class="tank-count"></span></div>`,
      )
      .join("");
  ds.forEach((d, i) => {
    const c = el.children[i],
      n = counts[d.name] || 0,
      pct = d.target > 0 ? Math.min(100, Math.round((n / d.target) * 100)) : 0;
    c.style.setProperty("--c", morandiTone(d.color));
    c.title = d.outcome || "";
    c.querySelector(".tank-name").textContent = d.name;
    const cnt = c.querySelector(".tank-count"),
      prev = Number(cnt.dataset.n || 0);
    cnt.dataset.n = n;
    cnt.textContent = d.target > 0 ? `${n} / ${d.target}` : `${n}`;
    c.querySelector(".tank-fill").style.width = pct + "%";
    if (n > prev && el.dataset.ready) {
      c.classList.remove("tank-bump");
      void c.offsetWidth;
      c.classList.add("tank-bump");
    }
  });
  el.dataset.ready = "1";
  const box = $("#tankHint"),
    wk = CURRENT_WEEK,
    show = (wk === 4 || wk === 8) && !state.tankReviewed[wk];
  box.hidden = !show;
  if (show)
    box.innerHTML = `<span>走到第 ${wk} 週了，要回頭看看水缸的目標嗎？</span><button type="button" class="text-button" data-tank-adjust>去看看</button><button type="button" class="text-button" data-tank-later>先不用</button>`;
}
function commitDirections(list) {
  const old = state.cycle.directions,
    links = state.cycle.directionLinks || (state.cycle.directionLinks = {});
  // Keep sealed task records unchanged while preserving their direction association by ID.
  state.tasks
    .filter((t) => isWeekArchived(t.week))
    .forEach((t) => {
      if (!Object.prototype.hasOwnProperty.call(links, t.id))
        links[t.id] = old.find((d) => d.name === t.goal)?.id || "";
    });
  list.forEach((d) => {
    const o = old.find((x) => x.id === d.id);
    if (o && o.name !== d.name)
      state.tasks
        .filter((t) => !isWeekArchived(t.week))
        .forEach((t) => {
          if (t.goal === o.name) t.goal = d.name;
        });
  });
  old
    .filter((o) => !list.some((d) => d.id === o.id))
    .forEach((o) =>
      state.tasks
        .filter((t) => !isWeekArchived(t.week))
        .forEach((t) => {
          if (t.goal === o.name) t.goal = "";
        }),
    );
  state.cycle.directions = list;
  syncGoals();
}
function renderDirectionList() {
  const el = $("#directionList");
  el.innerHTML = state.cycle.directions
    .map(
      (d) =>
        `<div class="manage-row"><span class="color-dot" style="--c:${morandiTone(d.color)}"></span><div><strong>${esc(d.name)}</strong><small>${esc(d.outcome || "")}${d.outcome ? " · " : ""}目標 ${d.target} 片</small></div><span></span><button class="text-button" type="button" data-edit-direction="${d.id}">編輯</button></div>`,
    )
    .join("");
  $("#addDirectionBtn").hidden = state.cycle.directions.length >= 3;
  $$("[data-edit-direction]").forEach((b) =>
    b.addEventListener("click", () =>
      openDirectionDialog(b.dataset.editDirection),
    ),
  );
}
let editingDirectionId = null,
  directionPickColor = PALETTE[0];
function renderDirectionPalette() {
  // 與「分類與顏色」共用預設色盤、選取樣式與 HEX 色彩規則。
  renderCategoryPresetPalette("directionPalette", directionPickColor, (color) => {
    setDirectionColor(color);
  });
  const hex = $("#directionHexColor");
  const native = $("#directionNativeColor");
  const preview = $("#directionColorPreview");
  hex.value = normalizeHexColor(directionPickColor) || "#9FC3DE";
  hex.setAttribute("aria-invalid", "false");
  $("#directionHexError").hidden = true;
  $("#directionForm button[type='submit']").disabled = false;
  native.value = hex.value;
  preview.style.backgroundColor = hex.value;
}
function setDirectionColor(input) {
  const value = normalizeHexColor(input);
  if (!value) return false;
  directionPickColor = value;
  renderDirectionPalette();
  return true;
}
function bindDirectionColorInputs() {
  $("#directionNativeColor").addEventListener("input", (event) => {
    setDirectionColor(event.target.value);
  });
  const hex = $("#directionHexColor");
  hex.addEventListener("input", () => {
    const value = /^#[0-9a-f]{6}$/i.test(hex.value.trim())
      ? normalizeHexColor(hex.value)
      : null;
    const invalid = !value;
    hex.setAttribute("aria-invalid", String(invalid));
    $("#directionHexError").hidden = !invalid;
    $("#directionForm button[type='submit']").disabled = invalid;
    if (value) {
      directionPickColor = value;
      $("#directionColorPreview").style.backgroundColor = value;
      $("#directionNativeColor").value = value;
      renderCategoryPresetPalette("directionPalette", directionPickColor, setDirectionColor);
    }
  });
  hex.addEventListener("blur", () => {
    const value = normalizeHexColor(hex.value);
    if (value) setDirectionColor(value);
  });
}
function openDirectionDialog(id = null) {
  editingDirectionId = id;
  const d = id ? state.cycle.directions.find((x) => x.id === id) : null;
  $("#directionDialogTitle").textContent = d ? "編輯成長方向" : "新增成長方向";
  $("#directionNameInput").value = d?.name || "";
  $("#directionOutcomeInput").value = d?.outcome || "";
  $("#directionTargetInput").value = d?.target || 12;
  directionPickColor =
    d?.color || PALETTE[(state.cycle.directions.length * 3) % PALETTE.length];
  renderDirectionPalette();
  $("#deleteDirectionBtn").hidden = !d || state.cycle.directions.length <= 1;
  $("#directionDialog").showModal();
}
function renderHistoryTanks(finishedWeeks = []) {
  const ds = state.cycle.directions,
    finished = new Set(finishedWeeks),
    counts = directionLeafCounts((week) => finished.has(week)),
    box = $("#historyTanks");
  $("#historyDirectionsWrap").hidden = !ds.length || !finished.size;
  box.innerHTML =
    `<p class="field-label">已結束週次的成長方向</p>` +
    ds
      .map((d) => {
        const n = counts[d.name] || 0,
          pct =
            d.target > 0 ? Math.min(100, Math.round((n / d.target) * 100)) : 0;
        return `<div class="htank" style="--c:${morandiTone(d.color)}"><div class="htank-head"><strong>${esc(d.name)}</strong><span>${n}${d.target ? ` / ${d.target}` : ""} 片</span></div>${d.outcome ? `<small>${esc(d.outcome)}</small>` : ""}<div class="tank big"><div class="tank-fill" style="width:${pct}%"></div></div></div>`;
      })
      .join("");
}

function isCycleResting() {
  return Boolean(CYCLE_START_YMD && compareIsoDate(TODAY, CYCLE_START_YMD) < 0);
}
// Rest days show the normal calendar with the task area collapsed by default.
// The task list itself is unchanged; expanding it never starts the new cycle.
function renderRestHome() {
  const dayMode = state.mode === "day";
  const viewWeek = state.selectedWeek;
  const dates = Object.values(weekDateMap(viewWeek));
  const first = dates[0], last = dates.at(-1);
  $("#homeTitle").textContent = "休息日";
  $("#homeLede").textContent = "休息也是前進的一部分。";
  $("#homeEyebrow").hidden = false;
  $("#homeModeControl").hidden = false;
  $("#growthBanner").hidden = true;
  $("#mobileTreePeek").hidden = true;
  $("#previewBar").hidden = true;
  $("#footprintEntry").hidden = true;
  $("#restBanner").hidden = true;
  $("#workCard").classList.add("resting");
  $("#workHeader").hidden = true;
  $("#progressTrack").hidden = true;
  $("#progressSummary").hidden = true;
  $("#weekStrip").hidden = dayMode;
  $("#dayStrip").hidden = !dayMode;
  if (dayMode) renderDayStrip();
  else renderWeekStrip();
  // The week range / future status now lives directly above the date strip.
  // Keep the legacy element hidden so information is not repeated at the bottom.
  $("#restDateNote").hidden = true;
  $("#restDateNote").textContent = "";
  $("#restPlanningBar").hidden = false;
  $("#toggleRestPlanner").textContent = "展開任務";
  $("#toggleRestPlanner").setAttribute("aria-expanded", "false");
  $("#restPlanningHint").hidden = true;
  $("#restPlanningHint").textContent = "";
  $("#taskList").hidden = true;
  $("#taskList").replaceChildren();
  $("#habitTracker").hidden = true;
  $("#habitList").replaceChildren();
  $("#focusPool").hidden = true;
  $("#quickAddForm").hidden = true;
  $("#openQuickAddBtn").hidden = true;
}
// 清單排序只影響畫面，不改動 state.tasks、事件或雲端儲存順序。
// 尚未完成維持加入清單的順序；完成的移到下方，依實際勾選完成的先後排列。
function renderDoneLast(rows) {
  if (!rows.length) return "";
  const lastCompletedAt = new Map();
  (state.events || []).forEach((event, index) => {
    if (event?.type !== "complete") return;
    const taskId = String(event.taskId);
    lastCompletedAt.set(taskId, index);
    if (event.occurrenceId != null)
      lastCompletedAt.set(`${taskId}:${event.occurrenceId}`, index);
  });
  const completionOrder = ({ task, occurrenceIds }) => {
    if (occurrenceIds?.length)
      return occurrenceIds.reduce((last, oid) =>
        Math.max(last, lastCompletedAt.get(`${task.id}:${oid}`) ?? -1), -1);
    return lastCompletedAt.get(String(task.id)) ?? -1;
  };
  return rows
    .map((row, index) => ({ ...row, index, order: row.done ? completionOrder(row) : -1 }))
    .sort((a, b) =>
      Number(a.done) - Number(b.done) ||
      (a.done && b.done ? a.order - b.order : 0) ||
      a.index - b.index,
    )
    .map((row) => row.html)
    .join("");
}
// One source of truth for Week/Day labels. Only UI copy changes; the tasks
// remain associated with their original week in the cloud.
function activeViewCopy() {
  if (state.mode === "day") {
    const isToday = state.selectedDate === TODAY;
    const when = isToday ? "今天" : "當天";
    return {
      workTitle: isToday ? "今日任務" : `${formatShortDate(state.selectedDate)} 的任務`,
      scopeLabel: isToday ? "今日任務" : "當日任務",
      completed: `${when}的任務都完成了`,
      remaining: (n) => `${when}還有 ${n} 項任務待完成`,
      start: `先加入一件${when}的任務`,
      placeholder: `${when}想加入什麼任務？`,
      empty: isToday ? "今天還沒有安排任務" : "這一天還沒有安排任務",
      habit: isToday ? "今天的習慣" : "當天的習慣",
      habitScope: when,
    };
  }
  return {
    workTitle: "本週任務",
    scopeLabel: "本週任務",
    completed: "本週任務都完成了",
    remaining: (n) => `本週還有 ${n} 項任務待完成`,
    start: "先加入一件本週任務",
    placeholder: "這週想加入什麼任務？",
    empty: "這一週還沒有安排任務",
    habit: "本週習慣",
    habitScope: "本週",
  };
}
function renderHome() {
  syncViewModeButtons();
  if (isCycleResting() && !restPlannerOpen) {
    renderRestHome();
    return;
  }
  $("#homeEyebrow").hidden = false;
  $("#homeModeControl").hidden = false;
  $("#growthBanner").hidden = isCycleResting();
  $("#mobileTreePeek").hidden = isCycleResting();
  $("#restDateNote").hidden = true;
  if (!state.selectedWeek) state.selectedWeek = CURRENT_WEEK;
  const viewWeek = state.selectedWeek,
    dates = weekDateMap(viewWeek);
  if (!Object.values(dates).includes(state.selectedDate))
    state.selectedDate = defaultDateForWeek(viewWeek);
  const dayMode = state.mode === "day";
  const copy = activeViewCopy();
  const firstWeekStart =
    CYCLE_START_YMD || CYCLE_WEEK_RANGES?.[0]?.start || CYCLE_WEEK_STARTS?.[0];
  const resting = isCycleResting();
  const showRest = resting;
  const planningOpen = resting && restPlannerOpen;
  const isToday =
    !resting && viewWeek === CURRENT_WEEK && state.selectedDate === TODAY;
  const preview = viewWeek !== CURRENT_WEEK;
  $("#previewBar").hidden = resting || !preview;
  if (preview) $("#previewLabel").textContent = dayMode
    ? `預覽日期 · ${formatShortDate(state.selectedDate)}`
    : `預習中 · Week ${viewWeek}`;
  const life = weekLifecycle(viewWeek),
    archived = life === "archived";
  const entry = $("#footprintEntry");
  entry.hidden = resting || footprintWeek === viewWeek;
  // 休息日只有任務區預設收合；不再顯示特殊任務提示卡。
  $("#restBanner").hidden = true;
  if (showRest)
    $("#restNextDate").textContent = `Week 1 將於 ${formatShortDate(firstWeekStart)} 開始`;
  $("#homeTitle").textContent = showRest
    ? "休息日"
    : dayMode
      ? (state.selectedDate === TODAY ? "今天的安排" : "這一天的安排")
      : "這週想完成什麼";
  $("#homeLede").textContent = showRest
    ? "休息也是前進的一部分。"
    : dayMode
      ? (state.selectedDate === TODAY
          ? "今天完成的，也會累積到這一週。"
          : "這一天完成的，也會累積到這一週。")
      : "任務以週累積，日期可以慢慢安排。";
  $("#homeLede").hidden = false;
  $("#workTitle").textContent = copy.workTitle;
  $("#workHint").textContent = archived
    ? dayMode ? "這一天所屬的週次已封存，請到 History 查看" : "這週已封存，請到 History 查看"
    : "";
  $("#workHint").hidden = !archived;
  $("#quickTitle").placeholder = copy.placeholder;
  $("#progressScopeLabel").textContent = copy.scopeLabel;
  $(".progress-number").setAttribute("aria-label", `${copy.scopeLabel}完成進度`);
  $("#weekStrip").hidden = dayMode;
  $("#dayStrip").hidden = !dayMode;
  if (dayMode) renderDayStrip();
  else renderWeekStrip();
  // 只有休息日預設收合任務。手動展開後，使用一般的任務欄位和進度顯示。
  // 非休息日永遠正常顯示任務欄位，不顯示收合按鈕。
  $("#workCard").classList.toggle("resting", resting);
  $("#workHeader").hidden = resting && !planningOpen;
  $("#progressTrack").hidden = resting && !planningOpen;
  $("#progressSummary").hidden = resting && !planningOpen;
  $("#restPlanningBar").hidden = !resting;
  $("#toggleRestPlanner").textContent = planningOpen ? "收起任務" : "展開任務";
  $("#toggleRestPlanner").setAttribute("aria-expanded", String(planningOpen));
  $("#restPlanningHint").hidden = true;
  $("#restPlanningHint").textContent = "";
  renderTreeHome();

  let html = "";
  let habitHtml = "";
  if (dayMode) {
    // 每日與整週共用同一批任務，○／✓ 直接表示狀態，無須另外分區。
    // 未指定日期的週任務：未完成者仍在「這週還有」；完成者直接可見。
    const entries = [], habits = [];
    activeTasks(viewWeek).forEach((t) => {
      if (isRecurring(t)) {
        const dated = t.occurrences.filter((o) => o.date === state.selectedDate);
        if (dated.length) habits.push({
          task: t,
          occurrenceIds: dated.map((o) => o.id),
          done: dated.every((o) => o.done),
          html: habitRow(t, dated),
        });
      } else if (t.focusDate === state.selectedDate) {
        entries.push({ task: t, done: taskDone(t), html: taskRow(t, null) });
      }
    });
    html = renderDoneLast(entries) || `<div class="empty-note">${copy.empty}</div>`;
    habitHtml = renderDoneLast(habits);
  } else {
    // 整週視角無論是否完成都同列表顯示，不要求指定日期。
    const tasks = activeTasks(viewWeek);
    const regular = tasks.filter((t) => !isRecurring(t));
    const habits = tasks.filter(isRecurring);
    html = renderDoneLast(regular.map((t) => ({
      task: t,
      done: taskDone(t),
      html: taskRow(t, null),
    }))) || (habits.length ? "" : `<div class="empty-note">${copy.empty}</div>`);
    habitHtml = renderDoneLast(habits.map((t) => ({
      task: t,
      occurrenceIds: t.occurrences.map((o) => o.id),
      done: t.occurrences.every((o) => o.done),
      html: habitRow(t, null),
    })));
  }
  const list = $("#taskList");
  list.hidden = resting && !planningOpen;
  list.innerHTML = html;
  [...list.querySelectorAll("[data-task-id]")].forEach((el, i) =>
    el.style.setProperty("--i", i),
  );
  const habitTracker = $("#habitTracker");
  habitTracker.hidden = !habitHtml || archived || (resting && !planningOpen);
  $("#habitTrackerTitle").textContent = copy.habit;
  $("#habitTrackerHint").textContent = "";
  $("#habitList").innerHTML = habitHtml;
  [...$("#habitList").querySelectorAll("[data-task-id]")].forEach((el, i) =>
    el.style.setProperty("--i", i),
  );
  const listKey = `${state.mode}|${viewWeek}|${state.selectedDate}`;
  if (listKey !== lastListKey) {
    lastListKey = listKey;
    list.classList.remove("enter");
    void list.offsetWidth;
    list.classList.add("enter");
  }
  bindTaskRows();
  renderFocusPool();
  if (resting && !planningOpen) $("#focusPool").hidden = true;
  applyRowFeedback();

  // Daily counts are for the selected date, not every task in its week.
  const ordinary = activeTasks(viewWeek).filter((t) =>
    !isRecurring(t) && (!dayMode || t.focusDate === state.selectedDate)
  ),
    done = ordinary.filter(taskDone).length,
    total = ordinary.length;
  const dc = $("#doneCount");
  if (prevDone !== null && prevDone !== done) {
    dc.classList.remove("bump");
    void dc.offsetWidth;
    dc.classList.add("bump");
  }
  prevDone = done;
  dc.textContent = done;
  $("#totalCount").textContent = total;
  $("#progressSummary").textContent = total
    ? done === total ? copy.completed : copy.remaining(total - done)
    : habitHtml
      ? "習慣已在下方追蹤"
      : copy.start;
  $("#progressFill").style.width = total
    ? `${Math.round((done / total) * 100)}%`
    : "0%";
  const canAdd = !archived && (!resting || planningOpen);
  $("#openQuickAddBtn").hidden = !canAdd;
  $("#openQuickAddBtn").setAttribute("aria-expanded", String(quickAddOpen && canAdd));
  $("#quickAddForm").hidden = !canAdd || !quickAddOpen;
  $("#openQuickAddBtn").textContent = quickAddOpen && canAdd ? "－ 收起新增" : "＋ 新增任務";
  renderQuickOptions();
}
function applyRowFeedback() {
  const rows = (id) =>
    $$(`#taskList [data-task-id="${id}"], #habitList [data-task-id="${id}"]`);
  if (justToggled) {
    const { id, occId, done } = justToggled;
    justToggled = null;
    rows(id)
      .filter(
        (r) =>
          !occId ||
          !r.dataset.occurrenceIds ||
          r.dataset.occurrenceIds.split(",").includes(occId),
      )
      .forEach((r) => r.classList.add(done ? "just-done" : "just-undone"));
  }
  if (justAdded) {
    const id = justAdded;
    justAdded = null;
    rows(id).forEach((r) => r.classList.add("row-new"));
  }
}

// Month is informational, not a navigation mode. Both views show the Week number;
// the selected date is conveyed solely by the seven-day strip in Day mode.
function renderCalendarMonthLabel() {
  const dates = Object.values(weekDateMap(state.selectedWeek));
  const first = dates[0], last = dates[dates.length - 1];
  const month = $("#calendarMonthLabel");
  const title = $("#calendarViewTitle");
  const range = $("#calendarWeekRange");
  const period = $("#calendarPeriod");
  const phase = $("#calendarPhase");
  if (!first || !last) {
    month.textContent = title.textContent = phase.textContent = "";
    range.textContent = "";
    range.hidden = true;
    period.classList.remove("is-real-current");
    period.classList.remove("is-week-view");
    period.classList.remove("is-day-view");
    phase.hidden = true;
    return;
  }
  const firstYear = Number(first.slice(0, 4));
  const lastYear = Number(last.slice(0, 4));
  const firstMonth = Number(first.slice(5, 7));
  const lastMonth = Number(last.slice(5, 7));
  month.textContent = state.mode === "day"
    ? `${Number(state.selectedDate.slice(0, 4))} 年 ${Number(state.selectedDate.slice(5, 7))} 月`
    : firstYear !== lastYear
      ? `${firstYear} 年 ${firstMonth} 月－${lastYear} 年 ${lastMonth} 月`
      : firstMonth !== lastMonth
        ? `${firstYear} 年 ${firstMonth} 月－${lastMonth} 月`
        : `${firstYear} 年 ${firstMonth} 月`;

  // Only Week view shows week number. Day view shows the selected month and day strip.
  title.textContent = state.mode === "week" ? `Week ${state.selectedWeek}` : "";
  title.hidden = state.mode !== "week";
  // Week view gives the date range once. Day view already shows 7 individual dates.
  range.textContent = `${formatShortDate(first)}～${formatShortDate(last)}`;
  range.hidden = state.mode !== "week";
  // Current time is independent of the user's green selection.
  // Before Cycle starts no future week/day may pretend to be current.
  const today = TODAY;
  const realWeek = first <= today && today <= last;
  const realDay = state.selectedDate === today && realWeek;
  period.classList.toggle("is-week-view", state.mode === "week");
  period.classList.toggle("is-day-view", state.mode === "day");
  period.classList.toggle("is-real-current", state.mode === "week" ? realWeek : realDay);
  const future = today < first;
  const past = today > last;
  phase.textContent = future ? "尚未開始" : past ? "已結束" : "進行中";
  phase.hidden = state.mode !== "week";
  phase.classList.toggle("is-future", future);
  phase.classList.toggle("is-past", past);
}
function renderWeekStrip() {
  renderCalendarMonthLabel();
  const el = $("#weekStrip");
  if (!el.children.length)
    el.innerHTML = Array.from(
      { length: 12 },
      (_, i) =>
        `<button type="button" class="wk" data-week="${i + 1}"><span class="week-number">${i + 1}</span></button>`,
    ).join("");
  [...el.children].forEach((b) => {
    const n = Number(b.dataset.week),
      unlocked = isWeekUnlocked(n),
      archived = isWeekArchived(n),
      enterable = canEnterWeek(n),
      // Red point follows the real date only, not the selected week.
      realCurrent = Object.values(weekDateMap(n)).includes(TODAY);
    b.disabled = !enterable;
    b.setAttribute("aria-disabled", enterable ? "false" : "true");
    b.setAttribute("aria-pressed", String(n === state.selectedWeek));
    if (realCurrent) b.setAttribute("aria-current", "date");
    else b.removeAttribute("aria-current");
    b.setAttribute("aria-label", `第 ${n} 週${realCurrent ? "，目前所在週" : ""}${n === state.selectedWeek ? "，已選取" : ""}`);
    b.classList.toggle("locked", !unlocked && !isCycleResting());
    b.classList.toggle("archived", archived);
    b.classList.toggle("now", realCurrent);
    b.classList.toggle("is-real-current", realCurrent);
    b.classList.toggle("sel", n === state.selectedWeek);
    b.classList.toggle("past", n < CURRENT_WEEK);
  });
}
function renderDayStrip() {
  renderCalendarMonthLabel();
  const el = $("#dayStrip"),
    dates = weekDateMap(state.selectedWeek),
    prev = state.selectedWeek - 1,
    next = state.selectedWeek + 1;
  el.innerHTML = `<button type="button" class="day-week-nav" data-day-week="${prev}" aria-label="上一週" ${canEnterWeek(prev) ? "" : "disabled"}>‹</button><div class="day-strip-row">${Object.keys(
    dates,
  )
    .map((k) => {
      const date = dates[k];
      const today = date === TODAY;
      const selected = date === state.selectedDate;
      return `<button type="button" class="dy ${today ? "today is-real-current" : ""} ${selected ? "sel" : ""}" data-date="${date}" aria-label="${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日，週${dayLabel(date)}${today ? "，今天" : ""}" aria-pressed="${selected}" ${today ? 'aria-current="date"' : ""}><span>${dayLabel(date)}</span><strong>${Number(date.slice(8))}</strong></button>`;
    })
    .join(
      "",
    )}</div><button type="button" class="day-week-nav" data-day-week="${next}" aria-label="下一週" ${canEnterWeek(next) ? "" : "disabled"}>›</button>`;
}
function taskRow(t, occ) {
  const group = Array.isArray(occ) ? occ : null;
  const cat = categoryById(t.categoryId),
    color = taskColor(t);
  const completed = group ? group.every((o) => o.done) : taskDone(t);
  const meta = [];
  if (t.goal) meta.push(`<span>${esc(t.goal)}</span>`);
  if (cat)
    meta.push(
      `<span class="chip" style="--c:${color}">${esc(cat.name)}</span>`,
    );
  if (state.mode === "week" && t.focusDate) meta.push(`<span class="task-date-tag">${formatShortDate(t.focusDate)}</span>`);
  const circleDone =
    isRecurring(t) &&
    t.frequency === "daily" &&
    !group &&
    state.mode === "day"
      ? Boolean(
          t.occurrences.find((o) => o.date === state.selectedDate)?.done,
        )
      : completed;
  const checkLabel = circleDone
    ? "改回未完成"
    : isRecurring(t) && state.mode === "day" && occurrenceDoneCount(t) > 0
      ? "再完成一次"
      : isRecurring(t) && state.mode === "week"
        ? "完成本週全部次數"
        : "完成";
  return `<article class="task-row ${completed ? "done" : ""}" data-task-id="${t.id}" ${group ? `data-occurrence-ids="${group.map((o) => o.id).join(",")}"` : ""} style="--c:${color}">
    <button class="task-check" type="button" aria-label="${checkLabel}">${circleDone ? "✓" : ""}</button>
    <div class="task-main"><p class="task-title">${esc(t.title)}</p>${meta.length ? `<div class="task-meta">${meta.join("")}</div>` : ""}</div>
    <button class="task-more" type="button" aria-label="更多" data-more="${t.id}">•••</button>
  </article>`;
}
function weeklyHabitProgress(t) { return `本週 ${occurrenceDoneCount(t)}/${t.targetCount} 次`; }
function habitRow(t, occ) {
  const group = Array.isArray(occ) ? occ : null,
    color = taskColor(t),
    count = occurrenceDoneCount(t),
    completed = group
      ? group.every((o) => o.done)
      : t.occurrences.every((o) => o.done);
  const label = completed
    ? "改回未完成"
    : group
      ? "完成這次習慣"
      : "完成本週全部次數";
  return `<article class="habit-row ${completed ? "done" : ""}" data-task-id="${t.id}" ${group ? `data-occurrence-ids="${group.map((o) => o.id).join(",")}"` : ""} style="--c:${color}">
    <button class="task-check" type="button" aria-label="${label}">${completed ? "✓" : ""}</button>
    <div class="habit-main"><strong>${esc(t.title)}</strong><span>${group
      ? `${activeViewCopy().habitScope} ${group.filter((o) => o.done).length}/${group.length} 次`
      : weeklyHabitProgress(t)}</span></div>
    <button class="task-more" type="button" aria-label="更多" data-more="${t.id}">•••</button>
  </article>`;
}
function taskSectionLabel(title, hint) {
  return `<div class="task-section-label"><span>${esc(title)}</span><small>${esc(hint)}</small></div>`;
}
function setTaskActionContext(t, row) {
  actionTaskId = t.id;
  actionOccIds = rowIds(row);
  actionOccurrenceId = actionOccIds[0] || null;
}
function historicalCompletionNotes(t) {
  if (!t) return [];
  return state.events
    .filter((e) => e.type === "uncomplete" &&
      Number(e.taskId) === Number(t.id) &&
      String(e.savedCompletionNote || "").trim())
    .map((e) => ({ date: e.previousDoneDate || "", note: e.savedCompletionNote }));
}
function hasCompletionNoteHistory(t) {
  return historicalCompletionNotes(t).length > 0;
}
function openTaskActions(t, row) {
  if (!t) return;
  setTaskActionContext(t, row);
  const archived = isWeekArchived(t.week);
  $("#actionTaskTitle").textContent = t.title;
  // 完成／改回未完成只透過任務左側的圓圈操作，避免 ••• 出現重複按鈕。
  $("#replanTaskBtn").hidden =
    archived || isRecurring(t) || taskDone(t) || t.week >= 12;
  // 未封存任務的「••• → 編輯」保持可見，不因勾選完成而消失。
  // 歷史封存週次仍只能查看，不能在此修改。
  $("#editTaskBtn").hidden = archived;
  $("#editTaskBtn").textContent = "編輯";
  $("#deleteTaskBtn").hidden = archived;
  $("#completionRecordBtn").hidden =
    occurrenceDoneCount(t) === 0 &&
    !t.note &&
    !t.occurrences?.some((o) => o.note) &&
    !hasCompletionNoteHistory(t);
  $("#taskActionDialog").showModal();
}
function openTaskEditor(t) {
  if (!t || !guardWeekEditable(t.week)) return;
  if (
    isRecurring(t) &&
    t.recurringRuleId &&
    state.recurringRules.some((r) => r.id === t.recurringRuleId)
  ) {
    openRecurringDialog(t.recurringRuleId);
    return;
  }
  openEditTask(t);
}
function openTaskCard(t, row) {
  if (!t) return;
  setTaskActionContext(t, row);
  const rowDone =
    isRecurring(t) && actionOccIds.length
      ? t.occurrences
          .filter((o) => actionOccIds.includes(o.id))
          .every((o) => o.done)
      : taskDone(t);
  if (isWeekArchived(t.week)) {
    if (
      occurrenceDoneCount(t) > 0 ||
      t.note ||
      t.occurrences?.some((o) => o.note) ||
      hasCompletionNoteHistory(t)
    )
      openCompletionRecord(t);
    else showToast("這週已封存，可以到 History 查看");
    return;
  }
  if (isRecurring(t) && t.frequency === "weekly" && actionOccIds.length === 1) {
    openEditTask(t);
    return;
  }
  if (rowDone) {
    openCompletionRecord(t);
    return;
  }
  openTaskEditor(t);
}
function bindTaskRows() {
  $$("#taskList .task-check, #habitList .task-check").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = b.closest("[data-task-id]"),
        t = state.tasks.find((x) => x.id === Number(row.dataset.taskId));
      toggleTaskCompletion(t, rowIds(row), b.getBoundingClientRect());
    }),
  );
  $$("[data-more]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = b.closest("[data-task-id]"),
        t = state.tasks.find((x) => x.id === Number(b.dataset.more));
      openTaskActions(t, row);
    }),
  );
  // Only the completion circle and ••• menu are interactive.
  // Tapping a task title or empty row space must never open the editor.
}
// 切換完成狀態：每一件一般任務，或每一個重複習慣發生次數，各自計算。
// 前 3 次可直接切換；第 4 次起每次都要先填理由才會真正更動狀態。
let pendingCompletionReasonAction = null;
function completionChangesForClick(t, occIds) {
  if (!isRecurring(t)) return [{ occurrenceId: null }];
  const pool = occIds?.length
    ? t.occurrences.filter((o) => occIds.includes(o.id))
    : t.frequency === "daily"
      ? t.occurrences.filter((o) => o.date === TODAY)
      : t.occurrences;
  const weekBulk = state.mode === "week" && !occIds?.length;
  if (weekBulk) {
    const allDone = t.occurrences.every((o) => o.done);
    return t.occurrences
      .filter((o) => allDone ? o.done : !o.done)
      .map((o) => ({ occurrenceId: o.id }));
  }
  const occ = pool.find((o) => !o.done) || [...pool].reverse().find((o) => o.done);
  return occ ? [{ occurrenceId: occ.id }] : [];
}
function needsCompletionChangeReason(t, occIds) {
  return completionChangesForClick(t, occIds).some(({ occurrenceId }) =>
    state.events.filter((event) =>
      Number(event.taskId) === Number(t.id) &&
      (event.type === "complete" || event.type === "uncomplete") &&
      (!isRecurring(t) || String(event.occurrenceId) === String(occurrenceId))
    ).length >= 3,
  );
}
function requestCompletionChangeReason(t, occIds, fromRect) {
  const dialog = $("#completionChangeReasonDialog");
  if (dialog.open) return;
  pendingCompletionReasonAction = (reason) =>
    toggleTaskCompletion(t, occIds, fromRect, reason);
  $("#completionChangeReasonTask").textContent = t.title;
  $("#completionChangeReasonInput").value = "";
  $("#completionChangeReasonError").hidden = true;
  dialog.showModal();
  $("#completionChangeReasonInput").focus();
}
function toggleTaskCompletion(t, occIds, fromRect, switchReason) {
  if (!t || !guardWeekEditable(t.week)) return;
  if (isCycleResting() && !restPlannerOpen)
    return showToast("請先展開任務");
  // 不先改資料；原因取消或留白時，勾選狀態完全不變。
  if (switchReason === undefined && needsCompletionChangeReason(t, occIds))
    return requestCompletionChangeReason(t, occIds, fromRect);
  const eventReason = String(switchReason || "").trim();
  if (switchReason !== undefined && needsCompletionChangeReason(t, occIds) && !eventReason)
    return showToast("超過三次變更後，請寫下原因");
  let becameComplete = false,
    leafKey = "",
    leafOccId = "",
    bulkLeafKeys = [],
    completedOccIds = [],
    bulkWeekAction = false;
  const inTree = t.week === treeWeek();
  if (isRecurring(t)) {
    const pool =
      occIds && occIds.length
        ? t.occurrences.filter((o) => occIds.includes(o.id))
        : t.frequency === "daily"
          ? t.occurrences.filter((o) => o.date === TODAY)
          : t.occurrences;
    const weekBulk = state.mode === "week" && !occIds?.length;
    if (weekBulk) {
      bulkWeekAction = true;
      const allDone = t.occurrences.every((o) => o.done);
      let removedCount = 0;
      t.occurrences.forEach((o) => {
        if (allDone ? o.done : !o.done) {
          const key = `${t.id}:${o.id}`;
          if (allDone) {
            if (inTree)
              queueFall(t.week, key, taskColor(t), removedCount * 90);
            removedCount++;
            const previousDoneDate = o.doneDate || "";
            const savedCompletionNote = String(o.note || "").trim();
            o.done = false;
            o.doneDate = "";
            o.note = "";
            o.noteEnabledAtCompletion = undefined;
            state.events.push({
              type: "uncomplete",
              taskId: t.id,
              title: t.title,
              week: t.week,
              date: TODAY,
              occurrenceId: o.id,
              ...(eventReason ? { reason: eventReason } : {}),
              ...(savedCompletionNote ? { savedCompletionNote, previousDoneDate } : {}),
            });
          } else {
            o.done = true;
            o.doneDate = TODAY;
            o.noteEnabledAtCompletion = Boolean(
              state.preferences.completionNote,
            );
            completedOccIds.push(o.id);
            bulkLeafKeys.push(key);
            state.events.push({
              type: "complete",
              taskId: t.id,
              title: t.title,
              week: t.week,
              date: TODAY,
              occurrenceId: o.id,
              ...(eventReason ? { reason: eventReason } : {}),
              color: taskColor(t),
            });
          }
        }
      });
      if (allDone) state.footprintDeferred[t.week] = false;
      else becameComplete = completedOccIds.length > 0;
      leafKey = bulkLeafKeys[0] || "";
      leafOccId = completedOccIds[0] || "";
      syncTaskDone(t);
    } else {
      const occ =
        pool.find((o) => !o.done) || [...pool].reverse().find((o) => o.done);
      if (!occ) {
        showToast("這張日常卡今天沒有待記錄的次數");
        return;
      }
      leafKey = `${t.id}:${occ.id}`;
      leafOccId = occ.id;
      if (occ.done) {
        if (inTree) queueFall(t.week, leafKey, taskColor(t));
        const previousDoneDate = occ.doneDate || "";
        const savedCompletionNote = String(occ.note || "").trim();
        occ.done = false;
        occ.doneDate = "";
        occ.note = "";
        occ.noteEnabledAtCompletion = undefined;
        if (t.frequency === "weekly") occ.date = "";
        state.events.push({
          type: "uncomplete",
          taskId: t.id,
          title: t.title,
          week: t.week,
          date: TODAY,
          occurrenceId: occ.id,
          ...(eventReason ? { reason: eventReason } : {}),
          ...(savedCompletionNote ? { savedCompletionNote, previousDoneDate } : {}),
        });
        state.footprintDeferred[t.week] = false;
      } else {
        if (t.frequency === "weekly" && !occ.date && state.mode === "day")
          occ.date = state.selectedDate;
        occ.done = true;
        occ.doneDate = TODAY;
        occ.noteEnabledAtCompletion = Boolean(state.preferences.completionNote);
        completedOccIds.push(occ.id);
        becameComplete = true;
        state.events.push({
          type: "complete",
          taskId: t.id,
          title: t.title,
          week: t.week,
          date: TODAY,
          occurrenceId: occ.id,
          ...(eventReason ? { reason: eventReason } : {}),
          color: taskColor(t),
        });
      }
      syncTaskDone(t);
    }
  } else {
    leafKey = String(t.id);
    if (t.done) {
      if (inTree) queueFall(t.week, leafKey, taskColor(t));
      const previousDoneDate = t.doneDate || "";
      const savedCompletionNote = String(t.note || "").trim();
      t.done = false;
      t.doneDate = "";
      t.note = "";
      t.noteEnabledAtCompletion = undefined;
      state.events.push({
        type: "uncomplete",
        taskId: t.id,
        title: t.title,
        week: t.week,
        date: TODAY,
        ...(eventReason ? { reason: eventReason } : {}),
        ...(savedCompletionNote ? { savedCompletionNote, previousDoneDate } : {}),
      });
      state.footprintDeferred[t.week] = false;
    } else {
      t.done = true;
      t.doneDate = TODAY;
      t.noteEnabledAtCompletion = Boolean(state.preferences.completionNote);
      becameComplete = true;
      state.events.push({
        type: "complete",
        taskId: t.id,
        title: t.title,
        week: t.week,
        date: TODAY,
        ...(eventReason ? { reason: eventReason } : {}),
        color: taskColor(t),
      });
    }
  }
  justToggled = { id: t.id, occId: leafOccId, done: becameComplete };
  const finish = () => {
    if (becameComplete && state.preferences.completionNote) {
      pendingNoteTaskId = t.id;
      pendingNoteOccId = leafOccId;
      pendingNoteOccIds = completedOccIds;
      $("#noteTaskTitle").textContent = t.title;
      $("#completionNoteInput").value = "";
      $("#completionNoteDialog").showModal();
    } else {
      showPendingCloudToast(
        becameComplete
          ? bulkWeekAction
            ? "本週習慣已全部完成"
            : inTree
              ? "又長出一片了"
              : "完成了"
          : bulkWeekAction
            ? "本週習慣已全部改回未完成"
            : "已改回未完成",
      );
      if (becameComplete) maybeOpenFootprint(t.week, 650);
    }
  };
  if (becameComplete && inTree) {
    const fly = !bulkLeafKeys.length && Boolean(fromRect) && motionOk();
    if (fly) flyingKeys.add(leafKey);
    else if (bulkLeafKeys.length)
      bulkLeafKeys.forEach((key) => growKeys.add(key));
    else growKeys.add(leafKey);
    renderAll();
    if (fly) launchLeaf(leafKey, taskColor(t), fromRect, finish);
    else finish();
  } else {
    renderAll();
    finish();
  }
}
function renderFocusPool() {
  const pool = $("#focusPool"),
    week = state.selectedWeek;
  if (state.mode !== "day" || isWeekArchived(week)) {
    pool.hidden = true;
    return;
  }
  const choices = [];
  activeTasks(week).forEach((t) => {
    if (!isRecurring(t) && !t.done && !t.focusDate) {
      choices.push({
        t, occ: null,
        label: `排到週${dayLabel(state.selectedDate)}`,
        meta: "",
      });
      return;
    }
    if (isRecurring(t) && t.frequency === "weekly") {
      const remaining = t.occurrences.filter((occ) => !occ.done && !occ.date);
      if (remaining.length)
        choices.push({
          t,
          occ: null,
          weekly: true,
          label: `排到週${dayLabel(state.selectedDate)}`,
          meta: `${weeklyHabitProgress(t)} · 還剩 ${remaining.length} 次未排`,
        });
    }
  });
  pool.hidden = !choices.length;
  pool.innerHTML =
    `<div class="focus-pool-head"><span>本週還沒排（${choices.length}）</span></div>` +
    (choices.length
      ? choices
          .map(
            ({ t, occ, weekly, label, meta }) =>
              `<div class="focus-choice" style="--c:${taskColor(t)}"><i></i><span>${esc(t.title)}${meta ? `<small> · ${esc(meta)}</small>` : ""}</span><button class="text-button" type="button" data-focus-task="${t.id}" ${occ ? `data-focus-occ="${occ.id}"` : ""} ${weekly ? `data-focus-weekly="true"` : ""}>${label}</button></div>`,
          )
          .join("")
      : `<div class="empty-note">這週沒有未指定日期的事項</div>`);
  $$("[data-focus-task]").forEach((b) =>
    b.addEventListener("click", () => {
      const t = state.tasks.find((x) => x.id === Number(b.dataset.focusTask));
      if (!guardWeekEditable(t.week)) return;
      if (b.dataset.focusOcc) {
        const o = t.occurrences.find((x) => x.id === b.dataset.focusOcc);
        if (o) o.date = state.selectedDate;
      } else if (b.dataset.focusWeekly) {
        const o = t.occurrences.find((x) => !x.done && !x.date);
        if (o) o.date = state.selectedDate;
      } else t.focusDate = state.selectedDate;
      state.events.push({
        type: "focus",
        taskId: t.id,
        title: t.title,
        week,
        date: state.selectedDate,
      });
      justAdded = t.id;
      renderAll();
      showPendingCloudToast("放進這天了");
    }),
  );
}
function updateQuickDatePickerVisibility() {
  $("#quickDateWrap").hidden = false;
  $("#quickDate").required = false;
}
function renderQuickOptions() {
  const dates = Object.values(weekDateMap(state.selectedWeek));
  // Same task schema in both views; only the default selected date differs.
  const selected = dates.includes(state.selectedDate) ? state.selectedDate : dates[0];
  const initialDate = state.mode === "day" ? selected : "";
  $("#quickDate").innerHTML = `<option value="" ${initialDate ? "" : "selected"}>不指定日期（留在本週）</option>` + dates.map((date) =>
    `<option value="${date}" ${date === initialDate ? "selected" : ""}>週${dayLabel(date)} ${formatShortDate(date)}</option>`
  ).join("");
  updateQuickDatePickerVisibility();
  $("#quickGoal").innerHTML =
    `<option value="">不指定成長方向</option>` +
    state.cycle.goals.map((g) => `<option>${esc(g)}</option>`).join("");
  $("#quickCategory").innerHTML = categoryOptions();
  $("#quickTimes").innerHTML = timesOptions(2);
}
function categoryOptions(selected = "") {
  return (
    `<option value="">不分類</option>` +
    state.categories
      .map(
        (c) =>
          `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${esc(c.name)}</option>`,
      )
      .join("")
  );
}
function timesOptions(selected = 2) {
  return Array.from(
    { length: 7 },
    (_, i) =>
      `<option value="${i + 1}" ${i + 1 === Number(selected) ? "selected" : ""}>${i + 1} 次</option>`,
  ).join("");
}

const TREE_BASE = 156,
  TREE_X = 125;
const treeGeoCache = {};
const motionOk = () =>
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function qPoint(p0, c, p1, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  };
}
function qTangent(p0, c, p1, t) {
  return Math.atan2(
    2 * (1 - t) * (c.y - p0.y) + 2 * t * (p1.y - c.y),
    2 * (1 - t) * (c.x - p0.x) + 2 * t * (p1.x - c.x),
  );
}
function leafD(len) {
  const W = (len * 0.36).toFixed(1),
    a = (len * 0.3).toFixed(1),
    b = (len * 0.78).toFixed(1),
    L = len.toFixed(1);
  return `M0 0C${a} -${W} ${b} -${W} ${L} 0C${b} ${W} ${a} ${W} 0 0Z`;
}
function treeGeo(week) {
  if (treeGeoCache[week]) return treeGeoCache[week];
  const g = (week - 1) / 11,
    trunkTop = 100 - g * 42,
    leafLen = 12 + g * 4.5;
  const T = {
    p0: { x: TREE_X, y: TREE_BASE },
    c: { x: TREE_X - 6 - g * 3, y: (TREE_BASE + trunkTop) / 2 + 4 },
    p1: { x: TREE_X + 1, y: trunkTop },
  };
  const paths = [],
    nb = 3 + Math.round(g * 5);
  for (let i = 0; i < nb; i++) {
    const h = nb > 1 ? i / (nb - 1) : 1,
      side = i % 2 ? -1 : 1,
      s = qPoint(T.p0, T.c, T.p1, 0.36 + h * 0.56);
    const reach = (30 + g * 38) * (1 - 0.4 * h) + (i % 3) * 3,
      rise = (14 + g * 14) * (1 - 0.28 * h) + 9;
    const e = { x: s.x + side * reach, y: s.y - rise },
      c = { x: s.x + side * reach * 0.6, y: s.y - rise * 0.08 };
    const w = (2 + g * 1.6) * (1 - 0.3 * h);
    paths.push({
      p0: s,
      c,
      p1: e,
      w,
      kind: "branch",
      pairs: 3 + Math.round(g * 2),
    });
    if (g > 0.2 && (i % 2 === 0 || g > 0.6)) {
      const m = qPoint(s, c, e, 0.55),
        L = 13 + g * 14;
      paths.push({
        p0: m,
        c: { x: m.x + side * L * 0.12, y: m.y - L * 0.5 },
        p1: { x: m.x + side * L * 0.5, y: m.y - L * 0.9 },
        w: w * 0.62,
        kind: "twig",
        pairs: 1 + Math.round(g),
      });
    }
  }
  paths.push({
    p0: T.p1,
    c: { x: TREE_X - 1, y: trunkTop - (5 + g * 7) },
    p1: { x: TREE_X + 2, y: trunkTop - (10 + g * 14) },
    w: 1.8 + g * 1.4,
    kind: "branch",
    pairs: 2,
  });
  const slots = [];
  paths.forEach((p, pi) => {
    const rb = pi,
      ofs = p.kind === "twig" ? 1.5 : 0;
    const push = (t, ang, order, layer) =>
      slots.push({
        x: qPoint(p.p0, p.c, p.p1, t).x,
        y: qPoint(p.p0, p.c, p.p1, t).y,
        ang,
        len: leafLen * (0.9 + ((slots.length * 37) % 10) / 50),
        rank: (order + ofs + layer * 100) * 100 + rb,
      });
    push(1, qTangent(p.p0, p.c, p.p1, 1), 0, 0);
    for (let k = 1; k <= p.pairs; k++)
      for (const layer of [0, 1]) {
        const t = 1 - ((k - 0.5 * layer) / (p.pairs + 1)) * 0.8,
          ta = qTangent(p.p0, p.c, p.p1, t),
          spread = 0.72 + layer * 0.28;
        push(t, ta - spread, k, layer);
        push(t, ta + spread, k, layer);
      }
  });
  slots.sort((a, b) => a.rank - b.rank);
  const W = 5.5 + g * 4.5,
    N = 14,
    L = [],
    R = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N,
      p = qPoint(T.p0, T.c, T.p1, t),
      a = qTangent(T.p0, T.c, T.p1, t) + Math.PI / 2,
      hw = (W / 2) * (1 - 0.62 * t);
    L.push(
      `${(p.x + Math.cos(a) * hw).toFixed(1)} ${(p.y + Math.sin(a) * hw).toFixed(1)}`,
    );
    R.push(
      `${(p.x - Math.cos(a) * hw).toFixed(1)} ${(p.y - Math.sin(a) * hw).toFixed(1)}`,
    );
  }
  const trunkD = `M${L.join("L")}L${R.reverse().join("L")}Z`;
  return (treeGeoCache[week] = { g, paths, slots, trunkD });
}
function assignLeafSlots(week, leaves) {
  const map = (state.leafSlots[week] = state.leafSlots[week] || {});
  const keys = new Set(leaves.map((l) => l.key));
  Object.keys(map).forEach((k) => {
    if (!keys.has(k)) delete map[k];
  });
  const used = new Set(Object.values(map));
  leaves.forEach((l) => {
    if (map[l.key] === undefined) {
      let i = 0;
      while (used.has(i)) i++;
      map[l.key] = i;
      used.add(i);
    }
  });
  return map;
}
function queueFall(week, key, color, delay = 0) {
  const idx = (state.leafSlots[week] || {})[key],
    s = treeGeo(week).slots[idx];
  if (!s || !motionOk()) return;
  activeFalls.push({
    week,
    x: s.x,
    y: s.y,
    deg: ((s.ang * 180) / Math.PI).toFixed(1),
    len: s.len,
    color,
    t0: performance.now(),
    delay,
    sx: (Math.random() * 26 - 13).toFixed(0),
    fall: TREE_BASE - s.y + 4,
  });
}
function setLeafCount(n) {
  const el = $("#homeLeafCount");
  if (el.textContent !== String(n)) {
    el.textContent = n;
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
  }
}
function renderTreeHome() {
  const week = treeWeek(),
    leaves = currentLeafRecords(week),
    map = assignLeafSlots(week, leaves);
  const keySet = new Set(leaves.map((l) => l.key)),
    flying = [...flyingKeys].filter((k) => keySet.has(k)).length;
  const now = performance.now();
  activeFalls = activeFalls.filter((f) => now - f.t0 - f.delay < 1300);
  if (renderTreeHome.week !== week) {
    renderTreeHome.week = week;
    if (renderTreeHome.ready) treeIntro = true;
  }
  renderTreeHome.ready = true;
  $("#treeNumber").textContent = `TREE ${String(week).padStart(2, "0")}`;
  setLeafCount(leaves.length - flying);
  $("#homeTree").innerHTML = treeSvg(week, leaves, {
    live: true,
    intro: treeIntro,
    slotOf: (k) => map[k],
    hidden: flyingKeys,
    grow: growKeys,
    falls: activeFalls.filter((f) => f.week === week),
    now,
  });
  // Miniature shares the same week, leaves and palette as the full tree.
  // It is presentation-only, never a second state or editable copy.
  $("#miniTreeArt").innerHTML = treeSvg(week, leaves, {
    slotOf: (k) => map[k],
  });
  $("#miniTreeLeafCount").textContent = String(leaves.length - flying);
  treeIntro = false;
  growKeys.clear();
}
function treeSvg(week, leaves, opts = {}) {
  const {
    live = false,
    intro = false,
    slotOf = null,
    hidden = null,
    grow = null,
    falls = null,
    now = 0,
  } = opts;
  const geo = treeGeo(week),
    f1 = (n) => n.toFixed(1);
  const branches = geo.paths
    .map(
      (p, i) =>
        `<path class="tree-branch${intro ? " draw" : ""}" pathLength="1" ${intro ? `style="animation-delay:${(0.3 + i * 0.04).toFixed(2)}s"` : ""} stroke-width="${p.w.toFixed(2)}" d="M${f1(p.p0.x)} ${f1(p.p0.y)}Q${f1(p.c.x)} ${f1(p.c.y)} ${f1(p.p1.x)} ${f1(p.p1.y)}"/>`,
    )
    .join("");
  const leafEls = leaves
    .map((l, i) => {
      const si = slotOf ? slotOf(l.key) : i,
        s = geo.slots[si];
      if (!s) return "";
      let cls = "tree-leaf",
        style = "";
      if (hidden && hidden.has(l.key)) cls += " is-hidden";
      else if (grow && grow.has(l.key)) cls += " grow";
      else if (intro) {
        cls += " grow";
        style = `animation-delay:${(0.75 + Math.min(i, 40) * 0.035).toFixed(2)}s`;
      }
      const dur = 3.8 + (si % 5) * 0.45,
        phase = ((now / 1000 + si * 0.37) % dur).toFixed(2);
      const open = live
        ? `<g class="leaf-sway" style="animation-duration:${dur.toFixed(2)}s;animation-delay:-${phase}s">`
        : "<g>";
      return `<g transform="translate(${f1(s.x)} ${f1(s.y)}) rotate(${((s.ang * 180) / Math.PI).toFixed(1)})" data-leaf="${esc(l.key)}" data-len="${s.len.toFixed(1)}">${open}<g class="${cls}" style="${style}"><path d="${leafD(s.len)}" fill="${morandiTone(l.color)}"><title>${esc(l.title)}</title></path><path class="leaf-vein" d="M0 0L${f1(s.len * 0.72)} 0"/></g></g></g>`;
    })
    .join("");
  const fallEls = (falls || [])
    .map(
      (f) =>
        `<g transform="translate(${f1(f.x)} ${f1(f.y)})"><g class="leaf-fall" style="--sx:${f.sx}px;--fall:${f.fall.toFixed(0)}px;animation-delay:${(-(now - f.t0 - f.delay)).toFixed(0)}ms"><path transform="rotate(${f.deg})" d="${leafD(f.len)}" fill="${morandiTone(f.color)}"/></g></g>`,
    )
    .join("");
  return `<svg viewBox="0 0 250 170" preserveAspectRatio="xMidYMax meet" role="img" aria-label="Week ${week} 的成長樹"><ellipse cx="${TREE_X}" cy="${TREE_BASE + 1.5}" rx="${(30 + geo.g * 22).toFixed(0)}" ry="4" fill="rgba(90,110,86,.13)"/>${branches}<path class="tree-trunk${intro ? " draw" : ""}" d="${geo.trunkD}"/>${leafEls}${fallEls}</svg>`;
}
function revealLeaf(key) {
  flyingKeys.delete(key);
  const el = $(`#homeTree [data-leaf="${key}"] .tree-leaf`);
  if (el) {
    el.classList.remove("is-hidden");
    el.classList.add("grow");
  }
  setLeafCount(currentLeafRecords(treeWeek()).length - flyingKeys.size);
  // Sync the small decorative preview after the actual tree leaf appears.
  const peekLeaves = currentLeafRecords(treeWeek());
  const peekSlots = assignLeafSlots(treeWeek(), peekLeaves);
  $("#miniTreeArt").innerHTML = treeSvg(treeWeek(), peekLeaves, {
    slotOf: (k) => peekSlots[k],
  });
  $("#miniTreeLeafCount").textContent = String(peekLeaves.length - flyingKeys.size);
  renderDirection();
  const svg = $("#homeTree svg");
  if (svg) {
    svg.classList.remove("bounce");
    void svg.getBoundingClientRect();
    svg.classList.add("bounce");
  }
}
function sparkle(x, y, color, host = document.body) {
  for (let i = 0; i < 5; i++) {
    const d = document.createElement("i");
    d.className = "sparkle";
    d.style.background = color;
    host.appendChild(d);
    const a = -Math.PI / 2 + (i - 2) * 0.7 + (Math.random() * 0.3 - 0.15),
      r = 16 + Math.random() * 14;
    const an = d.animate(
      [
        { transform: `translate(${x}px,${y}px) scale(.4)`, opacity: 1 },
        {
          transform: `translate(${x + Math.cos(a) * r}px,${y + Math.sin(a) * r}px) scale(1)`,
          opacity: 1,
          offset: 0.45,
        },
        {
          transform: `translate(${x + Math.cos(a) * r * 1.5}px,${y + Math.sin(a) * r * 1.5 + 8}px) scale(.2)`,
          opacity: 0,
        },
      ],
      { duration: 620, easing: "ease-out" },
    );
    an.onfinish = () => d.remove();
  }
}
function launchLeaf(key, color, from, done) {
  const g = $(`#homeTree [data-leaf="${key}"]`);
  if (!g) {
    revealLeaf(key);
    return done();
  }
  const sx = from.left + from.width / 2,
    sy = from.top + from.height / 2;
  const m = g.getScreenCTM(),
    svg = g.ownerSVGElement,
    pt = svg.createSVGPoint();
  pt.x = 0;
  pt.y = 0;
  const end = pt.matrixTransform(m);
  const scale = Math.hypot(m.a, m.b),
    len = Number(g.dataset.len),
    w = len * 0.36;
  const off =
    end.y < 10 || end.y > innerHeight - 10 || end.x < 0 || end.x > innerWidth;
  let endAng = (Math.atan2(m.b, m.a) * 180) / Math.PI;
  while (endAng > 180) endAng -= 360;
  while (endAng < -180) endAng += 360;
  const el = document.createElement("div");
  el.className = "flying-leaf";
  el.innerHTML = `<svg viewBox="0 -${w} ${len} ${2 * w}" width="${len * scale}" height="${2 * w * scale}" style="top:${-w * scale}px"><path d="${leafD(len)}" fill="${color}"/></svg>`;
  document.body.appendChild(el);
  const frames = [],
    rise = 18;
  for (let i = 0; i <= 6; i++) {
    const u = i / 6,
      e = 1 - Math.pow(1 - u, 3);
    frames.push({
      offset: 0.2 * u,
      opacity: Math.min(1, u * 3),
      transform: `translate(${sx.toFixed(1)}px,${(sy - rise * e).toFixed(1)}px) rotate(${(-35 - 12 * e).toFixed(1)}deg) scale(${(0.4 + 1.2 * e).toFixed(3)})`,
    });
  }
  const p0 = { x: sx, y: sy - rise },
    tgt = off
      ? {
          x: sx + (sx < innerWidth / 2 ? 30 : -30),
          y: end.y < 10 ? -40 : innerHeight + 40,
        }
      : end;
  const dist = Math.hypot(tgt.x - p0.x, tgt.y - p0.y),
    cx = (p0.x + tgt.x) / 2 + (tgt.x > p0.x ? -24 : 24),
    cy = off
      ? (p0.y + tgt.y) / 2
      : Math.min(p0.y, tgt.y) - Math.min(140, 60 + dist * 0.25),
    N = 18;
  for (let i = 1; i <= N; i++) {
    const u = i / N,
      e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    const x = (1 - e) ** 2 * p0.x + 2 * (1 - e) * e * cx + e * e * tgt.x,
      y = (1 - e) ** 2 * p0.y + 2 * (1 - e) * e * cy + e * e * tgt.y;
    const ang = off
      ? -47 + Math.sin(u * 6) * 14
      : -47 * (1 - e) + endAng * e + Math.sin(u * Math.PI * 2) * 12 * (1 - u);
    const k = off ? 1.6 - 0.9 * e : 1 + 0.6 * (1 - e);
    frames.push({
      offset: 0.2 + 0.8 * u,
      opacity: off && u > 0.65 ? 1 - (u - 0.65) / 0.35 : 1,
      transform: `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${ang.toFixed(1)}deg) scale(${k.toFixed(3)})`,
    });
  }
  if (off) revealLeaf(key);
  const a = el.animate(frames, { duration: off ? 700 : 950, fill: "forwards" });
  let ended = false;
  const land = () => {
    if (ended) return;
    ended = true;
    el.remove();
    if (!off) {
      sparkle(end.x, end.y, color);
      revealLeaf(key);
    }
    done();
  };
  a.onfinish = land;
  a.oncancel = land;
}

function footprintDayGroups(week) {
  const dates = weekDateMap(week),
    start = dates.mon,
    raw = currentLeafRecords(week),
    buckets = new Map();
  const order = ["early", ...Object.keys(dates)];
  const ensure = (key, label) => {
    if (!buckets.has(key)) buckets.set(key, { key, label, items: new Map() });
    return buckets.get(key);
  };
  ensure("early", "提前完成");
  Object.keys(dates).forEach((k) =>
    ensure(k, `週${dayLabel(dates[k])} ${formatShortDate(dates[k])}`),
  );
  raw.forEach((l) => {
    const t = state.tasks.find((x) => x.id === l.taskId);
    let planned = "";
    if (t) {
      if (l.rec) {
        const oid = String(l.key).split(":")[1],
          o = t.occurrences?.find((x) => x.id === oid);
        planned = o?.date || "";
      } else planned = t.focusDate || "";
    }
    const early = Boolean(
      l.date &&
        (compareIsoDate(l.date, start) < 0 ||
          (planned && compareIsoDate(l.date, planned) < 0)),
    );
    let key = "early";
    if (!early) {
      const found = Object.keys(dates).find((k) => dates[k] === l.date);
      key = found || "early";
    }
    const bucket = buckets.get(key),
      itemKey = `${l.taskId}|${l.title}`;
    if (!bucket.items.has(itemKey))
      bucket.items.set(itemKey, { title: l.title, color: l.color, n: 0 });
    bucket.items.get(itemKey).n++;
  });
  return order
    .map((k) => buckets.get(k))
    .filter((b) => b.items.size > 0)
    .map((b) => ({ ...b, items: [...b.items.values()] }));
}
function footprintWeekItems(week) {
  return groupLeaves(currentLeafRecords(week));
}
function footprintMood(count) {
  const avg = Math.max(
    2,
    Math.round(state.cycle.directions.reduce((n, d) => n + d.target, 0) / 12) ||
      4,
  );
  return count >= avg
    ? "成果滿滿"
    : count >= Math.ceil(avg / 2)
      ? "一步一步"
      : "先休息一下";
}
function renderFootprintCard(week) {
  const card = $("#weekFootprintCard"),
    count = currentCompletedUnits(week),
    dayMode = state.mode === "day";
  let body = "",
    i = 0;
  if (dayMode) {
    const groups = footprintDayGroups(week);
    body = groups.length
      ? groups
          .map(
            (g) =>
              `<div class="footprint-day"><strong>${esc(g.label)}</strong>${g.items.map((x) => `<div class="footprint-item" style="--i:${i++};--c:${morandiTone(x.color || NEUTRAL_LEAF)}"><i></i><span>${esc(x.title)}</span>${x.n > 1 ? `<em>${x.n} 次</em>` : ""}</div>`).join("")}</div>`,
          )
          .join("")
      : `<div class="footprint-empty">這週還沒有完成紀錄</div>`;
  } else {
    const items = footprintWeekItems(week);
    body = items.length
      ? items
          .map(
            (x) =>
              `<div class="footprint-item" style="--i:${i++};--c:${morandiTone(x.color || NEUTRAL_LEAF)}"><i></i><span>${esc(x.title)}</span>${x.rec ? `<em>完成 ${x.n} 次</em>` : ""}</div>`,
          )
          .join("")
      : `<div class="footprint-empty">這週還沒有完成紀錄</div>`;
  }
  const archived = isWeekArchived(week),
    r = reviewObj(state.reflections[week]);
  const reflection = state.preferences.weeklyReflection;
  const remaining = activeTasks(week).filter((t) => !isRecurring(t) && !t.done);
  if (remaining.length)
    body += `<div class="footprint-day"><strong>還有 ${remaining.length} 件</strong>${remaining.map((t) => `<div class="footprint-item"><span>${esc(t.title)}</span>${!archived && week < 12 ? `<button type="button" class="text-button" data-footprint-move="${t.id}">移週</button>` : ""}</div>`).join("")}</div>`;
  const editor = reflection
    ? `<div class="footprint-reflection"><label>這週做得不錯的地方<input id="footprintGood" type="text" maxlength="80" value="${esc(r.good)}" placeholder="留下一句就好"></label><label>下週想調整的地方<input id="footprintAdjust" type="text" maxlength="80" value="${esc(r.adjust)}" placeholder="也可以只寫其中一格"></label><button class="primary-button" type="button" data-footprint-save>${r.savedAt ? "更新感想" : "儲存感想"}</button><p class="footprint-help">哪天想到都可以寫，之後也能修改；感想不會提前封存週次。</p></div>`
    : r.savedAt
      ? `<div class="footprint-reflection"><p>${esc(r.good)}</p><p>${esc(r.adjust)}</p></div>`
      : "";
  const action = `${editor}<div class="footprint-actions"><button class="text-button" type="button" data-footprint-later>回本週</button></div>`;
  card.innerHTML = `<div class="footprint-head"><div><p class="eyebrow">Week ${week}</p><h2 id="footprintTitle">本週足跡</h2></div><small>${count} 片葉子</small></div><p class="footprint-summary">這週真正完成的事，都留在這裡。</p><div class="footprint-list">${body}</div>${action}`;
  $("[data-footprint-later]")?.addEventListener("click", () =>
    closeFootprint(true),
  );
  $("[data-footprint-save]")?.addEventListener("click", () => {
    const good = $("#footprintGood").value.trim(),
      adjust = $("#footprintAdjust").value.trim();
    if (!good && !adjust) return showToast("先留下一點這週的想法");
    const previous = reviewObj(state.reflections[week]);
    const now = new Date().toISOString();
    state.reflections[week] = {
      good,
      adjust,
      savedAt: previous.savedAt || now,
      updatedAt: now,
    };
    const snap = state.archivedWeeks.find((x) => Number(x.week) === week);
    if (snap) snap.reflection = state.reflections[week];
    saveState();
    renderFootprintCard(week);
    showPendingCloudToast("感想已儲存，之後仍可修改");
  });
  $$("[data-footprint-move]").forEach((b) =>
    b.addEventListener("click", () => {
      const t = state.tasks.find(
        (x) => String(x.id) === b.dataset.footprintMove,
      );
      closeFootprint();
      openReplanTask(t);
    }),
  );
}

function openFootprint(week) {
  week = Number(week);
  if (week < 1 || week > 12) return;
  footprintWeek = week;
  state.footprintDeferred[week] = false;
  renderFootprintCard(week);
  const layer = $("#weekFootprintLayer");
  layer.classList.remove("closing");
  layer.hidden = false;
  layer.setAttribute("aria-hidden", "false");
  document.body.classList.add("footprint-open");
  saveState();
}
function closeFootprint(defer = false) {
  if (footprintWeek && defer) state.footprintDeferred[footprintWeek] = true;
  footprintWeek = null;
  const layer = $("#weekFootprintLayer");
  if (layer) {
    layer.classList.remove("closing");
    layer.hidden = true;
    layer.setAttribute("aria-hidden", "true");
  }
  document.body.classList.remove("footprint-open");
  saveState();
  renderHome();
}
function maybeOpenFootprint(week, delay = 500) {
  week = Number(week);
  // Early completion belongs to its scheduled week, but must not end that week.
  if (isCycleResting() || compareIsoDate(TODAY, Object.values(weekDateMap(week))[0]) < 0) return;
  if (
    state.footprintDeferred[week] ||
    isWeekArchived(week) ||
    !isWeekComplete(week)
  )
    return;
  setTimeout(
    () => {
      if (
        !isCycleResting() &&
        compareIsoDate(TODAY, Object.values(weekDateMap(week))[0]) >= 0 &&
        !state.footprintDeferred[week] &&
        !isWeekArchived(week) &&
        isWeekComplete(week)
      )
        openFootprint(week);
    },
    motionOk() ? delay : 0,
  );
}
function syncFootprintState() {
  if (footprintWeek && (footprintWeek < 1 || footprintWeek > 12)) {
    footprintWeek = null;
    const layer = $("#weekFootprintLayer");
    if (layer) {
      layer.hidden = true;
      layer.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("footprint-open");
  }
}
function openCompletionRecord(t) {
  if (!t) return;
  $("#completionRecordTitle").textContent = t.title;
  const rows = historicalCompletionNotes(t);
  if (isRecurring(t))
    t.occurrences
      .filter((o) => String(o.note || "").trim())
      .forEach((o) =>
        rows.push({ date: o.doneDate || "", note: o.note }),
      );
  else if (String(t.note || "").trim())
    rows.push({ date: t.doneDate || "", note: t.note });
  // 沒有寫小記錄，就保持空白，不只顯示日期；實際完成日期仍在原始任務資料內。
  $("#completionRecordBody").innerHTML = rows
    .map((x) => `<div class="completion-record-line">${x.date ? `<strong>${formatShortDate(x.date)}</strong>` : ""}<p class="completion-record-note">${esc(x.note)}</p></div>`)
    .join("");
  $("#completionRecordDialog").showModal();
}

// History follows the actual end of each week, not its first day or task status.
// The current week and pre-scheduled future weeks must never appear here early.
function historyWeekFinished(week) {
  week = Number(week);
  if (!Number.isInteger(week) || week < 1 || week > 12) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(CYCLE_START_YMD || "")))
    return false;
  const days = Object.values(weekDateMap(week));
  const lastDay = days.at(-1);
  return Boolean(lastDay && compareIsoDate(TODAY, lastDay) > 0);
}
function finishedHistoryWeeks() {
  return Array.from({ length: 12 }, (_, i) => i + 1).filter(historyWeekFinished);
}
function renderHistory() {
  const finished = finishedHistoryWeeks();
  // Visual journey shares this page's true calendar and completed-week rules.
  const firstDates = Object.values(weekDateMap(1));
  window.TPMilestones?.renderJourney({
    weeks: Array.from({ length: 12 }, (_, i) => {
      const week = i + 1;
      const dates = Object.values(weekDateMap(week));
      const snapshot = state.archivedWeeks.find(x => Number(x.week) === week);
      return {
        number: week, start: dates[0], end: dates.at(-1),
        finished: finished.includes(week),
        leaves: snapshot ? (snapshot.completed || []).length : currentLeafRecords(week).length,
      };
    }),
    resting: isCycleResting(),
    currentWeek: CURRENT_WEEK,
    today: TODAY,
    tree: !isCycleResting() ? treeSvg(CURRENT_WEEK, currentLeafRecords(CURRENT_WEEK),
      { slotOf: (key) => assignLeafSlots(CURRENT_WEEK, currentLeafRecords(CURRENT_WEEK))[key] }) : "",
    onReviewWeek: week => {
      showHistoryWeek(week);
      $("#historyDetail").scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  });
  renderHistoryTanks(finished);
  $("#yearReviewBtn").hidden = !finished.length;
  const mk = (w) => {
    const leaves = currentLeafRecords(w),
      map = assignLeafSlots(w, leaves);
    return {
      week: w,
      map,
      leaves: leaves.map((l) => ({
        key: l.key,
        title: l.title,
        color: l.color,
      })),
      total: currentTotalUnits(w),
    };
  };
  const cards = finished.map((week) => {
    const snapshot = state.archivedWeeks.find((x) => Number(x.week) === week);
    return snapshot
      ? {
          week,
          leaves: (snapshot.completed || []).map((v, i) => ({
            key: v.key || `h${week}-${i}`,
            title: v.title,
            color: morandiTone(v.color || NEUTRAL_LEAF),
          })),
          total: currentTotalUnits(week),
        }
      : mk(week);
  });
  const firstWeekDates = Object.values(weekDateMap(1));
  const historyOpenDate = firstWeekDates.length
    ? formatShortDate(D.addDays(firstWeekDates.at(-1), 1))
    : "第一週結束後";
  $("#historyArchiveSubtitle").textContent = cards.length
    ? `已收藏 ${cards.length} 週的成果。選一週，看看當時留下了什麼。`
    : "";
  $("#historyGrid").innerHTML = cards.length
    ? cards.map((x) => {
        const done = x.leaves.length;
        const dates = Object.values(weekDateMap(x.week));
        const dateRange = dates.length
          ? `${formatShortDate(dates[0])}－${formatShortDate(dates.at(-1))}`
          : "";
        const tree = treeSvg(
          x.week, x.leaves,
          x.map ? { slotOf: (k) => x.map[k], hidden: flyingKeys } : {},
        );
        return `<button class="history-card soft-card" type="button" data-history-week="${x.week}" aria-pressed="false" aria-label="查看 Week ${x.week} 的歷史紀錄">
          <span class="history-card-index">W${String(x.week).padStart(2, "0")}</span>
          <div class="history-card-copy">
            <span class="history-card-overline">已完成的週次</span>
            <h3>Week ${x.week}</h3>
            <p class="history-card-date">${esc(dateRange)}</p>
            <div class="history-statline"><strong>${done}</strong><span>片葉子</span></div>
          </div>
          <div class="history-mini-tree" aria-hidden="true">${tree}</div>
          <span class="history-card-arrow" aria-hidden="true">↗</span>
        </button>`;
      }).join("")
    : `<div class="history-empty history-journal-empty">
        <span class="history-empty-leaf" aria-hidden="true">✦</span>
        <div><strong>第一份每週紀錄，還在路上</strong>
        <p>${esc(historyOpenDate)} 起，這裡會收好已結束週次的任務成果和感想。現在不會提前產生歷史紀錄。</p></div>
      </div>`;
  $$('[data-history-week]').forEach((b) =>
    b.addEventListener("click", () => {
      const w = Number(b.dataset.historyWeek);
      if (historySelected === w && !$("#historyDetail").hidden) closeHistory();
      else {
        showHistoryWeek(w);
        $("#historyDetail").scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }
    }),
  );
  const detailOpen = historySelected !== null && !$("#historyDetail").hidden;
  if (detailOpen) {
    if (finished.includes(Number(historySelected)))
      showHistoryWeek(historySelected);
    else closeHistory();
  } else markHistorySelected();
}
function groupLeaves(leaves) {
  const m = new Map();
  leaves.forEach((l) => {
    const k = l.taskId ?? `${l.title}|${l.color}`;
    if (!m.has(k))
      m.set(k, {
        title: l.title,
        color: l.color,
        n: 0,
        dates: [],
        items: [],
        note: l.note || "",
        noteEnabled: l.noteEnabled,
        rec: !!l.rec,
        target: l.target || 0,
      });
    const g = m.get(k);
    g.n++;
    if (l.date) g.dates.push(l.date);
    g.items.push({
      date: l.date || "",
      note: l.note || "",
      noteEnabled: l.noteEnabled,
    });
  });
  return [...m.values()];
}
function leftoverOf(week) {
  return activeTasks(week)
    .filter((t) => !taskDone(t))
    .map((t) => ({
      id: t.id,
      title: t.title,
      left: taskTarget(t) - occurrenceDoneCount(t),
      recurring: isRecurring(t),
      reason: state.unfinishedReasons[t.id] || "",
    }));
}
const REFLECTION_MESSAGES = [
  "這週的葉子收好了，慢慢長大也很棒 🌿",
  "這一週有留下痕跡，樹知道你有往前 🍃",
  "不用長得很滿，每一片留下來的都算數 🌱",
  "這週就先長到這裡，下一週再繼續 🌳",
];
function encouragementMessage(week, count) {
  return REFLECTION_MESSAGES[
    (Number(week) + Number(count)) % REFLECTION_MESSAGES.length
  ];
}
function reviewObj(v) {
  return {
    good: "",
    adjust: "",
    savedAt: "",
    ...(v && typeof v === "object" ? v : {}),
  };
}
function reflectionSaved(v) {
  return Boolean(reviewObj(v).savedAt);
}
function markHistorySelected() {
  const g = $("#historyGrid");
  g.classList.toggle("has-selection", historySelected !== null);
  $("#historyGrid .history-card").forEach((c) => {
    const selected = Number(c.dataset.historyWeek) === historySelected;
    c.classList.toggle("selected", selected);
    c.setAttribute("aria-pressed", String(selected));
  });
}
function closeHistory() {
  $("#historyDetail").hidden = true;
  historySelected = null;
  markHistorySelected();
}
function showHistoryWeek(week) {
  if (!historyWeekFinished(week)) {
    closeHistory();
    return;
  }
  const box = $("#historyDetail");
  box.hidden = false;
  historySelected = week;
  markHistorySelected();
  let completed,
    replans,
    deleted,
    review,
    leftover = [];
  const archived = state.archivedWeeks.find(
    (x) => Number(x.week) === Number(week),
  );
  if (archived) {
    completed = groupLeaves(archived.completed || []);
    replans = archived.replanned || [];
    deleted = archived.deleted || [];
    review = state.reflections[week] ?? archived.reflection;
    leftover = leftoverOf(week);
  } else {
    completed = groupLeaves(currentLeafRecords(week));
    replans = state.events
      .filter((e) => e.type === "replan" && e.fromWeek === week)
      .map((e) => `${e.title} → Week ${e.toWeek}｜${e.reason || ""}`)
      .concat(
        state.events
          .filter((e) => e.type === "replan" && e.toWeek === week)
          .map(
            (e) => `從 Week ${e.fromWeek} 移來：${e.title}｜${e.reason || ""}`,
          ),
      );
    deleted = state.events
      .filter((e) => e.type === "delete" && e.week === week)
      .map((e) => `${e.title}｜${e.reason || ""}`);
    review = state.reflections[week];
    leftover = leftoverOf(week);
  }
  const count = completed.reduce((n, x) => n + x.n, 0);
  const raw = archived ? archived.completed || [] : currentLeafRecords(week),
    dc = {};
  raw.forEach((l) => {
    if (l.date) dc[l.date] = (dc[l.date] || 0) + 1;
  });
  const daily = Object.keys(dc)
    .sort()
    .map((d) => `${formatShortDate(d)} ${dc[d]} 片`)
    .join(" · ");
  box.innerHTML = historyDetailHtml(
    week,
    completed,
    count,
    replans,
    deleted,
    review,
    leftover,
    daily,
  );
  // The detailed weekly journal is now the single source of review presentation.
  // No duplicated keepsake card is inserted above the actual records.
  $("[data-close-history]")?.addEventListener("click", closeHistory);
  $("[data-save-reflection]")?.addEventListener("click", () => {
    const good = $("#reviewGood").value.trim(),
      adjust = $("#reviewAdjust").value.trim();
    if (!good && !adjust) return showToast("先留下一點這週的想法");
    const previous = reviewObj(state.reflections[week]);
    const now = new Date().toISOString();
    state.reflections[week] = {
      good,
      adjust,
      savedAt: previous.savedAt || now,
      updatedAt: now,
    };
    const snap = state.archivedWeeks.find(
      (x) => Number(x.week) === Number(week),
    );
    if (snap) snap.reflection = state.reflections[week];
    saveState();
    showPendingCloudToast("感想已儲存，之後仍可修改");
    showHistoryWeek(week);
  });
  $$("[data-reason-task]").forEach((b) =>
    b.addEventListener("click", () => {
      if (isWeekArchived(week)) return;
      const id = b.dataset.reasonTask;
      state.unfinishedReasons[id] =
        state.unfinishedReasons[id] === b.dataset.reason
          ? ""
          : b.dataset.reason;
      saveState();
      showHistoryWeek(week);
    }),
  );
}
function historyDetailHtml(
  week,
  completed,
  count,
  replanned,
  deleted,
  review,
  leftover,
  daily = "",
) {
  const r = reviewObj(review),
    saved = reflectionSaved(review),
    archived = isWeekArchived(week);
  const line = (x) => {
    const head = x.rec ? `完成 ${x.n} 次` : "";
    const subs = x.rec
      ? [...x.items]
          .sort((a, b) => String(a.date).localeCompare(String(b.date)))
          .filter((i) => String(i.note || "").trim())
          .map(
            (i) =>
              `<small>${esc(i.date ? formatShortDate(i.date) : "")}${i.date ? "　" : ""}${esc(i.note)}</small>`,
          )
      : x.note
        ? [`<small>${esc(x.note)}</small>`]
        : [];
    return `<div class="history-line"><i class="leaf-dot" style="--c:${morandiTone(x.color || NEUTRAL_LEAF)}"></i><span>${esc(x.title)}${head ? `<em class="line-head">　${esc(head)}</em>` : ""}</span>${subs.length ? `<div class="history-subs">${subs.join("")}</div>` : ""}</div>`;
  };
  const left = leftover.length
    ? `<div class="history-section"><p class="field-label">還留在這週的</p>${leftover.map((x) => `<div class="history-line"><i class="leaf-dot hollow"></i><span>${esc(x.title)}</span>${x.recurring ? `<small>還差 ${x.left} 次</small>` : ""}${archived ? "" : `<div class="reason-chips">${REASONS.map((rs) => `<button type="button" class="reason-chip ${x.reason === rs ? "on" : ""}" data-reason-task="${x.id}" data-reason="${rs}">${rs}</button>`).join("")}</div>`}</div>`).join("")}</div>`
    : "";
  let reviewBlock = "";
  if (state.preferences.weeklyReflection) {
    reviewBlock = `<div class="reflection-editor history-section"><p class="field-label">每週感想</p><label class="review-label">這週做得不錯的地方<input id="reviewGood" type="text" maxlength="80" value="${esc(r.good)}" placeholder="留下一句就好"></label><label class="review-label">下週想調整的地方<input id="reviewAdjust" type="text" maxlength="80" value="${esc(r.adjust)}" placeholder="也可以只寫其中一格"></label><button class="primary-button" type="button" data-save-reflection="${week}">${saved ? "更新感想" : "儲存感想"}</button><p class="week-state-note">想寫就寫，也可以之後補充或修改；不會更動已封存的任務紀錄。</p></div>`;
  } else if (saved) {
    reviewBlock = `<div class="history-section"><p class="field-label">感想</p><div class="history-readonly-review">${r.good ? `<p><small>這週做得不錯的地方</small><br>${esc(r.good)}</p>` : ""}${r.adjust ? `<p><small>下週想調整的地方</small><br>${esc(r.adjust)}</p>` : ""}</div></div>`;
  }
  const dates = Object.values(weekDateMap(week));
  const range = dates.length
    ? `${formatShortDate(dates[0])}－${formatShortDate(dates.at(-1))}`
    : "";
  const doneLines = completed.length
    ? completed.map(line).join("")
    : `<p class="history-no-results">這週還沒有完成紀錄。</p>`;
  const completedSection = `<section class="history-section history-completed-section">
      <div class="history-section-heading"><h4>完成的事情</h4><span>${count} 片葉子</span></div>
      ${daily ? `<p class="daily-line">${esc(daily)}</p>` : ""}
      <div class="history-completed-list">${doneLines}</div>
    </section>`;
  const changes = `${left}
    ${replanned.length ? `<section class="history-section"><p class="field-label">移到其他週</p>${replanned.map((x) => `<div class="history-line history-change"><span>→</span><span>${esc(x)}</span></div>`).join("")}</section>` : ""}
    ${deleted.length ? `<section class="history-section"><p class="field-label">已刪除</p>${deleted.map((x) => `<div class="history-line history-delete"><span>×</span><span>${esc(x)}</span></div>`).join("")}</section>` : ""}`;
  const reflectionColumn = reviewBlock
    ? `<aside class="history-detail-reflection">${reviewBlock}</aside>`
    : "";
  const encouragement = saved
    ? `<p class="history-encouragement">${encouragementMessage(week, count)}</p>` : "";
  return `<div class="history-detail-head">
      <div><p class="history-detail-kicker">WEEK ${String(week).padStart(2, "0")} · ${esc(range)}</p>
      <h3>第 ${week} 週的紀錄</h3>
      <p class="history-detail-lede">完成的、調整過的，都留在這一週。</p></div>
      <button class="text-button" type="button" data-close-history aria-label="收起第 ${week} 週紀錄">收起 ↑</button>
    </div>
    <div class="history-detail-layout${reviewBlock ? " has-reflection" : ""}">
      <div class="history-detail-results">${completedSection}${changes}</div>
      ${reflectionColumn}
    </div>${encouragement}`;
}
function renderSettings() {
  $("#completionNoteToggle").checked = state.preferences.completionNote;
  $("#weeklyReflectionToggle").checked = state.preferences.weeklyReflection;
  $("#lineToggle").checked = state.preferences.lineEnabled;
  $("#lineTime").value = state.preferences.lineTime || "08:00";
  $("#lineMondayTime").value = state.preferences.lineMondayTime || state.preferences.lineTime || "08:00";
  $("#lineSundayTime").value = state.preferences.lineSundayTime || state.preferences.lineTime || "08:00";
  $("#lineSettings").hidden = !state.preferences.lineEnabled;
  $("#lineSummary").textContent = `週一 ${$("#lineMondayTime").value} · 週日 ${$("#lineSundayTime").value}`;
  $("#lineCadenceNote").textContent = "週一安排與週日足跡各自依設定時間推播；每日與每週模式都會收到。";
  renderDirectionList();
  renderRecurringList();
  renderCategoryList();
}
function renderRecurringList() {
  const el = $("#recurringList");
  el.innerHTML = state.recurringRules.length
    ? state.recurringRules
        .map(
          (r) =>
            `<div class="manage-row"><span class="color-dot" style="--c:${morandiTone(categoryById(r.categoryId)?.color || NEUTRAL_LEAF)}"></span><div><strong>${esc(r.title)}</strong><small>${r.frequency === "daily" ? "每天" : `每週 ${r.timesPerWeek} 次`}</small></div><label class="mini-switch"><input type="checkbox" data-rule-active="${r.id}" ${r.active ? "checked" : ""}><i></i></label><button class="text-button" type="button" data-edit-rule="${r.id}">編輯</button></div>`,
        )
        .join("")
    : `<div class="empty-note">還沒有重複習慣</div>`;
  $$("[data-rule-active]").forEach((i) =>
    i.addEventListener("change", () => {
      const r = state.recurringRules.find((x) => x.id === i.dataset.ruleActive);
      r.active = i.checked;
      renderAll();
    }),
  );
  $$("[data-edit-rule]").forEach((b) =>
    b.addEventListener("click", () => openRecurringDialog(b.dataset.editRule)),
  );
}
function renderCategoryList() {
  const el = $("#categoryList");
  el.innerHTML = state.categories.length
    ? state.categories.map((c) => {
        const color = normalizeHexColor(c.color) || PALETTE[0].toUpperCase();
        return `<div class="category-compact-row">` +
          `<button type="button" class="category-color-trigger" data-open-category-color="${esc(c.id)}" aria-label="調整 ${esc(c.name)} 的顏色" title="調整顏色"><span class="category-color-sample" style="--category-color:${color}"></span></button>` +
          `<div class="category-compact-copy"><strong>${esc(c.name)}</strong><small>${color}</small></div>` +
          `<div class="category-compact-actions">` +
          `<button type="button" class="category-action-btn" data-edit-category="${esc(c.id)}">編輯</button>` +
          `<button type="button" class="category-action-btn category-color-action" data-open-category-color="${esc(c.id)}">調色</button>` +
          `</div></div>`;
      }).join("")
    : '<div class="category-empty-state">還沒有分類，點「＋ 新增」建立第一個分類。</div>';
  $$('[data-edit-category]').forEach((button) =>
    button.addEventListener('click', () => openCategoryDialog(button.dataset.editCategory))
  );
  $$('[data-open-category-color]').forEach((button) =>
    button.addEventListener('click', () => openCategoryColorDialog(button.dataset.openCategoryColor))
  );
}
function openCategoryColorDialog(id) {
  const category = state.categories.find((c) => c.id === id);
  if (!category) return;
  categoryQuickTargetId = id;
  categoryQuickColor = normalizeHexColor(category.color) || PALETTE[0].toUpperCase();
  $("#categoryColorDialogTitle").textContent = category.name + " · 調整顏色";
  renderCategoryQuickPalette();
  $("#categoryColorDialog").showModal();
}
function renderCategoryQuickPalette() {
  renderCategoryPresetPalette("categoryQuickPalette", categoryQuickColor, (color) => {
    categoryQuickColor = color;
    renderCategoryQuickPalette();
  });
  updateCategoryColorInputs("categoryQuick", categoryQuickColor);
}

function openEditTask(t) {
  if (!t || !guardWeekEditable(t.week)) return;
  editingTaskId = t.id;
  editingTaskOccurrenceId = actionOccurrenceId;
  $("#editTaskTitle").value = t.title;
  $("#editTaskGoal").innerHTML =
    `<option value="">不指定成長方向</option>` +
    state.cycle.goals
      .map(
        (g) => `<option ${g === t.goal ? "selected" : ""}>${esc(g)}</option>`,
      )
      .join("");
  $("#editTaskCategory").innerHTML = categoryOptions(t.categoryId);
  const editOcc =
    editingTaskOccurrenceId && isRecurring(t)
      ? t.occurrences.find((o) => o.id === editingTaskOccurrenceId)
      : null;
  const editDate = editOcc?.date || t.focusDate || "",
    dates = weekDateMap(t.week);
  $("#editTaskDateWrap").hidden = isRecurring(t) && !editOcc;
  $("#editTaskDate").innerHTML =
    `<option value="">不指定日期</option>` +
    Object.keys(dates)
      .map(
        (k) =>
          `<option value="${dates[k]}" ${dates[k] === editDate ? "selected" : ""}>週${dayLabel(dates[k])} ${Number(dates[k].slice(8))}</option>`,
      )
      .join("");
  $("#editTaskTimesWrap").hidden =
    !isRecurring(t) ||
    t.frequency !== "weekly" ||
    Boolean(editingTaskOccurrenceId);
  $("#editTaskTimes").innerHTML = timesOptions(t.targetCount || 2);
  $("#editTaskDialog").showModal();
}
function openReplanTask(t) {
  if (
    !t ||
    !guardWeekEditable(t.week) ||
    isRecurring(t) ||
    t.done ||
    t.week >= 12
  )
    return;
  actionTaskId = t.id;
  $("#replanTaskTitle").textContent = t.title;
  $("#replanWeek").innerHTML = Array.from(
    { length: 12 - t.week },
    (_, i) => t.week + i + 1,
  )
    .map((w) => {
      const allowed =
        (w === t.week + 1 || isWeekUnlocked(w)) && !isWeekArchived(w);
      return `<option value="${w}" ${allowed ? "" : "disabled"}>Week ${w}</option>`;
    })
    .join("");
  $("#replanReason").value = "";
  $("#replanDialog").showModal();
}
function openRecurringDialog(id = null) {
  editingRecurringId = id;
  const r = id ? state.recurringRules.find((x) => x.id === id) : null;
  $("#recurringDialogTitle").textContent = r ? "編輯重複習慣" : "新增重複習慣";
  $("#recurringTitleInput").value = r?.title || "";
  $("#recurringCategory").innerHTML = categoryOptions(r?.categoryId || "");
  $("#recurringGoal").innerHTML =
    `<option value="">不指定成長方向</option>` +
    state.cycle.goals
      .map(
        (g) => `<option ${g === (r?.goal || "") ? "selected" : ""}>${esc(g)}</option>`,
      )
      .join("");
  $("#recurringFrequency").value = r?.frequency || "weekly";
  $("#recurringTimes").innerHTML = timesOptions(r?.timesPerWeek || 2);
  renderRecurringFields();
  $("#recurringDialog").showModal();
}
function renderRecurringFields() {
  $("#recurringTimesWrap").hidden = $("#recurringFrequency").value !== "weekly";
}
function openCategoryDialog(id = null) {
  editingCategoryId = id;
  const c = id ? state.categories.find((x) => x.id === id) : null;
  $("#categoryDialogTitle").textContent = c ? "編輯分類" : "新增分類";
  $("#categoryNameInput").value = c?.name || "";
  categoryPickColor =
    c?.color || PALETTE[state.categories.length % PALETTE.length];
  renderCategoryPalette();
  $("#categoryDialog").showModal();
}
function renderCategoryPalette() {
  renderCategoryPresetPalette("categoryPalette", categoryPickColor, (color) => {
    categoryPickColor = color;
    renderCategoryPalette();
  });
  updateCategoryColorInputs("category", categoryPickColor);
}

function createRecurringTask(rule, week = CURRENT_WEEK) {
  const id = D.id();
  const target = rule.frequency === "daily" ? 7 : rule.timesPerWeek;
  const t = recurringTask(
    id,
    rule.title,
    rule.categoryId,
    rule.frequency,
    target,
    week,
  );
  t.recurringRuleId = rule.id;
  t.goal = rule.goal || "";
  state.tasks.push(t);
  return id;
}
function resizeRecurringTask(t, target) {
  const old = t.occurrences || [],
    dates = weekDateMap(t.week);
  if (target > old.length) {
    for (let i = old.length; i < target; i++)
      old.push(
        occurrence(
          `${t.id}-o${D.id()}`,
          t.frequency === "daily" ? dates[DAY_KEYS[i]] || "" : "",
        ),
      );
  } else if (target < old.length) {
    const removable = [...old].reverse().filter((o) => !o.done);
    while (old.length > target && removable.length) {
      const r = removable.shift();
      old.splice(old.indexOf(r), 1);
    }
  }
  t.targetCount = Math.max(target, old.filter((o) => o.done).length);
  t.occurrences = old;
  syncTaskDone(t);
}
function ensureRecurringTasksForWeek(week) {
  week = Number(week);
  if (isWeekArchived(week)) return;
  state.recurringRules
    .filter((r) => r.active)
    .forEach((r) => {
      const exists = state.tasks.some(
        (t) => t.week === week && t.recurringRuleId === r.id,
      );
      if (!exists) createRecurringTask(r, week);
    });
}
function syncRecurringTasks() {
  ensureRecurringTasksForWeek(CURRENT_WEEK);
  const max = highestUnlockedWeek();
  for (let w = CURRENT_WEEK + 1; w <= max; w++) ensureRecurringTasksForWeek(w);
  if (state.selectedWeek && isWeekUnlocked(state.selectedWeek))
    ensureRecurringTasksForWeek(state.selectedWeek);
}

function dupExists(title) {
  const wk = state.selectedWeek;
  return state.tasks.some(
    (t) => t.status === "active" && t.week === wk && t.title.trim() === title,
  );
}
function bindStaticEvents() {
  $("#tankHint").addEventListener("click", (e) => {
    if (e.target.closest("[data-tank-adjust]")) {
      state.tankReviewed[CURRENT_WEEK] = true;
      renderAll();
      switchPage("settings");
      setTimeout(
        () =>
          $("#directionBlock").scrollIntoView({
            behavior: "smooth",
            block: "center",
          }),
        350,
      );
    } else if (e.target.closest("[data-tank-later]")) {
      state.tankReviewed[CURRENT_WEEK] = true;
      renderAll();
    }
  });
  bindDirectionColorInputs();
  $("#addDirectionBtn").addEventListener("click", () => openDirectionDialog());
  $("#directionForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#directionNameInput").value.trim(),
      outcome = $("#directionOutcomeInput").value.trim(),
      target = Math.max(
        1,
        Math.min(999, Number($("#directionTargetInput").value) || 1),
      );
    if (!name) return;
    if (!normalizeHexColor(directionPickColor) ||
        $("#directionHexColor").getAttribute("aria-invalid") === "true")
      return showToast("請輸入正確的 HEX 顏色");
    if (
      state.cycle.directions.some(
        (d) => d.name === name && d.id !== editingDirectionId,
      )
    )
      return showToast("方向的名字不能重複");
    const list = state.cycle.directions.map((d) => ({ ...d }));
    if (editingDirectionId)
      Object.assign(
        list.find((d) => d.id === editingDirectionId),
        { name, outcome, target, color: directionPickColor },
      );
    else {
      if (list.length >= 3) return;
      list.push({
        id: `d${Date.now()}`,
        name,
        outcome,
        target,
        color: directionPickColor,
      });
    }
    commitDirections(list);
    $("#directionDialog").close();
    renderAll();
    showPendingCloudToast("成長方向已更新");
  });
  $("#deleteDirectionBtn").addEventListener("click", () => {
    if (state.cycle.directions.length <= 1) return;
    commitDirections(
      state.cycle.directions
        .filter((d) => d.id !== editingDirectionId)
        .map((d) => ({ ...d })),
    );
    $("#directionDialog").close();
    renderAll();
    showPendingCloudToast("成長方向已刪除，葉子仍保留");
  });
  $("#replayTutorialBtn").addEventListener("click", openTutorial);

  $("#completionChangeReasonForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const reason = $("#completionChangeReasonInput").value.trim();
    if (!reason) {
      $("#completionChangeReasonError").hidden = false;
      $("#completionChangeReasonInput").focus();
      return;
    }
    const apply = pendingCompletionReasonAction;
    pendingCompletionReasonAction = null;
    $("#completionChangeReasonDialog").close();
    if (apply) apply(reason);
  });
  $("#completionChangeReasonCancel").addEventListener("click", () => {
    $("#completionChangeReasonDialog").close();
  });
  $("#completionChangeReasonDialog").addEventListener("close", () => {
    pendingCompletionReasonAction = null;
  });

  $("#completionRecordBtn").addEventListener("click", () => {
    const t = state.tasks.find((x) => x.id === actionTaskId);
    $("#taskActionDialog").close();
    openCompletionRecord(t);
  });
  $("#closeCompletionRecord").addEventListener("click", () =>
    $("#completionRecordDialog").close(),
  );

  $("#tutNext").addEventListener("click", () => {
    const totalSteps = TUT_STEPS;
    if (tutStep === 1 && !tutValid()) return;
    if (tutStep === totalSteps - 1) {
      tutApply = true;
      $("#tutorialDialog").close();
      return;
    }
    tutStep++;
    renderTutorial();
  });
  $("#tutBack").addEventListener("click", () => {
    tutStep = Math.max(0, tutStep - 1);
    renderTutorial();
  });
  $("#tutSkip").addEventListener("click", () => {
    tutApply = false;
    $("#tutorialDialog").close();
  });
  $("#tutorialDialog").addEventListener("close", finishTutorial);
  $("#dupCancel").addEventListener("click", () => $("#dupDialog").close());
  $("#dupConfirm").addEventListener("click", () => {
    $("#dupDialog").close();
    dupAllowed = true;
    $("#quickAddForm").requestSubmit();
    dupAllowed = false;
  });

  $("#weekStrip").addEventListener("click", (e) => {
    const b = e.target.closest("[data-week]");
    if (!b || b.disabled) return;
    state.selectedWeek = Number(b.dataset.week);
    state.selectedDate = defaultDateForWeek(state.selectedWeek);
    treeIntro = true;
    renderAll();
    b.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: "smooth",
    });
  });
  $("#dayStrip").addEventListener("click", (e) => {
    const nav = e.target.closest("[data-day-week]");
    if (nav) {
      const week = Number(nav.dataset.dayWeek);
      if (nav.disabled || !canEnterWeek(week)) return;
      state.selectedWeek = week;
      state.selectedDate = defaultDateForWeek(week);
      treeIntro = true;
      renderAll();
      return;
    }
    const b = e.target.closest("[data-date]");
    if (!b) return;
    state.selectedDate = b.dataset.date;
    renderAll();
  });
  $("#returnCurrentWeekBtn").addEventListener("click", () => {
    state.selectedWeek = CURRENT_WEEK;
    state.selectedDate = currentWeekDefaultDate();
    treeIntro = true;
    renderAll();
  });
  $("#footprintEntry").addEventListener("click", () =>
    openFootprint(state.selectedWeek),
  );
  $("#brandHome").addEventListener("click", (e) => {
    e.preventDefault();
    switchPage("home");
  });
  $$("[data-page-target]").forEach((b) =>
    b.addEventListener("click", () => switchPage(b.dataset.pageTarget)),
  );
  document.querySelectorAll("#homeModeControl [data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      const next = b.dataset.mode;
      if (next !== "week" && next !== "day") return;
      state.mode = next;
      syncViewModeButtons();
      try { localStorage.setItem("tp-view-preference", next); } catch {}
      renderAll();
    }),
  );

  $("#toggleRestPlanner").addEventListener("click", () => {
    if (!isCycleResting()) return;
    restPlannerOpen = !restPlannerOpen;
    renderHome();
  });
  $("#toggleWebPassword").addEventListener("click", () => {
    const field = $("#webPassword"), btn = $("#toggleWebPassword");
    const visible = field.type === "password";
    field.type = visible ? "text" : "password";
    btn.textContent = visible ? "隱藏" : "顯示";
    btn.setAttribute("aria-label", visible ? "隱藏密碼" : "顯示密碼");
    btn.setAttribute("aria-pressed", String(visible));
  });
  $("#openQuickAddBtn").addEventListener("click", () => {
    quickAddOpen = !quickAddOpen;
    $("#quickAddForm").hidden = !quickAddOpen;
    $("#openQuickAddBtn").setAttribute("aria-expanded", String(quickAddOpen));
    $("#openQuickAddBtn").textContent = quickAddOpen ? "－ 收起新增" : "＋ 新增任務";
    if (quickAddOpen) $("#quickTitle").focus();
  });
  $("#moreToggle").addEventListener("click", () => {
    const box = $("#moreFields");
    box.hidden = !box.hidden;
    $("#moreToggle").setAttribute("aria-expanded", String(!box.hidden));
    $("#moreToggle").textContent = box.hidden
      ? "＋ 更多設定"
      : "－ 收起更多設定";
  });
  $("#quickRepeat").addEventListener("change", () => {
    $("#quickRepeatFields").hidden = !$("#quickRepeat").checked;
    updateQuickDatePickerVisibility();
  });
  $("#quickFrequency").addEventListener("change", () => {
    $("#quickTimesWrap").hidden = $("#quickFrequency").value !== "weekly";
    updateQuickDatePickerVisibility();
  });
  $("#quickAddForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("#quickTitle").value.trim();
    if (!title) return showToast("先寫下一件想做的事");
    const targetWeek = state.selectedWeek;
    if (!isWeekUnlocked(targetWeek) && !isCycleResting()) return showToast("這一週還沒解鎖");
    if (!guardWeekEditable(targetWeek)) return;
    if (!dupAllowed && dupExists(title)) {
      $("#dupTitle").textContent = title;
      $("#dupDialog").showModal();
      return;
    }
    const categoryId = $("#quickCategory").value,
      goal = $("#quickGoal").value,
      scheduledDate = $("#quickDate").value,
      isRepeat = $("#quickRepeat").checked;
    if (scheduledDate && !Object.values(weekDateMap(targetWeek)).includes(scheduledDate))
      return showToast("日期需要在選取的週次內");
    if (isRepeat) {
      const frequency = $("#quickFrequency").value,
        times = frequency === "daily" ? 7 : Number($("#quickTimes").value || 2);
      const rule = {
        id: `rr-${Date.now()}`,
        title,
        frequency,
        timesPerWeek: times,
        categoryId,
        goal,
        active: true,
      };
      state.recurringRules.push(rule);
      justAdded = createRecurringTask(rule, targetWeek);
      if (frequency === "weekly" && scheduledDate) {
        const newHabit = state.tasks.find((t) => t.id === justAdded);
        const firstUnplanned = newHabit?.occurrences.find((occ) => !occ.done && !occ.date);
        if (firstUnplanned) firstUnplanned.date = scheduledDate;
      }
    } else
      state.tasks.push({
        id: (justAdded = D.id()),
        week: targetWeek,
        title,
        done: false,
        doneDate: "",
        focusDate: scheduledDate,
        goal,
        categoryId,
        status: "active",
        note: "",
      });
    state.footprintDeferred[targetWeek] = false;
    e.currentTarget.reset();
    $("#quickRepeatFields").hidden = true;
    $("#quickTimesWrap").hidden = true;
    $("#moreFields").hidden = true;
    $("#moreToggle").setAttribute("aria-expanded", "false");
    $("#moreToggle").textContent = "＋ 更多設定";
    quickAddOpen = false;
    renderAll();
    showPendingCloudToast(
      isRepeat
        ? state.mode === "day"
          ? `已加入 ${formatShortDate(scheduledDate || state.selectedDate)} 的習慣`
          : "已加入本週習慣"
        : scheduledDate
          ? `已安排到 ${formatShortDate(scheduledDate)}`
          : "已加入本週任務",
    );
  });

  $("#editTaskBtn").addEventListener("click", () => {
    const t = state.tasks.find((x) => x.id === actionTaskId);
    $("#taskActionDialog").close();
    openTaskEditor(t);
  });
  $("#replanTaskBtn").addEventListener("click", () => {
    const t = state.tasks.find((x) => x.id === actionTaskId);
    $("#taskActionDialog").close();
    openReplanTask(t);
  });
  $("#deleteTaskBtn").addEventListener("click", () => {
    const t = state.tasks.find((x) => x.id === actionTaskId);
    if (!t || !guardWeekEditable(t.week)) return;
    $("#taskActionDialog").close();
    $("#deleteTaskTitle").textContent = t.title;
    $("#deleteReason").value = "";
    $("#deleteDialog").showModal();
  });
  $("#deleteForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = state.tasks.find((x) => x.id === actionTaskId);
    const reason = $("#deleteReason").value.trim();
    if (!t || !reason || !guardWeekEditable(t.week)) return;
    $("#deleteDialog").close();
    performDelete(t, reason);
  });
  $("#editTaskForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = state.tasks.find((x) => x.id === editingTaskId);
    if (!t || !guardWeekEditable(t.week)) return;
    const title = $("#editTaskTitle").value.trim();
    if (!title) return showToast("名稱不能空白");
    const goal = $("#editTaskGoal").value,
      categoryId = $("#editTaskCategory").value,
      rule =
        isRecurring(t) && editingTaskOccurrenceId
          ? state.recurringRules.find((x) => x.id === t.recurringRuleId)
          : null;
    if (rule) {
      Object.assign(rule, { title, goal, categoryId });
      state.tasks
        .filter((x) => x.recurringRuleId === rule.id && !isWeekArchived(x.week))
        .forEach((x) => Object.assign(x, { title, goal, categoryId }));
    } else Object.assign(t, { title, goal, categoryId });
    const dateValue = $("#editTaskDate").value;
    if (editingTaskOccurrenceId && isRecurring(t)) {
      const o = t.occurrences.find((x) => x.id === editingTaskOccurrenceId);
      if (o) o.date = dateValue;
    } else if (!isRecurring(t)) t.focusDate = dateValue;
    if (isRecurring(t) && t.frequency === "weekly" && !editingTaskOccurrenceId)
      resizeRecurringTask(t, Number($("#editTaskTimes").value));
    $("#editTaskDialog").close();
    renderAll();
    showPendingCloudToast("編輯已更新");
  });
  $("#replanForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = state.tasks.find((x) => x.id === actionTaskId);
    if (!t || !guardWeekEditable(t.week)) return;
    const reason = $("#replanReason").value.trim();
    if (!reason) return;
    const from = t.week,
      to = Number($("#replanWeek").value),
      allowed = (to === from + 1 || isWeekUnlocked(to)) && !isWeekArchived(to);
    if (!allowed) return showToast("這一週還沒開放");
    state.events.push({
      type: "replan",
      taskId: t.id,
      title: t.title,
      fromWeek: from,
      toWeek: to,
      date: TODAY,
      reason,
    });
    t.originalWeek = t.originalWeek || from;
    t.week = to;
    t.focusDate = "";
    state.footprintDeferred[from] = false;
    if (isRecurring(t) && t.frequency === "daily") {
      const dates = weekDateMap(to);
      t.occurrences.forEach((o, i) => {
        if (!o.done) o.date = dates[DAY_KEYS[i]] || "";
      });
    } else if (isRecurring(t))
      t.occurrences.forEach((o) => {
        if (!o.done) o.date = "";
      });
    $("#replanDialog").close();
    renderAll();
    showPendingCloudToast(`已移到 Week ${to}`);
  });

  $("#skipNoteBtn").addEventListener("click", () => {
    const t = state.tasks.find((x) => x.id === pendingNoteTaskId);
    const week = t?.week;
    pendingNoteTaskId = null;
    pendingNoteOccId = "";
    pendingNoteOccIds = [];
    showToast("已略過完成小記；請以雲端同步提示確認儲存狀態");
    if (week) maybeOpenFootprint(week, 420);
  });
  $("#saveNoteBtn").addEventListener("click", () => {
    const t = state.tasks.find((x) => x.id === pendingNoteTaskId);
    const week = t?.week;
    if (t) {
      const v = $("#completionNoteInput").value.trim(),
        o =
          pendingNoteOccId &&
          t.occurrences?.find((x) => x.id === pendingNoteOccId);
      if (pendingNoteOccIds.length) {
        t.occurrences
          .filter((x) => pendingNoteOccIds.includes(x.id))
          .forEach((x) => (x.note = v));
      } else if (o) o.note = v;
      else t.note = v;
    }
    pendingNoteTaskId = null;
    pendingNoteOccId = "";
    pendingNoteOccIds = [];
    saveState();
    showPendingCloudToast("完成紀錄已更新");
    if (week) maybeOpenFootprint(week, 420);
  });

  $("#completionNoteToggle").addEventListener("change", (e) => {
    state.preferences.completionNote = e.target.checked;
    renderAll();
  });
  $("#weeklyReflectionToggle").addEventListener("change", (e) => {
    state.preferences.weeklyReflection = e.target.checked;
    renderAll();
  });
  $("#lineToggle").addEventListener("change", (e) => {
    state.preferences.lineEnabled = e.target.checked;
    renderAll();
  });
  $("#lineMondayTime").addEventListener("change", (e) => {
    state.preferences.lineMondayTime = e.target.value;
    renderAll();
  });
  $("#lineSundayTime").addEventListener("change", (e) => {
    state.preferences.lineSundayTime = e.target.value;
    renderAll();
  });

  $("#recurringFrequency").addEventListener("change", renderRecurringFields);
  $("#recurringForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("#recurringTitleInput").value.trim();
    if (!title) return showToast("先寫名稱");
    const frequency = $("#recurringFrequency").value,
      times =
        frequency === "daily" ? 7 : Number($("#recurringTimes").value || 2),
      categoryId = $("#recurringCategory").value,
      goal = $("#recurringGoal").value;
    if (editingRecurringId) {
      const r = state.recurringRules.find((x) => x.id === editingRecurringId);
      Object.assign(r, { title, frequency, timesPerWeek: times, categoryId, goal });
      state.tasks
        .filter((t) => t.recurringRuleId === r.id && !isWeekArchived(t.week))
        .forEach((t) => {
          t.title = title;
          t.categoryId = categoryId;
          t.goal = goal;
          t.frequency = frequency;
          resizeRecurringTask(t, times);
          if (frequency === "daily") {
            const dates = weekDateMap(t.week);
            t.occurrences.forEach((o, i) => {
              o.date = dates[DAY_KEYS[i]] || "";
            });
          } else
            t.occurrences.forEach((o) => {
              if (!o.done) o.date = "";
            });
        });
    } else
      state.recurringRules.push({
        id: `rr-${Date.now()}`,
        title,
        frequency,
        timesPerWeek: times,
        categoryId,
        active: true,
      });
    $("#recurringDialog").close();
    renderAll();
    showPendingCloudToast("重複習慣已更新");
  });
  $("#addCategoryBtn").addEventListener("click", () => openCategoryDialog());
  bindCategoryCustomColor("category", (color) => {
    categoryPickColor = color;
    renderCategoryPalette();
  });
  bindCategoryCustomColor("categoryQuick", (color) => {
    categoryQuickColor = color;
    renderCategoryQuickPalette();
  });
  $("#categoryColorForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const category = state.categories.find((c) => c.id === categoryQuickTargetId);
    const color = normalizeHexColor($("#categoryQuickHexColor").value);
    if (!category || !color) return showToast("請先輸入正確的色碼");
    $("#categoryColorDialog").close();
    if (normalizeHexColor(category.color) === color) return;
    category.color = color;
    renderAll();
    showPendingCloudToast(`${category.name} 的顏色已更新`);
  });
  $("#categoryForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#categoryNameInput").value.trim();
    if (!name) return showToast("先寫分類名稱");
    if (!normalizeHexColor($("#categoryHexColor").value)) return showToast("請先輸入正確的色碼");
    if (editingCategoryId)
      Object.assign(
        state.categories.find((x) => x.id === editingCategoryId),
        { name, color: categoryPickColor },
      );
    else
      state.categories.push({
        id: `cat-${Date.now()}`,
        name,
        color: categoryPickColor,
      });
    $("#categoryDialog").close();
    renderAll();
  });
  $$("[data-close-dialog]").forEach((b) =>
    b.addEventListener("click", () =>
      document.getElementById(b.dataset.closeDialog)?.close(),
    ),
  );
  $("#yearReviewBtn").addEventListener("click", openYearReview);
  $("#closeYearReview").addEventListener("click", () =>
    $("#yearReviewDialog").close(),
  );
}

function performDelete(t, reason) {
  if (!t || !guardWeekEditable(t.week)) return;
  const rows = $$(`#taskList [data-task-id="${t.id}"]`);
  rows.forEach((r) => {
    r.style.height = r.offsetHeight + "px";
  });
  void document.body.offsetHeight;
  rows.forEach((r) => r.classList.add("leaving"));
  const inTree = t.week === treeWeek(),
    units = occurrenceDoneCount(t);
  setTimeout(
    () => {
      if (inTree && units > 0) {
        const keys = isRecurring(t)
          ? t.occurrences.filter((o) => o.done).map((o) => `${t.id}:${o.id}`)
          : [String(t.id)];
        keys
          .slice(0, 7)
          .forEach((k, i) => queueFall(t.week, k, taskColor(t), i * 90));
      }
      state.events.push({
        type: "delete",
        taskId: t.id,
        title: t.title,
        week: t.week,
        date: TODAY,
        completedUnits: units,
        reason,
      });
      t.status = "deleted";
      renderAll();
      showPendingCloudToast("已刪除，原因留在 History 裡");
    },
    rows.length ? 300 : 0,
  );
}
function restartEnter(p) {
  p.classList.remove("entering");
  void p.offsetWidth;
  p.classList.add("entering");
  clearTimeout(p._t);
  p._t = setTimeout(() => p.classList.remove("entering"), 1500);
}
function switchPage(page) {
  const cur = $(".page.active");
  if (cur && cur.dataset.page === page) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  $$(".page").forEach((p) =>
    p.classList.toggle("active", p.dataset.page === page),
  );
  $$("[data-page-target]").forEach((b) =>
    b.classList.toggle("active", b.dataset.pageTarget === page),
  );
  window.scrollTo(0, 0);
  if (page === "home") {
    treeIntro = true;
    lastListKey = null;
    renderHome();
  }
  restartEnter($(`.page[data-page="${page}"]`));
}

const TUT_STEPS = 8;
let tutTasks = [],
  tutStep = 0,
  tutDraft = [],
  tutApply = false,
  tutDemoDone = false;
function openTutorial() {
  tutDraft = JSON.parse(JSON.stringify(state.cycle.directions));
  tutStep = 0;
  tutApply = false;
  tutDemoDone = false;
  tutTasks = [];
  $("#tutorialDialog").showModal();
  renderTutorial();
}
function tutPace(weekly) {
  const total = Math.round(weekly * 12 * 0.8),
    n = tutDraft.length;
  if (n === 1) {
    tutDraft[0].target = total;
    return;
  }
  const first = Math.round(total * 0.625),
    rest = total - first,
    share = Math.floor(rest / (n - 1));
  tutDraft.forEach(
    (d, i) =>
      (d.target =
        i === 0 ? first : i === n - 1 ? rest - share * (n - 2) : share),
  );
}
function tutTree(week, n, size = "") {
  const colors = state.categories.map((c) => c.color).concat(PALETTE),
    leaves = Array.from({ length: n }, (_, i) => ({
      key: "tut" + i,
      title: "",
      color: colors[i % colors.length],
    }));
  return `<div class="tut-stage tree ${size}">${treeSvg(week, leaves, {
    live: true,
    intro: true,
    now: performance.now(),
  })}</div>`;
}
function tutRow(t, color, more = false) {
  return `<article class="task-row tut-row ${t.done ? "done" : ""}" data-tut-id="${t.id}" style="--c:${color}"><button class="task-check" type="button" aria-label="${t.done ? "已完成" : "完成"}">${t.done ? "✓" : ""}</button><div class="task-main"><p class="task-title">${esc(t.title)}</p></div>${more ? `<button class="task-more" type="button" id="tutMore" aria-label="更多">•••</button>` : ""}</article>`;
}
const tutDoneCount = () => tutTasks.filter((t) => t.done).length;
function renderTutorial() {
  const body = $("#tutBody"),
    last = TUT_STEPS - 1,
    pane = (scene, title, text, extra = "") =>
      `<div class="tut-pane">${scene}<h3>${title}</h3><p>${text}</p>${extra}</div>`;
  $("#tutDots").innerHTML = Array.from(
    { length: TUT_STEPS },
    (_, i) => `<i class="${i < tutStep ? "done" : i === tutStep ? "on" : ""}"></i>`,
  ).join("");
  $("#tutCount").textContent = `${tutStep + 1} / ${TUT_STEPS}`;
  $("#tutBack").hidden = tutStep === 0;
  $("#tutNext").textContent =
    tutStep === last ? "開始使用" : tutStep === 0 ? "開始看看" : "下一步";
  $("#tutSkip").hidden = tutStep === last;
  $("#tutSkip").textContent = tutStep === 0 ? "先開始使用" : "略過教學";
  const dir = tutDraft[0] || { name: "", color: PALETTE[0], target: 12 };

  if (tutStep === 0) {
    body.innerHTML = pane(
      tutTree(1, 3),
      "歡迎來到 Tiny Progress",
      "每完成一件小事，就長一片葉子。接下來用一分鐘，實際做一遍。",
    );
  } else if (tutStep === 1) {
    body.innerHTML = pane(
      "",
      "選擇你的成長方向",
      "本輪目標是這 12 週想達成的成果；成長方向是持續投入的 1 到 3 個項目。之後可以修改，已長出的葉子不會消失。",
      `<div class="tut-dirs">${tutDraft.map((d, i) => `<div class="tut-dir" style="--c:${morandiTone(d.color)}"><i class="color-dot"></i><div><input data-tut-name="${i}" value="${esc(d.name)}" placeholder="成長方向名稱" maxlength="12"><input data-tut-outcome="${i}" value="${esc(d.outcome)}" placeholder="做到什麼算完成" maxlength="40"></div></div>`).join("")}</div>${tutDraft.length < 3 ? `<button class="text-button" type="button" id="tutAddDir">＋ 再加一個方向</button>` : ""}`,
    );
    $$("[data-tut-name]").forEach((el) =>
      el.addEventListener(
        "input",
        () => (tutDraft[Number(el.dataset.tutName)].name = el.value),
      ),
    );
    $$("[data-tut-outcome]").forEach((el) =>
      el.addEventListener(
        "input",
        () => (tutDraft[Number(el.dataset.tutOutcome)].outcome = el.value),
      ),
    );
    $("#tutAddDir")?.addEventListener("click", () => {
      tutDraft.push({
        id: `d${Date.now()}`,
        name: "",
        outcome: "",
        target: 12,
        color: PALETTE[(tutDraft.length * 3) % PALETTE.length],
      });
      renderTutorial();
    });
  } else if (tutStep === 2) {
    body.innerHTML = pane(
      "",
      "你習慣怎麼安排？",
      "整週和每日是同一份任務的兩個視角。請選擇平常想先看到哪一個，之後也能隨時切換。",
      `<div class="tut-reflect"><div class="tp-lens-choice" role="group" aria-label="預設檢視"><button type="button" data-tut-lens="week" aria-pressed="${state.mode === "week"}">整週安排</button><button type="button" data-tut-lens="day" aria-pressed="${state.mode === "day"}">每日安排</button></div><p>週次依真正的日期前進。任務屬於週，日期可留空；每日鏡頭會把未排日期的任務放在「本週還沒排」。</p><p>提前安排或完成不會讓週次提早跳轉。雲端顯示成功儲存後，才算完成同步。</p></div>`,
    );
    $$("[data-tut-lens]").forEach(button =>
      button.addEventListener("click", () => {
        const lens = button.dataset.tutLens;
        if (lens !== "week" && lens !== "day") return;
        state.mode = lens;
        syncViewModeButtons();
        try { localStorage.setItem("tp-view-preference", lens); } catch {}
        $("[data-tut-lens]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tutLens === lens)));
      })
    );
  } else if (tutStep === 3) {
    body.innerHTML = pane(
      "",
      "放進一件這週想做的事",
      "在下面寫一件事，按「加入」。這是練習，不會寫進正式資料。",
      `<form class="tut-add" id="tutAddForm"><input id="tutAddInput" maxlength="40" autocomplete="off" placeholder="例如：整理 HTML 筆記"><button class="primary-button" type="submit">加入</button></form><div class="tut-sandbox" id="tutList">${tutTasks.map((t) => tutRow(t, dir.color)).join("")}</div><p class="tut-note" id="tutAddMsg">${tutTasks.length ? "加好了，下一步就能完成它" : "加好之後，下一步就能完成它"}</p>`,
    );
    $("#tutAddForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("#tutAddInput"),
        title = input.value.trim(),
        msg = $("#tutAddMsg");
      if (!title) {
        msg.textContent = "先寫下一件想做的事";
        return;
      }
      if (tutTasks.length >= 3) {
        msg.textContent = "練習先加三件就夠了，繼續下一步吧";
        return;
      }
      tutTasks.push({ id: Date.now(), title, done: false });
      input.value = "";
      $("#tutList").innerHTML = tutTasks.map((t) => tutRow(t, dir.color)).join("");
      $("#tutList").lastElementChild.classList.add("row-new");
      msg.textContent = "加好了，下一步就能完成它";
    });
  } else if (tutStep === 4) {
    if (!tutTasks.length)
      tutTasks.push({ id: Date.now(), title: "整理 HTML 筆記", done: false });
    const stepPct = Math.max(8, Math.min(100, Math.round(100 / dir.target))),
      n = tutDoneCount();
    body.innerHTML = pane(
      "",
      "完成一件，長一片葉子",
      "點事情左邊的圈圈，看水缸長高。這只是練習，不會留下正式紀錄。",
      `<div class="tut-demo"><div class="tank demo" style="--c:${morandiTone(dir.color)}"><div class="tank-fill" id="tutDemoFill" style="width:${Math.min(100, n * stepPct)}%"></div><span class="tank-name">${esc(dir.name)}</span><span class="tank-count" id="tutDemoCount">${n} / ${dir.target}</span></div><div class="tut-sandbox" id="tutList">${tutTasks.map((t) => tutRow(t, dir.color)).join("")}</div></div><p class="tut-note" id="tutDemoMsg">${n ? "再點一件試試看" : "做完一件事，水缸就會長高"}</p>`,
    );
    $$("#tutList .task-check").forEach((btn) =>
      btn.addEventListener("click", () => {
        const row = btn.closest("[data-tut-id]"),
          t = tutTasks.find((x) => String(x.id) === row.dataset.tutId);
        if (!t || t.done) return;
        t.done = true;
        const count = tutDoneCount(),
          pct = Math.min(100, count * stepPct),
          from = btn.getBoundingClientRect(),
          tank = $("#tutDemoFill").parentElement.getBoundingClientRect(),
          to = {
            x: tank.left + Math.max(14, (tank.width * pct) / 100),
            y: tank.top + tank.height / 2,
          };
        btn.classList.add("popped");
        flyLeafSimple(
          from,
          to,
          dir.color,
          () => {
            $("#tutDemoFill").style.width = pct + "%";
            $("#tutDemoCount").textContent = `${count} / ${dir.target}`;
            btn.textContent = "✓";
            row.classList.add("done");
            sparkle(to.x, to.y, dir.color, $("#tutorialDialog"));
            $("#tutDemoMsg").textContent =
              count === tutTasks.length
                ? "全部完成了，每一件小事都算數 🌿"
                : "再點一件試試看";
          },
          $("#tutorialDialog"),
        );
      }),
    );
  } else if (tutStep === 5) {
    body.innerHTML = pane(
      tutTree(3, Math.max(tutDoneCount(), 3), "small"),
      "每週留一句感想",
      "樹上的葉子，就是你完成的每一件事。任何一天都可以到「本週足跡」寫一句，之後也能修改。",
      `<div class="tut-reflect"><label>這週做得不錯的地方<input id="tutGood" maxlength="80" placeholder="留一句就好"></label><label>下週想調整的地方<input id="tutAdjust" maxlength="80" placeholder="也可以只寫其中一格"></label><button class="primary-button" type="button" id="tutSaveRef">儲存感想</button></div><p class="tut-note" id="tutRefMsg">可以隨時回來補充或修改，簡單一句就好</p>`,
    );
    $("#tutSaveRef").addEventListener("click", () => {
      const good = $("#tutGood"),
        adjust = $("#tutAdjust"),
        msg = $("#tutRefMsg");
      if (!good.value.trim() && !adjust.value.trim()) {
        msg.textContent = "先寫一句再儲存";
        return;
      }
      good.disabled = adjust.disabled = true;
      $("#tutSaveRef").disabled = true;
      $("#tutSaveRef").textContent = "已儲存";
      msg.textContent = "存好了。這是練習，正式的感想要在本週足跡留下";
    });
  } else if (tutStep === 6) {
    let title = tutTasks.find((t) => !t.done)?.title || tutTasks[0]?.title || "練習 DOM 操作";
    body.innerHTML = pane(
      "",
      "寫錯了也沒關係",
      "點右邊的「•••」，三個選項都可以試試看。移週和刪除會請你留一句原因。",
      `<div class="tut-sandbox" id="tutEditBox">${tutRow({ id: "edit", title, done: false }, dir.color, true)}</div><p class="tut-note" id="tutEditMsg">這是練習，不會改到正式資料</p>`,
    );
    const box = $("#tutEditBox"),
      msg = $("#tutEditMsg"),
      closeMenu = () => box.querySelector(".mini-menu")?.remove(),
      finish = (text) => {
        box.innerHTML = `<p class="tut-gone">${text}</p><button class="text-button" type="button" id="tutAgain">再練習一次</button>`;
        $("#tutAgain").addEventListener("click", renderTutorial);
        msg.textContent = "要改回來，也是一樣的步驟";
      },
      startEdit = () => {
        const p = box.querySelector(".task-title"),
          input = document.createElement("input");
        input.className = "tut-inline";
        input.value = title;
        input.maxLength = 40;
        p.replaceWith(input);
        input.focus();
        input.select();
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            input.blur();
          }
        });
        input.addEventListener(
          "blur",
          () => {
            title = input.value.trim() || title;
            const np = document.createElement("p");
            np.className = "task-title";
            np.textContent = title;
            input.replaceWith(np);
            msg.textContent = "改好了，之後隨時都能再改";
          },
          { once: true },
        );
      },
      askReason = (act) => {
        box.querySelector(".tut-reason")?.remove();
        const f = document.createElement("form");
        f.className = "tut-reason";
        f.innerHTML = `<input maxlength="40" required placeholder="${act === "del" ? "為什麼刪除？例如：不需要了" : "為什麼移走？例如：時間不夠"}"><button class="primary-button" type="submit">確定</button>`;
        box.appendChild(f);
        f.querySelector("input").focus();
        f.addEventListener("submit", (e) => {
          e.preventDefault();
          const reason = f.querySelector("input").value.trim();
          if (!reason) return;
          const row = box.querySelector(".tut-row");
          f.remove();
          row.classList.add("leaving");
          setTimeout(
            () =>
              finish(
                act === "del"
                  ? `已刪除，原因「${esc(reason)}」留在 History 裡`
                  : `已移到 Week 2，原因「${esc(reason)}」記在紀錄裡`,
              ),
            280,
          );
        });
      };
    $("#tutMore").addEventListener("click", () => {
      if (box.querySelector(".mini-menu")) return closeMenu();
      const menu = document.createElement("div");
      menu.className = "mini-menu";
      menu.innerHTML = `<button type="button" data-act="edit">編輯</button><button type="button" data-act="move">移到其他週</button><button type="button" class="del" data-act="del">刪除</button>`;
      box.appendChild(menu);
      menu.addEventListener("click", (e) => {
        const act = e.target.dataset.act;
        if (!act) return;
        closeMenu();
        if (act === "edit") startEdit();
        else askReason(act);
      });
    });
  } else if (tutStep === 7) {
    body.innerHTML = pane(
      `<div class="tut-done" aria-hidden="true">✓</div>`,
      "準備好了",
      "你已經練習過：設定成長方向、加入任務、完成、寫感想、修改。想再看一次，到「設定」按「使用教學」。",
    );
  }
  // 樹上的葉子照順序一片一片長出來，而不是同時蹦出。
  const leafPace = { 0: [0.95, 0.32], 5: [0.7, 0.12] }[tutStep];
  if (leafPace)
    $$("#tutBody .tree-leaf").forEach(
      (el, i) =>
        (el.style.animationDelay = `${(leafPace[0] + i * leafPace[1]).toFixed(2)}s`),
    );
}
function flyLeafSimple(from, to, color, done, host = document.body) {
  const len = 16,
    w = len * 0.36,
    el = document.createElement("div");
  el.className = "flying-leaf";
  el.innerHTML = `<svg viewBox="0 -${w} ${len} ${2 * w}" width="${len}" height="${2 * w}" style="top:${-w}px"><path d="${leafD(len)}" fill="${color}"/></svg>`;
  host.appendChild(el);
  const sx = from.left + from.width / 2,
    sy = from.top + from.height / 2,
    N = 16,
    frames = [],
    cx = (sx + to.x) / 2,
    cy = Math.min(sy, to.y) - 60;
  for (let i = 0; i <= 5; i++) {
    const u = i / 5,
      e = 1 - Math.pow(1 - u, 3);
    frames.push({
      offset: 0.2 * u,
      opacity: Math.min(1, u * 3),
      transform: `translate(${sx}px,${sy - 16 * e}px) rotate(${-35 - 12 * e}deg) scale(${0.4 + 1.2 * e})`,
    });
  }
  for (let i = 1; i <= N; i++) {
    const u = i / N,
      e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2,
      p0y = sy - 16,
      x = (1 - e) ** 2 * sx + 2 * (1 - e) * e * cx + e * e * to.x,
      y = (1 - e) ** 2 * p0y + 2 * (1 - e) * e * cy + e * e * to.y;
    frames.push({
      offset: 0.2 + 0.8 * u,
      transform: `translate(${x}px,${y}px) rotate(${-47 + e * 80}deg) scale(${1.6 - 0.6 * e})`,
    });
  }
  const a = el.animate(frames, { duration: 900, fill: "forwards" });
  let ended = false;
  const fin = () => {
    if (ended) return;
    ended = true;
    el.remove();
    done();
  };
  a.onfinish = fin;
  a.oncancel = fin;
}
function finishTutorial() {
  if (tutApply) {
    const list = tutDraft.map((d) => ({
      ...d,
      name: d.name.trim(),
      outcome: d.outcome.trim(),
    }));
    commitDirections(list);
  }
  state.onboarded = true;
  renderAll();
}
function tutValid() {
  const names = tutDraft.map((d) => d.name.trim());
  if (names.some((n) => !n)) {
    showToast("每個方向都要有名字");
    return false;
  }
  if (new Set(names).size !== names.length) {
    showToast("方向的名字不能重複");
    return false;
  }
  return true;
}
function formatShortDate(iso) {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}
// A successful local UI change is not yet a confirmed cloud save.
// The sync banner in connection.js shows the authoritative result after PUT /api/state.
function showPendingCloudToast(message) {
  showToast(TPConnection.demo ? message : `${message} · 等待雲端確認`);
}
function showToast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.classList.remove("show"), 1800);
}
function openYearReview() {
  const finished = finishedHistoryWeeks();
  if (!finished.length) return;
  const completed = finished.reduce((total, week) => {
    const snapshot = state.archivedWeeks.find((w) => Number(w.week) === week);
    return total + (snapshot ? (snapshot.completed || []).length : currentLeafRecords(week).length);
  }, 0);
  const replans = state.events.filter(
    (e) => e.type === "replan" && finished.includes(Number(e.fromWeek)),
  ).length;
  $("#yearReviewText").textContent = "這裡統計本輪已結束週次的完成與移週紀錄。";
  $("#yearStats").innerHTML =
    `<div><strong>${completed}</strong><span>片葉子</span></div><div><strong>${finished.length}</strong><span>週走過</span></div><div><strong>${replans}</strong><span>次移到其他週</span></div>`;
  $("#yearReviewDialog").showModal();
}

bindStaticEvents();
$("#mobileTreePeek").addEventListener("click", () => {
  $("#growthBanner").scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    block: "start",
  });
});
refreshClock();
renderAll();
// 網頁跨到新日期時，休息畫面會自動切回正式週期；切回分頁時也會校正。
setInterval(() => {
  if (D.today() !== TODAY) renderAll();
}, 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && D.today() !== TODAY) renderAll();
});
restartEnter($(".page.active"));
TPConnection.start({
  get: () => state,
  toast: showToast,
  onCycleTheme: () => renderDirection(),
  replace(next) {
    state = next;
    try {
      const preference = localStorage.getItem("tp-view-preference");
      if (preference === "week" || preference === "day") state.mode = preference;
    } catch {}
    refreshClock();
    syncGoals();
    lastListKey = null;
    prevDone = null;
    flyingKeys.clear();
    growKeys.clear();
    renderAll();
    const hash = location.hash.slice(1);
    if (hash === "footprint") openFootprint(CURRENT_WEEK);
    else if (hash === "settings") switchPage("settings");
    if (!state.onboarded)
      setTimeout(() => {
        if (TPConnection.isReady()) openTutorial();
      }, 500);
  },
}).catch((error) => showToast(error.message));
