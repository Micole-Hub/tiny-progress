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
const PALETTE = [
  "#9fc3de",
  "#efb8cf",
  "#e7ce72",
  "#e3b48a",
  "#a9cb9f",
  "#c8b9e6",
  "#d4a99c",
  "#91b4a2",
  "#aeb8d3",
  "#d5c09c",
  "#b5a3c9",
  "#bec9b2",
];
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
const SEED_WEEK1_DATES = weekDateMap(1);
const seedState = {
  simulationWeekStart: CYCLE_START_YMD,
  mode: "week",
  selectedWeek: CURRENT_WEEK,
  selectedDate: TODAY,
  cycle: {
    number: 2,
    locked: true,
    direction: "以獨立開發為主，一邊把技能學到夠用",
    directions: [
      {
        id: "d1",
        name: "獨立開發",
        outcome: "完成 Flex Board 的靜態介面",
        target: 30,
        color: "#9fc3de",
      },
      {
        id: "d2",
        name: "學技能",
        outcome: "CSS 學到夠用，再開始 JavaScript",
        target: 18,
        color: "#a9cb9f",
      },
    ],
    goals: ["獨立開發", "學技能"],
  },
  preferences: {
    completionNote: false,
    weeklyReflection: true,
    lineEnabled: true,
    lineTime: "08:00",
  },
  categories: [
    { id: "learn", name: "學習", color: "#9fc3de" },
    { id: "life", name: "生活", color: "#e3b48a" },
    { id: "health", name: "健康", color: "#a9cb9f" },
    { id: "create", name: "創作", color: "#efb8cf" },
  ],
  recurringRules: [
    {
      id: "rr-8",
      title: "閱讀 15 分鐘",
      frequency: "weekly",
      timesPerWeek: 2,
      categoryId: "learn",
      active: true,
    },
    {
      id: "rr-11",
      title: "記下一個收穫",
      frequency: "daily",
      timesPerWeek: 7,
      categoryId: "health",
      active: true,
    },
  ],
  tasks: [
    {
      id: 1,
      week: 1,
      title: "整理 HTML 語意筆記",
      done: false,
      doneDate: "",
      focusDate: SEED_WEEK1_DATES.mon,
      goal: "學技能",
      categoryId: "learn",
      status: "active",
      note: "",
    },
    {
      id: 2,
      week: 1,
      title: "練習 DOM 操作",
      done: false,
      doneDate: "",
      focusDate: SEED_WEEK1_DATES.wed,
      goal: "學技能",
      categoryId: "learn",
      status: "active",
      note: "事件監聽終於比較順了",
    },
    {
      id: 3,
      week: 1,
      title: "Tiny Progress 新版首頁草圖",
      done: false,
      doneDate: "",
      focusDate: TODAY,
      goal: "獨立開發",
      categoryId: "create",
      status: "active",
      note: "",
    },
    {
      id: 4,
      week: 1,
      title: "整理 Tiny Progress 的 Week 流程",
      done: false,
      doneDate: "",
      focusDate: SEED_WEEK1_DATES.sun,
      goal: "獨立開發",
      categoryId: "create",
      status: "active",
      note: "",
    },
    recurringTask(8, "閱讀 15 分鐘", "learn", "weekly", 2, 1),
    recurringTask(11, "記下一個收穫", "health", "daily", 7, 2),
    {
      id: 20,
      week: 2,
      title: "讀完 JavaScript 函式章節",
      done: false,
      doneDate: "",
      focusDate: "",
      goal: "學技能",
      categoryId: "learn",
      status: "active",
      note: "",
    },
    {
      id: 21,
      week: 2,
      title: "Tiny Progress 接上真資料",
      done: false,
      doneDate: "",
      focusDate: "",
      goal: "獨立開發",
      categoryId: "create",
      status: "active",
      note: "",
    },
  ],
  archivedWeeks: [],
  weekMeta: {},
  footprintDeferred: {},
  reflections: {},
  events: [],
  leafSlots: {},
  onboarded: false,
  tankReviewed: {},
};

let state = loadState();
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
  categoryPickColor = PALETTE[0];

function cloneSeed() {
  return JSON.parse(JSON.stringify(seedState));
}
function loadState() {
  return TPConnection.initial(seedState);
}
function saveState() {
  TPConnection.save(state);
}
function refreshClock() {
  TODAY = D.today();
  CYCLE_START_YMD = state.cycle.startDate;
  CYCLE_WEEK_STARTS = state.cycle.weekStarts || null;
  CYCLE_WEEK_RANGES = state.cycle.weekRanges || null;
  CURRENT_WEEK = calendarWeekFor(TODAY);
}
function categoryById(id) {
  return state.categories.find((c) => c.id === id);
}
function taskColor(t) {
  return categoryById(t.categoryId)?.color || NEUTRAL_LEAF;
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
function renderAll() {
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
  $("#historyCycleLabel").textContent = `Cycle ${state.cycle.number}`;
  $("#homeEyebrow").textContent =
    `Cycle ${state.cycle.number} · ${state.mode === "day" ? "每日檢視" : "整週檢視"}`;
}
function directionLeafCounts() {
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
    const d = directionFor(t);
    if (t.status === "active" && d) counts[d.name] += occurrenceDoneCount(t);
  });
  flyingKeys.forEach((k) => {
    const [tid, oid] = k.split(":"),
      t = state.tasks.find((x) => String(x.id) === tid),
      d = t && directionFor(t);
    if (!t || t.status !== "active" || !d) return;
    const completed = oid
      ? t.occurrences?.find((o) => o.id === oid)?.done
      : t.done;
    if (completed) counts[d.name]--;
  });
  return counts;
}
function renderDirection() {
  syncGoals();
  $("#directionText").textContent = state.cycle.direction;
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
    c.style.setProperty("--c", d.color);
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
        `<div class="manage-row"><span class="color-dot" style="--c:${d.color}"></span><div><strong>${esc(d.name)}</strong><small>${esc(d.outcome || "")}${d.outcome ? " · " : ""}目標 ${d.target} 片</small></div><span></span><button class="text-button" type="button" data-edit-direction="${d.id}">編輯</button></div>`,
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
  $("#directionPalette").innerHTML = PALETTE.map(
    (c) =>
      `<button type="button" class="palette-dot ${c === directionPickColor ? "on" : ""}" style="--c:${c}" data-color="${c}" aria-label="選擇顏色"></button>`,
  ).join("");
  $$("#directionPalette [data-color]").forEach((b) =>
    b.addEventListener("click", () => {
      directionPickColor = b.dataset.color;
      renderDirectionPalette();
    }),
  );
}
function openDirectionDialog(id = null) {
  editingDirectionId = id;
  const d = id ? state.cycle.directions.find((x) => x.id === id) : null;
  $("#directionDialogTitle").textContent = d ? "編輯方向" : "新增方向";
  $("#directionNameInput").value = d?.name || "";
  $("#directionOutcomeInput").value = d?.outcome || "";
  $("#directionTargetInput").value = d?.target || 12;
  directionPickColor =
    d?.color || PALETTE[(state.cycle.directions.length * 3) % PALETTE.length];
  renderDirectionPalette();
  $("#deleteDirectionBtn").hidden = !d || state.cycle.directions.length <= 1;
  $("#directionDialog").showModal();
}
function renderHistoryTanks() {
  const ds = state.cycle.directions,
    counts = directionLeafCounts(),
    box = $("#historyTanks");
  box.hidden = !ds.length;
  box.innerHTML =
    `<p class="field-label">方向水缸</p>` +
    ds
      .map((d) => {
        const n = counts[d.name] || 0,
          pct =
            d.target > 0 ? Math.min(100, Math.round((n / d.target) * 100)) : 0;
        return `<div class="htank" style="--c:${d.color}"><div class="htank-head"><strong>${esc(d.name)}</strong><span>${n}${d.target ? ` / ${d.target}` : ""} 片</span></div>${d.outcome ? `<small>${esc(d.outcome)}</small>` : ""}<div class="tank big"><div class="tank-fill" style="width:${pct}%"></div></div></div>`;
      })
      .join("");
}

function renderHome() {
  if (!state.selectedWeek) state.selectedWeek = CURRENT_WEEK;
  const viewWeek = state.selectedWeek,
    dates = weekDateMap(viewWeek);
  if (!Object.values(dates).includes(state.selectedDate))
    state.selectedDate = defaultDateForWeek(viewWeek);
  const dayMode = state.mode === "day",
    isToday = viewWeek === CURRENT_WEEK && state.selectedDate === TODAY;
  const preview = viewWeek !== CURRENT_WEEK;
  $("#previewBar").hidden = !preview;
  if (preview) $("#previewLabel").textContent = `預習中 · Week ${viewWeek}`;
  const life = weekLifecycle(viewWeek),
    archived = life === "archived";
  const entry = $("#footprintEntry");
  entry.hidden = footprintWeek === viewWeek;
  $("#homeTitle").textContent = dayMode
    ? `Week ${viewWeek} · ${isToday ? "今天" : `週${dayLabel(state.selectedDate)} ${formatShortDate(state.selectedDate)}`}`
    : `Week ${viewWeek} · 這週慢慢長大`;
  $("#homeLede").textContent = dayMode
    ? "今天完成的每一件，都會長進這週的樹"
    : "一件一件完成，讓這週留下自己的樣子";
  $("#workTitle").textContent = dayMode
    ? isToday
      ? "今天想完成什麼"
      : `${formatShortDate(state.selectedDate)} 想完成什麼`
    : viewWeek === CURRENT_WEEK
      ? "這週想完成什麼"
      : `Week ${viewWeek}`;
  $("#workHint").textContent = archived
    ? "這週已封存，完整紀錄留在 History"
    : dayMode
      ? "選擇本週中的一天；事情仍屬於本週"
      : "把這週要完成的具體任務放在這裡";
  $("#quickTitle").placeholder = "加入本週事項";
  $("#weekStrip").hidden = dayMode;
  $("#dayStrip").hidden = !dayMode;
  dayMode ? renderDayStrip() : renderWeekStrip();
  renderTreeHome();

  let html = "";
  let habitHtml = "";
  if (dayMode) {
    const entries = [],
      habits = [];
    activeTasks(viewWeek).forEach((t) => {
      if (isRecurring(t)) {
        const dated = t.occurrences.filter(
          (o) => o.date === state.selectedDate,
        );
        if (dated.length) habits.push(habitRow(t, dated));
      } else if (t.focusDate === state.selectedDate)
        entries.push(taskRow(t, null));
    });
    html = entries.length
      ? taskSectionLabel("今天安排", "完成後也會計入本週進度") +
        entries.join("")
      : `<div class="empty-note">今天還沒有放進事情</div>`;
    habitHtml = habits.join("");
  } else {
    const tasks = activeTasks(viewWeek),
      regular = tasks.filter((t) => !isRecurring(t)),
      pending = regular.filter((t) => !taskDone(t)),
      finished = regular.filter(taskDone),
      habits = tasks.filter(isRecurring);
    html = pending.length
      ? taskSectionLabel("本週任務", "本週需要完成的項目") +
        pending.map((t) => taskRow(t, null)).join("")
      : "";
    if (finished.length)
      html += `<details class="completed-tasks"><summary>已完成任務</summary>${finished.map((t) => taskRow(t, null)).join("")}</details>`;
    habitHtml = habits.map((t) => habitRow(t, null)).join("");
    if (!regular.length)
      html = habits.length
        ? ""
        : `<div class="empty-note">這一週還沒有放進事情</div>`;
  }
  const list = $("#taskList");
  list.innerHTML = html;
  [...list.querySelectorAll("[data-task-id]")].forEach((el, i) =>
    el.style.setProperty("--i", i),
  );
  const habitTracker = $("#habitTracker");
  habitTracker.hidden = !habitHtml || archived;
  $("#habitTrackerTitle").textContent = dayMode ? "今天的習慣" : "習慣追蹤";
  $("#habitTrackerHint").textContent = dayMode
    ? "完成次數會計入本週"
    : "固定重複的事，集中記錄在這裡";
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
  applyRowFeedback();

  const ordinary = activeTasks(viewWeek).filter((t) => !isRecurring(t)),
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
    ? done === total
      ? "本週任務都完成了"
      : "本週還有 " + (total - done) + " 項任務待完成"
    : activeTasks(viewWeek).some(isRecurring)
      ? "習慣已在下方追蹤"
      : "先加入一件本週任務";
  $("#progressFill").style.width = total
    ? `${Math.round((done / total) * 100)}%`
    : "0%";
  $("#quickAddForm").hidden = archived;
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

function renderWeekStrip() {
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
      enterable = canEnterWeek(n);
    b.disabled = !enterable;
    b.setAttribute("aria-disabled", enterable ? "false" : "true");
    b.classList.toggle("locked", !unlocked);
    b.classList.toggle("archived", archived);
    b.classList.toggle("now", n === CURRENT_WEEK);
    b.classList.toggle("sel", n === state.selectedWeek);
    b.classList.toggle("past", n < CURRENT_WEEK);
  });
}
function renderDayStrip() {
  const el = $("#dayStrip"),
    dates = weekDateMap(state.selectedWeek),
    prev = state.selectedWeek - 1,
    next = state.selectedWeek + 1;
  el.innerHTML = `<button type="button" class="day-week-nav" data-day-week="${prev}" aria-label="上一週" ${canEnterWeek(prev) ? "" : "disabled"}>‹</button><div class="day-strip-row">${Object.keys(
    dates,
  )
    .map((k) => {
      const date = dates[k];
      return `<button type="button" class="dy ${date === TODAY ? "today" : ""}" data-date="${date}"><span>${dayLabel(dates[k])}</span><strong>${Number(date.slice(8))}</strong></button>`;
    })
    .join(
      "",
    )}</div><button type="button" class="day-week-nav" data-day-week="${next}" aria-label="下一週" ${canEnterWeek(next) ? "" : "disabled"}>›</button>`;
  $$("#dayStrip .dy").forEach((b) =>
    b.classList.toggle("sel", b.dataset.date === state.selectedDate),
  );
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
  return `<article class="task-row ${completed ? "done" : ""}" data-task-id="${t.id}" ${group ? `data-occurrence-ids="${group.map((o) => o.id).join(",")}"` : ""} style="--c:${color}" tabindex="0" aria-label="${completed ? "查看完成紀錄" : "編輯"}：${esc(t.title)}">
    <button class="task-check" type="button" aria-label="${checkLabel}">${circleDone ? "✓" : ""}</button>
    <div class="task-main"><p class="task-title">${esc(t.title)}</p>${meta.length ? `<div class="task-meta">${meta.join("")}</div>` : ""}</div>
    <button class="task-more" type="button" aria-label="更多" data-more="${t.id}">•••</button>
  </article>`;
}
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
  return `<article class="habit-row ${completed ? "done" : ""}" data-task-id="${t.id}" ${group ? `data-occurrence-ids="${group.map((o) => o.id).join(",")}"` : ""} style="--c:${color}" tabindex="0" aria-label="${completed ? "查看完成紀錄" : "編輯"}：${esc(t.title)}">
    <button class="task-check" type="button" aria-label="${label}">${completed ? "✓" : ""}</button>
    <div class="habit-main"><strong>${esc(t.title)}</strong><span>${t.frequency === "daily" ? "每天" : "每週"} · ${count}/${t.targetCount}</span></div>
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
function openTaskActions(t, row) {
  if (!t) return;
  setTaskActionContext(t, row);
  const archived = isWeekArchived(t.week);
  const pool = isRecurring(t)
    ? actionOccIds.length
      ? t.occurrences.filter((o) => actionOccIds.includes(o.id))
      : t.frequency === "daily"
        ? t.occurrences.filter((o) => o.date === TODAY)
        : t.occurrences
    : [t];
  const rowDone = pool.length > 0 && pool.every((o) => o.done);
  $("#actionTaskTitle").textContent = t.title;
  $("#toggleTaskDoneBtn").hidden = archived;
  $("#toggleTaskDoneBtn").textContent =
    isRecurring(t) && state.mode === "week" && !actionOccIds.length
      ? rowDone
        ? "改回本週未完成"
        : "完成本週全部次數"
      : rowDone
        ? "改回未完成"
        : "完成";
  $("#replanTaskBtn").hidden =
    archived || isRecurring(t) || taskDone(t) || t.week >= 12;
  $("#editTaskBtn").hidden = archived || !rowDone;
  $("#editTaskBtn").textContent = "編輯";
  $("#deleteTaskBtn").hidden = archived;
  $("#completionRecordBtn").hidden =
    occurrenceDoneCount(t) === 0 &&
    !t.note &&
    !t.occurrences?.some((o) => o.note);
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
      t.occurrences?.some((o) => o.note)
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
  $$("#taskList .task-row, #habitList .habit-row").forEach((row) => {
    const open = () => {
      const t = state.tasks.find((x) => x.id === Number(row.dataset.taskId));
      openTaskCard(t, row);
    };
    row.addEventListener("click", (e) => {
      if (e.target.closest("button,a,input,select,textarea,label")) return;
      open();
    });
    row.addEventListener("keydown", (e) => {
      if (e.target !== row || !(e.key === "Enter" || e.key === " ")) return;
      e.preventDefault();
      open();
    });
  });
}
function toggleTaskCompletion(t, occIds, fromRect) {
  if (!t || !guardWeekEditable(t.week)) return;
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
          color: taskColor(t),
        });
      }
      syncTaskDone(t);
    }
  } else {
    leafKey = String(t.id);
    if (t.done) {
      if (inTree) queueFall(t.week, leafKey, taskColor(t));
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
      showToast(
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
  pool.hidden = false;
  const choices = [];
  activeTasks(week).forEach((t) => {
    if (!isRecurring(t) && !t.done && t.focusDate !== state.selectedDate) {
      choices.push({ t, occ: null, label: "放進這天", meta: "" });
      return;
    }
    if (isRecurring(t) && t.frequency === "weekly") {
      const remaining = t.occurrences.filter((occ) => !occ.done && !occ.date);
      if (remaining.length)
        choices.push({
          t,
          occ: null,
          weekly: true,
          label: "安排一次",
          meta: `每週習慣 · 尚有 ${remaining.length} 次`,
        });
    }
  });
  pool.innerHTML =
    `<div class="focus-pool-head"><span>這週還有</span><small>安排到某一天後仍屬於本週</small></div>` +
    (choices.length
      ? choices
          .map(
            ({ t, occ, weekly, label, meta }) =>
              `<div class="focus-choice" style="--c:${taskColor(t)}"><i></i><span>${esc(t.title)}${meta ? `<small> · ${esc(meta)}</small>` : ""}</span><button class="text-button" type="button" data-focus-task="${t.id}" ${occ ? `data-focus-occ="${occ.id}"` : ""} ${weekly ? `data-focus-weekly="true"` : ""}>${label}</button></div>`,
          )
          .join("")
      : `<div class="empty-note">這週目前沒有其他還沒安排日期的事情</div>`);
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
      showToast("放進這天了");
    }),
  );
}
function renderQuickOptions() {
  $("#quickGoal").innerHTML =
    `<option value="">不連結方向</option>` +
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
      return `<g transform="translate(${f1(s.x)} ${f1(s.y)}) rotate(${((s.ang * 180) / Math.PI).toFixed(1)})" data-leaf="${esc(l.key)}" data-len="${s.len.toFixed(1)}">${open}<g class="${cls}" style="${style}"><path d="${leafD(s.len)}" fill="${l.color}"><title>${esc(l.title)}</title></path><path class="leaf-vein" d="M0 0L${f1(s.len * 0.72)} 0"/></g></g></g>`;
    })
    .join("");
  const fallEls = (falls || [])
    .map(
      (f) =>
        `<g transform="translate(${f1(f.x)} ${f1(f.y)})"><g class="leaf-fall" style="--sx:${f.sx}px;--fall:${f.fall.toFixed(0)}px;animation-delay:${(-(now - f.t0 - f.delay)).toFixed(0)}ms"><path transform="rotate(${f.deg})" d="${leafD(f.len)}" fill="${f.color}"/></g></g>`,
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
              `<div class="footprint-day"><strong>${esc(g.label)}</strong>${g.items.map((x) => `<div class="footprint-item" style="--i:${i++};--c:${x.color || NEUTRAL_LEAF}"><i></i><span>${esc(x.title)}</span>${x.n > 1 ? `<em>${x.n} 次</em>` : ""}</div>`).join("")}</div>`,
          )
          .join("")
      : `<div class="footprint-empty">這週還沒有完成紀錄</div>`;
  } else {
    const items = footprintWeekItems(week);
    body = items.length
      ? items
          .map(
            (x) =>
              `<div class="footprint-item" style="--i:${i++};--c:${x.color || NEUTRAL_LEAF}"><i></i><span>${esc(x.title)}</span>${x.rec ? `<em>完成 ${x.n} 次</em>` : ""}</div>`,
          )
          .join("")
      : `<div class="footprint-empty">這週還沒有完成紀錄</div>`;
  }
  const archived = isWeekArchived(week),
    complete = isWeekComplete(week),
    r = reviewObj(state.reflections[week]);
  const reflection = state.preferences.weeklyReflection && !reflectionSaved(r);
  const remaining = activeTasks(week).filter((t) => !isRecurring(t) && !t.done);
  if (remaining.length)
    body += `<div class="footprint-day"><strong>還有 ${remaining.length} 件</strong>${remaining.map((t) => `<div class="footprint-item"><span>${esc(t.title)}</span>${!archived && week < 12 ? `<button type="button" class="text-button" data-footprint-move="${t.id}">移週</button>` : ""}</div>`).join("")}</div>`;
  const editor = reflection
    ? `<div class="footprint-reflection"><label>這週做得不錯的地方<input id="footprintGood" type="text" maxlength="80" value="${esc(r.good)}" placeholder="留下一句就好"></label><label>下週想調整的地方<input id="footprintAdjust" type="text" maxlength="80" value="${esc(r.adjust)}" placeholder="也可以只寫其中一格"></label><button class="primary-button" type="button" data-footprint-save>儲存感想</button><p class="footprint-help">儲存後只能查看；不會立即封存這一週</p></div>`
    : r.savedAt
      ? `<div class="footprint-reflection"><p>${esc(r.good)}</p><p>${esc(r.adjust)}</p></div>`
      : "";
  const action = `${editor}<div class="footprint-actions">${complete && !archived ? `<button class="primary-button" type="button" data-footprint-next>${week < 12 ? "收好本週，前往下一週" : "收好本輪"}</button>` : ""}<button class="text-button" type="button" data-footprint-later>回本週</button></div>`;
  card.innerHTML = `<div class="footprint-head"><div><p class="eyebrow">Week ${week}</p><h2 id="footprintTitle">本週足跡</h2></div><small>${count} 片葉子</small></div><p class="footprint-summary">這週真正完成的事，都留在這裡。</p><div class="footprint-list">${body}</div>${action}`;
  $("[data-footprint-later]")?.addEventListener("click", () =>
    closeFootprint(true),
  );
  $("[data-footprint-save]")?.addEventListener("click", () => {
    const good = $("#footprintGood").value.trim(),
      adjust = $("#footprintAdjust").value.trim();
    if (!good && !adjust) return showToast("先留下一點這週的想法");
    state.reflections[week] = {
      good,
      adjust,
      savedAt: new Date().toISOString(),
    };
    const snap = state.archivedWeeks.find((x) => Number(x.week) === week);
    if (snap) snap.reflection = state.reflections[week];
    saveState();
    renderFootprintCard(week);
    showToast("感想存好了");
  });
  $("[data-footprint-next]")?.addEventListener("click", () =>
    finalizeFootprintWeek(week),
  );
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
  if (
    state.footprintDeferred[week] ||
    isWeekArchived(week) ||
    !isWeekComplete(week)
  )
    return;
  setTimeout(
    () => {
      if (
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
function finalizeFootprintWeek(week) {
  if (isWeekArchived(week)) return;
  if (!isWeekComplete(week)) return showToast("這週還有事情沒完成");
  archiveWeek(week, "review");
  saveState();
  const next = week < 12 ? week + 1 : null,
    layer = $("#weekFootprintLayer");
  const finish = () => {
    footprintWeek = null;
    if (layer) {
      layer.classList.remove("closing");
      layer.hidden = true;
      layer.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("footprint-open");
    if (next && isWeekUnlocked(next)) {
      state.selectedWeek = next;
      state.selectedDate = defaultDateForWeek(next);
      treeIntro = true;
      showToast(`Week ${next} 已經可以開始安排`);
    } else showToast("這一輪收好了");
    renderAll();
  };
  if (motionOk() && layer) {
    layer.classList.add("closing");
    setTimeout(finish, 280);
  } else finish();
}
function openCompletionRecord(t) {
  if (!t) return;
  $("#completionRecordTitle").textContent = t.title;
  const rows = [];
  if (isRecurring(t))
    t.occurrences
      .filter((o) => o.done || o.note)
      .forEach((o) =>
        rows.push({
          date: o.doneDate || o.date,
          note: o.note || "",
          noteEnabled: o.noteEnabledAtCompletion,
        }),
      );
  else if (t.done || t.note)
    rows.push({
      date: t.doneDate,
      note: t.note || "",
      noteEnabled: t.noteEnabledAtCompletion,
    });
  $("#completionRecordBody").innerHTML = rows.length
    ? rows
        .map(
          (x, i) =>
            `<div class="completion-record-line"><strong>${x.date ? formatShortDate(x.date) : `完成 ${i + 1}`}</strong>${x.note ? `<p class="completion-record-note">${esc(x.note)}</p>` : ""}</div>`,
        )
        .join("")
    : `<div class="empty-note">還沒有完成紀錄</div>`;
  $("#completionRecordDialog").showModal();
}

function renderHistory() {
  renderHistoryTanks();
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
  const cards = [];
  state.archivedWeeks.forEach((w) =>
    cards.push({
      week: w.week,
      leaves: (w.completed || []).map((v, i) => ({
        key: v.key || `h${w.week}-${i}`,
        title: v.title,
        color: v.color || NEUTRAL_LEAF,
      })),
      total: currentTotalUnits(w.week),
    }),
  );
  if (!isWeekArchived(CURRENT_WEEK)) cards.push(mk(CURRENT_WEEK));
  for (let w = CURRENT_WEEK + 1; w <= 12; w++) {
    if (isWeekArchived(w)) {
      if (!cards.some((c) => c.week === w)) {
        const a = state.archivedWeeks.find((x) => x.week === w);
        if (a)
          cards.push({
            week: w,
            leaves: (a.completed || []).map((v, i) => ({
              key: v.key || `h${w}-${i}`,
              title: v.title,
              color: v.color || NEUTRAL_LEAF,
            })),
            total: currentTotalUnits(w),
          });
      }
      continue;
    }
    const c = mk(w);
    if (
      c.leaves.length ||
      state.events.some(
        (e) =>
          e.type !== "complete" &&
          e.type !== "uncomplete" &&
          e.type !== "focus" &&
          (e.week === w || e.fromWeek === w || e.toWeek === w),
      )
    )
      cards.push(c);
  }
  cards.sort((a, b) => a.week - b.week);
  $("#historyGrid").innerHTML = cards
    .map((x, idx) => {
      const done = x.leaves.length;
      const tree = treeSvg(
        x.week,
        x.leaves,
        x.map ? { slotOf: (k) => x.map[k], hidden: flyingKeys } : {},
      );
      return `<button class="history-card soft-card" type="button" style="--i:${idx}" data-history-week="${x.week}"><div class="history-card-copy"><h3>Week ${x.week}</h3><div class="history-statline"><strong>${done}</strong><span>片葉子 · ${done}/${Math.max(x.total, done)}</span></div></div><div class="history-mini-tree">${tree}</div></button>`;
    })
    .join("");
  $$("[data-history-week]").forEach((b) =>
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
    if (cards.some((c) => Number(c.week) === Number(historySelected)))
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
  $$("#historyGrid .history-card").forEach((c) =>
    c.classList.toggle(
      "selected",
      Number(c.dataset.historyWeek) === historySelected,
    ),
  );
}
function closeHistory() {
  $("#historyDetail").hidden = true;
  historySelected = null;
  markHistorySelected();
}
function showHistoryWeek(week) {
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
  $("[data-close-history]")?.addEventListener("click", closeHistory);
  $("[data-save-reflection]")?.addEventListener("click", () => {
    if (reflectionSaved(state.reflections[week]))
      return showToast("這週的感想已經存好了");
    if (!weekMetaFor(week).autoArchived)
      return showToast("這週的感想請從本週足跡留下");
    const good = $("#reviewGood").value.trim(),
      adjust = $("#reviewAdjust").value.trim();
    if (!good && !adjust) return showToast("先留下一點這週的想法");
    state.reflections[week] = {
      good,
      adjust,
      savedAt: new Date().toISOString(),
    };
    const snap = state.archivedWeeks.find(
      (x) => Number(x.week) === Number(week),
    );
    if (snap) snap.reflection = state.reflections[week];
    saveState();
    showToast("感想存好了，之後只能查看");
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
    meta = weekMetaFor(week),
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
    return `<div class="history-line"><i class="leaf-dot" style="--c:${x.color || NEUTRAL_LEAF}"></i><span>${esc(x.title)}${head ? `<em class="line-head">　${esc(head)}</em>` : ""}</span>${subs.length ? `<div class="history-subs">${subs.join("")}</div>` : ""}</div>`;
  };
  const left = leftover.length
    ? `<div class="history-section"><p class="field-label">還留在這週的</p>${leftover.map((x) => `<div class="history-line"><i class="leaf-dot hollow"></i><span>${esc(x.title)}</span>${x.recurring ? `<small>還差 ${x.left} 次</small>` : ""}${archived ? "" : `<div class="reason-chips">${REASONS.map((rs) => `<button type="button" class="reason-chip ${x.reason === rs ? "on" : ""}" data-reason-task="${x.id}" data-reason="${rs}">${rs}</button>`).join("")}</div>`}</div>`).join("")}</div>`
    : "";
  let reviewBlock = "";
  if (saved) {
    reviewBlock = `<div class="history-section"><p class="field-label">感想</p><div class="history-readonly-review">${r.good ? `<p><small>這週做得不錯的地方</small><br>${esc(r.good)}</p>` : ""}${r.adjust ? `<p><small>下週想調整的地方</small><br>${esc(r.adjust)}</p>` : ""}</div></div>`;
  } else if (meta.autoArchived && state.preferences.weeklyReflection) {
    reviewBlock = `<div class="reflection-editor history-section"><p class="field-label">補上這週的感想</p><label class="review-label">這週做得不錯的地方<input id="reviewGood" type="text" maxlength="80" value="${esc(r.good)}" placeholder="留下一句就好"></label><label class="review-label">下週想調整的地方<input id="reviewAdjust" type="text" maxlength="80" value="${esc(r.adjust)}" placeholder="也可以只寫其中一格"></label><button class="primary-button" type="button" data-save-reflection="${week}">儲存</button><p class="week-state-note">儲存後不能再修改</p></div>`;
  }
  const encouragement = saved
    ? `<p>${encouragementMessage(week, count)}</p>`
    : "";
  return `<div class="history-detail-head"><span>Week ${week}${archived ? " · 已封存" : ""}</span><button class="text-button" type="button" data-close-history>收起</button></div><h3>這週留下來的進度</h3><div class="history-section"><p class="field-label">完成 ${count} 次</p>${daily ? `<p class="daily-line">${esc(daily)}</p>` : ""}${completed.length ? completed.map(line).join("") : `<div class="empty-note">這週還沒有完成紀錄</div>`}</div>${left}${replanned.length ? `<div class="history-section"><p class="field-label">移到其他週</p>${replanned.map((x) => `<div class="history-line history-change"><span>→</span><span>${esc(x)}</span></div>`).join("")}</div>` : ""}${deleted.length ? `<div class="history-section"><p class="field-label">刪除</p>${deleted.map((x) => `<div class="history-line history-delete"><span>×</span><span>${esc(x)}</span></div>`).join("")}</div>` : ""}${reviewBlock}${encouragement}`;
}
function renderSettings() {
  $$("[data-mode]").forEach((b) => {
    const selected = b.dataset.mode === state.mode;
    b.classList.toggle("active", selected);
    b.setAttribute("aria-pressed", String(selected));
  });
  $("#completionNoteToggle").checked = state.preferences.completionNote;
  $("#weeklyReflectionToggle").checked = state.preferences.weeklyReflection;
  $("#lineToggle").checked = state.preferences.lineEnabled;
  $("#lineTime").value = state.preferences.lineTime;
  $("#lineSettings").hidden = !state.preferences.lineEnabled;
  const daily = state.mode === "day";
  $("#lineSummary").textContent = daily
    ? `每天約 ${state.preferences.lineTime} 提醒`
    : `週一、週日約 ${state.preferences.lineTime}`;
  $("#lineCadenceNote").textContent = daily
    ? "每天送出本週清單，週日改送本週足跡；提醒約在設定時間後送出"
    : "週一送本週安排、週日送本週足跡；提醒約在設定時間後送出";
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
            `<div class="manage-row"><span class="color-dot" style="--c:${categoryById(r.categoryId)?.color || NEUTRAL_LEAF}"></span><div><strong>${esc(r.title)}</strong><small>${r.frequency === "daily" ? "每天" : `每週 ${r.timesPerWeek} 次`}</small></div><label class="mini-switch"><input type="checkbox" data-rule-active="${r.id}" ${r.active ? "checked" : ""}><i></i></label><button class="text-button" type="button" data-edit-rule="${r.id}">編輯</button></div>`,
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
  el.innerHTML = state.categories
    .map(
      (c) =>
        `<div class="category-color-block"><div class="category-color-head"><div class="category-color-actions"><span class="color-dot" style="--c:${c.color}"></span><strong>${esc(c.name)}</strong></div><button class="text-button" data-edit-category="${c.id}" type="button">改名稱</button></div><div class="inline-palette">${PALETTE.map((color) => `<button type="button" class="palette-dot ${color === c.color ? "on" : ""}" style="--c:${color}" data-category-color="${c.id}" data-color="${color}" aria-label="選擇顏色"></button>`).join("")}</div></div>`,
    )
    .join("");
  $$("[data-edit-category]").forEach((b) =>
    b.addEventListener("click", () =>
      openCategoryDialog(b.dataset.editCategory),
    ),
  );
  $$("[data-category-color]").forEach((b) =>
    b.addEventListener("click", () => {
      const c = state.categories.find((x) => x.id === b.dataset.categoryColor);
      c.color = b.dataset.color;
      renderAll();
      showToast(`${c.name} 的顏色換好了`);
    }),
  );
}

function openEditTask(t) {
  if (!t || !guardWeekEditable(t.week)) return;
  editingTaskId = t.id;
  editingTaskOccurrenceId = actionOccurrenceId;
  $("#editTaskTitle").value = t.title;
  $("#editTaskGoal").innerHTML =
    `<option value="">不連結方向</option>` +
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
    `<option value="">不連結方向</option>` +
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
  $("#categoryPalette").innerHTML = PALETTE.map(
    (c) =>
      `<button type="button" class="palette-dot ${c === categoryPickColor ? "on" : ""}" style="--c:${c}" data-color="${c}" aria-label="選擇顏色"></button>`,
  ).join("");
  $$("#categoryPalette [data-color]").forEach((b) =>
    b.addEventListener("click", () => {
      categoryPickColor = b.dataset.color;
      renderCategoryPalette();
    }),
  );
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
    showToast("方向存好了");
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
    showToast("方向刪除了，葉子都還在");
  });
  $("#replayTutorialBtn").addEventListener("click", openTutorial);

  $("#toggleTaskDoneBtn").addEventListener("click", () => {
    const t = state.tasks.find((x) => x.id === actionTaskId);
    $("#taskActionDialog").close();
    if (t) toggleTaskCompletion(t, [...actionOccIds], null);
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
  $$("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      state.mode = b.dataset.mode;
      renderAll();
    }),
  );

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
  });
  $("#quickFrequency").addEventListener("change", () => {
    $("#quickTimesWrap").hidden = $("#quickFrequency").value !== "weekly";
  });
  $("#quickAddForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("#quickTitle").value.trim();
    if (!title) return showToast("先寫下一件想做的事");
    const targetWeek = state.selectedWeek;
    if (!isWeekUnlocked(targetWeek)) return showToast("這一週還沒解鎖");
    if (!guardWeekEditable(targetWeek)) return;
    if (!dupAllowed && dupExists(title)) {
      $("#dupTitle").textContent = title;
      $("#dupDialog").showModal();
      return;
    }
    const categoryId = $("#quickCategory").value,
      goal = $("#quickGoal").value,
      scheduledDate = state.mode === "day" ? state.selectedDate : "",
      isRepeat = $("#quickRepeat").checked;
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
    $("#moreToggle").textContent = "＋ 更多設定";
    renderAll();
    showToast(
      isRepeat
        ? "已加入本週習慣"
        : state.mode === "day"
          ? `已安排到 ${formatShortDate(scheduledDate)}`
          : "已經放進這週了",
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
    showToast("已更新");
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
    showToast(`移到 Week ${to} 了`);
  });

  $("#skipNoteBtn").addEventListener("click", () => {
    const t = state.tasks.find((x) => x.id === pendingNoteTaskId);
    const week = t?.week;
    pendingNoteTaskId = null;
    pendingNoteOccId = "";
    pendingNoteOccIds = [];
    showToast("這片葉子已經留下來了");
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
    showToast("完成紀錄存好了");
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
  $("#lineTime").addEventListener("change", (e) => {
    state.preferences.lineTime = e.target.value;
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
    showToast("重複習慣已更新");
  });
  $("#addCategoryBtn").addEventListener("click", () => openCategoryDialog());
  $("#categoryForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#categoryNameInput").value.trim();
    if (!name) return showToast("先寫分類名稱");
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
      showToast("已刪除，原因留在 History 裡");
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

const TUT_STEPS = 7;
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
      "先選幾個方向",
      "寫下 1 到 3 個想前進的方向，之後隨時能改，已長出的葉子不會消失。",
      `<div class="tut-dirs">${tutDraft.map((d, i) => `<div class="tut-dir" style="--c:${d.color}"><i class="color-dot"></i><div><input data-tut-name="${i}" value="${esc(d.name)}" placeholder="方向名稱" maxlength="12"><input data-tut-outcome="${i}" value="${esc(d.outcome)}" placeholder="做到什麼算完成" maxlength="40"></div></div>`).join("")}</div>${tutDraft.length < 3 ? `<button class="text-button" type="button" id="tutAddDir">＋ 再加一個方向</button>` : ""}`,
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
  } else if (tutStep === 3) {
    if (!tutTasks.length)
      tutTasks.push({ id: Date.now(), title: "整理 HTML 筆記", done: false });
    const stepPct = Math.max(8, Math.min(100, Math.round(100 / dir.target))),
      n = tutDoneCount();
    body.innerHTML = pane(
      "",
      "完成一件，長一片葉子",
      "點事情左邊的圈圈，看水缸長高。這只是練習，不會留下正式紀錄。",
      `<div class="tut-demo"><div class="tank demo" style="--c:${dir.color}"><div class="tank-fill" id="tutDemoFill" style="width:${Math.min(100, n * stepPct)}%"></div><span class="tank-name">${esc(dir.name)}</span><span class="tank-count" id="tutDemoCount">${n} / ${dir.target}</span></div><div class="tut-sandbox" id="tutList">${tutTasks.map((t) => tutRow(t, dir.color)).join("")}</div></div><p class="tut-note" id="tutDemoMsg">${n ? "再點一件試試看" : "做完一件事，水缸就會長高"}</p>`,
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
  } else if (tutStep === 4) {
    body.innerHTML = pane(
      tutTree(3, Math.max(tutDoneCount(), 3), "small"),
      "每週留一句感想",
      "樹上的葉子，就是你完成的每一件事。週末到「本週足跡」寫一兩句就夠了。",
      `<div class="tut-reflect"><label>這週做得不錯的地方<input id="tutGood" maxlength="80" placeholder="留一句就好"></label><label>下週想調整的地方<input id="tutAdjust" maxlength="80" placeholder="也可以只寫其中一格"></label><button class="primary-button" type="button" id="tutSaveRef">儲存感想</button></div><p class="tut-note" id="tutRefMsg">儲存後就不能再改，所以簡單一句就好</p>`,
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
  } else if (tutStep === 5) {
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
  } else if (tutStep === 6) {
    body.innerHTML = pane(
      `<div class="tut-done" aria-hidden="true">✓</div>`,
      "準備好了",
      "你已經練習過：設定方向、加入事情、完成、寫感想、修改。想再看一次，到「設定」按「重看教學」。",
    );
  }
  // 樹上的葉子照順序一片一片長出來，而不是同時蹦出。
  const leafPace = { 0: [0.95, 0.32], 4: [0.7, 0.12] }[tutStep];
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
function showToast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.classList.remove("show"), 1800);
}
function openYearReview() {
  const currentExtra = isWeekArchived(CURRENT_WEEK)
    ? 0
    : currentLeafRecords(CURRENT_WEEK).length;
  const completed =
    state.archivedWeeks.reduce((n, w) => n + w.completed.length, 0) +
    currentExtra;
  const replans = state.events.filter((e) => e.type === "replan").length;
  $("#yearReviewText").textContent = "這裡統計目前這一輪的完成與移週紀錄。";
  $("#yearStats").innerHTML =
    `<div><strong>${completed}</strong><span>片葉子</span></div><div><strong>${CURRENT_WEEK}</strong><span>週走過</span></div><div><strong>${replans}</strong><span>次移到其他週</span></div>`;
  $("#yearReviewDialog").showModal();
}

bindStaticEvents();
refreshClock();
renderAll();
restartEnter($(".page.active"));
TPConnection.start({
  get: () => state,
  toast: showToast,
  replace(next) {
    state = next;
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
if (TPConnection.demo && !state.onboarded) setTimeout(openTutorial, 500);
