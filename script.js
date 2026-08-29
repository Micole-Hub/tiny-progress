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
};

const DAILY_QUOTES = [
  "本局提醒：時間會往前，未完成的事情不會偷偷消失。",
  "一點進度，一點溫度；慢慢累積，也會有路。",
  "今天不必追趕誰，留下真實進度就很好。",
  "計畫可以調整，但不用把昨天改寫成滿分。",
  "本局備註：未完成不是失敗，它只是下一次判斷的資料。",
];

const RESCHEDULE_REASONS = [
  "低估工作量",
  "任務太大",
  "技術卡住",
  "優先順序改變",
  "個人狀態",
  "原計畫需要調整",
  "其他",
];

const CANCEL_REASONS = [
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

const CYCLE_DATE_REASONS = [
  "個人行程調整",
  "需要延長休息時間",
  "前一個 Cycle 收尾尚未完成",
  "學習／工作計畫改變",
  "外部因素影響",
  "其他",
];

const els = {};

function cacheElements() {
  [
    "homePage", "historyPage", "settingsPage", "heroTitle", "dailyQuote", "cycleWeekBadge",
    "weekStatusBadge", "weekRangeWrap", "weekStartText", "weekEndText", "activeWeekPanel",
    "weekThemeText", "weekGoalText", "workloadCount", "workloadFill", "workloadNote", "postponeWeekBtn",
    "weekSetupPanel", "weekSetupForm", "weekSetupTheme", "weekSetupGoal", "restPanel", "restMessage",
    "changeCycleStartBtn", "cycleCompletePanel", "cycleCompleteTitle", "openReviewBtn", "workArea",
    "currentTaskList", "currentTaskCount", "overdueCount", "overdueList", "showAllOverdueBtn",
    "rescheduledList", "showAllRescheduledBtn", "addTaskForm", "taskInput", "taskCategory",
    "taskSubCategory", "taskDifficulty", "addTaskBtn", "historyList", "refreshHistoryBtn",
    "categorySettingsList", "addCategoryBtn", "toggleInactiveBtn", "replayTourBtn", "loadingToast",
    "bottomSheet", "sheetTitle", "sheetActions", "closeSheetBtn", "cycleCelebration", "celebrationTitle",
    "skipCelebrationBtn", "tourPopover", "tourStepLabel", "tourTitle", "tourText", "tourSkipBtn",
    "tourNextBtn", "editWeekPlanBtn"
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
      api("/week-context"), api("/items"), api("/weeks"), api("/cycles"), api("/categories"),
    ]);
    state.context = context;
    state.items = Array.isArray(items) ? items : [];
    state.weeks = Array.isArray(weeks) ? weeks : [];
    state.cycles = Array.isArray(cycles) ? cycles : [];
    state.categories = Array.isArray(categories) ? categories : [];
    renderAll();
    maybeShowCycleCelebration();
  } catch (error) {
    console.error(error);
    showAlert("讀取資料失敗", error.message, "⚠️");
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

function getCategoryName(id, fallback = "未分類") {
  return state.categories.find((c) => c.id === id)?.name || fallback;
}

function statusIcon(item) {
  if (item.status === "completed") return "✅";
  if (item.status === "overdue") return "🕒";
  if (item.status === "replanned") return "♻️";
  if (item.status === "cancelled") return "🗑";
  return "☐";
}

function difficultyClass(value) {
  if (value === "困難") return "hard";
  if (value === "適中") return "medium";
  return "easy";
}

function currentWeek() {
  return state.context?.currentWeek || null;
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
  renderQuote();
  renderHome();
  renderCategorySelects();
  renderSettings();
  if (state.currentPage === "history" && state.history) renderHistory();
}

function renderQuote() {
  const index = Math.floor((Date.now() / 86400000)) % DAILY_QUOTES.length;
  els.dailyQuote.textContent = DAILY_QUOTES[index];
}

function renderHome() {
  const context = state.context || {};
  const week = context.currentWeek;

  els.activeWeekPanel.hidden = !week;
  els.workArea.hidden = !week;
  els.weekSetupPanel.hidden = true;
  els.restPanel.hidden = true;
  els.cycleCompletePanel.hidden = true;

  if (week) {
    els.heroTitle.textContent = "慢慢做，也要留下真的進度。";
    els.cycleWeekBadge.textContent = `Cycle ${week.cycleNumber} · Week ${week.weekNumber}`;
    els.weekStatusBadge.textContent = "進行中";
    els.weekStartText.textContent = formatDate(week.weekStart);
    els.weekEndText.textContent = formatDate(week.weekEnd);
    els.weekRangeWrap.hidden = false;
    els.weekThemeText.textContent = week.title || "尚未設定";
    els.weekGoalText.textContent = week.achievement || "尚未設定";
    els.postponeWeekBtn.disabled = week.postponed === true;
    els.postponeWeekBtn.textContent = week.postponed ? `本週已順延 ${week.postponeDays || 7} 天` : "特殊狀況：本週順延";

    const needsSetup = !String(week.title || "").trim() || !String(week.achievement || "").trim();
    els.weekSetupPanel.hidden = !needsSetup;
    els.workArea.hidden = needsSetup;
    if (needsSetup) {
      els.weekSetupTheme.value = week.title || "";
      els.weekSetupGoal.value = week.achievement || "";
    }

    renderWorkload();
    renderCurrentTasks();
    renderOverdue();
    renderRescheduled();
    return;
  }

  els.weekRangeWrap.hidden = true;
  els.cycleWeekBadge.textContent = context.restPeriod ? "Cycle 間休息" : "12 Week Cycle";
  els.weekStatusBadge.textContent = context.restPeriod ? "休息中" : "已結案";

  if (context.restPeriod && context.nextCycle) {
    els.heroTitle.textContent = "休息也是 Cycle 的一部分。";
    els.restPanel.hidden = false;
    els.restMessage.textContent = `下一個 Cycle ${context.nextCycle.cycleNumber} 將於 ${formatDate(context.nextCycle.startDate)} 開始。`;
    return;
  }

  if (context.cycleComplete && context.completedCycleNumber) {
    els.heroTitle.textContent = "這一輪，已經走完 12 週。";
    els.cycleCompletePanel.hidden = false;
    els.cycleCompleteTitle.textContent = `Cycle ${context.completedCycleNumber} 完成`;
  }
}

function renderWorkload() {
  const count = activeWorkloadItems().length;
  els.workloadCount.textContent = `${count} / ${WORKLOAD_RECOMMENDED}`;
  els.workloadFill.style.width = `${Math.min(100, (count / WORKLOAD_RECOMMENDED) * 100)}%`;
  const box = els.workloadCount.closest(".v2-load-box");
  box.classList.toggle("is-over", count > WORKLOAD_RECOMMENDED);
  els.workloadNote.textContent = count > WORKLOAD_RECOMMENDED
    ? `目前有 ${count} 件尚未結案。仍可新增，但先確認一下是不是排太滿。`
    : "本週、逾期與已排未來但未完成的任務都會算進來。";
}

function renderCurrentTasks() {
  const week = currentWeek();
  if (!week) return;
  const items = state.items
    .filter((item) => item.type === "task" && isSameWeek(item, week) && !["cancelled", "replanned"].includes(item.status))
    .sort((a, b) => Number(a.done) - Number(b.done) || String(a.createdAt).localeCompare(String(b.createdAt)));
  els.currentTaskCount.textContent = `${items.length} 件`;
  els.currentTaskList.innerHTML = items.length
    ? items.map((item) => `<li>${renderTaskCard(item, { list: "current" })}</li>`).join("")
    : `<li class="v2-empty">本週還沒有任務。先立一件小小的案，就能開始。</li>`;
  bindTaskCardEvents(els.currentTaskList);
}

function renderOverdue() {
  const all = state.items.filter((item) => item.type === "task" && item.status === "overdue");
  els.overdueCount.textContent = String(all.length);
  const visible = state.showAllOverdue ? all : all.slice(0, 3);
  els.overdueList.innerHTML = visible.length
    ? visible.map((item) => renderTaskCard(item, { compact: true, list: "overdue" })).join("")
    : `<div class="v2-empty">目前沒有尚未結案的舊任務。📎</div>`;
  els.showAllOverdueBtn.hidden = all.length <= 3;
  els.showAllOverdueBtn.textContent = state.showAllOverdue ? "收合" : `查看全部 ${all.length} 件`;
  bindTaskCardEvents(els.overdueList);
}

function renderRescheduled() {
  const week = currentWeek();
  const all = state.items.filter((item) =>
    item.type === "task" && item.status === "active" && isRescheduled(item) && !isSameWeek(item, week)
  );
  const visible = state.showAllRescheduled ? all : all.slice(0, 3);
  els.rescheduledList.innerHTML = visible.length
    ? visible.map((item) => renderTaskCard(item, { compact: true, list: "rescheduled" })).join("")
    : `<div class="v2-empty">目前沒有排到未來的舊任務。</div>`;
  els.showAllRescheduledBtn.hidden = all.length <= 3;
  els.showAllRescheduledBtn.textContent = state.showAllRescheduled ? "收合" : `查看全部 ${all.length} 件`;
  bindTaskCardEvents(els.rescheduledList);
}

function renderTaskCard(item, options = {}) {
  const compact = options.compact === true;
  const classes = ["v2-task-card"];
  if (item.status === "completed") classes.push("is-done");
  if (item.status === "overdue") classes.push("is-overdue");
  if (isRescheduled(item) && item.status !== "completed") classes.push("is-rescheduled");

  let route = "";
  if (options.list === "overdue") {
    route = `原定：Cycle ${item.originalCycleNumber} · Week ${item.originalWeekNumber}`;
  } else if (options.list === "rescheduled") {
    route = `原定：C${item.originalCycleNumber} W${item.originalWeekNumber} → 現在：C${item.scheduledCycleNumber} W${item.scheduledWeekNumber}`;
  }

  const meta = compact ? "" : `
    <div class="v2-task-meta">
      <span class="chip chip-category">${escapeHtml(item.category || "未分類")}</span>
      ${item.subCategory && item.subCategory !== "未分類" ? `<span class="chip chip-subcategory uncategorized">${escapeHtml(item.subCategory)}</span>` : ""}
      <span class="chip chip-difficulty ${difficultyClass(item.difficulty)}">${escapeHtml(item.difficulty)}</span>
    </div>`;

  const checkbox = item.status === "completed"
    ? `<input type="checkbox" checked disabled aria-label="已完成：${escapeHtml(item.title)}" />`
    : `<input type="checkbox" data-complete-id="${escapeHtml(item.id)}" aria-label="完成：${escapeHtml(item.title)}" />`;

  const primaryAction = options.list === "overdue"
    ? `<button class="v2-soft-btn" type="button" data-reschedule-id="${escapeHtml(item.id)}">重新排程</button>`
    : `<button class="v2-more-btn" type="button" data-more-id="${escapeHtml(item.id)}">更多</button>`;

  return `
    <article class="${classes.join(" ")}" data-task-id="${escapeHtml(item.id)}">
      ${checkbox}
      <div class="v2-task-main">
        <p class="v2-task-title">${escapeHtml(item.title)}</p>
        ${route ? `<p class="v2-task-route">${escapeHtml(route)}</p>` : ""}
        ${meta}
      </div>
      ${primaryAction}
    </article>`;
}

function bindTaskCardEvents(root) {
  root.querySelectorAll("[data-complete-id]").forEach((box) => {
    box.addEventListener("change", async () => {
      if (!box.checked) return;
      box.checked = false;
      const item = state.items.find((x) => x.id === box.dataset.completeId);
      if (item) await confirmComplete(item);
    });
  });
  root.querySelectorAll("[data-more-id]").forEach((button) => {
    button.addEventListener("click", (event) => openTaskActions(button.dataset.moreId, event.currentTarget));
  });
  root.querySelectorAll("[data-reschedule-id]").forEach((button) => {
    button.addEventListener("click", () => startRescheduleFlow(button.dataset.rescheduleId));
  });
}

function renderCategorySelects() {
  const active = getActiveCategories();
  if (!active.length) {
    els.taskCategory.innerHTML = `<option value="">請先到設定新增分類</option>`;
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
  if (!payload.categoryId) return showAlert("還缺一個分類", "請先到設定建立至少一個分類。", "📎");

  const workload = activeWorkloadItems().length;
  if (workload >= WORKLOAD_RECOMMENDED) {
    const ok = await showConfirm({
      icon: "📚",
      title: "目前待處理負荷比較高",
      text: `現在已有 ${workload} 件尚未結案。仍然可以新增，只是建議先確認一下工作量。`,
      confirmText: "仍要新增",
    });
    if (!ok) return;
  }

  showLoading("立案中…");
  try {
    await api("/items", { method: "POST", body: payload });
    els.taskInput.value = "";
    els.taskDifficulty.value = "適中";
    await loadCore({ quiet: true });
  } catch (error) {
    showAlert("新增失敗", error.message, "⚠️");
  } finally { hideLoading(); }
}

async function confirmComplete(item) {
  const ok = await showConfirm({
    icon: "✅",
    title: "確定完成這項任務？",
    text: `「${item.title}」\n\n完成後一般編輯會鎖定；如果真的是手滑，仍可用「誤操作更正」。`,
    confirmText: "確認完成",
  });
  if (!ok) return;
  showLoading("蓋完成章…");
  try {
    await api(`/items/${encodeURIComponent(item.id)}/complete`, { method: "POST", body: {} });
    await loadCore({ quiet: true });
  } catch (error) { showAlert("完成失敗", error.message, "⚠️"); }
  finally { hideLoading(); }
}

function getTaskActions(item) {
  if (item.status === "completed") {
    return [
      { key: "correct", label: "↩️ 誤操作更正" },
      { key: "history", label: "📚 查看紀錄" },
    ];
  }
  if (["cancelled", "replanned"].includes(item.status)) {
    return [{ key: "history", label: "📚 查看紀錄" }];
  }
  return [
    { key: "edit", label: "✏️ 編輯" },
    { key: "reschedule", label: "♻️ 重新排程" },
    { key: "history", label: "📚 查看紀錄" },
    { key: "cancel", label: "🗑 撤案", danger: true },
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
  if (action === "reschedule") return startRescheduleFlow(item.id);
  if (action === "history") return goToTaskHistory(item.id);
  if (action === "cancel") return openCancelTask(item);
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

function startRescheduleFlow(itemId) {
  const item = state.items.find((x) => x.id === itemId);
  if (!item) return;
  els.modalRoot.innerHTML = `
    <div class="tp-modal-overlay tp-modal-open">
      <div class="tp-modal tp-modal-wide" role="dialog" aria-modal="true">
        <div class="tp-modal-icon">♻️</div>
        <p class="tp-modal-body"><strong style="display:block;font-size:18px;margin-bottom:8px;">重新排程前先看一下</strong>
        這項任務沒有在原定時間完成。要先把它拆小重新規劃，還是直接往後排？</p>
        <div class="tp-modal-preformatted">${escapeHtml(item.title)}</div>
        <div class="tp-modal-actions">
          <button class="tp-btn tp-btn-ghost" id="rsCancel" type="button">取消</button>
          <button class="tp-btn tp-btn-seal" id="rsReplan" type="button">重新規劃</button>
          <button class="tp-btn tp-btn-primary" id="rsDirect" type="button">直接重新排程</button>
        </div>
      </div>
    </div>`;
  document.getElementById("rsCancel").onclick = closeModal;
  document.getElementById("rsReplan").onclick = () => { closeModal(); openReplanTask(item); };
  document.getElementById("rsDirect").onclick = () => { closeModal(); openDirectReschedule(item); };
}

function openDirectReschedule(item) {
  const availableWeeks = state.weeks.filter((week) => week.weekEnd && week.weekEnd >= todayYmd());
  if (!availableWeeks.length) return showAlert("還沒有可排的未來 Week", "如果要跨到下一個 Cycle，請先建立下一個 Cycle。", "📅");
  const weekOptions = availableWeeks.map((week) =>
    `<option value="${week.cycleNumber}|${week.weekNumber}">Cycle ${week.cycleNumber} · Week ${week.weekNumber}（${formatDate(week.weekStart)}～${formatDate(week.weekEnd)}）</option>`
  ).join("");
  openFormModal({
    icon: "📅", title: "直接重新排程", confirmText: "確認重新排程",
    body: `
      <label class="v2-form-field">重新排到<select id="rescheduleTarget">${weekOptions}</select></label>
      <label class="v2-form-field">原因<select id="rescheduleReason">${RESCHEDULE_REASONS.map((r) => `<option>${r}</option>`).join("")}</select></label>
      <label class="v2-form-field">補充說明（選填）<textarea id="rescheduleNote" rows="3"></textarea></label>`,
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
  if (!activeCats.length) return showAlert("還沒有分類", "先到設定建立分類，再拆分任務。", "📎");
  let rowCount = 0;
  openFormModal({
    icon: "🧩", title: "重新規劃任務", confirmText: "完成重新規劃", wide: true,
    body: `
      <div class="tp-modal-preformatted">原任務：${escapeHtml(item.title)}\n拆出的新任務會先放在目前 Week。</div>
      <div id="replanRows" class="v2-replan-rows"></div>
      <button class="v2-soft-btn" id="addReplanRowBtn" type="button">＋ 新增拆分任務</button>`,
    onReady: () => {
      const container = document.getElementById("replanRows");
      const addRow = () => {
        const index = rowCount++;
        const firstCat = activeCats[0];
        const wrapper = document.createElement("div");
        wrapper.className = "v2-replan-row";
        wrapper.dataset.index = index;
        wrapper.innerHTML = `
          <div class="v2-replan-row-head"><strong>新任務 ${index + 1}</strong>${index > 0 ? `<button type="button" class="text-btn danger" data-remove-row>移除</button>` : ""}</div>
          <label class="v2-form-field">任務名稱<input data-r-title maxlength="120" placeholder="把任務切小一點…" /></label>
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
      if (!tasks.length) throw new Error("至少要填一個拆分後的新任務");
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

function openCancelTask(item) {
  openFormModal({
    icon: "🗑", title: "撤案這項任務？", confirmText: "確認撤案", danger: true,
    body: `
      <div class="tp-modal-preformatted">${escapeHtml(item.title)}</div>
      <label class="v2-form-field">原因<select id="cancelReason">${CANCEL_REASONS.map((r) => `<option>${r}</option>`).join("")}</select></label>
      <label class="v2-form-field">補充說明（選填）<textarea id="cancelNote" rows="3"></textarea></label>`,
    onConfirm: async () => {
      await api(`/items/${encodeURIComponent(item.id)}/cancel`, {
        method: "POST",
        body: { reason: document.getElementById("cancelReason").value, note: document.getElementById("cancelNote").value.trim() },
      });
      await loadCore({ quiet: true });
    },
  });
}

async function correctCompletion(item) {
  const ok = await showConfirm({
    icon: "↩️", title: "這項任務其實尚未完成？",
    text: "系統會恢復成未完成，並在 History 留下一筆「誤操作更正」。",
    confirmText: "恢復未完成",
  });
  if (!ok) return;
  showLoading("更正中…");
  try {
    await api(`/items/${encodeURIComponent(item.id)}/correct-completion`, { method: "POST", body: {} });
    await loadCore({ quiet: true });
  } catch (error) { showAlert("更正失敗", error.message, "⚠️"); }
  finally { hideLoading(); }
}

function openWeekPlanEditor() {
  const week = currentWeek();
  if (!week) return;
  openFormModal({
    icon: "🎯", title: "調整本週方向", confirmText: "儲存",
    body: `
      <label class="v2-form-field">本週主題<input id="planTheme" value="${escapeHtml(week.title || "")}" maxlength="80" /></label>
      <label class="v2-form-field">本週目標<textarea id="planGoal" rows="4" maxlength="240">${escapeHtml(week.achievement || "")}</textarea></label>`,
    onConfirm: async () => {
      const title = document.getElementById("planTheme").value.trim();
      const achievement = document.getElementById("planGoal").value.trim();
      if (!title || !achievement) throw new Error("主題與目標都必填");
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
  showLoading("本週立案中…");
  try {
    await api("/weeks/current-plan", { method: "PATCH", body: { title, achievement } });
    await loadCore({ quiet: true });
  } catch (error) { showAlert("立案失敗", error.message, "⚠️"); }
  finally { hideLoading(); }
}

function openPostponeWeek() {
  const week = currentWeek();
  if (!week || week.postponed) return;
  openFormModal({
    icon: "📅", title: "特殊狀況：本週順延", confirmText: "確認順延",
    body: `
      <div class="tp-modal-preformatted">Cycle ${week.cycleNumber} · Week ${week.weekNumber}\n原定：${formatDate(week.weekStart)} ～ ${formatDate(week.weekEnd)}\n每週最多順延一次，最多 7 天。</div>
      <label class="v2-form-field">順延天數<select id="postponeDays">${[1,2,3,4,5,6,7].map((d) => `<option value="${d}" ${d === 7 ? "selected" : ""}>${d} 天</option>`).join("")}</select></label>
      <label class="v2-form-field">原因<select id="postponeReason">${POSTPONE_REASONS.map((r) => `<option>${r}</option>`).join("")}</select></label>
      <label class="v2-form-field">補充說明（選填）<textarea id="postponeNote" rows="3"></textarea></label>`,
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
  showLoading("翻閱 History…");
  try {
    state.history = await api("/history");
    renderHistory();
    if (state.historyFocusTaskId) {
      requestAnimationFrame(() => focusHistoryTask(state.historyFocusTaskId));
    }
  } catch (error) { showAlert("History 讀取失敗", error.message, "⚠️"); }
  finally { hideLoading(); }
}

function renderHistory() {
  const history = Array.isArray(state.history) ? state.history : [];
  if (!history.length) {
    els.historyList.innerHTML = `<div class="v2-empty">目前還沒有可顯示的 History。</div>`;
    return;
  }
  els.historyList.innerHTML = history.map((entry) => {
    const cycle = entry.cycle;
    const summary = entry.summary || {};
    const weeks = entry.weeks || [];
    return `
      <details class="v2-history-cycle" ${cycle.status === "active" ? "open" : ""}>
        <summary><strong>Cycle ${cycle.cycleNumber}</strong><span style="display:block;margin-top:5px;color:var(--muted);font-size:13px;">${escapeHtml(cycle.status || "")}</span></summary>
        <div class="v2-history-summary-grid">
          ${historyStat(summary.onTimeCompleted, "按期完成")}
          ${historyStat(summary.lateCompleted, "逾期後完成")}
          ${historyStat(summary.incomplete, "尚未結案")}
          ${historyStat(summary.replanned, "重新規劃")}
          ${historyStat(summary.cancelled, "撤案")}
        </div>
        <div class="v2-history-weeks">
          ${weeks.map((w) => renderHistoryWeek(w)).join("")}
        </div>
        ${cycle.status === "completed" ? `<div style="padding:0 19px 19px;"><button class="v2-soft-btn" type="button" data-review-cycle="${cycle.cycleNumber}">查看 12 Week Review</button></div>` : ""}
      </details>`;
  }).join("");

  els.historyList.querySelectorAll("[data-review-cycle]").forEach((button) => {
    button.addEventListener("click", () => openReview(Number(button.dataset.reviewCycle), false));
  });
  els.historyList.querySelectorAll("[data-retro-cycle]").forEach((button) => {
    button.addEventListener("click", () => openRetrospective(Number(button.dataset.retroCycle), Number(button.dataset.retroWeek)));
  });
}

function historyStat(value, label) {
  return `<div class="v2-history-stat"><strong>${Number(value || 0)}</strong><span>${label}</span></div>`;
}

function renderHistoryWeek(wrapper) {
  const week = wrapper.week;
  const retro = wrapper.retrospective;
  const tasks = wrapper.tasks || [];
  const retroLabel = retro ? "已完成" : "未完成";
  return `
    <details class="v2-history-week">
      <summary>Week ${week.weekNumber} · ${escapeHtml(week.title || "尚未設定主題")}</summary>
      <div class="v2-history-week-body">
        <div class="v2-history-week-meta">
          <span>📅 ${formatDate(week.weekStart)} ～ ${formatDate(week.weekEnd)}</span>
          <span>🎯 ${escapeHtml(week.achievement || "尚未設定目標")}</span>
          <span>💭 週復盤：<button class="v2-retro-button" type="button" data-retro-cycle="${week.cycleNumber}" data-retro-week="${week.weekNumber}">${retroLabel}</button></span>
        </div>
        ${tasks.length ? tasks.map((taskWrap) => renderHistoryTask(taskWrap)).join("") : `<div class="v2-empty">這週沒有任務。</div>`}
      </div>
    </details>`;
}

function renderHistoryTask(wrapper) {
  const item = wrapper.item;
  const events = wrapper.events || [];
  return `
    <details class="v2-history-task" id="history-task-${safeId(item.id)}">
      <summary><span>${statusIcon(item)} ${escapeHtml(item.title)}</span><span class="v2-mini-badge">${statusLabel(item.status)}</span></summary>
      <div class="v2-history-task-detail">
        <div class="v2-history-week-meta">
          <span>原定：Cycle ${item.originalCycleNumber} · Week ${item.originalWeekNumber}</span>
          ${isRescheduled(item) ? `<span>目前排程：Cycle ${item.scheduledCycleNumber} · Week ${item.scheduledWeekNumber}</span>` : ""}
        </div>
        <ul class="v2-event-list">
          ${events.length ? events.map((event) => `
            <li class="v2-event-item">
              <strong>${escapeHtml(event.summary || event.eventType)}</strong>
              <span>${formatDateTime(event.occurredAt)}${event.reason ? ` · 原因：${escapeHtml(event.reason)}` : ""}${event.note ? `<br>${escapeHtml(event.note)}` : ""}</span>
            </li>`).join("") : `<li class="v2-empty">目前沒有額外事件紀錄。</li>`}
        </ul>
      </div>
    </details>`;
}

function statusLabel(status) {
  return ({ active: "進行中", overdue: "尚未結案", completed: "已完成", replanned: "已重新規劃", cancelled: "已撤案" })[status] || status;
}

async function goToTaskHistory(itemId) {
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

function openRetrospective(cycleNumber, weekNumber) {
  const historyCycle = (state.history || []).find((c) => c.cycle?.cycleNumber === cycleNumber);
  const wrapper = historyCycle?.weeks?.find((w) => w.week?.weekNumber === weekNumber);
  const retro = wrapper?.retrospective || {};
  openFormModal({
    icon: "💭", title: `Cycle ${cycleNumber} · Week ${weekNumber} 週復盤`, confirmText: "儲存復盤", wide: true,
    body: `
      ${retro.createdAt ? `<p class="section-note">已儲存，可直接修改後再次儲存。</p>` : ""}
      <label class="v2-form-field">1. 這週做得最好的地方是什麼？<textarea id="retroQ1" rows="3">${escapeHtml(retro.q1 || "")}</textarea></label>
      <label class="v2-form-field">2. 這週最大的卡點是什麼？<textarea id="retroQ2" rows="3">${escapeHtml(retro.q2 || "")}</textarea></label>
      <label class="v2-form-field">3. 有沒有低估工作量，或排得太大的任務？<textarea id="retroQ3" rows="3">${escapeHtml(retro.q3 || "")}</textarea></label>
      <label class="v2-form-field">4. 下週最需要調整什麼？<textarea id="retroQ4" rows="3">${escapeHtml(retro.q4 || "")}</textarea></label>`,
    onConfirm: async () => {
      await api("/retrospectives", {
        method: "POST",
        body: {
          cycleNumber, weekNumber,
          q1: document.getElementById("retroQ1").value.trim(),
          q2: document.getElementById("retroQ2").value.trim(),
          q3: document.getElementById("retroQ3").value.trim(),
          q4: document.getElementById("retroQ4").value.trim(),
        },
      });
      await loadHistory();
    },
  });
}

async function openReview(cycleNumber, fromCompletion = false) {
  showLoading("整理 12 Week Review…");
  try {
    const review = await api(`/reviews/${cycleNumber}`);
    closeModal();
    const stat = (value, label) => `<div class="v2-review-stat"><strong>${value}</strong><span>${label}</span></div>`;
    const bars = (review.trend || []).map((point) => {
      const empty = point.rate === null;
      const height = empty ? 3 : Math.max(5, point.rate);
      return `<div class="v2-review-bar-col"><div class="v2-review-bar-wrap"><div class="v2-review-bar ${empty ? "is-empty" : ""}" style="height:${height}%"></div></div><b>${empty ? "—" : `${point.rate}%`}</b><small>W${point.weekNumber}</small></div>`;
    }).join("");

    els.modalRoot.innerHTML = `
      <div class="tp-modal-overlay tp-modal-open">
        <div class="tp-modal tp-modal-review" role="dialog" aria-modal="true">
          <div class="tp-modal-icon">📊</div>
          <p class="tp-modal-body"><strong style="display:block;font-size:20px;">Cycle ${cycleNumber} · 12 Week Review</strong></p>
          <div class="v2-review-grid">
            ${stat(review.totalTasks, "安排任務")}
            ${stat(review.onTimeCompleted, "按期完成")}
            ${stat(review.lateCompleted, "逾期後完成")}
            ${stat(review.incomplete, "尚未結案")}
            ${stat(review.replanned, "重新規劃")}
            ${stat(review.cancelled, "撤案")}
            ${stat(`${review.onTimeRate}%`, "按期完成率")}
            ${stat(review.postponedWeeks, "Week 順延")}
            ${stat(`${review.retrospectiveCount}/12`, "完成週復盤")}
          </div>
          <div class="v2-chart"><p class="v2-chart-title">Week 1～12 · 按期完成率</p><div class="v2-review-chart">${bars}</div></div>
          <div class="tp-modal-actions">
            <button class="tp-btn tp-btn-ghost" id="reviewCloseBtn" type="button">關閉</button>
            ${fromCompletion ? `<button class="tp-btn tp-btn-primary" id="reviewNextCycleBtn" type="button">建立下一個 Cycle</button>` : ""}
          </div>
        </div>
      </div>`;
    document.getElementById("reviewCloseBtn").onclick = closeModal;
    if (fromCompletion) document.getElementById("reviewNextCycleBtn").onclick = () => { closeModal(); openCreateCycle(); };
  } catch (error) { showAlert("Review 讀取失敗", error.message, "⚠️"); }
  finally { hideLoading(); }
}

function maybeShowCycleCelebration() {
  const context = state.context;
  if (!context?.cycleComplete || !context.completedCycleNumber) return;
  const key = `tp-v2-cycle-celebration-${context.completedCycleNumber}`;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, "1");
  els.celebrationTitle.textContent = `Cycle ${context.completedCycleNumber} 完成！`;
  els.cycleCelebration.hidden = false;
}

function closeCelebrationAndReview() {
  els.cycleCelebration.hidden = true;
  if (state.context?.completedCycleNumber) openReview(Number(state.context.completedCycleNumber), true);
}

function openCreateCycle() {
  const latest = state.cycles.length ? Math.max(...state.cycles.map((c) => Number(c.cycleNumber))) : 0;
  openFormModal({
    icon: "🌱", title: `建立 Cycle ${latest + 1}`, confirmText: "建立新 Cycle", wide: true,
    body: `
      <label class="v2-form-field">開始日期<input id="newCycleStart" type="date" min="${todayYmd()}" /></label>
      <label class="v2-form-field">Week 1 主題<input id="newCycleTheme" maxlength="80" /></label>
      <label class="v2-form-field">Week 1 目標<textarea id="newCycleGoal" rows="3" maxlength="240"></textarea></label>`,
    onConfirm: async () => {
      const startDate = document.getElementById("newCycleStart").value;
      const title = document.getElementById("newCycleTheme").value.trim();
      const achievement = document.getElementById("newCycleGoal").value.trim();
      if (!startDate || !title || !achievement) throw new Error("開始日期、主題與目標都必填");
      await api("/cycles", { method: "POST", body: { startDate, title, achievement } });
      await loadCore({ quiet: true });
    },
  });
}

function openChangeCycleStart() {
  const cycle = state.context?.nextCycle;
  if (!cycle) return;
  openFormModal({
    icon: "📅", title: `修改 Cycle ${cycle.cycleNumber} 開始日期`, confirmText: "確認修改",
    body: `
      <label class="v2-form-field">開始日期<input id="cycleStartDate" type="date" value="${escapeHtml(cycle.startDate || "")}" min="${todayYmd()}" /></label>
      <label class="v2-form-field">原因<select id="cycleStartReason">${CYCLE_DATE_REASONS.map((r) => `<option>${r}</option>`).join("")}</select></label>
      <label class="v2-form-field">補充說明（選填）<textarea id="cycleStartNote" rows="3"></textarea></label>`,
    onConfirm: async () => {
      await api(`/cycles/${cycle.cycleNumber}/start-date`, {
        method: "PATCH",
        body: {
          startDate: document.getElementById("cycleStartDate").value,
          reason: document.getElementById("cycleStartReason").value,
          note: document.getElementById("cycleStartNote").value.trim(),
        },
      });
      await loadCore({ quiet: true });
    },
  });
}

function renderSettings() {
  const categories = state.categories.filter((c) => c.type === "category");
  const active = categories.filter((c) => c.active);
  const inactive = categories.filter((c) => !c.active);
  const renderRow = (cat) => {
    const subs = getSubcategories(cat.id, true);
    const activeSubs = subs.filter((s) => s.active);
    const inactiveSubs = subs.filter((s) => !s.active);
    return `
      <article class="v2-setting-row">
        <div class="v2-setting-row-top">
          <div><strong>${escapeHtml(cat.name)}</strong>${!cat.active ? ` <span class="v2-category-state">已停用</span>` : ""}</div>
          <div class="v2-setting-actions">
            <button class="text-btn" type="button" data-rename-category="${cat.id}">改名</button>
            <button class="text-btn ${cat.active ? "danger" : ""}" type="button" data-toggle-category="${cat.id}">${cat.active ? "停用" : "重新啟用"}</button>
          </div>
        </div>
        <div class="v2-subcategory-list">
          ${activeSubs.map((sub) => `<span class="chip chip-subcategory uncategorized">${escapeHtml(sub.name)} <button class="v2-chip-btn" type="button" data-sub-menu="${sub.id}">⋯</button></span>`).join("")}
          ${cat.active ? `<button class="v2-link-btn" type="button" data-add-sub="${cat.id}">＋ 新增子分類</button>` : ""}
        </div>
        ${state.showInactiveCategories && inactiveSubs.length ? `<div class="v2-inactive-wrap">${inactiveSubs.map((sub) => `<button class="v2-soft-btn" type="button" data-reactivate-sub="${sub.id}">${escapeHtml(sub.name)} · 重新啟用</button>`).join(" ")}</div>` : ""}
      </article>`;
  };

  els.categorySettingsList.innerHTML = [
    ...active.map(renderRow),
    ...(state.showInactiveCategories ? inactive.map(renderRow) : []),
  ].join("") || `<div class="v2-empty">尚未建立分類。</div>`;
  els.toggleInactiveBtn.textContent = state.showInactiveCategories ? "隱藏已停用" : `顯示已停用${inactive.length ? ` ${inactive.length} 項` : ""}`;

  els.categorySettingsList.querySelectorAll("[data-add-sub]").forEach((b) => b.onclick = () => openAddCategory("subcategory", b.dataset.addSub));
  els.categorySettingsList.querySelectorAll("[data-rename-category]").forEach((b) => b.onclick = () => openRenameCategory(b.dataset.renameCategory));
  els.categorySettingsList.querySelectorAll("[data-toggle-category]").forEach((b) => b.onclick = () => toggleCategory(b.dataset.toggleCategory));
  els.categorySettingsList.querySelectorAll("[data-sub-menu]").forEach((b) => b.onclick = () => openSubcategoryActions(b.dataset.subMenu));
  els.categorySettingsList.querySelectorAll("[data-reactivate-sub]").forEach((b) => b.onclick = () => setCategoryActive(b.dataset.reactivateSub, true));
}

function openAddCategory(type = "category", parentId = "") {
  const label = type === "category" ? "分類" : "子分類";
  openFormModal({
    icon: "🗂️", title: `新增${label}`, confirmText: "新增",
    body: `<label class="v2-form-field">${label}名稱<input id="newCategoryName" maxlength="50" /></label>`,
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
  const ok = await showConfirm({ icon: "🗂️", title: `${action}「${cat.name}」？`, text: cat.active ? "停用後不會出現在新任務表單，但舊任務與 History 仍保留。" : "重新啟用後會再次出現在新任務表單。", confirmText: action });
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
      <div class="tp-modal-icon">📎</div><p class="tp-modal-body"><strong>${escapeHtml(sub.name)}</strong></p>
      <div class="tp-modal-actions">
        <button class="tp-btn tp-btn-ghost" id="subCancel" type="button">取消</button>
        <button class="tp-btn tp-btn-primary" id="subRename" type="button">改名</button>
        <button class="tp-btn tp-btn-danger" id="subToggle" type="button">${sub.active ? "停用" : "重新啟用"}</button>
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

function showAlert(title, text, icon = "📎") {
  els.modalRoot.innerHTML = `
    <div class="tp-modal-overlay tp-modal-open"><div class="tp-modal" role="dialog" aria-modal="true">
      <div class="tp-modal-icon">${icon}</div>
      <p class="tp-modal-body"><strong style="display:block;font-size:18px;margin-bottom:8px;">${escapeHtml(title)}</strong>${escapeHtml(text).replaceAll("\n", "<br>")}</p>
      <div class="tp-modal-actions"><button class="tp-btn tp-btn-primary" id="alertOk" type="button">知道了</button></div>
    </div></div>`;
  document.getElementById("alertOk").onclick = closeModal;
}

function showConfirm({ icon = "📎", title, text, confirmText = "確認", danger = false }) {
  return new Promise((resolve) => {
    els.modalRoot.innerHTML = `
      <div class="tp-modal-overlay tp-modal-open"><div class="tp-modal" role="dialog" aria-modal="true">
        <div class="tp-modal-icon">${icon}</div>
        <p class="tp-modal-body"><strong style="display:block;font-size:18px;margin-bottom:8px;">${escapeHtml(title)}</strong>${escapeHtml(text).replaceAll("\n", "<br>")}</p>
        <div class="tp-modal-actions">
          <button class="tp-btn tp-btn-ghost" id="confirmCancel" type="button">取消</button>
          <button class="tp-btn ${danger ? "tp-btn-danger" : "tp-btn-primary"}" id="confirmOk" type="button">${escapeHtml(confirmText)}</button>
        </div>
      </div></div>`;
    document.getElementById("confirmCancel").onclick = () => { closeModal(); resolve(false); };
    document.getElementById("confirmOk").onclick = () => { closeModal(); resolve(true); };
  });
}

function openFormModal({ icon = "📎", title, body, confirmText = "確認", danger = false, wide = false, onReady, onConfirm }) {
  els.modalRoot.innerHTML = `
    <div class="tp-modal-overlay tp-modal-open">
      <div class="tp-modal ${wide ? "tp-modal-wide" : ""}" role="dialog" aria-modal="true">
        <div class="tp-modal-icon">${icon}</div>
        <p class="tp-modal-body"><strong style="font-size:18px;">${escapeHtml(title)}</strong></p>
        <div class="v2-modal-form">${body}</div>
        <p class="v2-modal-error" id="formModalError" hidden></p>
        <div class="tp-modal-actions">
          <button class="tp-btn tp-btn-ghost" id="formCancel" type="button">取消</button>
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
      await onConfirm();
      closeModal();
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
  { page: "home", selector: "#tourCycle", title: "Cycle / Week", text: "每 12 週是一個 Cycle。日期到了會自動進下一週，未完成任務會留下來。" },
  { page: "home", selector: "#tourPlan", title: "本週主題與目標", text: "新 Week 先立案：寫下這週要往哪裡走。" },
  { page: "home", selector: "#tourTasks", title: "任務與逾期", text: "平常只要新增任務、完成打勾。沒完成會保留，不會偷偷搬走。" },
  { page: "history", selector: "#tourHistory", title: "History", text: "完成、逾期、重新排程、重新規劃、撤案等重要事件都放在這裡。" },
  { page: "settings", selector: "#tourSettings", title: "設定", text: "這裡只管理分類與重新觀看導覽，保持簡單。" },
];

async function startTour(force = false) {
  if (!force && localStorage.getItem("tp-v2-tour-seen")) return;
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
  localStorage.setItem("tp-v2-tour-seen", "1");
  switchPage("home");
}

function bindGlobalEvents() {
  els.navButtons.forEach((button) => button.addEventListener("click", () => switchPage(button.dataset.page)));
  els.taskCategory.addEventListener("change", () => updateSubcategorySelect(els.taskSubCategory, els.taskCategory.value));
  els.addTaskForm.addEventListener("submit", addTask);
  els.weekSetupForm.addEventListener("submit", saveWeekSetup);
  els.editWeekPlanBtn.addEventListener("click", openWeekPlanEditor);
  els.postponeWeekBtn.addEventListener("click", openPostponeWeek);
  els.showAllOverdueBtn.addEventListener("click", () => { state.showAllOverdue = !state.showAllOverdue; renderOverdue(); });
  els.showAllRescheduledBtn.addEventListener("click", () => { state.showAllRescheduled = !state.showAllRescheduled; renderRescheduled(); });
  els.refreshHistoryBtn.addEventListener("click", loadHistory);
  els.addCategoryBtn.addEventListener("click", () => openAddCategory("category", ""));
  els.toggleInactiveBtn.addEventListener("click", () => { state.showInactiveCategories = !state.showInactiveCategories; renderSettings(); });
  els.replayTourBtn.addEventListener("click", () => startTour(true));
  els.changeCycleStartBtn.addEventListener("click", openChangeCycleStart);
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
      closeTaskMenu(); closeBottomSheet(); closeModal();
      if (!els.tourPopover.hidden) finishTour();
    }
  });
}

async function init() {
  cacheElements();
  bindGlobalEvents();
  await loadCore();
  if (!localStorage.getItem("tp-v2-tour-seen")) setTimeout(() => startTour(false), 350);
}

init();
