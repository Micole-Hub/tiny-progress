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
  return url.includes("/items") || url.includes("/week-context") || url.includes("/weeks/complete-current");
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
const SUBCATEGORY_OPTIONS = ["觀看課程影片", "練習", "寫筆記"];
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
let weekContext = { currentWeek: null, nextWeek: null };
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
const currentWeekTab = document.querySelector("#currentWeekTab");
const nextWeekTab = document.querySelector("#nextWeekTab");
const selectedWeekLabel = document.querySelector("#selectedWeekLabel");
const selectedWeekTitle = document.querySelector("#selectedWeekTitle");
const selectedWeekAchievement = document.querySelector("#selectedWeekAchievement");
const completeWeekBtn = document.querySelector("#completeWeekBtn");

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
  const currentWeek = weekContext.currentWeek;
  if (currentWeek && currentWeek.weekStart && currentWeek.weekEnd) {
    weekStartText.textContent = currentWeek.weekStart.replaceAll("-", "/");
    weekStartText.setAttribute("datetime", currentWeek.weekStart);
    weekEndText.textContent = currentWeek.weekEnd.replaceAll("-", "/");
    weekEndText.setAttribute("datetime", currentWeek.weekEnd);
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
function getSelectedWeek() { return selectedWeekView === "next" ? weekContext.nextWeek : weekContext.currentWeek; }
function getSelectedWeekNumber() { const selectedWeek = getSelectedWeek(); return selectedWeek && selectedWeek.weekNumber ? Number(selectedWeek.weekNumber) : null; }
function getSelectedWeekDisplayLabel() { return selectedWeekView === "next" ? "下週" : "本週"; }
function getSelectedWeekLabelText() { return selectedWeekView === "next" ? "下週主題" : "本週主題"; }
function getAchievementLabelText() { return selectedWeekView === "next" ? "下週達成" : "本週達成"; }
function isCurrentWeekView() { return selectedWeekView === "current"; }
function isNextWeekView() { return selectedWeekView === "next"; }
function canAddToSelectedWeek() {
  const selectedWeek = getSelectedWeek();
  if (!selectedWeek || !selectedWeek.weekNumber) return false;
  if (isCurrentWeekView()) return true;
  if (isNextWeekView()) return isSundayNoonOrLater();
  return false;
}
function setWeekTabActiveState() {
  if (!currentWeekTab || !nextWeekTab) return;
  currentWeekTab.classList.toggle("is-active", selectedWeekView === "current");
  nextWeekTab.classList.toggle("is-active", selectedWeekView === "next");
}
function renderPlanCard() {
  if (!currentWeekNumber || !planStatusText || !selectedWeekLabel || !selectedWeekTitle || !selectedWeekAchievement) return;
  const currentWeek = weekContext.currentWeek;
  const nextWeek = weekContext.nextWeek;
  const selectedWeek = getSelectedWeek();
  setWeekTabActiveState();
  if (!currentWeek) {
    currentWeekNumber.textContent = "-";
    planStatusText.textContent = "目前讀不到週次資料。";
    selectedWeekLabel.textContent = "週次主題";
    selectedWeekTitle.textContent = "尚無資料";
    selectedWeekAchievement.textContent = "請確認後端 /week-context 是否正常，以及 weeks 工作表是否有 current。";
    return;
  }
  currentWeekNumber.textContent = String(currentWeek.weekNumber || "-");
  planStatusText.textContent = nextWeek ? `目前第 ${currentWeek.weekNumber} 週，下週預告第 ${nextWeek.weekNumber} 週。` : `目前第 ${currentWeek.weekNumber} 週，尚未設定下週。`;
  if (!selectedWeek) {
    selectedWeekLabel.textContent = "下週主題";
    selectedWeekTitle.textContent = "尚未設定下週";
    selectedWeekAchievement.textContent = "可以先在 weeks 工作表補上 status = next 的週次。";
    return;
  }
  selectedWeekLabel.textContent = getSelectedWeekLabelText();
  selectedWeekTitle.textContent = selectedWeek.title || "尚未填寫主題";
  const achievementBoxLabel = document.querySelector(".achievement-box span");
  if (achievementBoxLabel) achievementBoxLabel.textContent = getAchievementLabelText();
  selectedWeekAchievement.textContent = selectedWeek.achievement || "尚未填寫本週達成。";
}
function renderBoardLabels() {
  const label = getSelectedWeekDisplayLabel();
  if (progressTitle) progressTitle.textContent = `${label}進度`;
  if (taskProgressLabel) taskProgressLabel.textContent = `${label}任務`;
  if (standardProgressLabel) standardProgressLabel.textContent = `${label}驗收標準`;
  if (taskSectionTitle) taskSectionTitle.textContent = `${label}任務`;
  if (standardSectionTitle) standardSectionTitle.textContent = `${label}驗收標準`;
  if (isNextWeekView()) {
    const nextWeekCanAdd = canAddToSelectedWeek();
    if (progressNote) progressNote.textContent = nextWeekCanAdd ? "下週已開放預先立案，先替未來鋪一小段路。" : "下週先預覽，不急著提前開張。";
    if (taskSectionNote) taskSectionNote.textContent = nextWeekCanAdd ? "週日中午已過，可以先把下週任務安靜放進資料夾。" : "這裡先預覽下週案件，週日中午 12 點後開放新增。";
    if (standardSectionNote) standardSectionNote.textContent = nextWeekCanAdd ? "可以先替下週寫下驗收方向，但正式開工仍待本週結案。" : "下週目前僅供預覽，週日中午 12 點後可先立案。";
    return;
  }
  if (progressNote) progressNote.textContent = "本局只記本週靠近了哪裡，不翻舊帳。";
  if (taskSectionNote) taskSectionNote.textContent = "本局會依分類排好，陪你一件一件辦。";
  if (standardSectionNote) standardSectionNote.textContent = "這不是拿來責備自己，而是看見本週靠近了哪裡。";
}
function renderAddFormState() {
  const canAdd = canAddToSelectedWeek();
  [taskInput, taskCategory, taskSubCategory, taskDifficulty, addTaskBtn, standardInput, addStandardBtn].forEach((control) => {
    if (control) control.disabled = !canAdd;
  });
  renderSubCategoryControl();
  if (taskInput) taskInput.placeholder = isCurrentWeekView() ? "立一個小案件，例如：練習 CSS Flex" : canAdd ? "先替下週立一個小案件，例如：練習 JavaScript" : "下週目前只供預覽，週日中午 12 點後可先立案";
  if (standardInput) standardInput.placeholder = isCurrentWeekView() ? "寫一個本週想靠近的方向，例如：本週能說明一個學到的觀念" : canAdd ? "先寫一個下週驗收方向" : "下週目前只供預覽，週日中午 12 點後可先新增";
}
function switchWeekView(view) { if (view !== "current" && view !== "next") return; selectedWeekView = view; renderAll(); }
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
function getSubCategoryClass(subCategory) { if (subCategory === "觀看課程影片") return "video"; if (subCategory === "練習") return "practice"; if (subCategory === "寫筆記") return "note"; return "uncategorized"; }
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
function getTaskEmptyMessage() { if (!getSelectedWeek()) return "目前還沒有可顯示的週次資料。"; return isNextWeekView() ? "下週目前還沒有任務，先讓未來安靜排隊。" : "今天還沒立案也無妨，放一個小任務，就是好的開始。"; }
function getStandardEmptyMessage() { if (!getSelectedWeek()) return "目前還沒有可顯示的週次資料。"; return isNextWeekView() ? "下週標準尚未成文，等時機到了再慢慢補。" : "本週標準尚未成文，寫下一個方向，慢慢前進。"; }
function createChip(text, className) { const chip = document.createElement("span"); chip.className = className; chip.textContent = text; return chip; }
function createCheckItem(item, displayNumber) {
  const normalizedItem = normalizeItem(item);
  const itemElement = document.createElement("li");
  itemElement.className = normalizedItem.done ? "task-item is-done" : "task-item";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = normalizedItem.done;
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
  checkbox.addEventListener("change", async () => updateItem(normalizedItem.id, { done: checkbox.checked }));
  editBtn.addEventListener("click", async () => {
    const newTitle = prompt("請輸入修訂後的公文內容", normalizedItem.title);
    if (newTitle === null) return;
    const trimmedTitle = newTitle.trim();
    if (trimmedTitle === "") { alert("公文內容不可空白。本局未更動資料。"); return; }
    await updateItem(normalizedItem.id, { title: trimmedTitle });
  });
  deleteBtn.addEventListener("click", async () => {
    const message = normalizedItem.type === "task" ? `確定要將這項${getSelectedWeekDisplayLabel()}任務撤案嗎？本局會將它移出案件板。` : `確定要將這項${getSelectedWeekDisplayLabel()}驗收標準撤案嗎？本局會將它移出案件板。`;
    if (!confirm(message)) return;
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
    weekContext = { currentWeek: data.currentWeek || null, nextWeek: data.nextWeek || null };
  } catch (error) {
    console.error("讀取週次資料失敗：", error);
    weekContext = { currentWeek: null, nextWeek: null };
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
    alert("本局暫時讀不到案件板，資料未更動。請稍後再重新整理。");
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
    alert("重新整理資料失敗，請稍後再試。");
    refreshBtn.textContent = "重新整理案件板";
  } finally {
    refreshBtn.disabled = false;
  }
}
async function addItem(type, inputElement, options = {}) {
  if (!canAddToSelectedWeek()) {
    alert(isNextWeekView() ? "下週目前只供預覽，週日中午 12 點後才可先新增。" : "目前還沒有可新增的週次資料。");
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
    alert("新增失敗，已恢復畫面。請確認 Render 後端是否正常運作。");
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
    alert("本局暫時無法修訂案件，畫面已恢復，資料未更動。請稍後再試。");
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
    alert("本局暫時無法撤案，案件已放回原位，資料未更動。請稍後再試。");
  }
}
function buildCompleteWeekConfirmText(currentWeek, nextWeek) {
  const currentWeekNumber = Number(currentWeek.weekNumber);
  const nextWeekNumber = Number(nextWeek.weekNumber);
  const upcomingWeekNumber = nextWeekNumber + 1;
  const lines = ["結案確認", "", `第 ${currentWeekNumber} 週：current → completed`, `第 ${nextWeekNumber} 週：next → current`];
  lines.push(upcomingWeekNumber <= 12 ? `第 ${upcomingWeekNumber} 週：upcoming → next` : "目前已接近最後一週，可能沒有新的 upcoming 可接成 next。");
  lines.push("", "按「確定」後會正式更新週次。", "按「取消」不會更動資料。");
  return lines.join("\n");
}
async function completeCurrentWeek() {
  const currentWeek = weekContext.currentWeek;
  const nextWeek = weekContext.nextWeek;
  if (!currentWeek) { alert("目前讀不到本週資料，暫時無法結案。"); return; }
  if (!nextWeek) { alert("目前尚未設定下週，暫時無法進入下一週。"); return; }
  if (!confirm(buildCompleteWeekConfirmText(currentWeek, nextWeek))) return;
  try {
    const response = await fetch(`${API_BASE_URL}/weeks/complete-current`, { method: "POST" });
    if (!response.ok) throw new Error("本週結案失敗");
    const data = await response.json();
    selectedWeekView = "current";
    await Promise.all([loadWeekContext(), loadItems()]);
    renderAll();
    alert(`第 ${data.completedWeek.weekNumber} 週已結案，現在進入第 ${data.currentWeek.weekNumber} 週。`);
  } catch (error) {
    console.error("本週結案失敗：", error);
    alert("本局暫時無法結案，週次未更動。請稍後再試。");
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
  if (currentWeekTab) currentWeekTab.addEventListener("click", () => switchWeekView("current"));
  if (nextWeekTab) nextWeekTab.addEventListener("click", () => switchWeekView("next"));
  if (completeWeekBtn) completeWeekBtn.addEventListener("click", completeCurrentWeek);
  taskInput.addEventListener("keydown", (event) => { if (event.key === "Enter") addTask(); });
  standardInput.addEventListener("keydown", (event) => { if (event.key === "Enter") addStandard(); });
  await Promise.all([loadWeekContext(), loadItems()]);
  renderAll();
}
initApp();
