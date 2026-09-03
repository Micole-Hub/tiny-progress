const API_BASE_URL = "https://no-effort-time-bureau.onrender.com";
const WORKLOAD_RECOMMENDED = 5;
const DIFFICULTIES = ["簡單", "適中", "困難"];

const state = {
  context: null,
  items: [],
  weeks: [],
  cycles: [],
  categories: [],
  history: null,
  historyFocusTaskId: null,
  showAllOverdue: false,
  showAllRescheduled: false,
  showInactiveCategories: false,
  currentPage: "home",
  activeTaskForSheet: null,
  tourIndex: 0,
  retrospectives: [],
  historyOpenCycles: new Set(),
  historySelectedWeeks: {},
};


const RESCHEDULE_REASONS = [
  "低估工作量",
  "任務太大",
  "技術卡住",
  "優先順序改變",
  "個人狀態",
  "原計畫需要調整",
  "其他",
];

const DELETE_REASONS = [
  "任務已不需要",
  "任務內容重複",
  "當初規劃錯誤",
  "已整合到其他任務",
  "優先順序改變",
  "其他",
];

const POSTPONE_REASONS = [
  "個人狀況",
  "臨時重大事項",
  "原排程估算錯誤",
  "外部因素導致無法進行",
  "計畫需要重新調整",
  "其他",
];

const els = {};

function cacheElements() {
  [
    "homePage", "historyPage", "settingsPage", "heroTitle", "cycleThemeText", "editCycleThemeBtn",
    "cycleWeekBadge", "weekStatusBadge", "weekRangeWrap", "weekStartText", "weekEndText", "activeWeekPanel",
    "weekThemeText", "weekGoalText", "workloadCount", "workloadFill", "starProgress",
    "postponeWeekBtn", "nextWeekPlanBtn", "weekSetupPanel", "weekSetupForm", "weekSetupTheme", "weekSetupGoal",
    "restPanel", "restMessage", "changeCycleStartBtn", "cycleCompletePanel", "cycleCompleteTitle", "openReviewBtn",
    "workArea", "currentTaskList", "currentTaskCount", "overdueCount", "overdueList", "showAllOverdueBtn",
    "rescheduledList", "showAllRescheduledBtn", "addTaskForm", "toggleAddTaskBtn", "taskInput", "taskCategory",
    "taskSubCategory", "taskDifficulty", "cyclePathCard", "cyclePath", "cyclePathCaption",
    "weeklyReviewPanel", "weeklyReviewSpark", "weeklyReviewStatus", "weeklyReviewBtn",
    "historyList", "refreshHistoryBtn", "categorySettingsList", "addCategoryBtn", "toggleInactiveBtn",
    "replayTourBtn", "loadingToast", "bottomSheet", "sheetTitle", "sheetActions", "closeSheetBtn",
    "cycleCelebration", "celebrationTitle", "skipCelebrationBtn", "tourPopover", "tourStepLabel",
    "tourTitle", "tourText", "tourSkipBtn", "tourNextBtn", "editWeekPlanBtn"
  ].forEach((id) => { els[id] = document.getElementById(id); });
  els.modalRoot = document.getElementById("tp-modal-root");
  els.taskMenuRoot = document.getElementById("taskMenuRoot");
  els.navButtons = [...document.querySelectorAll(".v2-nav-btn")];
  els.pages = [...document.querySelectorAll("[data-page-panel]")];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function mobiusMarkup(className = "mobius-mark") {
  return `<svg class="${className}" viewBox="0 0 36 24" aria-hidden="true" focusable="false">
    <path d="M18,12 C18,8.134 14.418,5 10,5 C5.582,5 2,8.134 2,12 C2,15.866 5.582,19 10,19 C14.418,19 18,15.866 18,12 C18,8.134 21.582,5 26,5 C30.418,5 34,8.134 34,12 C34,15.866 30.418,19 26,19 C21.582,19 18,15.866 18,12 Z"></path>
    <path class="mobius-cross" d="M13 9C16 12 20 12 23 9"></path>
  </svg>`;
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function formatDate(value) {
  if (!value) return "—";
  return String(value).slice(0, 10).replaceAll("-", "/");
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function todayYmd() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysYmd(value, days) {
  const raw = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const date = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + Number(days || 0));
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isMobile() {
  return window.matchMedia("(max-width: 680px)").matches;
}

function showLoading(text = "處理中…") {
  els.loadingToast.textContent = text;
  els.loadingToast.classList.add("is-show");
  document.body.classList.add("is-busy");
}

function hideLoading() {
  els.loadingToast.classList.remove("is-show");
  document.body.classList.remove("is-busy");
}

async function api(path, options = {}) {
  const config = {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  };
  if (options.body !== undefined) config.body = JSON.stringify(options.body);

  const response = await fetch(`${API_BASE_URL}${path}`, config);
  let data = null;
  try { data = await response.json(); }
  catch { data = null; }
  if (!response.ok) {
    throw new Error((data && (data.error || data.message)) || `API ${response.status}`);
  }
  return data;
}

async function loadCore({ quiet = false } = {}) {
  if (!quiet) showLoading("同步 Tiny Progress…");
  try {
    const [context, items, weeks, cycles, categories] = await Promise.all([
      api("/week-context"),
      api("/items"),
      api("/weeks"),
      api("/cycles"),
      api("/categories"),
    ]);
    state.context = context;
    state.items = items;
    state.weeks = weeks;
    state.cycles = cycles;
    state.categories = categories;

    if (context?.currentWeek?.cycleNumber >= 2) {
      try {
        state.retrospectives = await api("/retrospectives");
      } catch (error) {
        console.warn("Weekly Review 暫時讀取失敗：", error);
        state.retrospectives = [];
      }
    } else {
      state.retrospectives = [];
    }

    renderAll();
    maybeShowCycleCelebration();
  } catch (error) {
    console.error(error);
    showAlert("讀取資料失敗", error.message, "");
  } finally {
    hideLoading();
  }
}

function getActiveCategories() {
  return state.categories.filter((c) => c.type === "category" && c.active === true);
}

function getSubcategories(categoryId, includeInactive = false) {
  return state.categories.filter((c) =>
    c.type === "subcategory" && c.parentId === categoryId && (includeInactive || c.active === true)
  );
}

function currentWeek() {
  return state.context?.currentWeek || null;
}

function currentCycle() {
  const week = currentWeek();
  if (!week) return state.context?.nextCycle || null;
  return state.cycles.find((cycle) => Number(cycle.cycleNumber) === Number(week.cycleNumber)) || null;
}

function compareWeekIdentity(aCycle, aWeek, bCycle, bWeek) {
  return (Number(aCycle) - Number(bCycle)) || (Number(aWeek) - Number(bWeek));
}

function isFutureScheduled(item) {
  const week = currentWeek();
  if (!week || item.status !== "active") return false;
  return compareWeekIdentity(
    item.scheduledCycleNumber || item.cycleNumber,
    item.scheduledWeekNumber || item.weekNumber,
    week.cycleNumber,
    week.weekNumber
  ) > 0;
}

function getSubmittedReview(cycleNumber, weekNumber) {
  return (state.retrospectives || []).find((retro) =>
    Number(retro.cycleNumber) === Number(cycleNumber) &&
    Number(retro.weekNumber) === Number(weekNumber) &&
    !!retro.submittedAt
  ) || null;
}

function isSameWeek(item, week) {
  if (!week) return false;
  return Number(item.scheduledCycleNumber) === Number(week.cycleNumber) &&
    Number(item.scheduledWeekNumber) === Number(week.weekNumber);
}

function isRescheduled(item) {
  return Number(item.originalCycleNumber) !== Number(item.scheduledCycleNumber) ||
    Number(item.originalWeekNumber) !== Number(item.scheduledWeekNumber);
}

function activeWorkloadItems() {
  return state.items.filter((item) =>
    item.type === "task" && ["active", "overdue"].includes(item.status)
  );
}

function renderAll() {
  renderHome();
  renderCategorySelects();
  renderSettings();
  if (state.currentPage === "history" && state.history) renderHistory();
}

function renderHome() {
  const context = state.context || {};
  const week = context.currentWeek;
  const cycle = currentCycle();

  els.activeWeekPanel.hidden = !week;
  els.workArea.hidden = !week;
  els.weekSetupPanel.hidden = true;
  els.restPanel.hidden = true;
  els.cycleCompletePanel.hidden = true;
  els.cyclePathCard.hidden = true;
  els.weeklyReviewPanel.hidden = true;
  els.editCycleThemeBtn.hidden = !week;

  if (week) {
    els.heroTitle.textContent = "Tiny Progress";
    els.cycleThemeText.textContent = cycle?.theme || "尚未設定";
    els.editCycleThemeBtn.textContent = cycle?.theme ? "編輯" : "設定";
    els.cycleWeekBadge.textContent = `Cycle ${week.cycleNumber}`;
    els.weekStatusBadge.textContent = `Week ${week.weekNumber}`;
    els.weekStartText.textContent = formatDate(week.weekStart);
    els.weekEndText.textContent = formatDate(week.weekEnd);
    els.weekRangeWrap.hidden = false;

    els.weekThemeText.textContent = week.title || "尚未設定";
    els.weekGoalText.textContent = week.achievement || "尚未設定";
    els.postponeWeekBtn.disabled = week.postponed === true;
    els.postponeWeekBtn.textContent = week.postponed ? `本週已順延 ${week.postponeDays || 7} 天` : "本週需要順延";
    const canOpenPlanner = context.canPlanNextWeek || context.canPlanNextCycle;
    els.nextWeekPlanBtn.hidden = !canOpenPlanner;
    els.nextWeekPlanBtn.textContent = context.canPlanNextCycle ? "下一輪安排" : "下週安排";

    const needsSetup = !String(week.title || "").trim() || !String(week.achievement || "").trim();
    els.weekSetupPanel.hidden = !needsSetup;
    els.workArea.hidden = needsSetup;
    els.activeWeekPanel.hidden = needsSetup;
    if (needsSetup) {
      els.weekSetupTheme.value = week.title || "";
      els.weekSetupGoal.value = week.achievement || "";
    }

    renderWorkload();
    renderCurrentTasks();
    renderOverdue();
    renderRescheduled();
    renderCyclePath();
    renderWeeklyReview();
    return;
  }

  els.weekRangeWrap.hidden = true;
  els.cycleThemeText.textContent = context.nextCycle?.theme || "";
  els.cycleWeekBadge.textContent = context.restPeriod && context.nextCycle ? `Cycle ${context.nextCycle.cycleNumber}` : "Cycle";
  els.weekStatusBadge.textContent = context.restPeriod ? "休息" : "12 Weeks";

  const completedCycleKey = context.completedCycleNumber
    ? `tp-star-cycle-archived-${context.completedCycleNumber}`
    : "";
  const completionArchived = completedCycleKey ? localStorage.getItem(completedCycleKey) === "1" : false;

  if (context.cycleComplete && context.completedCycleNumber && !completionArchived) {
    els.cycleCompletePanel.hidden = false;
    els.cycleCompleteTitle.textContent = `Cycle ${context.completedCycleNumber}`;
    return;
  }

  if (context.restPeriod && context.nextCycle) {
    els.restPanel.hidden = false;
    els.restMessage.textContent = `下一個 Cycle 會在 ${formatDate(context.nextCycle.startDate)} 開始。`;
    return;
  }
}

function weeklyProgressStats() {
  const week = currentWeek();
  if (!week) return { done: 0, total: 0, percent: 0 };
  const tasks = state.items.filter((item) =>
    item.type === "task" &&
    isSameWeek(item, week) &&
    !["cancelled", "replanned"].includes(item.status)
  );
  const done = tasks.filter((item) => item.status === "completed").length;
  const total = tasks.length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

function renderWorkload() {
  const progress = weeklyProgressStats();
  els.workloadCount.textContent = `${progress.done} / ${progress.total}`;
  els.workloadFill.hidden = false;
  els.workloadFill.style.width = `${progress.percent}%`;
  els.starProgress.setAttribute("aria-valuemin", "0");
  els.starProgress.setAttribute("aria-valuemax", String(progress.total));
  els.starProgress.setAttribute("aria-valuenow", String(progress.done));
  els.starProgress.setAttribute("aria-label", `本週進度 ${progress.done} / ${progress.total}`);
}

function renderCurrentTasks() {
  const week = currentWeek();
  if (!week) return;
  const items = state.items
    .filter((item) => item.type === "task" && isSameWeek(item, week) && !["cancelled", "replanned"].includes(item.status))
    .sort((a, b) => Number(a.status === "completed") - Number(b.status === "completed") || String(a.createdAt).localeCompare(String(b.createdAt)));

  els.currentTaskCount.textContent = `${items.length} 件`;
  els.currentTaskList.innerHTML = items.length
    ? items.map((item) => `<li>${renderTaskCard(item, { list: "current" })}</li>`).join("")
    : `<li class="v2-empty">這週還是空白的。想放一件事情進來時，按「加入」就好。</li>`;
  bindTaskCardEvents(els.currentTaskList);
}

function renderOverdue() {
  const all = state.items
    .filter((item) => item.type === "task" && item.status === "overdue")
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  els.overdueCount.textContent = String(all.length);
  const visible = state.showAllOverdue ? all : all.slice(0, 3);
  els.overdueList.innerHTML = visible.length
    ? visible.map((item) => renderTaskCard(item, { compact: true, list: "overdue" })).join("")
    : "";
  els.showAllOverdueBtn.hidden = all.length <= 3;
  els.showAllOverdueBtn.textContent = state.showAllOverdue ? "收合" : `查看全部 ${all.length} 件`;
  bindTaskCardEvents(els.overdueList);
}

function renderRescheduled() {
  const all = state.items
    .filter((item) => item.type === "task" && isFutureScheduled(item))
    .sort((a, b) =>
      compareWeekIdentity(a.scheduledCycleNumber, a.scheduledWeekNumber, b.scheduledCycleNumber, b.scheduledWeekNumber) ||
      String(a.createdAt).localeCompare(String(b.createdAt))
    );

  const visible = state.showAllRescheduled ? all : all.slice(0, 3);
  els.rescheduledList.innerHTML = visible.length
    ? visible.map((item) => renderTaskCard(item, { compact: true, list: "future" })).join("")
    : "";
  els.showAllRescheduledBtn.hidden = all.length <= 3;
  els.showAllRescheduledBtn.textContent = state.showAllRescheduled ? "收合" : `查看全部 ${all.length} 件`;
  bindTaskCardEvents(els.rescheduledList);
}

const TAG_COLOR_PALETTE = [
  { bg: "#E6F0E4", text: "#56705A", border: "#BDD5BC" },
  { bg: "#F6E5E7", text: "#805D67", border: "#E5BEC6" },
  { bg: "#E5EEF7", text: "#526B84", border: "#BDD1E5" },
  { bg: "#F7E9D8", text: "#806349", border: "#E7C9A8" },
  { bg: "#EEE6F5", text: "#6C5B7C", border: "#D5C3E5" },
  { bg: "#E1F0EF", text: "#4F7272", border: "#B9D9D6" },
  { bg: "#F4EBCF", text: "#7A693D", border: "#E2D095" },
  { bg: "#E8EEE0", text: "#607052", border: "#C7D4B9" },
  { bg: "#F5E4DD", text: "#7D5F54", border: "#E4C0B2" },
  { bg: "#E6EAF5", text: "#5B647D", border: "#C7CFE5" },
  { bg: "#E5F0E8", text: "#58705F", border: "#C0D9C6" },
  { bg: "#F2E4EF", text: "#755E72", border: "#DFC0D7" },
];

function stableTagIndex(value, salt = "") {
  const text = `${salt}|${String(value || "未分類")}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % TAG_COLOR_PALETTE.length;
}

function getTagColors(value, type = "category", parentValue = "") {
  let index = stableTagIndex(value, type);
  if (type === "subcategory") {
    const parentIndex = stableTagIndex(parentValue || "parent", "category");
    if (index === parentIndex) index = (index + 1) % TAG_COLOR_PALETTE.length;
  }
  return TAG_COLOR_PALETTE[index];
}

function tagStyle(value, type = "category", parentValue = "") {
  const c = getTagColors(value, type, parentValue);
  return `--tag-bg:${c.bg};--tag-text:${c.text};--tag-border:${c.border};`;
}

function renderTaskCard(item, options = {}) {
  const compact = options.compact === true;
  const classes = ["v2-task-card"];
  if (item.status === "completed") classes.push("is-done");
  if (item.status === "overdue") classes.push("is-overdue");
  if (isRescheduled(item) && item.status !== "completed") classes.push("is-rescheduled");

  let route = "";
  let statusLine = "";

  if (options.list === "overdue") {
    route = `原本安排：Week ${item.originalWeekNumber}`;
    statusLine = "未完待續";
  } else if (options.list === "future") {
    const targetWeek = state.weeks.find((week) =>
      Number(week.cycleNumber) === Number(item.scheduledCycleNumber) &&
      Number(week.weekNumber) === Number(item.scheduledWeekNumber)
    );
    route = targetWeek
      ? `Week ${item.scheduledWeekNumber} · ${formatDate(targetWeek.weekStart)} ～ ${formatDate(targetWeek.weekEnd)}`
      : `Week ${item.scheduledWeekNumber}`;
  }

  const meta = compact ? "" : `
    <div class="v2-task-meta">
      <span class="chip chip-category" style="${tagStyle(item.categoryId || item.category || "未分類", "category")}">${escapeHtml(item.category || "未分類")}</span>
      ${item.subCategory && item.subCategory !== "未分類" ? `<span class="chip chip-subcategory" style="${tagStyle(item.subCategoryId || item.subCategory, "subcategory", item.categoryId || item.category)}">${escapeHtml(item.subCategory)}</span>` : ""}
      <span class="chip chip-difficulty">${escapeHtml(item.difficulty)}</span>
    </div>`;

  const completionControl = item.status === "completed"
    ? `<button class="v2-complete-check is-complete" type="button" disabled aria-label="已完成：${escapeHtml(item.title)}"><span aria-hidden="true">✓</span></button>`
    : `<button class="v2-complete-check" type="button" data-complete-id="${escapeHtml(item.id)}" aria-label="完成：${escapeHtml(item.title)}"><span aria-hidden="true"></span></button>`;

  return `
    <article class="${classes.join(" ")}" data-task-id="${escapeHtml(item.id)}">
      ${completionControl}
      <div class="v2-task-main">
        <p class="v2-task-title">${escapeHtml(item.title)}</p>
        ${route ? `<p class="v2-task-route">${escapeHtml(route)}</p>` : ""}
        ${statusLine ? `<p class="v2-task-status-line continue">${escapeHtml(statusLine)}</p>` : ""}
        ${meta}
      </div>
      <button class="v2-more-btn" type="button" data-more-id="${escapeHtml(item.id)}" aria-label="更多">⋯</button>
    </article>`;
}

function bindTaskCardEvents(root) {
  if (!root) return;
  root.querySelectorAll("[data-complete-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = state.items.find((x) => x.id === button.dataset.completeId);
      if (item) await confirmComplete(item);
    });
  });
  root.querySelectorAll("[data-more-id]").forEach((button) => {
    button.addEventListener("click", (event) => openTaskActions(button.dataset.moreId, event.currentTarget));
  });
}

function renderCategorySelects() {
  const active = getActiveCategories();
  if (!active.length) {
    els.taskCategory.innerHTML = `<option value="">請先到 Settings 加入分類</option>`;
    els.taskSubCategory.hidden = true;
    return;
  }
  const previous = els.taskCategory.value;
  els.taskCategory.innerHTML = active.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("");
  if (active.some((c) => c.id === previous)) els.taskCategory.value = previous;
  updateSubcategorySelect(els.taskSubCategory, els.taskCategory.value);
}

function updateSubcategorySelect(select, categoryId, selectedId = "") {
  const subs = getSubcategories(categoryId);
  if (!subs.length) {
    select.innerHTML = "";
    select.hidden = true;
    select.disabled = true;
    return;
  }
  select.hidden = false;
  select.disabled = false;
  select.innerHTML = subs.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("");
  if (selectedId && subs.some((s) => s.id === selectedId)) select.value = selectedId;
}

function getTaskPayloadFromForm() {
  return {
    type: "task",
    title: els.taskInput.value.trim(),
    categoryId: els.taskCategory.value,
    subCategoryId: els.taskSubCategory.hidden ? "" : els.taskSubCategory.value,
    difficulty: els.taskDifficulty.value,
  };
}

async function addTask(event) {
  event.preventDefault();
  const payload = getTaskPayloadFromForm();
  if (!payload.title) return;
  if (!payload.categoryId) return showAlert("還缺一個分類", "先到 Settings 加入至少一個分類。", "");

  const category = state.categories.find((c) => c.id === payload.categoryId);
  const subCategory = state.categories.find((c) => c.id === payload.subCategoryId);
  const workload = activeWorkloadItems().length;
  const detailBits = [
    category?.name || "未分類",
    subCategory?.name || "",
    payload.difficulty,
  ].filter(Boolean);
  const workloadLine = workload >= WORKLOAD_RECOMMENDED
    ? `\n\n目前還有 ${workload} 件事情在進行中。`
    : "";

  const ok = await showConfirm({
    icon: "",
    title: "要加入這件事嗎？",
    text: `「${payload.title}」\n\n${detailBits.join(" · ")}${workloadLine}`,
    confirmText: "加入",
    cancelText: "取消",
  });
  if (!ok) return;

  showLoading("加入中…");
  try {
    await api("/items", { method: "POST", body: payload });
    els.taskInput.value = "";
    els.taskDifficulty.value = "適中";
    els.addTaskForm.hidden = true;
    els.toggleAddTaskBtn.textContent = "＋ 加入";
    els.toggleAddTaskBtn.classList.add("just-added");
    setTimeout(() => els.toggleAddTaskBtn.classList.remove("just-added"), 800);
    await loadCore({ quiet: true });
  } catch (error) {
    showAlert("加入失敗", error.message, "");
  } finally { hideLoading(); }
}

async function confirmComplete(item) {
  const ok = await showConfirm({
    icon: "✓",
    title: "要完成這件事嗎？",
    text: `「${item.title}」\n\n完成後會更新本週進度；如果是不小心按到，之後仍可更正。`,
    confirmText: "完成",
    cancelText: "取消",
  });
  if (!ok) return;

  showLoading("更新進度中…");
  try {
    await api(`/items/${encodeURIComponent(item.id)}/complete`, { method: "POST", body: {} });
    await loadCore({ quiet: true });
  } catch (error) {
    showAlert("完成失敗", error.message, "");
  } finally { hideLoading(); }
}

function isUnstartedCycleTask(item) {
  const cycleNumber = Number(item?.scheduledCycleNumber || item?.cycleNumber || 0);
  const cycle = state.cycles.find((row) => Number(row.cycleNumber) === cycleNumber);
  const startDate = String(cycle?.startDate || "").slice(0, 10);
  return !!(startDate && startDate > todayYmd());
}

function getTaskActions(item) {
  if (item.status === "completed") {
    return [
      { key: "correct", label: "↩ 誤操作更正" },
      { key: "history", label: "查看紀錄" },
    ];
  }
  if (["cancelled", "replanned"].includes(item.status)) {
    return [{ key: "history", label: "查看紀錄" }];
  }
  return [
    { key: "edit", label: "編輯" },
    { key: "reschedule", label: "調整時間" },
    { key: "replan", label: "重新整理" },
    { key: "history", label: "查看紀錄" },
    { key: "delete", label: "刪除", danger: true },
  ];
}

function openTaskActions(itemId, anchor) {
  const item = state.items.find((x) => x.id === itemId);
  if (!item) return;
  const actions = getTaskActions(item);
  if (isMobile()) {
    state.activeTaskForSheet = item;
    els.sheetTitle.textContent = item.title;
    els.sheetActions.innerHTML = actions.map((a) =>
      `<button class="v2-sheet-action ${a.danger ? "danger" : ""}" type="button" data-sheet-action="${a.key}">${a.label}</button>`
    ).join("");
    els.sheetActions.querySelectorAll("[data-sheet-action]").forEach((button) => {
      button.addEventListener("click", () => {
        closeBottomSheet();
        handleTaskAction(item, button.dataset.sheetAction);
      });
    });
    els.bottomSheet.classList.add("is-open");
    els.bottomSheet.setAttribute("aria-hidden", "false");
    return;
  }

  closeTaskMenu();
  const rect = anchor.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "v2-task-menu";
  menu.style.left = `${Math.min(window.innerWidth - 210, Math.max(12, rect.right - 190))}px`;
  menu.style.top = `${rect.bottom + 6}px`;
  menu.innerHTML = actions.map((a) =>
    `<button class="${a.danger ? "danger" : ""}" type="button" data-menu-action="${a.key}">${a.label}</button>`
  ).join("");
  els.taskMenuRoot.appendChild(menu);
  menu.querySelectorAll("[data-menu-action]").forEach((button) => {
    button.addEventListener("click", () => {
      closeTaskMenu();
      handleTaskAction(item, button.dataset.menuAction);
    });
  });
}

function closeTaskMenu() { els.taskMenuRoot.innerHTML = ""; }
function closeBottomSheet() {
  els.bottomSheet.classList.remove("is-open");
  els.bottomSheet.setAttribute("aria-hidden", "true");
  state.activeTaskForSheet = null;
}

async function handleTaskAction(item, action) {
  if (action === "edit") return openEditTask(item);
  if (action === "reschedule") return openDirectReschedule(item);
  if (action === "replan") return openReplanTask(item);
  if (action === "history") return goToTaskHistory(item.id);
  if (action === "delete") return openDeleteTask(item);
  if (action === "correct") return correctCompletion(item);
}

function categoryOptionsHtml(selectedId = "") {
  return getActiveCategories().map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === selectedId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("");
}

function subcategoryOptionsHtml(categoryId, selectedId = "") {
  return getSubcategories(categoryId).map((s) => `<option value="${escapeHtml(s.id)}" ${s.id === selectedId ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("");
}

function difficultyOptionsHtml(selected = "適中") {
  return DIFFICULTIES.map((d) => `<option value="${d}" ${d === selected ? "selected" : ""}>${d}</option>`).join("");
}

function openEditTask(item) {
  openFormModal({
    icon: "✏️", title: "編輯任務", confirmText: "儲存",
    body: `
      <label class="v2-form-field">任務名稱<input id="editTitle" value="${escapeHtml(item.title)}" maxlength="120" /></label>
      <div class="v2-modal-grid">
        <label class="v2-form-field">分類<select id="editCategory">${categoryOptionsHtml(item.categoryId)}</select></label>
        <label class="v2-form-field" id="editSubWrap">子分類<select id="editSubCategory"></select></label>
      </div>
      <label class="v2-form-field">難度<select id="editDifficulty">${difficultyOptionsHtml(item.difficulty)}</select></label>`,
    onReady: () => {
      const cat = document.getElementById("editCategory");
      const sub = document.getElementById("editSubCategory");
      const wrap = document.getElementById("editSubWrap");
      const refresh = (selected = "") => {
        const subs = getSubcategories(cat.value);
        wrap.hidden = !subs.length;
        sub.innerHTML = subcategoryOptionsHtml(cat.value, selected);
      };
      refresh(item.subCategoryId);
      cat.addEventListener("change", () => refresh(""));
    },
    onConfirm: async () => {
      const title = document.getElementById("editTitle").value.trim();
      if (!title) throw new Error("任務名稱不可空白");
      const cat = document.getElementById("editCategory");
      const subWrap = document.getElementById("editSubWrap");
      await api(`/items/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: {
          title,
          categoryId: cat.value,
          subCategoryId: subWrap.hidden ? "" : document.getElementById("editSubCategory").value,
          difficulty: document.getElementById("editDifficulty").value,
        },
      });
      await loadCore({ quiet: true });
    },
  });
}

function openDirectReschedule(item) {
  const current = currentWeek();
  const availableWeeks = state.weeks.filter((week) =>
    current &&
    compareWeekIdentity(week.cycleNumber, week.weekNumber, current.cycleNumber, current.weekNumber) > 0
  );
  if (!availableWeeks.length) return showAlert("還沒有之後的 Week", "如果要放到下一個 Cycle，先建立下一個 Cycle。", "");

  const weekOptions = availableWeeks.map((week) =>
    `<option value="${week.cycleNumber}|${week.weekNumber}">Cycle ${week.cycleNumber} · Week ${week.weekNumber}（${formatDate(week.weekStart)}～${formatDate(week.weekEnd)}）</option>`
  ).join("");

  openFormModal({
    icon: "",
    title: "調整時間",
    confirmText: "確定",
    cancelText: "取消",
    body: `
      <label class="v2-form-field">放到哪一週<select id="rescheduleTarget">${weekOptions}</select></label>
      <label class="v2-form-field">原因<select id="rescheduleReason">${RESCHEDULE_REASONS.map((r) => `<option>${r}</option>`).join("")}</select></label>
      <label class="v2-form-field">想補充的話（選填）<textarea id="rescheduleNote" rows="3"></textarea></label>`,
    onConfirm: async () => {
      const [cycleNumber, weekNumber] = document.getElementById("rescheduleTarget").value.split("|").map(Number);
      await api(`/items/${encodeURIComponent(item.id)}/reschedule`, {
        method: "POST",
        body: {
          target: { cycleNumber, weekNumber },
          reason: document.getElementById("rescheduleReason").value,
          note: document.getElementById("rescheduleNote").value.trim(),
        },
      });
      await loadCore({ quiet: true });
    },
  });
}

function openReplanTask(item) {
  const activeCats = getActiveCategories();
  if (!activeCats.length) return showAlert("還沒有分類", "先到 Settings 加入分類，再重新整理這件事。", "");
  let rowCount = 0;

  openFormModal({
    icon: "", title: "重新整理", confirmText: "確定", cancelText: "取消", wide: true,
    body: `
      <div class="tp-modal-preformatted">原本：${escapeHtml(item.title)}\n整理後的新任務會放在目前 Week。</div>
      <div id="replanRows" class="v2-replan-rows"></div>
      <button class="v2-soft-btn" id="addReplanRowBtn" type="button">＋ 加入一個</button>`,
    onReady: () => {
      const container = document.getElementById("replanRows");
      const addRow = () => {
        const index = rowCount++;
        const firstCat = activeCats[0];
        const wrapper = document.createElement("div");
        wrapper.className = "v2-replan-row";
        wrapper.dataset.index = index;
        wrapper.innerHTML = `
          <div class="v2-replan-row-head"><strong>新的下一步 ${index + 1}</strong>${index > 0 ? `<button type="button" class="text-btn danger" data-remove-row>移除</button>` : ""}</div>
          <label class="v2-form-field">內容<input data-r-title maxlength="120" placeholder="把它整理得更小一點…" /></label>
          <div class="v2-modal-grid">
            <label class="v2-form-field">分類<select data-r-cat>${categoryOptionsHtml(firstCat.id)}</select></label>
            <label class="v2-form-field" data-r-sub-wrap>子分類<select data-r-sub></select></label>
          </div>
          <label class="v2-form-field">難度<select data-r-diff>${difficultyOptionsHtml("適中")}</select></label>`;
        container.appendChild(wrapper);
        setupReplanRow(wrapper);
        wrapper.querySelector("[data-remove-row]")?.addEventListener("click", () => wrapper.remove());
      };
      document.getElementById("addReplanRowBtn").onclick = addRow;
      addRow();
      addRow();
    },
    onConfirm: async () => {
      const rows = [...document.querySelectorAll(".v2-replan-row")];
      const tasks = rows.map((row) => ({
        title: row.querySelector("[data-r-title]").value.trim(),
        categoryId: row.querySelector("[data-r-cat]").value,
        subCategoryId: row.querySelector("[data-r-sub-wrap]").hidden ? "" : row.querySelector("[data-r-sub]").value,
        difficulty: row.querySelector("[data-r-diff]").value,
      })).filter((task) => task.title);
      if (!tasks.length) throw new Error("至少加入一個整理後的任務");
      await api(`/items/${encodeURIComponent(item.id)}/replan`, { method: "POST", body: { tasks } });
      await loadCore({ quiet: true });
    },
  });
}

function setupReplanRow(row) {
  const cat = row.querySelector("[data-r-cat]");
  const sub = row.querySelector("[data-r-sub]");
  const wrap = row.querySelector("[data-r-sub-wrap]");
  const refresh = () => {
    const subs = getSubcategories(cat.value);
    wrap.hidden = !subs.length;
    sub.innerHTML = subs.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("");
  };
  cat.addEventListener("change", refresh);
  refresh();
}

async function openDeleteTask(item) {
  const isDraft = isUnstartedCycleTask(item);

  if (isDraft) {
    const ok = await showConfirm({
      icon: "",
      title: "確定刪除這件草稿任務嗎？",
      text: `「${item.title}」\n\n下一輪還沒開始，刪除後不會留下 History 紀錄。`,
      confirmText: "刪除",
      cancelText: "取消",
      danger: true,
    });
    if (!ok) return;

    showLoading("刪除中…");
    try {
      await api(`/items/${encodeURIComponent(item.id)}/draft`, { method: "DELETE" });
      await loadCore({ quiet: true });
    } catch (error) {
      showAlert("刪除失敗", error.message, "");
    } finally { hideLoading(); }
    return;
  }

  openFormModal({
    icon: "",
    title: "確定刪除這件事嗎？",
    confirmText: "刪除",
    cancelText: "取消",
    danger: true,
    body: `
      <div class="tp-modal-preformatted">${escapeHtml(item.title)}</div>
      <p class="section-note">刪除後仍會保留在 History。</p>
      <label class="v2-form-field">原因<select id="deleteReason">${DELETE_REASONS.map((r) => `<option>${r}</option>`).join("")}</select></label>
      <label class="v2-form-field">想補充的話（選填）<textarea id="deleteNote" rows="3"></textarea></label>`,
    onConfirm: async () => {
      await api(`/items/${encodeURIComponent(item.id)}/delete`, {
        method: "POST",
        body: {
          reason: document.getElementById("deleteReason").value,
          note: document.getElementById("deleteNote").value.trim(),
        },
      });
      await loadCore({ quiet: true });
    },
  });
}

async function correctCompletion(item) {
  const ok = await showConfirm({
    icon: "↩",
    title: "這件任務是不是按早了？",
    text: "會恢復成進行中的狀態，History 只留一筆「誤操作更正」。",
    confirmText: "恢復",
    cancelText: "取消",
  });
  if (!ok) return;
  showLoading("更正中…");
  try {
    await api(`/items/${encodeURIComponent(item.id)}/correct-completion`, { method: "POST", body: {} });
    await loadCore({ quiet: true });
  } catch (error) {
    showAlert("更正失敗", error.message, "");
  } finally { hideLoading(); }
}

function openWeekPlanEditor() {
  const week = currentWeek();
  if (!week) return;
  openFormModal({
    icon: "", title: `Week ${week.weekNumber}`, confirmText: "儲存", cancelText: "取消",
    body: `
      <label class="v2-form-field">本週主題<input id="weekPlanTheme" maxlength="80" value="${escapeHtml(week.title || "")}" /></label>
      <label class="v2-form-field">本週目標<textarea id="weekPlanGoal" rows="3" maxlength="240">${escapeHtml(week.achievement || "")}</textarea></label>`,
    onConfirm: async () => {
      const title = document.getElementById("weekPlanTheme").value.trim();
      const achievement = document.getElementById("weekPlanGoal").value.trim();
      if (!title || !achievement) throw new Error("本週主題與目標都要填");
      await api("/weeks/current-plan", { method: "PATCH", body: { title, achievement } });
      await loadCore({ quiet: true });
    },
  });
}

async function saveWeekSetup(event) {
  event.preventDefault();
  const title = els.weekSetupTheme.value.trim();
  const achievement = els.weekSetupGoal.value.trim();
  if (!title || !achievement) return;
  showLoading("準備這一週…");
  try {
    await api("/weeks/current-plan", { method: "PATCH", body: { title, achievement } });
    await loadCore({ quiet: true });
  } catch (error) {
    showAlert("儲存失敗", error.message, "");
  } finally { hideLoading(); }
}

function openPostponeWeek() {
  const week = currentWeek();
  if (!week || week.postponed) return;
  openFormModal({
    icon: "", title: "本週需要多一點時間？", confirmText: "確定順延", cancelText: "取消",
    body: `
      <label class="v2-form-field">順延天數<select id="postponeDays">${[1,2,3,4,5,6,7].map((d) => `<option value="${d}" ${d === 7 ? "selected" : ""}>${d} 天</option>`).join("")}</select></label>
      <label class="v2-form-field">原因<select id="postponeReason">${POSTPONE_REASONS.map((r) => `<option>${r}</option>`).join("")}</select></label>
      <label class="v2-form-field">想補充的話（選填）<textarea id="postponeNote" rows="3"></textarea></label>`,
    onConfirm: async () => {
      await api("/weeks/postpone-current", {
        method: "POST",
        body: {
          days: Number(document.getElementById("postponeDays").value),
          reason: document.getElementById("postponeReason").value,
          note: document.getElementById("postponeNote").value.trim(),
        },
      });
      await loadCore({ quiet: true });
    },
  });
}

async function switchPage(page) {
  state.currentPage = page;
  els.pages.forEach((panel) => { panel.hidden = panel.dataset.pagePanel !== page; });
  els.navButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.page === page));
  closeTaskMenu();
  closeBottomSheet();
  if (page === "history") await loadHistory();
  if (page === "settings") renderSettings();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadHistory() {
  showLoading("整理 History…");
  try {
    state.history = await api("/history");
    if (!state.historyOpenCycles.size && state.history?.length) {
      const latest = state.history[0]?.cycle?.cycleNumber;
      if (latest) state.historyOpenCycles.add(Number(latest));
    }
    renderHistory();
    if (state.historyFocusTaskId) {
      requestAnimationFrame(() => focusHistoryTask(state.historyFocusTaskId));
    }
  } catch (error) {
    showAlert("History 讀取失敗", error.message, "");
  } finally { hideLoading(); }
}

function renderHistory() {
  const history = Array.isArray(state.history) ? state.history : [];
  if (!history.length) {
    els.historyList.innerHTML = `<div class="v2-empty">History 還是空白的。</div>`;
    return;
  }

  els.historyList.innerHTML = history.map((wrapper) => {
    const cycle = wrapper.cycle;
    const open = state.historyOpenCycles.has(Number(cycle.cycleNumber));
    const summary = wrapper.summary || {};
    const weeks = wrapper.weeks || [];
    const firstWeek = weeks[0]?.week;
    const lastWeek = weeks[weeks.length - 1]?.week;
    const dateText = firstWeek && lastWeek ? `${formatDate(firstWeek.weekStart)} ～ ${formatDate(lastWeek.weekEnd)}` : "";
    const selected = state.historySelectedWeeks[cycle.cycleNumber];

    const summaryBits = [
      `完成 ${summary.onTimeCompleted || 0}`,
      `後來完成 ${summary.lateCompleted || 0}`,
      `未完待續 ${summary.incomplete || 0}`,
      `重新整理 ${summary.replanned || 0}`,
      `刪除 ${summary.cancelled || 0}`,
    ];
    if (Number(cycle.cycleNumber) >= 2) summaryBits.push(`Weekly Review ${summary.retrospectiveCount || 0}/12`);

    return `
      <article class="history-cycle-card" data-history-cycle-card="${cycle.cycleNumber}">
        <button class="history-cycle-toggle" type="button" data-history-cycle-toggle="${cycle.cycleNumber}">
          <span class="history-cycle-title">
            <strong>Cycle ${cycle.cycleNumber}</strong>
            <span>${escapeHtml(cycle.theme || "")}${cycle.theme && dateText ? " · " : ""}${dateText}</span>
          </span>
          <span class="history-cycle-chevron">${open ? "⌄" : "›"}</span>
        </button>
        ${open ? `
          <div class="history-cycle-body">
            <div class="history-path">${renderHistoryCyclePath(weeks)}</div>
            <div class="history-summary-line">${summaryBits.map((bit) => `<span>${escapeHtml(bit)}</span>`).join("")}</div>
            ${renderCycleHistoryEvents(wrapper.events || [])}
            <div class="history-week-grid">
              ${weeks.map((weekWrap) => `
                <button class="history-week-btn ${Number(selected) === Number(weekWrap.week.weekNumber) ? "is-selected" : ""}" type="button"
                  data-history-week-cycle="${cycle.cycleNumber}" data-history-week="${weekWrap.week.weekNumber}">
                  W${weekWrap.week.weekNumber}
                </button>`).join("")}
            </div>
            ${selected ? renderHistoryWeek(weeks.find((w) => Number(w.week.weekNumber) === Number(selected))) : ""}
          </div>` : ""}
      </article>`;
  }).join("");

  els.historyList.querySelectorAll("[data-history-cycle-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const cycleNumber = Number(button.dataset.historyCycleToggle);
      if (state.historyOpenCycles.has(cycleNumber)) state.historyOpenCycles.delete(cycleNumber);
      else state.historyOpenCycles.add(cycleNumber);
      renderHistory();
    });
  });

  els.historyList.querySelectorAll("[data-history-week]").forEach((button) => {
    button.addEventListener("click", () => {
      const cycleNumber = Number(button.dataset.historyWeekCycle);
      const weekNumber = Number(button.dataset.historyWeek);
      state.historySelectedWeeks[cycleNumber] =
        Number(state.historySelectedWeeks[cycleNumber]) === weekNumber ? null : weekNumber;
      renderHistory();
    });
  });

  els.historyList.querySelectorAll("[data-history-task-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const details = document.getElementById(button.dataset.historyTaskToggle);
      if (details) details.open = !details.open;
    });
  });

  els.historyList.querySelectorAll("[data-retro-cycle]").forEach((button) => {
    button.addEventListener("click", () => openWeeklyReview(Number(button.dataset.retroCycle), Number(button.dataset.retroWeek)));
  });
}

function renderCycleHistoryEvents(events) {
  const relevant = (Array.isArray(events) ? events : []).filter((event) =>
    ["cycle_start_changed"].includes(event.eventType)
  );
  if (!relevant.length) return "";

  return `
    <div class="history-cycle-events">
      ${relevant.map((event) => {
        const beforeDate = event.before?.startDate || "";
        const afterDate = event.after?.startDate || "";
        return `
          <div class="history-cycle-event">
            <strong>開始日期調整</strong>
            <span>${beforeDate && afterDate ? `${formatDate(beforeDate)} → ${formatDate(afterDate)}` : escapeHtml(event.summary || "")}</span>
            <small>${formatDateTime(event.occurredAt)}</small>
          </div>`;
      }).join("")}
    </div>`;
}

function renderHistoryCyclePath(weeks) {
  const rows = [weeks.slice(0, 6), weeks.slice(6, 12)];
  return rows.map((row) => `
    <div class="cycle-path-row">
      ${row.map((wrapper) => {
        const week = wrapper.week;
        const stateClass = week.status === "current" ? "is-current" : (week.status === "completed" ? "is-past" : "is-future");
        const marker = week.status === "current"
          ? mobiusMarkup("path-mobius")
          : `<span class="path-dot" aria-hidden="true"></span>`;
        return `<div class="path-node ${stateClass}">${marker}<span>W${week.weekNumber}</span></div>`;
      }).join("")}
    </div>`).join("");
}

function renderHistoryWeek(wrapper) {
  if (!wrapper) return "";
  const week = wrapper.week;
  const retro = wrapper.retrospective;
  const tasks = wrapper.tasks || [];
  const showReview = Number(week.cycleNumber) >= 2;

  return `
    <div class="history-week-detail">
      <div class="history-week-head">
        <h3>Week ${week.weekNumber}</h3>
        <p>${formatDate(week.weekStart)} ～ ${formatDate(week.weekEnd)}</p>
      </div>

      <div class="history-plan">
        <div><span>本週主題</span><br><strong>${escapeHtml(week.title || "—")}</strong></div>
        <div><span>本週目標</span><br><strong>${escapeHtml(week.achievement || "—")}</strong></div>
      </div>

      <div class="history-task-list">
        ${tasks.length ? tasks.map((taskWrap) => renderHistoryTask(taskWrap)).join("") : `<div class="v2-empty">這週沒有任務。</div>`}
      </div>

      ${showReview ? `
        <div class="history-review-line">
          <span>Weekly Review</span>
          <button class="v2-retro-button" type="button" data-retro-cycle="${week.cycleNumber}" data-retro-week="${week.weekNumber}">
            ${retro?.submittedAt ? "查看" : "寫下回顧"}
          </button>
        </div>` : ""}
    </div>`;
}

function renderHistoryTask(wrapper) {
  const item = wrapper.item;
  const events = wrapper.events || [];
  return `
    <details class="v2-history-task" id="history-task-${safeId(item.id)}">
      <summary>
        <span>${escapeHtml(item.title)}</span>
        <span class="v2-mini-badge">${statusLabel(item.status)}</span>
      </summary>
      <div class="v2-history-task-detail">
        <div class="v2-history-week-meta">
          <span>原本安排：Cycle ${item.originalCycleNumber} · Week ${item.originalWeekNumber}</span>
          ${isRescheduled(item) ? `<span>後來安排：Cycle ${item.scheduledCycleNumber} · Week ${item.scheduledWeekNumber}</span>` : ""}
        </div>
        <ul class="v2-event-list">
          ${events.length ? events.map((event) => `
            <li class="v2-event-item">
              <strong>${escapeHtml(eventLabel(event))}</strong>
              <span>${formatDateTime(event.occurredAt)}${event.reason ? ` · ${escapeHtml(event.reason)}` : ""}${event.note ? `<br>${escapeHtml(event.note)}` : ""}</span>
            </li>`).join("") : `<li class="v2-empty">沒有其他紀錄。</li>`}
        </ul>
      </div>
    </details>`;
}

function eventLabel(event) {
  return ({
    task_created: "加入",
    task_overdue: "未完待續",
    task_rescheduled: "調整時間",
    task_replanned: "重新整理",
    task_completed: "完成",
    task_cancelled: "刪除",
    task_deleted: "刪除",
    completion_corrected: "誤操作更正",
  })[event.eventType] || event.summary || event.eventType;
}

function statusLabel(status) {
  return ({
    active: "進行中",
    overdue: "未完待續",
    completed: "已完成",
    replanned: "已重新整理",
    cancelled: "已刪除",
  })[status] || status;
}

async function goToTaskHistory(itemId) {
  const item = state.items.find((x) => x.id === itemId);
  if (item) {
    const cycleNumber = Number(item.originalCycleNumber || item.cycleNumber);
    const weekNumber = Number(item.originalWeekNumber || item.weekNumber);
    if (cycleNumber) state.historyOpenCycles.add(cycleNumber);
    if (cycleNumber && weekNumber) state.historySelectedWeeks[cycleNumber] = weekNumber;
  }
  state.historyFocusTaskId = itemId;
  await switchPage("history");
}

function focusHistoryTask(itemId) {
  const target = document.getElementById(`history-task-${safeId(itemId)}`);
  if (!target) return;
  let parent = target.parentElement;
  while (parent) {
    if (parent.tagName === "DETAILS") parent.open = true;
    parent = parent.parentElement;
  }
  target.open = true;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("v2-tour-highlight");
  setTimeout(() => target.classList.remove("v2-tour-highlight"), 1600);
  state.historyFocusTaskId = null;
}

async function openReview(cycleNumber, fromCompletion = false) {
  showLoading("整理這一輪…");
  try {
    const review = await api(`/reviews/${cycleNumber}`);
    closeModal();

    const stat = (value, label) => `<div class="v2-review-stat"><strong>${value}</strong><span>${label}</span></div>`;
    const bars = (review.trend || []).map((point) => {
      const empty = point.rate === null;
      const height = empty ? 3 : Math.max(5, point.rate);
      return `<div class="v2-review-bar-col">
        <div class="v2-review-bar-wrap"><div class="v2-review-bar ${empty ? "is-empty" : ""}" style="height:${height}%"></div></div>
        <b>${empty ? "—" : `${point.rate}%`}</b><small>W${point.weekNumber}</small>
      </div>`;
    }).join("");

    els.modalRoot.innerHTML = `
      <div class="tp-modal-overlay tp-modal-open">
        <div class="tp-modal tp-modal-review" role="dialog" aria-modal="true">
          <div class="cycle-summary-mobius">${mobiusMarkup("summary-mobius")}</div>
          <p class="tp-modal-body"><strong style="display:block;text-align:center;font-size:22px;">Cycle ${cycleNumber}</strong>
          <span style="display:block;text-align:center;color:var(--muted);">這一輪走完了</span></p>
          <div class="v2-review-grid">
            ${stat(review.totalTasks, "總任務")}
            ${stat(review.onTimeCompleted, "按期完成")}
            ${stat(review.lateCompleted, "後來完成")}
            ${stat(review.incomplete, "未完待續")}
            ${stat(review.replanned, "重新整理")}
            ${stat(review.cancelled, "刪除")}
            ${stat(`${review.onTimeRate}%`, "按期完成率")}
            ${stat(review.postponedWeeks, "Week 順延")}
            ${Number(cycleNumber) >= 2 ? stat(`${review.retrospectiveCount}/12`, "Weekly Review") : ""}
          </div>
          <div class="v2-chart">
            <p class="v2-chart-title">Week 1～12 · 按期完成趨勢</p>
            <div class="v2-review-chart">${bars}</div>
          </div>
          <div class="tp-modal-actions">
            <button class="tp-btn tp-btn-ghost" id="reviewCloseBtn" type="button">${fromCompletion ? "先看看" : "關閉"}</button>
            ${fromCompletion ? `<button class="tp-btn tp-btn-primary" id="reviewNextCycleBtn" type="button">收進 History</button>` : ""}
          </div>
        </div>
      </div>`;

    document.getElementById("reviewCloseBtn").onclick = closeModal;
    if (fromCompletion) {
      document.getElementById("reviewNextCycleBtn").onclick = () => {
        localStorage.setItem(`tp-star-cycle-archived-${cycleNumber}`, "1");
        closeModal();
        if (state.context?.nextCycle) {
          renderHome();
        } else {
          openCreateCycle();
        }
      };
    }
  } catch (error) {
    showAlert("總結讀取失敗", error.message, "");
  } finally { hideLoading(); }
}

function maybeShowCycleCelebration() {
  const context = state.context;
  if (!context?.cycleComplete || !context.completedCycleNumber) return;
  const key = `tp-star-cycle-celebration-${context.completedCycleNumber}`;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, "1");
  els.celebrationTitle.textContent = `Cycle ${context.completedCycleNumber}`;
  els.cycleCelebration.hidden = false;
}

function closeCelebrationAndReview() {
  els.cycleCelebration.hidden = true;
  if (state.context?.completedCycleNumber) openReview(Number(state.context.completedCycleNumber), true);
}

function openCreateCycle() {
  const latest = state.cycles.length ? Math.max(...state.cycles.map((c) => Number(c.cycleNumber))) : 0;
  openFormModal({
    icon: "", title: `Cycle ${latest + 1}`, confirmText: "開始下一輪", cancelText: "取消", wide: true,
    body: `
      <label class="v2-form-field">開始日期<input id="newCycleStart" type="date" min="${todayYmd()}" /></label>
      <label class="v2-form-field">本輪主題<input id="newCycleMainTheme" maxlength="80" placeholder="例如：CSS" /></label>
      <label class="v2-form-field">Week 1 主題<input id="newCycleTheme" maxlength="80" /></label>
      <label class="v2-form-field">Week 1 目標<textarea id="newCycleGoal" rows="3" maxlength="240"></textarea></label>`,
    onConfirm: async () => {
      const startDate = document.getElementById("newCycleStart").value;
      const theme = document.getElementById("newCycleMainTheme").value.trim();
      const title = document.getElementById("newCycleTheme").value.trim();
      const achievement = document.getElementById("newCycleGoal").value.trim();
      if (!startDate || !theme || !title || !achievement) throw new Error("開始日期、本輪主題、Week 1 主題與目標都要填");
      await api("/cycles", { method: "POST", body: { startDate, theme, title, achievement } });
      await loadCore({ quiet: true });
    },
  });
}

function renderSettings() {
  if (!els.categorySettingsList) return;
  const categories = state.categories.filter((c) => c.type === "category");
  const visible = categories.filter((c) => c.active || state.showInactiveCategories);

  els.categorySettingsList.innerHTML = visible.length ? visible.map((cat) => {
    const subs = getSubcategories(cat.id, true).filter((sub) => sub.active || state.showInactiveCategories);
    return `
      <article class="v2-setting-row" style="--category-dot:${getTagColors(cat.id || cat.name, "category").border};">
        <div class="v2-setting-row-top">
          <div>
            <strong class="v2-category-name-chip" style="${tagStyle(cat.id || cat.name, "category")}">${escapeHtml(cat.name)}</strong>
            ${!cat.active ? `<span class="v2-category-state">已停用</span>` : ""}
          </div>
          <div class="v2-setting-actions">
            ${cat.active ? `<button class="text-btn" type="button" data-add-sub="${cat.id}">＋ 子分類</button>` : ""}
            <button class="v2-more-btn" type="button" data-category-more="${cat.id}">⋯</button>
          </div>
        </div>
        ${subs.length ? `<div class="v2-subcategory-list">${subs.map((sub) => `
          <button class="v2-subcategory-chip ${!sub.active ? "is-inactive" : ""}" style="${tagStyle(sub.id || sub.name, "subcategory", cat.id || cat.name)}" type="button" data-sub-actions="${sub.id}">
            ${escapeHtml(sub.name)}${!sub.active ? " · 已停用" : ""}
          </button>`).join("")}</div>` : ""}
      </article>`;
  }).join("") : `<div class="v2-empty">還沒有分類。</div>`;

  els.toggleInactiveBtn.textContent = state.showInactiveCategories ? "隱藏已停用" : "顯示已停用";

  els.categorySettingsList.querySelectorAll("[data-add-sub]").forEach((button) => {
    button.addEventListener("click", () => openAddCategory("subcategory", button.dataset.addSub));
  });
  els.categorySettingsList.querySelectorAll("[data-sub-actions]").forEach((button) => {
    button.addEventListener("click", () => openSubcategoryActions(button.dataset.subActions));
  });
  els.categorySettingsList.querySelectorAll("[data-category-more]").forEach((button) => {
    button.addEventListener("click", () => {
      const cat = state.categories.find((c) => c.id === button.dataset.categoryMore);
      if (!cat) return;
      els.modalRoot.innerHTML = `
        <div class="tp-modal-overlay tp-modal-open"><div class="tp-modal" role="dialog" aria-modal="true">
          
          <p class="tp-modal-body"><strong>${escapeHtml(cat.name)}</strong></p>
          <div class="tp-modal-actions">
            <button class="tp-btn tp-btn-ghost" id="catClose" type="button">取消</button>
            <button class="tp-btn tp-btn-primary" id="catRename" type="button">改名</button>
            <button class="tp-btn ${cat.active ? "tp-btn-danger" : "tp-btn-primary"}" id="catToggle" type="button">${cat.active ? "停用" : "重新啟用"}</button>
          </div>
        </div></div>`;
      document.getElementById("catClose").onclick = closeModal;
      document.getElementById("catRename").onclick = () => { closeModal(); openRenameCategory(cat.id); };
      document.getElementById("catToggle").onclick = async () => { closeModal(); await toggleCategory(cat.id); };
    });
  });
}

function openAddCategory(type = "category", parentId = "") {
  const label = type === "subcategory" ? "子分類" : "分類";
  openFormModal({
    icon: "", title: `加入${label}`, confirmText: "加入", cancelText: "取消",
    body: `<label class="v2-form-field">名稱<input id="newCategoryName" maxlength="50" /></label>`,
    onConfirm: async () => {
      const name = document.getElementById("newCategoryName").value.trim();
      if (!name) throw new Error("名稱不可空白");
      await api("/categories", { method: "POST", body: { name, type, parentId } });
      await reloadCategories();
    },
  });
}

function openRenameCategory(id) {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return;
  openFormModal({
    icon: "✏️", title: `改名：${cat.name}`, confirmText: "儲存",
    body: `<label class="v2-form-field">新名稱<input id="renameCategoryInput" value="${escapeHtml(cat.name)}" maxlength="50" /></label>`,
    onConfirm: async () => {
      const name = document.getElementById("renameCategoryInput").value.trim();
      if (!name) throw new Error("名稱不可空白");
      await api(`/categories/${encodeURIComponent(id)}`, { method: "PATCH", body: { name } });
      await reloadCategories();
    },
  });
}

async function toggleCategory(id) {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return;
  const action = cat.active ? "停用" : "重新啟用";
  const ok = await showConfirm({
    icon: "",
    title: `${action}「${cat.name}」？`,
    text: cat.active ? "停用後不會出現在新的任務裡，但舊紀錄會保留。" : "重新啟用後會再次出現在加入表單。",
    confirmText: action,
    cancelText: "取消",
    danger: cat.active,
  });
  if (!ok) return;
  await setCategoryActive(id, !cat.active);
}

async function setCategoryActive(id, active) {
  showLoading(active ? "重新啟用中…" : "停用中…");
  try {
    await api(`/categories/${encodeURIComponent(id)}`, { method: "PATCH", body: { active } });
    await reloadCategories();
  } catch (error) { showAlert("分類更新失敗", error.message, "⚠️"); }
  finally { hideLoading(); }
}

function openSubcategoryActions(id) {
  const sub = state.categories.find((c) => c.id === id);
  if (!sub) return;
  els.modalRoot.innerHTML = `
    <div class="tp-modal-overlay tp-modal-open"><div class="tp-modal" role="dialog" aria-modal="true">
      <p class="tp-modal-body"><strong>${escapeHtml(sub.name)}</strong></p>
      <div class="tp-modal-actions">
        <button class="tp-btn tp-btn-ghost" id="subCancel" type="button">取消</button>
        <button class="tp-btn tp-btn-primary" id="subRename" type="button">改名</button>
        <button class="tp-btn ${sub.active ? "tp-btn-danger" : "tp-btn-primary"}" id="subToggle" type="button">${sub.active ? "停用" : "重新啟用"}</button>
      </div></div></div>`;
  document.getElementById("subCancel").onclick = closeModal;
  document.getElementById("subRename").onclick = () => { closeModal(); openRenameCategory(id); };
  document.getElementById("subToggle").onclick = async () => { closeModal(); await setCategoryActive(id, !sub.active); };
}

async function reloadCategories() {
  state.categories = await api("/categories");
  renderCategorySelects();
  renderSettings();
  closeModal();
}

function showAlert(title, text, icon = "") {
  els.modalRoot.innerHTML = `
    <div class="tp-modal-overlay tp-modal-open"><div class="tp-modal" role="dialog" aria-modal="true">
      ${icon ? `<div class="tp-modal-icon">${icon}</div>` : ""}
      <p class="tp-modal-body"><strong style="display:block;margin-bottom:8px;">${escapeHtml(title)}</strong>${escapeHtml(text).replaceAll("\n", "<br>")}</p>
      <div class="tp-modal-actions"><button class="tp-btn tp-btn-primary" id="alertOk" type="button">知道了</button></div>
    </div></div>`;
  document.getElementById("alertOk").onclick = closeModal;
}

function showConfirm({ icon = "", title, text, confirmText = "確認", cancelText = "取消", danger = false }) {
  return new Promise((resolve) => {
    els.modalRoot.innerHTML = `
      <div class="tp-modal-overlay tp-modal-open"><div class="tp-modal" role="dialog" aria-modal="true">
        ${icon ? `<div class="tp-modal-icon">${icon}</div>` : ""}
        <p class="tp-modal-body"><strong style="display:block;margin-bottom:8px;">${escapeHtml(title)}</strong>${escapeHtml(text).replaceAll("\n", "<br>")}</p>
        <div class="tp-modal-actions">
          <button class="tp-btn tp-btn-ghost" id="confirmCancel" type="button">${escapeHtml(cancelText)}</button>
          <button class="tp-btn ${danger ? "tp-btn-danger" : "tp-btn-primary"}" id="confirmOk" type="button">${escapeHtml(confirmText)}</button>
        </div>
      </div></div>`;
    document.getElementById("confirmCancel").onclick = () => { closeModal(); resolve(false); };
    document.getElementById("confirmOk").onclick = () => { closeModal(); resolve(true); };
  });
}

function openFormModal({ icon = "", title, body, confirmText = "確認", cancelText = "取消", danger = false, wide = false, onReady, onConfirm }) {
  els.modalRoot.innerHTML = `
    <div class="tp-modal-overlay tp-modal-open">
      <div class="tp-modal ${wide ? "tp-modal-wide" : ""}" role="dialog" aria-modal="true">
        ${icon ? `<div class="tp-modal-icon">${icon}</div>` : ""}
        <p class="tp-modal-body"><strong>${escapeHtml(title)}</strong></p>
        <div class="v2-modal-form">${body}</div>
        <p class="v2-modal-error" id="formModalError" hidden></p>
        <div class="tp-modal-actions">
          <button class="tp-btn tp-btn-ghost" id="formCancel" type="button">${escapeHtml(cancelText)}</button>
          <button class="tp-btn ${danger ? "tp-btn-danger" : "tp-btn-primary"}" id="formConfirm" type="button">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    </div>`;
  document.getElementById("formCancel").onclick = closeModal;
  const confirm = document.getElementById("formConfirm");
  confirm.onclick = async () => {
    const errorBox = document.getElementById("formModalError");
    errorBox.hidden = true;
    confirm.disabled = true;
    try {
      const result = await onConfirm();
      if (result !== false) closeModal();
    } catch (error) {
      errorBox.textContent = error.message || "操作失敗";
      errorBox.hidden = false;
      confirm.disabled = false;
    }
  };
  if (onReady) onReady();
}

function closeModal() { els.modalRoot.innerHTML = ""; }

const TOUR_STEPS = [
  { page: "home", selector: "#toggleAddTaskBtn", title: "先加入", text: "把這週想做的事放進來。加入只是放下一步，不代表已經完成。" },
  { page: "home", selector: "#starProgress", title: "進度條看完成狀況", text: "每完成一件，本週進度條就會往前一點。" },
  { page: "history", selector: "#tourHistory", title: "需要時再回頭看", text: "調整時間、重新整理與真正完成的紀錄，都會留在 History。" },
];

async function startTour(force = false) {
  if (!force && localStorage.getItem("tp-star-tour-seen")) return;
  state.tourIndex = 0;
  els.tourPopover.hidden = false;
  await renderTourStep();
}

async function renderTourStep() {
  document.querySelectorAll(".v2-tour-highlight").forEach((x) => x.classList.remove("v2-tour-highlight"));
  const step = TOUR_STEPS[state.tourIndex];
  if (!step) return finishTour();
  if (state.currentPage !== step.page) await switchPage(step.page);
  const target = document.querySelector(step.selector);
  target?.classList.add("v2-tour-highlight");
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
  els.tourStepLabel.textContent = `${state.tourIndex + 1} / ${TOUR_STEPS.length}`;
  els.tourTitle.textContent = step.title;
  els.tourText.textContent = step.text;
  els.tourNextBtn.textContent = state.tourIndex === TOUR_STEPS.length - 1 ? "開始使用" : "下一步";
}

function finishTour() {
  document.querySelectorAll(".v2-tour-highlight").forEach((x) => x.classList.remove("v2-tour-highlight"));
  els.tourPopover.hidden = true;
  localStorage.setItem("tp-star-tour-seen", "1");
  switchPage("home");
}


function renderCyclePath() {
  const week = currentWeek();
  if (!week) {
    els.cyclePathCard.hidden = true;
    return;
  }
  const cycleWeeks = state.weeks
    .filter((w) => Number(w.cycleNumber) === Number(week.cycleNumber))
    .sort((a, b) => Number(a.weekNumber) - Number(b.weekNumber));

  if (!cycleWeeks.length) {
    els.cyclePathCard.hidden = true;
    return;
  }

  const rows = [cycleWeeks.slice(0, 6), cycleWeeks.slice(6, 12)];
  els.cyclePath.innerHTML = rows.map((row) => `
    <div class="cycle-path-row">
      ${row.map((w) => {
        const cmp = Number(w.weekNumber) - Number(week.weekNumber);
        const stateClass = cmp < 0 ? "is-past" : (cmp === 0 ? "is-current" : "is-future");
        const marker = cmp === 0
          ? mobiusMarkup("path-mobius")
          : `<span class="path-dot" aria-hidden="true"></span>`;
        return `<div class="path-node ${stateClass}">${marker}<span>W${w.weekNumber}</span></div>`;
      }).join("")}
    </div>`).join("");
  els.cyclePathCaption.textContent = `Cycle ${week.cycleNumber} · Week ${week.weekNumber} / 12`;
  els.cyclePathCard.hidden = false;
}

function renderWeeklyReview() {
  const week = currentWeek();
  if (!week || Number(week.cycleNumber) < 2) {
    els.weeklyReviewPanel.hidden = true;
    return;
  }

  const retro = getSubmittedReview(week.cycleNumber, week.weekNumber);
  els.weeklyReviewPanel.hidden = false;
  els.weeklyReviewSpark.textContent = "";
  els.weeklyReviewSpark.classList.toggle("is-done", !!retro);
  els.weeklyReviewStatus.textContent = retro ? "這週的回顧已經留下來了。" : "寫下這週真正留下的感覺。";
  els.weeklyReviewBtn.textContent = retro ? "查看" : "開始回顧";
}

function openCycleThemeEditor() {
  const week = currentWeek();
  const cycle = currentCycle();
  if (!week || !cycle) return;

  openFormModal({
    icon: "",
    title: "本輪主題",
    confirmText: "儲存",
    cancelText: "取消",
    body: `<label class="v2-form-field">本輪主題<input id="cycleThemeInput" maxlength="80" value="${escapeHtml(cycle.theme || "")}" placeholder="例如：CSS" /></label>`,
    onConfirm: async () => {
      const theme = document.getElementById("cycleThemeInput").value.trim();
      if (!theme) throw new Error("本輪主題不可空白");
      await api(`/cycles/${week.cycleNumber}/theme`, { method: "PATCH", body: { theme } });
      await loadCore({ quiet: true });
    },
  });
}

function openPlanningEntry() {
  if (state.context?.canPlanNextCycle) return openNextCyclePlanner();
  return openNextWeekPlanner();
}

function openNextCyclePlanner(draft = null) {
  const context = state.context || {};
  const current = context.currentWeek;
  const existingCycle = context.nextCycle || null;
  const inFinalWeekWindow = !!(current && Number(current.weekNumber) === 12 && context.canPlanNextCycle);
  const inRestDraftWindow = !!(context.restPeriod && existingCycle);
  if (!inFinalWeekWindow && !inRestDraftWindow) return;


  const cycleNumber = existingCycle?.cycleNumber || ((state.cycles.length ? Math.max(...state.cycles.map((c) => Number(c.cycleNumber))) : 0) + 1);
  const weekOne = existingCycle
    ? state.weeks.find((week) => Number(week.cycleNumber) === Number(existingCycle.cycleNumber) && Number(week.weekNumber) === 1) || null
    : null;
  const existingTasks = existingCycle ? state.items.filter((item) =>
    item.type === "task" &&
    Number(item.scheduledCycleNumber || item.cycleNumber) === Number(existingCycle.cycleNumber) &&
    Number(item.scheduledWeekNumber || item.weekNumber) === 1 &&
    !["cancelled", "replanned"].includes(item.status)
  ) : [];
  const pendingTasks = Array.isArray(draft?.pendingTasks) ? draft.pendingTasks : [];

  const previousCycleNumber = Number(existingCycle?.cycleNumber || cycleNumber) - 1;
  const previousWeek12 = state.weeks.find((week) =>
    Number(week.cycleNumber) === previousCycleNumber && Number(week.weekNumber) === 12
  ) || null;
  const minStart = current?.weekEnd
    ? addDaysYmd(current.weekEnd, 1)
    : (previousWeek12?.weekEnd ? addDaysYmd(previousWeek12.weekEnd, 1) : todayYmd());
  const startDate = draft?.startDate ?? existingCycle?.startDate ?? minStart;
  const cycleTheme = draft?.cycleTheme ?? existingCycle?.theme ?? "";
  const title = draft?.title ?? weekOne?.title ?? "";
  const achievement = draft?.achievement ?? weekOne?.achievement ?? "";
  const activeCategories = getActiveCategories();
  const firstCat = activeCategories[0] || null;

  const existingRows = existingTasks.length ? existingTasks.map((item) => `
    <div class="next-task-row">
      <span>${escapeHtml(item.title)}</span>
      <div class="next-task-actions">
        <button class="text-btn" type="button" data-next-cycle-task-edit="${escapeHtml(item.id)}">編輯</button>
        <button class="text-btn" type="button" data-next-cycle-task-remove="${escapeHtml(item.id)}">刪除</button>
      </div>
    </div>`).join("") : "";
  const pendingRows = pendingTasks.length ? pendingTasks.map((item, index) => `
    <div class="next-task-row">
      <span>${escapeHtml(item.title)}</span>
      <button class="text-btn" type="button" data-next-cycle-draft-remove="${index}">刪除</button>
    </div>`).join("") : "";

  els.modalRoot.innerHTML = `
    <div class="tp-modal-overlay tp-modal-open">
      <div class="tp-modal tp-modal-wide" role="dialog" aria-modal="true">
        <div class="tp-modal-icon">✓</div>
        <p class="tp-modal-body"><strong>Cycle ${cycleNumber}</strong><br>
          <span style="color:var(--muted);font-size:12px;">先準備下一輪，不會提前結束現在的 Cycle；開始日期若有調整，會留下時間紀錄。</span>
        </p>

        <div class="v2-modal-form">
          <label class="v2-form-field">開始日期<input id="nextCycleStart" type="date" min="${escapeHtml(minStart)}" value="${escapeHtml(startDate)}" /></label>
          <label class="v2-form-field">本輪主題<input id="nextCycleTheme" maxlength="80" value="${escapeHtml(cycleTheme)}" placeholder="例如：JavaScript" /></label>
          <label class="v2-form-field">Week 1 主題<input id="nextCycleWeekTheme" maxlength="80" value="${escapeHtml(title)}" /></label>
          <label class="v2-form-field">Week 1 目標<textarea id="nextCycleWeekGoal" rows="3" maxlength="240">${escapeHtml(achievement)}</textarea></label>

          <div class="next-task-list" id="nextCycleTaskList">
            ${existingRows}${pendingRows || (!existingRows ? `<div class="tp-modal-preformatted">Week 1 還沒有先放進去的事情。</div>` : "")}
          </div>

          ${firstCat ? `
          <div class="v2-modal-grid">
            <label class="v2-form-field">想先加入的事情<input id="nextCycleTaskTitle" maxlength="120" placeholder="可以先留白" /></label>
            <label class="v2-form-field">難度<select id="nextCycleTaskDifficulty">${difficultyOptionsHtml("適中")}</select></label>
          </div>
          <div class="v2-modal-grid">
            <label class="v2-form-field">分類<select id="nextCycleTaskCategory">${categoryOptionsHtml(firstCat.id)}</select></label>
            <label class="v2-form-field" id="nextCycleTaskSubWrap">子分類<select id="nextCycleTaskSubCategory"></select></label>
          </div>
          <button class="v2-soft-btn" id="nextCycleTaskAddBtn" type="button">加入</button>` : `
          <div class="tp-modal-preformatted">如果要先加 Week 1 任務，可以先到 Settings 建立分類。</div>`}
          <p class="v2-modal-error" id="nextCyclePlannerError" hidden></p>
        </div>

        <div class="tp-modal-actions">
          <button class="tp-btn tp-btn-ghost" id="nextCyclePlannerCancel" type="button">取消</button>
          <button class="tp-btn tp-btn-primary" id="nextCyclePlannerSave" type="button">儲存下一輪</button>
        </div>
      </div>
    </div>`;

  const collectDraft = () => ({
    startDate: document.getElementById("nextCycleStart")?.value || startDate,
    cycleTheme: document.getElementById("nextCycleTheme")?.value.trim() || "",
    title: document.getElementById("nextCycleWeekTheme")?.value.trim() || "",
    achievement: document.getElementById("nextCycleWeekGoal")?.value.trim() || "",
    pendingTasks: pendingTasks.slice(),
  });

  document.getElementById("nextCyclePlannerCancel").onclick = closeModal;

  els.modalRoot.querySelectorAll("[data-next-cycle-task-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.items.find((x) => x.id === button.dataset.nextCycleTaskEdit);
      if (!item) return;
      closeModal();
      openEditTask(item);
    });
  });

  els.modalRoot.querySelectorAll("[data-next-cycle-task-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.nextCycleTaskRemove;
      const item = state.items.find((x) => x.id === id);
      const draftSnapshot = collectDraft();
      const ok = await showConfirm({
        icon: "",
        title: "確定刪除這件草稿任務嗎？",
        text: `「${item?.title || "這件任務"}」\n\n下一輪還沒開始，刪除後不會留下 History 紀錄。`,
        confirmText: "刪除",
        cancelText: "取消",
        danger: true,
      });
      if (!ok) return openNextCyclePlanner(draftSnapshot);
      try {
        showLoading("刪除中…");
        await api(`/items/${encodeURIComponent(id)}/draft`, { method: "DELETE" });
        await loadCore({ quiet: true });
        openNextCyclePlanner(draftSnapshot);
      } catch (e) {
        showAlert("刪除失敗", e.message || "草稿任務刪除失敗", "");
      } finally {
        hideLoading();
      }
    });
  });

  els.modalRoot.querySelectorAll("[data-next-cycle-draft-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextDraft = collectDraft();
      const index = Number(button.dataset.nextCycleDraftRemove);
      const task = nextDraft.pendingTasks[index];
      const ok = await showConfirm({
        icon: "",
        title: "確定刪除這件草稿任務嗎？",
        text: `「${task?.title || "這件任務"}」\n\n這件事還沒儲存，刪除後不會留下紀錄。`,
        confirmText: "刪除",
        cancelText: "取消",
        danger: true,
      });
      if (!ok) return openNextCyclePlanner(nextDraft);
      nextDraft.pendingTasks.splice(index, 1);
      openNextCyclePlanner(nextDraft);
    });
  });

  if (firstCat) {
    const cat = document.getElementById("nextCycleTaskCategory");
    const sub = document.getElementById("nextCycleTaskSubCategory");
    const subWrap = document.getElementById("nextCycleTaskSubWrap");
    const refreshSubs = () => {
      const subs = getSubcategories(cat.value);
      subWrap.hidden = !subs.length;
      sub.innerHTML = subs.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
    };
    cat.addEventListener("change", refreshSubs);
    refreshSubs();

    document.getElementById("nextCycleTaskAddBtn").onclick = () => {
      const taskTitle = document.getElementById("nextCycleTaskTitle").value.trim();
      if (!taskTitle) return;
      const nextDraft = collectDraft();
      nextDraft.pendingTasks.push({
        title: taskTitle,
        categoryId: cat.value,
        subCategoryId: subWrap.hidden ? "" : sub.value,
        difficulty: document.getElementById("nextCycleTaskDifficulty").value,
      });
      openNextCyclePlanner(nextDraft);
    };
  }

  document.getElementById("nextCyclePlannerSave").onclick = async () => {
    const error = document.getElementById("nextCyclePlannerError");
    error.hidden = true;
    const finalDraft = collectDraft();
    if (!finalDraft.startDate || !finalDraft.cycleTheme || !finalDraft.title || !finalDraft.achievement) {
      error.textContent = "開始日期、本輪主題、Week 1 主題與目標都要填";
      error.hidden = false;
      return;
    }
    if (finalDraft.startDate < minStart) {
      error.textContent = `開始日期要在目前 Cycle 結束後，也就是 ${formatDate(minStart)} 之後。`;
      error.hidden = false;
      return;
    }

    try {
      showLoading("儲存下一輪…");
      let targetCycleNumber = Number(existingCycle?.cycleNumber || 0);

      if (!existingCycle) {
        const created = await api("/cycles", {
          method: "POST",
          body: {
            startDate: finalDraft.startDate,
            theme: finalDraft.cycleTheme,
            title: finalDraft.title,
            achievement: finalDraft.achievement,
          },
        });
        targetCycleNumber = Number(created?.cycleNumber || cycleNumber);
      } else {
        if (finalDraft.startDate !== String(existingCycle.startDate || "").slice(0, 10)) {
          await api(`/cycles/${existingCycle.cycleNumber}/start-date`, {
            method: "PATCH",
            body: { startDate: finalDraft.startDate },
          });
        }
        if (finalDraft.cycleTheme !== String(existingCycle.theme || "").trim()) {
          await api(`/cycles/${existingCycle.cycleNumber}/theme`, {
            method: "PATCH",
            body: { theme: finalDraft.cycleTheme },
          });
        }
        if (!weekOne || finalDraft.title !== String(weekOne.title || "").trim() || finalDraft.achievement !== String(weekOne.achievement || "").trim()) {
          await api(`/weeks/${existingCycle.cycleNumber}/1/plan`, {
            method: "PATCH",
            body: { title: finalDraft.title, achievement: finalDraft.achievement },
          });
        }
      }

      for (const task of finalDraft.pendingTasks) {
        await api("/items", {
          method: "POST",
          body: {
            type: "task",
            title: task.title,
            categoryId: task.categoryId,
            subCategoryId: task.subCategoryId,
            difficulty: task.difficulty,
            scheduledCycleNumber: targetCycleNumber,
            scheduledWeekNumber: 1,
          },
        });
      }

      closeModal();
      await loadCore({ quiet: true });
      showAlert("下一輪已準備好", `Cycle ${targetCycleNumber} 會在 ${formatDate(finalDraft.startDate)} 開始。`, "");
    } catch (e) {
      error.textContent = e.message || "儲存下一輪失敗";
      error.hidden = false;
    } finally {
      hideLoading();
    }
  };
}

function openNextWeekPlanner(draft = null) {
  const next = state.context?.nextWeek;
  if (!next || !state.context?.canPlanNextWeek) return;

  const nextTasks = state.items.filter((item) =>
    item.type === "task" &&
    Number(item.scheduledCycleNumber || item.cycleNumber) === Number(next.cycleNumber) &&
    Number(item.scheduledWeekNumber || item.weekNumber) === Number(next.weekNumber) &&
    !["cancelled", "replanned"].includes(item.status)
  );

  const firstCat = getActiveCategories()[0];
  if (!firstCat) return showAlert("還沒有分類", "先到 Settings 加入一個分類。", "");

  const modal = `
    <div class="tp-modal-overlay tp-modal-open">
      <div class="tp-modal tp-modal-wide" role="dialog" aria-modal="true">
        
        <p class="tp-modal-body"><strong>Week ${next.weekNumber}</strong><br>
        <span style="color:var(--muted);font-size:12px;">${formatDate(next.weekStart)} ～ ${formatDate(next.weekEnd)}</span></p>

        <div class="v2-modal-form">
          <label class="v2-form-field">本週主題<input id="nextWeekTheme" maxlength="80" value="${escapeHtml(draft?.title ?? next.title ?? "")}" /></label>
          <label class="v2-form-field">本週目標<textarea id="nextWeekGoal" rows="3" maxlength="240">${escapeHtml(draft?.achievement ?? next.achievement ?? "")}</textarea></label>

          <div class="next-task-list">
            ${nextTasks.length ? nextTasks.map((item) => `
              <div class="next-task-row">
                <span>${escapeHtml(item.title)}</span>
                <button class="text-btn" type="button" data-next-task-edit="${escapeHtml(item.id)}">編輯</button>
              </div>`).join("") : `<div class="tp-modal-preformatted">目前還沒有先放進去的事情。</div>`}
          </div>

          <div class="v2-modal-grid">
            <label class="v2-form-field">想先加入的事情<input id="nextTaskTitle" maxlength="120" placeholder="可以先留白" /></label>
            <label class="v2-form-field">難度<select id="nextTaskDifficulty">${difficultyOptionsHtml("適中")}</select></label>
          </div>
          <div class="v2-modal-grid">
            <label class="v2-form-field">分類<select id="nextTaskCategory">${categoryOptionsHtml(firstCat.id)}</select></label>
            <label class="v2-form-field" id="nextTaskSubWrap">子分類<select id="nextTaskSubCategory"></select></label>
          </div>
          <button class="v2-soft-btn" id="nextTaskAddBtn" type="button">加入</button>
          <p class="v2-modal-error" id="nextPlannerError" hidden></p>
        </div>

        <div class="tp-modal-actions">
          <button class="tp-btn tp-btn-ghost" id="nextPlannerCancel" type="button">取消</button>
          <button class="tp-btn tp-btn-primary" id="nextPlannerSave" type="button">儲存安排</button>
        </div>
      </div>
    </div>`;

  els.modalRoot.innerHTML = modal;

  const cat = document.getElementById("nextTaskCategory");
  const sub = document.getElementById("nextTaskSubCategory");
  const subWrap = document.getElementById("nextTaskSubWrap");
  const refreshSubs = () => {
    const subs = getSubcategories(cat.value);
    subWrap.hidden = !subs.length;
    sub.innerHTML = subs.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("");
  };
  cat.addEventListener("change", refreshSubs);
  refreshSubs();

  els.modalRoot.querySelectorAll("[data-next-task-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.items.find((x) => x.id === button.dataset.nextTaskEdit);
      if (!item) return;
      closeModal();
      openEditTask(item);
    });
  });

  document.getElementById("nextPlannerCancel").onclick = closeModal;

  document.getElementById("nextTaskAddBtn").onclick = async () => {
    const error = document.getElementById("nextPlannerError");
    error.hidden = true;
    const title = document.getElementById("nextTaskTitle").value.trim();
    if (!title) return;

    try {
      showLoading("加入中…");
      await api("/items", {
        method: "POST",
        body: {
          type: "task",
          title,
          categoryId: cat.value,
          subCategoryId: subWrap.hidden ? "" : sub.value,
          difficulty: document.getElementById("nextTaskDifficulty").value,
          scheduledCycleNumber: next.cycleNumber,
          scheduledWeekNumber: next.weekNumber,
        },
      });
      const plannerDraft = {
        title: document.getElementById("nextWeekTheme")?.value.trim() || "",
        achievement: document.getElementById("nextWeekGoal")?.value.trim() || "",
      };
      await loadCore({ quiet: true });
      openNextWeekPlanner(plannerDraft);
    } catch (e) {
      error.textContent = e.message || "加入失敗";
      error.hidden = false;
    } finally {
      hideLoading();
    }
  };

  document.getElementById("nextPlannerSave").onclick = async () => {
    const error = document.getElementById("nextPlannerError");
    error.hidden = true;
    const title = document.getElementById("nextWeekTheme").value.trim();
    const achievement = document.getElementById("nextWeekGoal").value.trim();
    if (!title || !achievement) {
      error.textContent = "本週主題與目標都要填";
      error.hidden = false;
      return;
    }
    try {
      showLoading("儲存安排…");
      await api(`/weeks/${next.cycleNumber}/${next.weekNumber}/plan`, {
        method: "PATCH",
        body: { title, achievement },
      });
      closeModal();
      await loadCore({ quiet: true });
    } catch (e) {
      error.textContent = e.message || "儲存失敗";
      error.hidden = false;
    } finally {
      hideLoading();
    }
  };
}

function openWeeklyReview(cycleNumber, weekNumber, draft = null) {
  if (Number(cycleNumber) < 2) return;

  let retro = getSubmittedReview(cycleNumber, weekNumber);
  if (!retro && state.history) {
    const cycleWrap = state.history.find((c) => Number(c.cycle?.cycleNumber) === Number(cycleNumber));
    retro = cycleWrap?.weeks?.find((w) => Number(w.week?.weekNumber) === Number(weekNumber))?.retrospective || null;
    if (retro && !retro.submittedAt) retro = null;
  }

  if (retro?.submittedAt) {
    els.modalRoot.innerHTML = `
      <div class="tp-modal-overlay tp-modal-open">
        <div class="tp-modal tp-modal-wide" role="dialog" aria-modal="true">
          <div class="tp-modal-icon">✓</div>
          <p class="tp-modal-body"><strong>Weekly Review</strong><br><span style="color:var(--muted);font-size:12px;">Cycle ${cycleNumber} · Week ${weekNumber}</span></p>
          <div class="v2-modal-form">
            ${[
              ["1. 這週做得最好的地方是什麼？", retro.q1],
              ["2. 這週最大的卡點是什麼？", retro.q2],
              ["3. 有沒有低估工作量，或排得太大的任務？", retro.q3],
              ["4. 下週最需要調整什麼？", retro.q4],
            ].map(([q, a]) => `<div class="tp-modal-preformatted"><strong>${escapeHtml(q)}</strong><br>${escapeHtml(a || "—")}</div>`).join("")}
          </div>
          <div class="tp-modal-actions"><button class="tp-btn tp-btn-primary" id="reviewViewClose" type="button">關閉</button></div>
        </div>
      </div>`;
    document.getElementById("reviewViewClose").onclick = closeModal;
    return;
  }

  const values = draft || { q1: "", q2: "", q3: "", q4: "" };
  openFormModal({
    icon: "",
    title: `Weekly Review · Week ${weekNumber}`,
    confirmText: "送出",
    cancelText: "取消",
    wide: true,
    body: `
      <label class="v2-form-field">1. 這週做得最好的地方是什麼？<textarea id="retroQ1" rows="3">${escapeHtml(values.q1 || "")}</textarea></label>
      <label class="v2-form-field">2. 這週最大的卡點是什麼？<textarea id="retroQ2" rows="3">${escapeHtml(values.q2 || "")}</textarea></label>
      <label class="v2-form-field">3. 有沒有低估工作量，或排得太大的任務？<textarea id="retroQ3" rows="3">${escapeHtml(values.q3 || "")}</textarea></label>
      <label class="v2-form-field">4. 下週最需要調整什麼？<textarea id="retroQ4" rows="3">${escapeHtml(values.q4 || "")}</textarea></label>`,
    onConfirm: async () => {
      const answers = {
        q1: document.getElementById("retroQ1").value.trim(),
        q2: document.getElementById("retroQ2").value.trim(),
        q3: document.getElementById("retroQ3").value.trim(),
        q4: document.getElementById("retroQ4").value.trim(),
      };
      if (!answers.q1 || !answers.q2 || !answers.q3 || !answers.q4) {
        throw new Error("四個問題都寫完後再送出");
      }

      closeModal();
      const ok = await showConfirm({
        icon: "",
        title: "確定送出這週的 Review？",
        text: "送出後就不能再修改，可以先確認一下內容。",
        confirmText: "確定送出",
        cancelText: "取消",
      });

      if (!ok) {
        openWeeklyReview(cycleNumber, weekNumber, answers);
        return false;
      }

      showLoading("留下這週的回顧…");
      try {
        const submitted = await api("/retrospectives", {
          method: "POST",
          body: { cycleNumber, weekNumber, ...answers },
        });
        const normalized = submitted?.result || submitted;
        state.retrospectives = (state.retrospectives || []).filter((r) =>
          !(Number(r.cycleNumber) === Number(cycleNumber) && Number(r.weekNumber) === Number(weekNumber))
        );
        if (normalized) state.retrospectives.push(normalized);
        if (state.currentPage === "history") await loadHistory();
        else renderWeeklyReview();
        return true;
      } catch (error) {
        showAlert("送出失敗", error.message, "");
        return false;
      } finally {
        hideLoading();
      }
    },
  });
}

function bindGlobalEvents() {
  els.navButtons.forEach((button) => button.addEventListener("click", () => switchPage(button.dataset.page)));
  els.taskCategory.addEventListener("change", () => updateSubcategorySelect(els.taskSubCategory, els.taskCategory.value));
  els.addTaskForm.addEventListener("submit", addTask);
  els.toggleAddTaskBtn.addEventListener("click", () => {
    els.addTaskForm.hidden = !els.addTaskForm.hidden;
    els.toggleAddTaskBtn.textContent = els.addTaskForm.hidden ? "＋ 加入" : "收起";
    if (!els.addTaskForm.hidden) setTimeout(() => els.taskInput.focus(), 50);
  });
  els.weekSetupForm.addEventListener("submit", saveWeekSetup);
  els.editWeekPlanBtn.addEventListener("click", openWeekPlanEditor);
  els.editCycleThemeBtn.addEventListener("click", openCycleThemeEditor);
  els.postponeWeekBtn.addEventListener("click", openPostponeWeek);
  els.nextWeekPlanBtn.addEventListener("click", openPlanningEntry);
  els.weeklyReviewBtn.addEventListener("click", () => {
    const week = currentWeek();
    if (week) openWeeklyReview(week.cycleNumber, week.weekNumber);
  });
  els.showAllOverdueBtn.addEventListener("click", () => { state.showAllOverdue = !state.showAllOverdue; renderOverdue(); });
  els.showAllRescheduledBtn.addEventListener("click", () => { state.showAllRescheduled = !state.showAllRescheduled; renderRescheduled(); });
  els.refreshHistoryBtn.addEventListener("click", loadHistory);
  els.addCategoryBtn.addEventListener("click", () => openAddCategory("category", ""));
  els.toggleInactiveBtn.addEventListener("click", () => { state.showInactiveCategories = !state.showInactiveCategories; renderSettings(); });
  els.replayTourBtn.addEventListener("click", () => startTour(true));
  els.changeCycleStartBtn.addEventListener("click", () => openNextCyclePlanner());
  els.openReviewBtn.addEventListener("click", () => openReview(Number(state.context.completedCycleNumber), true));
  els.skipCelebrationBtn.addEventListener("click", closeCelebrationAndReview);
  els.closeSheetBtn.addEventListener("click", closeBottomSheet);
  els.bottomSheet.addEventListener("click", (event) => { if (event.target === els.bottomSheet) closeBottomSheet(); });
  els.tourSkipBtn.addEventListener("click", finishTour);
  els.tourNextBtn.addEventListener("click", () => {
    if (state.tourIndex >= TOUR_STEPS.length - 1) return finishTour();
    state.tourIndex += 1;
    renderTourStep();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".v2-task-menu") && !event.target.closest("[data-more-id]")) closeTaskMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeTaskMenu();
      closeBottomSheet();
      closeModal();
      if (!els.tourPopover.hidden) finishTour();
    }
  });
}

async function init() {
  cacheElements();
  bindGlobalEvents();
  await loadCore();
  if (!localStorage.getItem("tp-star-tour-seen")) setTimeout(() => startTour(false), 350);
}

init();
