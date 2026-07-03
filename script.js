// === 自訂對話框系統（取代原生 alert / confirm / prompt）===

function ensureModalRoot() {
  let root = document.getElementById("tp-modal-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "tp-modal-root";
    document.body.appendChild(root);
  }
  return root;
}

function closeModal(overlay) {
  overlay.classList.remove("tp-modal-open");
  overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
}

function showAlert(message, { type = "info" } = {}) {
  return new Promise((resolve) => {
    const root = ensureModalRoot();
    const iconMap = {
      info:    "📋",
      success: "✅",
      warning: "⚠️",
      danger:  "🚨",
    };
    const overlay = document.createElement("div");
    overlay.className = "tp-modal-overlay";
    overlay.innerHTML = `
      <div class="tp-modal tp-modal-alert" role="alertdialog" aria-modal="true">
        <div class="tp-modal-icon tp-modal-icon--${type}">${iconMap[type] || iconMap.info}</div>
        <p class="tp-modal-body">${message.replace(/\n/g, "<br>")}</p>
        <div class="tp-modal-actions">
          <button class="tp-btn tp-btn-primary" data-action="ok">確認</button>
        </div>
      </div>`;
    root.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("tp-modal-open"));
    overlay.querySelector("[data-action='ok']").addEventListener("click", () => {
      closeModal(overlay);
      resolve();
    });
    overlay.querySelector(".tp-btn-primary").focus();
  });
}

function showConfirm(
  message,
  {
    type = "warning",
    confirmText = "確認撤案",
    cancelText = "取消",
    confirmClass = "tp-btn-danger",
  } = {}
) {
  return new Promise((resolve) => {
    const root = ensureModalRoot();
    const iconMap = {
      info:    "📋",
      success: "✅",
      warning: "⚠️",
      danger:  "🚨",
    };
    const overlay = document.createElement("div");
    overlay.className = "tp-modal-overlay";
    overlay.innerHTML = `
      <div class="tp-modal tp-modal-confirm" role="alertdialog" aria-modal="true">
        <div class="tp-modal-icon tp-modal-icon--${type}">${iconMap[type] || iconMap.warning}</div>
        <p class="tp-modal-body">${message.replace(/\n/g, "<br>")}</p>
        <div class="tp-modal-actions">
          <button class="tp-btn tp-btn-ghost" data-action="cancel">${cancelText}</button>
          <button class="tp-btn ${confirmClass}" data-action="ok">${confirmText}</button>
        </div>
      </div>`;
    root.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("tp-modal-open"));
    overlay.querySelector("[data-action='ok']").addEventListener("click", () => {
      closeModal(overlay);
      resolve(true);
    });
    overlay.querySelector("[data-action='cancel']").addEventListener("click", () => {
      closeModal(overlay);
      resolve(false);
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) { closeModal(overlay); resolve(false); }
    });
    overlay.querySelector("[data-action='cancel']").focus();
  });
}

function showPrompt(message, defaultValue = "") {
  return new Promise((resolve) => {
    const root = ensureModalRoot();
    const overlay = document.createElement("div");
    overlay.className = "tp-modal-overlay";
    overlay.innerHTML = `
      <div class="tp-modal tp-modal-prompt" role="dialog" aria-modal="true">
        <div class="tp-modal-icon tp-modal-icon--info">📝</div>
        <p class="tp-modal-body">${message.replace(/\n/g, "<br>")}</p>
        <input class="tp-modal-input" type="text" value="${defaultValue}" />
        <div class="tp-modal-actions">
          <button class="tp-btn tp-btn-ghost" data-action="cancel">取消</button>
          <button class="tp-btn tp-btn-primary" data-action="ok">確認</button>
        </div>
      </div>`;
    root.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("tp-modal-open"));
    const input = overlay.querySelector(".tp-modal-input");
    const ok = overlay.querySelector("[data-action='ok']");
    const cancel = overlay.querySelector("[data-action='cancel']");
    const submit = () => { closeModal(overlay); resolve(input.value); };
    const dismiss = () => { closeModal(overlay); resolve(null); };
    ok.addEventListener("click", submit);
    cancel.addEventListener("click", dismiss);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") dismiss();
    });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) dismiss(); });
    input.focus();
    input.select();
  });
}

// 專門用於結案確認的 prompt（含多行說明 + 輸入框）
function showCompleteWeekPrompt(message) {
  return new Promise((resolve) => {
    const root = ensureModalRoot();
    const overlay = document.createElement("div");
    overlay.className = "tp-modal-overlay";
    overlay.innerHTML = `
      <div class="tp-modal tp-modal-complete" role="dialog" aria-modal="true">
        <div class="tp-modal-icon tp-modal-icon--warning">📦</div>
        <div class="tp-modal-body tp-modal-preformatted">${message.replace(/\n/g, "<br>")}</div>
        <input class="tp-modal-input" type="text" placeholder="請輸入：結案" />
        <div class="tp-modal-actions">
          <button class="tp-btn tp-btn-ghost" data-action="cancel">再考慮一下</button>
          <button class="tp-btn tp-btn-seal" data-action="ok">🔏 蓋章封存</button>
        </div>
      </div>`;
    root.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("tp-modal-open"));
    const input = overlay.querySelector(".tp-modal-input");
    const ok = overlay.querySelector("[data-action='ok']");
    const cancel = overlay.querySelector("[data-action='cancel']");
    const submit = () => { closeModal(overlay); resolve(input.value); };
    const dismiss = () => { closeModal(overlay); resolve(null); };
    ok.addEventListener("click", submit);
    cancel.addEventListener("click", dismiss);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") dismiss();
    });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) dismiss(); });
    input.focus();
  });
}

// === 全域 API 等待狀態 ===
let activeApiRequestCount = 0;
let disabledButtonsBeforeBusy = [];

function getRequestUrl(input) {
  return typeof input === "string" ? input : input && input.url;
}

function ensureLoadingToast() {
  let toast = document.querySelector(".loading-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "loading-toast";
    toast.setAttribute("aria-live", "polite");
    toast.textContent = "處理中...";
    document.body.appendChild(toast);
  }
  return toast;
}

function getLoadingText(method, url) {
  if (url && url.includes("/weeks/complete-current")) return "本局結案中...";
  if (url && url.includes("/weeks/postpone-current")) return "本週順延中...";
  if (method === "POST") return "本局立案中...";
  if (method === "PATCH") return "本局修訂中...";
  if (method === "DELETE") return "本局撤案中...";
  return "本局讀取資料中...";
}

function startApiLoading(message) {
  const isFirstRequest = activeApiRequestCount === 0;
  activeApiRequestCount += 1;
  const toast = ensureLoadingToast();
  toast.textContent = message;
  document.body.classList.add("is-busy");
  toast.classList.add("is-show");
  if (isFirstRequest) {
    disabledButtonsBeforeBusy = Array.from(document.querySelectorAll("button:disabled"));
    document.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  }
}

function stopApiLoading() {
  activeApiRequestCount -= 1;
  if (activeApiRequestCount > 0) return;
  activeApiRequestCount = 0;
  const toast = ensureLoadingToast();
  document.body.classList.remove("is-busy");
  toast.classList.remove("is-show");
  document.querySelectorAll("button").forEach((button) => {
    if (!disabledButtonsBeforeBusy.includes(button)) button.disabled = false;
  });
  disabledButtonsBeforeBusy = [];
}

function shouldTrackApiRequest(input) {
  const url = getRequestUrl(input);
  if (!url) return false;
  return url.includes("/items") ||
    url.includes("/week-context") ||
    url.includes("/weeks/complete-current") ||
    url.includes("/weeks/postpone-current");
}

const originalFetch = window.fetch.bind(window);
window.fetch = async function (input, options = {}) {
  const shouldTrack = shouldTrackApiRequest(input);
  const method = (options.method || "GET").toUpperCase();
  const url = getRequestUrl(input);
  if (!shouldTrack) return originalFetch(input, options);
  startApiLoading(getLoadingText(method, url));
  try {
    return await originalFetch(input, options);
  } finally {
    stopApiLoading();
  }
};

const API_BASE_URL = "https://no-effort-time-bureau.onrender.com";

const CATEGORY_OPTIONS = ["程式學習", "身心穩定", "興趣探索"];
const SUBCATEGORY_OPTIONS = ["觀看課程影片", "練習", "寫筆記", "W3Schools", "freeCodeCamp"];
const DIFFICULTY_OPTIONS = ["簡單", "適中", "困難"];

const DEFAULT_CATEGORY = "程式學習";
const DEFAULT_SUBCATEGORY = "觀看課程影片";
const EMPTY_SUBCATEGORY = "未分類";
const DEFAULT_DIFFICULTY = "簡單";

const DAILY_QUOTES = [
  "本局提醒：今日有學，即可立案；步子再小，也能靠岸。",
  "今日有光，心就不慌；學得再慢，也在路上。",
  "一點進度，一點溫度；慢慢累積，也會有路。",
  "本日案件不求滿分，有願意開始，就是啟程。",
  "學習不急著成篇，今天一點，也算向前。",
  "本局備註：不必逞強，穩穩前行，也會發光。",
  "今日有開張，心就有方向；一點點學，也值得收藏。",
  "不把自己送去審判，先把努力放進檔案。",
  "一小步也能立案，一小時也能靠岸。",
  "本局認定：願意練習，就是有效前進。",
  "今天不必追趕誰，照顧自己，也是在準備。",
  "學習不是急件，慢慢養成，也會成篇。",
  "今日有做，心就有火；今日有學，路就有光。",
  "不用十天走完十年，今日一點，也能向前。",
  "本局小章：你有學習，值得記上一筆。",
  "慢慢寫，慢慢懂，慢慢把自己接回手中。",
  "今日進度不問長短，有打開心門，就算靠岸。",
  "不急著變強，先不再受傷；穩穩學習，也會發光。",
  "本局收件：今天有學，就是好案件。",
  "一點點也有重量，慢慢來也有方向。",
];

let items = [];
let weekContext = { previousWeek: null, currentWeek: null, nextWeek: null, canPlanNextWeek: false };
let selectedWeekView = "current";

const taskList = document.querySelector("#taskList");
const standardList = document.querySelector("#standardList");
const progressTitle = document.querySelector("#progressTitle");
const progressNote = document.querySelector("#progressNote");
const taskProgressLabel = document.querySelector("#taskProgressLabel");
const standardProgressLabel = document.querySelector("#standardProgressLabel");
const taskProgress = document.querySelector("#taskProgress");
const standardProgress = document.querySelector("#standardProgress");
const taskProgressFill = document.querySelector("#taskProgressFill");
const standardProgressFill = document.querySelector("#standardProgressFill");
const taskSectionTitle = document.querySelector("#taskSectionTitle");
const taskSectionNote = document.querySelector("#taskSectionNote");
const standardSectionTitle = document.querySelector("#standardSectionTitle");
const standardSectionNote = document.querySelector("#standardSectionNote");
const taskInput = document.querySelector("#taskInput");
const taskCategory = document.querySelector("#taskCategory");
const taskSubCategory = document.querySelector("#taskSubCategory");
const taskDifficulty = document.querySelector("#taskDifficulty");
const addTaskBtn = document.querySelector("#addTaskBtn");
const standardInput = document.querySelector("#standardInput");
const addStandardBtn = document.querySelector("#addStandardBtn");
const refreshBtn = document.getElementById("refreshBtn");
const weekStartText = document.querySelector("#weekStartText");
const weekEndText = document.querySelector("#weekEndText");
const dailyQuote = document.querySelector("#dailyQuote");
const currentWeekNumber = document.querySelector("#currentWeekNumber");
const planStatusText = document.querySelector("#planStatusText");
const previousWeekTab = document.querySelector("#previousWeekTab");
const currentWeekTab = document.querySelector("#currentWeekTab");
const nextWeekTab = document.querySelector("#nextWeekTab");
const selectedWeekLabel = document.querySelector("#selectedWeekLabel");
const selectedWeekTitle = document.querySelector("#selectedWeekTitle");
const selectedWeekAchievement = document.querySelector("#selectedWeekAchievement");
const completeWeekBtn = document.querySelector("#completeWeekBtn");
const postponeWeekBtn = document.querySelector("#postponeWeekBtn");

function padNumber(number) { return String(number).padStart(2, "0"); }
function formatDateForDisplay(date) { return `${date.getFullYear()}/${padNumber(date.getMonth() + 1)}/${padNumber(date.getDate())}`; }
function formatDateForDatetime(date) { return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`; }
function getCurrentWeekRange(baseDate = new Date()) {
  const date = new Date(baseDate);
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { weekStart: monday, weekEnd: sunday };
}
function renderWeekRange() {
  if (!weekStartText || !weekEndText) return;
  const selectedWeek = getSelectedWeek();
  const displayWeek = selectedWeek || weekContext.currentWeek;
  if (displayWeek && displayWeek.weekStart && displayWeek.weekEnd) {
    weekStartText.textContent = displayWeek.weekStart.replaceAll("-", "/");
    weekStartText.setAttribute("datetime", displayWeek.weekStart);
    weekEndText.textContent = displayWeek.weekEnd.replaceAll("-", "/");
    weekEndText.setAttribute("datetime", displayWeek.weekEnd);
    return;
  }
  const range = getCurrentWeekRange();
  weekStartText.textContent = formatDateForDisplay(range.weekStart);
  weekStartText.setAttribute("datetime", formatDateForDatetime(range.weekStart));
  weekEndText.textContent = formatDateForDisplay(range.weekEnd);
  weekEndText.setAttribute("datetime", formatDateForDatetime(range.weekEnd));
}
function getDayOfYear(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / (1000 * 60 * 60 * 24));
}
function renderDailyQuote() {
  if (!dailyQuote) return;
  dailyQuote.textContent = `本日金句：${DAILY_QUOTES[getDayOfYear() % DAILY_QUOTES.length]}`;
}
function isSundayNoonOrLater(date = new Date()) { return date.getDay() === 0 && date.getHours() >= 12; }
function getSelectedWeek() {
  if (selectedWeekView === "previous") return weekContext.previousWeek;
  if (selectedWeekView === "next") return weekContext.nextWeek;
  return weekContext.currentWeek;
}
function getSelectedWeekNumber() { const selectedWeek = getSelectedWeek(); return selectedWeek && selectedWeek.weekNumber ? Number(selectedWeek.weekNumber) : null; }
function getSelectedWeekDisplayLabel() { if (selectedWeekView === "previous") return "已結案"; return selectedWeekView === "next" ? "下週" : "本週"; }
function getSelectedWeekLabelText() { if (selectedWeekView === "previous") return "已結案主題"; return selectedWeekView === "next" ? "下週主題" : "本週主題"; }
function getAchievementLabelText() { if (selectedWeekView === "previous") return "結案達成"; return selectedWeekView === "next" ? "下週達成" : "本週達成"; }
function isPreviousWeekView() { return selectedWeekView === "previous"; }
function isCurrentWeekView() { return selectedWeekView === "current"; }
function isNextWeekView() { return selectedWeekView === "next"; }
function canEditSelectedWeek() { return isCurrentWeekView() && !!getSelectedWeekNumber(); }
function canAddToSelectedWeek() {
  const selectedWeek = getSelectedWeek();
  if (!selectedWeek || !selectedWeek.weekNumber) return false;
  return isCurrentWeekView();
}
function canPostponeCurrentWeek() {
  return isCurrentWeekView() && !!weekContext.currentWeek;
}
function setWeekTabActiveState() {
  if (previousWeekTab) previousWeekTab.classList.toggle("is-active", selectedWeekView === "previous");
  if (currentWeekTab) currentWeekTab.classList.toggle("is-active", selectedWeekView === "current");
  if (nextWeekTab) nextWeekTab.classList.toggle("is-active", selectedWeekView === "next");
}
function renderPlanCard() {
  if (!currentWeekNumber || !planStatusText || !selectedWeekLabel || !selectedWeekTitle || !selectedWeekAchievement) return;
  const currentWeek = weekContext.currentWeek;
  const previousWeek = weekContext.previousWeek;
  const nextWeek = weekContext.nextWeek;
  const selectedWeek = getSelectedWeek();
  setWeekTabActiveState();
  if (!currentWeek) {
    currentWeekNumber.textContent = "-";
    planStatusText.textContent = "目前讀不到週次資料。";
    selectedWeekLabel.textContent = "週次主題";
    selectedWeekTitle.textContent = "尚無資料";
    selectedWeekAchievement.textContent = "請確認後端 /week-context 是否正常，以及 weeks 工作表是否有 status = current。";
    return;
  }
  currentWeekNumber.textContent = selectedWeek && selectedWeek.weekNumber ? String(selectedWeek.weekNumber) : String(currentWeek.weekNumber || "-");
  if (isPreviousWeekView()) {
    planStatusText.textContent = previousWeek ? `正在查看第 ${previousWeek.weekNumber} 週已結案紀錄；目前進行第 ${currentWeek.weekNumber} 週。` : "目前沒有已結案紀錄。完成一次結案後，這裡會顯示上一週檔案。";
  } else {
    planStatusText.textContent = nextWeek ? `目前第 ${currentWeek.weekNumber} 週，下週預告第 ${nextWeek.weekNumber} 週。` : `目前第 ${currentWeek.weekNumber} 週，尚未設定下週。`;
  }
  if (!selectedWeek) {
    selectedWeekLabel.textContent = getSelectedWeekLabelText();
    selectedWeekTitle.textContent = isPreviousWeekView() ? "尚無已結案紀錄" : "尚未設定下週";
    selectedWeekAchievement.textContent = isPreviousWeekView() ? "完成第一次結案後，這裡會保留上一週檔案。" : "請先在 weeks 工作表補上 status = next 的週次。";
    return;
  }
  selectedWeekLabel.textContent = getSelectedWeekLabelText();
  selectedWeekTitle.textContent = selectedWeek.title || "尚未填寫主題";
  const achievementBoxLabel = document.querySelector(".achievement-box span");
  if (achievementBoxLabel) achievementBoxLabel.textContent = getAchievementLabelText();
  selectedWeekAchievement.textContent = selectedWeek.achievement || "尚未填寫本週達成說明。";
}
function renderBoardLabels() {
  const label = getSelectedWeekDisplayLabel();
  if (progressTitle) progressTitle.textContent = `${label}進度`;
  if (taskProgressLabel) taskProgressLabel.textContent = `${label}任務`;
  if (standardProgressLabel) standardProgressLabel.textContent = `${label}驗收標準`;
  if (taskSectionTitle) taskSectionTitle.textContent = `${label}任務`;
  if (standardSectionTitle) standardSectionTitle.textContent = `${label}驗收標準`;
  if (isPreviousWeekView()) {
    if (progressNote) progressNote.textContent = "已結案週次只供查閱；任務與驗收標準都已封存。";
    if (taskSectionNote) taskSectionNote.textContent = "這是結案檔案櫃：可查看，不能新增、勾選、修訂或撤案。";
    if (standardSectionNote) standardSectionNote.textContent = "驗收標準已封存；如需調整，請回到目前本週重新立案。";
    return;
  }
  if (isNextWeekView()) {
    if (progressNote) progressNote.textContent = "下週目前只供預覽；本週結案後，才會正式開張。";
    if (taskSectionNote) taskSectionNote.textContent = "預覽下週任務內容；要新增請先完成本週結案。";
    if (standardSectionNote) standardSectionNote.textContent = "預覽下週驗收條件；結案後才能新增或修訂。";
    return;
  }
  if (progressNote) progressNote.textContent = "本局統計本週完成狀態；完成就打勾，結案後會封存。";
  if (taskSectionNote) taskSectionNote.textContent = "新增任務時，請寫清楚要做什麼，並選好分類與難度。";
  if (standardSectionNote) standardSectionNote.textContent = "驗收條件用來判斷任務是否完成，請寫成可檢查的一句話。";
}
function renderAddFormState() {
  const canAdd = canAddToSelectedWeek();
  [taskInput, taskCategory, taskSubCategory, taskDifficulty, addTaskBtn, standardInput, addStandardBtn].forEach((control) => {
    if (control) control.disabled = !canAdd;
  });
  if (completeWeekBtn) completeWeekBtn.disabled = !isCurrentWeekView() || !weekContext.nextWeek;
  if (postponeWeekBtn) postponeWeekBtn.disabled = !canPostponeCurrentWeek();
  renderSubCategoryControl();
  if (taskInput) taskInput.placeholder = isPreviousWeekView() ? "已結案週次僅供查看，不能新增任務" : isCurrentWeekView() ? "輸入任務，例如：練習 CSS Flex 排版" : "下週僅供預覽；本週結案後才可新增任務";
  if (standardInput) standardInput.placeholder = isPreviousWeekView() ? "已結案週次僅供查看，不能新增驗收條件" : isCurrentWeekView() ? "輸入驗收條件，例如：能說明 flex 排版怎麼運作" : "下週僅供預覽；本週結案後才可新增驗收條件";
}
function switchWeekView(view) { if (view !== "previous" && view !== "current" && view !== "next") return; selectedWeekView = view; renderAll(); }
function normalizeCategory(value) { const category = String(value || "").trim(); return CATEGORY_OPTIONS.includes(category) ? category : DEFAULT_CATEGORY; }
function normalizeSubCategory(value, category = DEFAULT_CATEGORY) {
  const normalizedCategory = normalizeCategory(category);
  if (normalizedCategory !== "程式學習") return EMPTY_SUBCATEGORY;
  const subCategory = String(value || "").trim();
  if (SUBCATEGORY_OPTIONS.includes(subCategory)) return subCategory;
  if (subCategory === EMPTY_SUBCATEGORY) return EMPTY_SUBCATEGORY;
  return EMPTY_SUBCATEGORY;
}
function normalizeDifficulty(value) { const difficulty = String(value || "").trim(); return DIFFICULTY_OPTIONS.includes(difficulty) ? difficulty : DEFAULT_DIFFICULTY; }
function normalizeDone(value) { return value === true || String(value).toUpperCase() === "TRUE"; }
function normalizeItem(item) {
  const category = normalizeCategory(item.category);
  return {
    ...item,
    category,
    subCategory: normalizeSubCategory(item.subCategory, category),
    difficulty: normalizeDifficulty(item.difficulty),
    done: normalizeDone(item.done),
    weekNumber: item.weekNumber === undefined || item.weekNumber === "" ? "" : Number(item.weekNumber),
  };
}
function getVisibleItems() { const selectedWeekNumber = getSelectedWeekNumber(); return selectedWeekNumber ? items.filter((item) => Number(item.weekNumber) === selectedWeekNumber) : []; }
function getVisibleItemsByType(type) { return getVisibleItems().filter((item) => item.type === type); }
function getSubCategorySortIndex(subCategory) {
  const index = SUBCATEGORY_OPTIONS.indexOf(subCategory);
  return index === -1 ? SUBCATEGORY_OPTIONS.length : index;
}
function getTasksSortedByCategory() {
  return [...getVisibleItemsByType("task")].sort((a, b) => {
    const categoryA = normalizeCategory(a.category);
    const categoryB = normalizeCategory(b.category);
    const categoryDiff = CATEGORY_OPTIONS.indexOf(categoryA) - CATEGORY_OPTIONS.indexOf(categoryB);
    if (categoryDiff !== 0) return categoryDiff;
    if (categoryA === "程式學習") return getSubCategorySortIndex(normalizeSubCategory(a.subCategory, categoryA)) - getSubCategorySortIndex(normalizeSubCategory(b.subCategory, categoryB));
    return 0;
  });
}
function findItemById(id) { return items.find((item) => item.id === id); }
function replaceItem(updatedItem) { const normalizedUpdatedItem = normalizeItem(updatedItem); items = items.map((item) => item.id === normalizedUpdatedItem.id ? normalizedUpdatedItem : item); }
function replaceItemById(targetId, newItem) { const normalizedNewItem = normalizeItem(newItem); items = items.map((item) => item.id === targetId ? normalizedNewItem : item); }
function createEmptyMessage(text) { const emptyItem = document.createElement("li"); emptyItem.className = "empty-message"; emptyItem.textContent = text; return emptyItem; }
function getCategoryClass(category) { if (category === "程式學習") return "programming"; if (category === "身心穩定") return "wellness"; if (category === "興趣探索") return "interest"; return ""; }
function getSubCategoryClass(subCategory) { if (subCategory === "觀看課程影片") return "video"; if (subCategory === "練習") return "practice"; if (subCategory === "寫筆記") return "note"; if (subCategory === "W3Schools") return "w3schools"; if (subCategory === "freeCodeCamp") return "freecodecamp"; return "uncategorized"; }
function createCategoryHeading(category) {
  const heading = document.createElement("li");
  const categoryClass = getCategoryClass(category);
  heading.className = categoryClass ? `category-heading ${categoryClass}` : "category-heading";
  heading.textContent = `【${category}】`;
  return heading;
}
function createSubCategoryHeading(subCategory) {
  const heading = document.createElement("li");
  heading.className = `subcategory-heading ${getSubCategoryClass(subCategory)}`;
  heading.textContent = `－ ${subCategory}`;
  return heading;
}
function getDifficultyClass(difficulty) { if (difficulty === "簡單") return "easy"; if (difficulty === "適中") return "medium"; if (difficulty === "困難") return "hard"; return ""; }
function getTaskEmptyMessage() {
  if (!getSelectedWeek()) return isPreviousWeekView() ? "目前沒有已結案任務檔案。" : "目前還沒有可顯示的週次資料。";
  if (isPreviousWeekView()) return "這週已結案，當時沒有任務紀錄。";
  return isNextWeekView() ? "下週目前沒有任務；結案後可在新的本週新增。" : "本週尚未立案。請先新增一個小任務。";
}
function getStandardEmptyMessage() {
  if (!getSelectedWeek()) return isPreviousWeekView() ? "目前沒有已結案驗收標準檔案。" : "目前還沒有可顯示的週次資料。";
  if (isPreviousWeekView()) return "這週已結案，當時沒有驗收標準紀錄。";
  return isNextWeekView() ? "下週目前沒有驗收條件；結案後可在新的本週新增。" : "本週尚未新增驗收條件。請寫下怎樣算完成。";
}
function createChip(text, className) { const chip = document.createElement("span"); chip.className = className; chip.textContent = text; return chip; }
function createCheckItem(item, displayNumber) {
  const normalizedItem = normalizeItem(item);
  const itemElement = document.createElement("li");
  itemElement.className = normalizedItem.done ? "task-item is-done" : "task-item";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = normalizedItem.done;
  checkbox.disabled = !canEditSelectedWeek();
  const content = document.createElement("div");
  content.className = "item-content";
  const topLine = document.createElement("div");
  topLine.className = "item-topline";
  const number = document.createElement("span");
  number.className = "item-number";
  number.textContent = displayNumber ? String(displayNumber) : "";
  const title = document.createElement("span");
  title.className = "item-title";
  title.textContent = normalizedItem.title;
  const meta = document.createElement("div");
  meta.className = "item-meta";
  if (normalizedItem.type === "task") {
    const categoryClass = getCategoryClass(normalizedItem.category);
    meta.appendChild(createChip(normalizedItem.category, categoryClass ? `chip chip-category ${categoryClass}` : "chip chip-category"));
    if (normalizedItem.category === "程式學習") {
      meta.appendChild(createChip(normalizedItem.subCategory, `chip chip-subcategory ${getSubCategoryClass(normalizedItem.subCategory)}`));
    }
    meta.appendChild(createChip(normalizedItem.difficulty, "chip chip-difficulty " + getDifficultyClass(normalizedItem.difficulty)));
  }
  topLine.appendChild(number);
  if (normalizedItem.type === "task") topLine.appendChild(meta);
  content.appendChild(topLine);
  content.appendChild(title);
  const actions = document.createElement("div");
  actions.className = "item-actions";
  const editBtn = document.createElement("button");
  editBtn.className = "text-btn";
  editBtn.type = "button";
  editBtn.textContent = "修訂";
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "text-btn danger";
  deleteBtn.type = "button";
  deleteBtn.textContent = "撤案";
  editBtn.disabled = !canEditSelectedWeek();
  deleteBtn.disabled = !canEditSelectedWeek();
  checkbox.addEventListener("change", async () => updateItem(normalizedItem.id, { done: checkbox.checked }));

  // ── 修訂（原 prompt）──
  editBtn.addEventListener("click", async () => {
    const newTitle = await showPrompt("請輸入修訂後內容", normalizedItem.title);
    if (newTitle === null) return;
    const trimmedTitle = newTitle.trim();
    if (trimmedTitle === "") {
      await showAlert("內容不可空白，本局未更動資料。", { type: "warning" });
      return;
    }
    await updateItem(normalizedItem.id, { title: trimmedTitle });
  });

  // ── 撤案（原 confirm）──
  deleteBtn.addEventListener("click", async () => {
    const message = normalizedItem.type === "task"
      ? `確定要撤案這項${getSelectedWeekDisplayLabel()}任務嗎？<br>刪除後會從案件板移除。`
      : `確定要撤案這項${getSelectedWeekDisplayLabel()}驗收標準嗎？<br>刪除後會從案件板移除。`;
    const confirmed = await showConfirm(message, {
      type: "danger",
      confirmText: "確認撤案",
      confirmClass: "tp-btn-danger",
    });
    if (!confirmed) return;
    await deleteItem(normalizedItem.id);
  });

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);
  itemElement.appendChild(checkbox);
  itemElement.appendChild(content);
  itemElement.appendChild(actions);
  return itemElement;
}
function renderTasks() {
  const tasks = getTasksSortedByCategory();
  taskList.innerHTML = "";
  if (tasks.length === 0) { taskList.appendChild(createEmptyMessage(getTaskEmptyMessage())); return; }
  let displayNumber = 1;
  CATEGORY_OPTIONS.forEach((category) => {
    const categoryTasks = tasks.filter((task) => normalizeCategory(task.category) === category);
    if (categoryTasks.length === 0) return;
    taskList.appendChild(createCategoryHeading(category));
    if (category === "程式學習") {
      const orderedSubCategories = [...SUBCATEGORY_OPTIONS, EMPTY_SUBCATEGORY];
      orderedSubCategories.forEach((subCategory) => {
        const groupTasks = categoryTasks.filter((task) => normalizeSubCategory(task.subCategory, category) === subCategory);
        if (groupTasks.length === 0) return;
        taskList.appendChild(createSubCategoryHeading(subCategory));
        groupTasks.forEach((task) => { taskList.appendChild(createCheckItem(task, displayNumber)); displayNumber += 1; });
      });
      return;
    }
    categoryTasks.forEach((task) => { taskList.appendChild(createCheckItem(task, displayNumber)); displayNumber += 1; });
  });
}
function renderStandards() {
  const standards = getVisibleItemsByType("standard");
  standardList.innerHTML = "";
  if (standards.length === 0) { standardList.appendChild(createEmptyMessage(getStandardEmptyMessage())); return; }
  standards.forEach((standard, index) => standardList.appendChild(createCheckItem(standard, index + 1)));
}
function getProgressPercent(doneCount, totalCount) { return totalCount ? Math.round((doneCount / totalCount) * 100) : 0; }
function updateProgressFill(fillElement, percent) { if (!fillElement) return; fillElement.style.width = `${percent}%`; fillElement.setAttribute("aria-valuenow", String(percent)); }
function renderProgress() {
  const tasks = getVisibleItemsByType("task");
  const standards = getVisibleItemsByType("standard");
  const doneTasks = tasks.filter((task) => task.done);
  const doneStandards = standards.filter((standard) => standard.done);
  if (taskProgress) taskProgress.textContent = `${doneTasks.length} / ${tasks.length}`;
  if (standardProgress) standardProgress.textContent = `${doneStandards.length} / ${standards.length}`;
  updateProgressFill(taskProgressFill, getProgressPercent(doneTasks.length, tasks.length));
  updateProgressFill(standardProgressFill, getProgressPercent(doneStandards.length, standards.length));
}
function renderSubCategoryControl() {
  if (!taskCategory || !taskSubCategory) return;
  const shouldShow = taskCategory.value === "程式學習";
  taskSubCategory.hidden = !shouldShow;
  taskSubCategory.disabled = !canAddToSelectedWeek() || !shouldShow;
}
function renderAll() { renderPlanCard(); renderBoardLabels(); renderAddFormState(); renderWeekRange(); renderTasks(); renderStandards(); renderProgress(); }
async function loadWeekContext() {
  try {
    const response = await fetch(`${API_BASE_URL}/week-context`);
    if (!response.ok) throw new Error("後端週次資料回應失敗");
    const data = await response.json();
    weekContext = {
      previousWeek: data.previousWeek || null,
      currentWeek: data.currentWeek || null,
      nextWeek: data.nextWeek || null,
      canPlanNextWeek: data.canPlanNextWeek === true,
    };
  } catch (error) {
    console.error("讀取週次資料失敗：", error);
    weekContext = { previousWeek: null, currentWeek: null, nextWeek: null, canPlanNextWeek: false };
  }
}
async function loadItems() {
  try {
    const response = await fetch(`${API_BASE_URL}/items`);
    if (!response.ok) throw new Error("後端回應失敗");
    const data = await response.json();
    items = data.map(normalizeItem);
  } catch (error) {
    console.error("讀取任務資料失敗：", error);
    // ── 原 alert ──
    await showAlert("本局暫時讀不到案件板，資料未更動。\n請稍後再重新整理。", { type: "warning" });
    items = [];
  }
}
async function refreshItems() {
  if (!refreshBtn) { await Promise.all([loadWeekContext(), loadItems()]); renderAll(); return; }
  try {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "案件板整理中...";
    await Promise.all([loadWeekContext(), loadItems()]);
    renderAll();
    refreshBtn.textContent = "重新整理案件板";
  } catch (error) {
    console.error("重新整理資料失敗：", error);
    // ── 原 alert ──
    await showAlert("重新整理資料失敗，請稍後再試。", { type: "danger" });
    refreshBtn.textContent = "重新整理案件板";
  } finally {
    refreshBtn.disabled = false;
  }
}
async function addItem(type, inputElement, options = {}) {
  if (!canAddToSelectedWeek()) {
    // ── 原 alert ──
    await showAlert(
      isNextWeekView()
        ? "下週目前只供預覽；\n按本週結案後，才會成為新的本週。"
        : "目前沒有可新增的週次資料。",
      { type: "info" }
    );
    return;
  }
  const title = inputElement.value.trim();
  if (title === "") return;
  const now = new Date().toISOString();
  const category = normalizeCategory(options.category);
  const subCategory = normalizeSubCategory(options.subCategory, category);
  const difficulty = normalizeDifficulty(options.difficulty);
  const targetWeekNumber = getSelectedWeekNumber();
  const tempItem = { id: "temp-" + Date.now(), type, title, category, subCategory, difficulty, done: false, weekNumber: targetWeekNumber, weekStart: "", weekEnd: "", createdAt: now, updatedAt: now };
  items.push(tempItem);
  inputElement.value = "";
  renderAll();
  try {
    const response = await fetch(`${API_BASE_URL}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, title, category, subCategory, difficulty, weekNumber: targetWeekNumber }),
    });
    if (!response.ok) throw new Error("新增失敗");
    const newItem = await response.json();
    replaceItemById(tempItem.id, newItem);
    renderAll();
  } catch (error) {
    console.error("新增資料失敗：", error);
    items = items.filter((item) => item.id !== tempItem.id);
    inputElement.value = title;
    renderAll();
    // ── 原 alert ──
    await showAlert("新增失敗，畫面已恢復；請確認後端是否正常。", { type: "danger" });
  }
}
async function updateItem(id, updates) {
  const previousItem = findItemById(id);
  if (!previousItem) return;
  const optimisticItem = normalizeItem({ ...previousItem, ...updates, updatedAt: new Date().toISOString() });
  replaceItem(optimisticItem);
  renderAll();
  try {
    const response = await fetch(`${API_BASE_URL}/items/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
    if (!response.ok) throw new Error("更新失敗");
    const updatedItem = await response.json();
    replaceItem(updatedItem);
    renderAll();
  } catch (error) {
    console.error("更新資料失敗：", error);
    replaceItem(previousItem);
    renderAll();
    // ── 原 alert ──
    await showAlert("本局暫時無法修訂，畫面已恢復，資料未更動。\n請稍後再試。", { type: "danger" });
  }
}
async function deleteItem(id) {
  const previousItems = [...items];
  if (!findItemById(id)) return;
  items = items.filter((item) => item.id !== id);
  renderAll();
  try {
    const response = await fetch(`${API_BASE_URL}/items/${id}`, { method: "DELETE" });
    if (!response.ok) throw new Error("刪除失敗");
  } catch (error) {
    console.error("刪除資料失敗：", error);
    items = previousItems;
    renderAll();
    // ── 原 alert ──
    await showAlert("本局暫時無法撤案，案件已放回原位，資料未更動。\n請稍後再試。", { type: "danger" });
  }
}
function buildCompleteWeekConfirmText(currentWeek, nextWeek) {
  const currentWeekNumberValue = Number(currentWeek.weekNumber);
  const nextWeekNumberValue = Number(nextWeek.weekNumber);
  const upcomingWeekNumber = nextWeekNumberValue + 1;

  const lines = [
    "📦 本週結案確認",
    "",
    `第 ${currentWeekNumberValue} 週　→　封存為「已結案」`,
    `第 ${nextWeekNumberValue} 週　→　接手為「新的本週」`,
    upcomingWeekNumber <= 12
      ? `第 ${upcomingWeekNumber} 週　→　成為「新的下週預告」`
      : "目前已接近最後一週，可能沒有新的下週預告。",
    "",
    "結案後：",
    "• 已結案週次只能查看，不能新增或修改。",
    "• 新的本週可以立刻新增任務與驗收條件。",
    "",
    "若確認要蓋章封存，請在下方輸入：結案",
  ];

  return lines.join("\n");
}
function buildPostponeWeekConfirmText(currentWeek) {
  const weekNumber = currentWeek && currentWeek.weekNumber ? Number(currentWeek.weekNumber) : "目前";
  const title = currentWeek && currentWeek.title ? `「${currentWeek.title}」` : "本週";

  return [
    "要把本週和後面的週次往後順延一週嗎？",
    "任務、驗收標準和完成狀態都會保留。",
    "",
    `本次會從第 ${weekNumber} 週 ${title} 開始順延。`,
  ].join("\n");
}
async function completeCurrentWeek() {
  const currentWeek = weekContext.currentWeek;
  const nextWeek = weekContext.nextWeek;
  if (!currentWeek) {
    await showAlert("目前讀不到本週資料，暫時無法結案。", { type: "warning" });
    return;
  }
  if (!nextWeek) {
    await showAlert("目前尚未設定下週，暫時無法進入下一週。", { type: "warning" });
    return;
  }

  // ── 原 prompt（結案專用）──
  const confirmationText = await showCompleteWeekPrompt(buildCompleteWeekConfirmText(currentWeek, nextWeek));

  if (confirmationText === null) return;

  if (confirmationText.trim() !== "結案") {
    await showAlert("未輸入「結案」，本局未更動週次。", { type: "info" });
    return;
  }
  try {
    const response = await fetch(`${API_BASE_URL}/weeks/complete-current`, { method: "POST" });
    if (!response.ok) throw new Error("本週結案失敗");
    const data = await response.json();
    selectedWeekView = "previous";
    await Promise.all([loadWeekContext(), loadItems()]);
    renderAll();
    // ── 原 alert（結案成功）──
    await showAlert(
      `第 ${data.completedWeek.weekNumber} 週已結案並封存。\n現在第 ${data.currentWeek.weekNumber} 週已開張。\n\n畫面已切到「已結案」，你可以切回「本週」新增資料。`,
      { type: "success" }
    );
  } catch (error) {
    console.error("本週結案失敗：", error);
    await showAlert("本局暫時無法結案，週次未更動。\n請稍後再試。", { type: "danger" });
  }
}
async function postponeCurrentWeek() {
  const currentWeek = weekContext.currentWeek;
  if (!currentWeek) {
    await showAlert("目前讀不到本週資料，暫時無法順延。", { type: "warning" });
    return;
  }
  if (!isCurrentWeekView()) {
    await showAlert("請先切回「本週」，再執行本週順延。", { type: "info" });
    return;
  }

  const confirmed = await showConfirm(buildPostponeWeekConfirmText(currentWeek), {
    type: "warning",
    confirmText: "確認順延",
    confirmClass: "tp-btn-seal",
    cancelText: "先不要",
  });

  if (!confirmed) return;

  try {
    const response = await fetch(`${API_BASE_URL}/weeks/postpone-current`, { method: "POST" });
    if (!response.ok) throw new Error("本週順延失敗");

    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }

    selectedWeekView = "current";
    await Promise.all([loadWeekContext(), loadItems()]);
    renderAll();

    const result = data && (data.result || data);
    const affectedWeeksCount = result && result.affectedWeeksCount !== undefined ? Number(result.affectedWeeksCount) : null;
    const affectedItemsCount = result && result.affectedItemsCount !== undefined ? Number(result.affectedItemsCount) : null;
    const countText = Number.isFinite(affectedWeeksCount) || Number.isFinite(affectedItemsCount)
      ? `\n\n已更新週次：${Number.isFinite(affectedWeeksCount) ? affectedWeeksCount : "-"} 筆\n已更新任務 / 驗收標準：${Number.isFinite(affectedItemsCount) ? affectedItemsCount : "-"} 筆`
      : "";

    await showAlert(
      `本週和後面的週次已順延一週。\n任務、驗收標準和完成狀態都已保留。${countText}`,
      { type: "success" }
    );
  } catch (error) {
    console.error("本週順延失敗：", error);
    await showAlert(
      "本局暫時無法順延，週次未更動。\n請確認後端是否已支援 /weeks/postpone-current。",
      { type: "danger" }
    );
  }
}
function addTask() { addItem("task", taskInput, { category: taskCategory.value, subCategory: taskSubCategory ? taskSubCategory.value : DEFAULT_SUBCATEGORY, difficulty: taskDifficulty.value }); }
function addStandard() { addItem("standard", standardInput, { category: DEFAULT_CATEGORY, subCategory: EMPTY_SUBCATEGORY, difficulty: DEFAULT_DIFFICULTY }); }
async function initApp() {
  renderWeekRange();
  renderDailyQuote();
  renderPlanCard();
  renderBoardLabels();
  renderAddFormState();
  addTaskBtn.addEventListener("click", addTask);
  addStandardBtn.addEventListener("click", addStandard);
  if (taskCategory) taskCategory.addEventListener("change", renderSubCategoryControl);
  if (refreshBtn) refreshBtn.addEventListener("click", refreshItems);
  if (previousWeekTab) previousWeekTab.addEventListener("click", () => switchWeekView("previous"));
  if (currentWeekTab) currentWeekTab.addEventListener("click", () => switchWeekView("current"));
  if (nextWeekTab) nextWeekTab.addEventListener("click", () => switchWeekView("next"));
  if (completeWeekBtn) completeWeekBtn.addEventListener("click", completeCurrentWeek);
  if (postponeWeekBtn) postponeWeekBtn.addEventListener("click", postponeCurrentWeek);
  taskInput.addEventListener("keydown", (event) => { if (event.key === "Enter") addTask(); });
  standardInput.addEventListener("keydown", (event) => { if (event.key === "Enter") addStandard(); });
  await Promise.all([loadWeekContext(), loadItems()]);
  renderAll();
}
initApp();
