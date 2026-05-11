// === 全域 API 等待狀態 ===
// 目的：只要前端呼叫 API，就顯示「處理中」，並暫時鎖住按鈕

let activeApiRequestCount = 0;
let disabledButtonsBeforeBusy = [];

// 建立畫面下方的「處理中」提示
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

// 依照 API 方法顯示不同提示文字
function getLoadingText(method) {
  if (method === "POST") return "本局立案中...";
  if (method === "PATCH") return "本局修訂中...";
  if (method === "DELETE") return "本局撤案中...";
  return "本局讀取資料中...";
}

// 開始等待狀態
function startApiLoading(message) {
  const isFirstRequest = activeApiRequestCount === 0;

  activeApiRequestCount += 1;

  const toast = ensureLoadingToast();
  toast.textContent = message;

  document.body.classList.add("is-busy");
  toast.classList.add("is-show");

  // 只有第一個 API 請求開始時，才記錄原本 disabled 的按鈕
  // 避免第二個同時進來的請求，把「剛剛被鎖住的按鈕」誤判成原本就 disabled
  if (isFirstRequest) {
    disabledButtonsBeforeBusy = Array.from(
      document.querySelectorAll("button:disabled")
    );

    document.querySelectorAll("button").forEach(function (button) {
      button.disabled = true;
    });
  }
}

// 結束等待狀態
function stopApiLoading() {
  activeApiRequestCount -= 1;

  if (activeApiRequestCount > 0) return;

  activeApiRequestCount = 0;

  const toast = ensureLoadingToast();

  document.body.classList.remove("is-busy");
  toast.classList.remove("is-show");

  // 只恢復「原本不是 disabled」的按鈕
  document.querySelectorAll("button").forEach(function (button) {
    const wasDisabledBeforeBusy = disabledButtonsBeforeBusy.includes(button);

    if (!wasDisabledBeforeBusy) {
      button.disabled = false;
    }
  });

  disabledButtonsBeforeBusy = [];
}

// 判斷這次 fetch 是不是我們要追蹤的 API
function shouldTrackApiRequest(input) {
  const url = typeof input === "string" ? input : input && input.url;

  if (!url) return false;

  return url.includes("/items") || url.includes("/week-context");
}

// 包裝原本的 fetch，讓等待狀態自動套用
const originalFetch = window.fetch.bind(window);

window.fetch = async function (input, options = {}) {
  const shouldTrack = shouldTrackApiRequest(input);
  const method = (options.method || "GET").toUpperCase();

  if (!shouldTrack) {
    return originalFetch(input, options);
  }

  startApiLoading(getLoadingText(method));

  try {
    const response = await originalFetch(input, options);
    return response;
  } finally {
    stopApiLoading();
  }
};

// === API 設定 ===
// 注意：這裡只放 Render 後端主網址，不要加 /items
const API_BASE_URL = "https://no-effort-time-bureau.onrender.com";

// === 分類與難度設定 ===
const CATEGORY_OPTIONS = ["程式學習", "身心穩定", "興趣探索"];
const DIFFICULTY_OPTIONS = ["簡單", "適中", "困難"];

const DEFAULT_CATEGORY = "程式學習";
const DEFAULT_DIFFICULTY = "簡單";

// === 每日金句 ===
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

// === 前端狀態 ===
let items = [];

let weekContext = {
  currentWeek: null,
  nextWeek: null,
};

let selectedWeekView = "current";

// === DOM 元素 ===
const taskList = document.querySelector("#taskList");
const standardList = document.querySelector("#standardList");

const taskProgress = document.querySelector("#taskProgress");
const standardProgress = document.querySelector("#standardProgress");

const taskInput = document.querySelector("#taskInput");
const taskCategory = document.querySelector("#taskCategory");
const taskDifficulty = document.querySelector("#taskDifficulty");
const addTaskBtn = document.querySelector("#addTaskBtn");

const standardInput = document.querySelector("#standardInput");
const addStandardBtn = document.querySelector("#addStandardBtn");

const refreshBtn = document.getElementById("refreshBtn");

const weekStartText = document.querySelector("#weekStartText");
const weekEndText = document.querySelector("#weekEndText");
const dailyQuote = document.querySelector("#dailyQuote");

// === 12 週主線 DOM ===
const currentWeekNumber = document.querySelector("#currentWeekNumber");
const planStatusText = document.querySelector("#planStatusText");

const currentWeekTab = document.querySelector("#currentWeekTab");
const nextWeekTab = document.querySelector("#nextWeekTab");

const selectedWeekLabel = document.querySelector("#selectedWeekLabel");
const selectedWeekTitle = document.querySelector("#selectedWeekTitle");
const selectedWeekAchievement = document.querySelector("#selectedWeekAchievement");

const completeWeekBtn = document.querySelector("#completeWeekBtn");

// === 日期工具函式 ===
function padNumber(number) {
  return String(number).padStart(2, "0");
}

function formatDateForDisplay(date) {
  const year = date.getFullYear();
  const month = padNumber(date.getMonth() + 1);
  const day = padNumber(date.getDate());

  return `${year}/${month}/${day}`;
}

function formatDateForDatetime(date) {
  const year = date.getFullYear();
  const month = padNumber(date.getMonth() + 1);
  const day = padNumber(date.getDate());

  return `${year}-${month}-${day}`;
}

function getCurrentWeekRange(baseDate = new Date()) {
  const date = new Date(baseDate);
  const day = date.getDay();

  const diffToMonday = day === 0 ? -6 : 1 - day;

  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    weekStart: monday,
    weekEnd: sunday,
  };
}

function renderWeekRange() {
  if (!weekStartText || !weekEndText) return;

  const currentWeek = weekContext.currentWeek;

  // 如果 weeks 工作表未來有填 weekStart / weekEnd，就優先顯示 weeks 的日期
  if (currentWeek && currentWeek.weekStart && currentWeek.weekEnd) {
    weekStartText.textContent = currentWeek.weekStart.replaceAll("-", "/");
    weekStartText.setAttribute("datetime", currentWeek.weekStart);

    weekEndText.textContent = currentWeek.weekEnd.replaceAll("-", "/");
    weekEndText.setAttribute("datetime", currentWeek.weekEnd);

    return;
  }

  // 若 weeks 尚未填日期，先沿用原本的本週日期算法
  const range = getCurrentWeekRange();

  weekStartText.textContent = formatDateForDisplay(range.weekStart);
  weekStartText.setAttribute("datetime", formatDateForDatetime(range.weekStart));

  weekEndText.textContent = formatDateForDisplay(range.weekEnd);
  weekEndText.setAttribute("datetime", formatDateForDatetime(range.weekEnd));
}

// === 金句工具函式 ===
function getDayOfYear(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  const oneDay = 1000 * 60 * 60 * 24;

  return Math.floor(diff / oneDay);
}

function renderDailyQuote() {
  if (!dailyQuote) return;

  const dayOfYear = getDayOfYear();
  const quoteIndex = dayOfYear % DAILY_QUOTES.length;
  const quote = DAILY_QUOTES[quoteIndex];

  dailyQuote.textContent = `本日金句：${quote}`;
}

// === 12 週主線工具函式 ===
function getSelectedWeek() {
  if (selectedWeekView === "next") {
    return weekContext.nextWeek;
  }

  return weekContext.currentWeek;
}

function getSelectedWeekLabelText() {
  return selectedWeekView === "next" ? "下週主題" : "本週主題";
}

function getAchievementLabelText() {
  return selectedWeekView === "next" ? "下週達成" : "本週達成";
}

function setWeekTabActiveState() {
  if (!currentWeekTab || !nextWeekTab) return;

  currentWeekTab.classList.toggle("is-active", selectedWeekView === "current");
  nextWeekTab.classList.toggle("is-active", selectedWeekView === "next");
}

function renderPlanCard() {
  if (
    !currentWeekNumber ||
    !planStatusText ||
    !selectedWeekLabel ||
    !selectedWeekTitle ||
    !selectedWeekAchievement
  ) {
    return;
  }

  const currentWeek = weekContext.currentWeek;
  const nextWeek = weekContext.nextWeek;
  const selectedWeek = getSelectedWeek();

  setWeekTabActiveState();

  if (!currentWeek) {
    currentWeekNumber.textContent = "-";
    planStatusText.textContent = "目前讀不到週次資料。";
    selectedWeekLabel.textContent = "週次主題";
    selectedWeekTitle.textContent = "尚無資料";
    selectedWeekAchievement.textContent =
      "請確認後端 /week-context 是否正常，以及 weeks 工作表是否有 current。";
    return;
  }

  currentWeekNumber.textContent = String(currentWeek.weekNumber || "-");

  planStatusText.textContent = nextWeek
    ? `目前第 ${currentWeek.weekNumber} 週，下週預告第 ${nextWeek.weekNumber} 週。`
    : `目前第 ${currentWeek.weekNumber} 週，尚未設定下週。`;

  if (!selectedWeek) {
    selectedWeekLabel.textContent = "下週主題";
    selectedWeekTitle.textContent = "尚未設定下週";
    selectedWeekAchievement.textContent =
      "可以先在 weeks 工作表補上 status = next 的週次。";
    return;
  }

  selectedWeekLabel.textContent = getSelectedWeekLabelText();
  selectedWeekTitle.textContent = selectedWeek.title || "尚未填寫主題";

  const achievementBoxLabel = document.querySelector(".achievement-box span");

  if (achievementBoxLabel) {
    achievementBoxLabel.textContent = getAchievementLabelText();
  }

  selectedWeekAchievement.textContent =
    selectedWeek.achievement || "尚未填寫本週達成。";
}

function switchWeekView(view) {
  if (view !== "current" && view !== "next") {
    return;
  }

  selectedWeekView = view;
  renderPlanCard();
}

// === 資料工具函式 ===
function normalizeCategory(value) {
  const category = String(value || "").trim();

  if (CATEGORY_OPTIONS.includes(category)) {
    return category;
  }

  return DEFAULT_CATEGORY;
}

function normalizeDifficulty(value) {
  const difficulty = String(value || "").trim();

  if (DIFFICULTY_OPTIONS.includes(difficulty)) {
    return difficulty;
  }

  return DEFAULT_DIFFICULTY;
}

function normalizeItem(item) {
  return {
    ...item,
    category: normalizeCategory(item.category),
    difficulty: normalizeDifficulty(item.difficulty),
    parentTaskId: String(item.parentTaskId || "").trim(),
  };
}

function getItemsByType(type) {
  return items.filter(function (item) {
    return item.type === type;
  });
}

function getTasksSortedByCategory() {
  const tasks = getItemsByType("task");

  return [...tasks].sort(function (a, b) {
    const categoryA = normalizeCategory(a.category);
    const categoryB = normalizeCategory(b.category);

    return CATEGORY_OPTIONS.indexOf(categoryA) - CATEGORY_OPTIONS.indexOf(categoryB);
  });
}

function findItemById(id) {
  return items.find(function (item) {
    return item.id === id;
  });
}

function findItemIndexById(id) {
  return items.findIndex(function (item) {
    return item.id === id;
  });
}

function replaceItem(updatedItem) {
  const normalizedUpdatedItem = normalizeItem(updatedItem);

  items = items.map(function (item) {
    if (item.id === normalizedUpdatedItem.id) {
      return normalizedUpdatedItem;
    }

    return item;
  });
}

function replaceItemById(targetId, newItem) {
  const normalizedNewItem = normalizeItem(newItem);

  items = items.map(function (item) {
    if (item.id === targetId) {
      return normalizedNewItem;
    }

    return item;
  });
}

function insertItemAtIndex(item, index) {
  const safeIndex = Math.max(0, index);

  items = [
    ...items.slice(0, safeIndex),
    normalizeItem(item),
    ...items.slice(safeIndex),
  ];
}

// === 畫面渲染 ===
function createEmptyMessage(text) {
  const emptyItem = document.createElement("li");
  emptyItem.className = "empty-message";
  emptyItem.textContent = text;

  return emptyItem;
}

function createCategoryHeading(category) {
  const heading = document.createElement("li");
  heading.className = "category-heading";
  heading.textContent = `【${category}】`;

  return heading;
}

function getDifficultyClass(difficulty) {
  if (difficulty === "簡單") return "easy";
  if (difficulty === "適中") return "medium";
  if (difficulty === "困難") return "hard";
  return "";
}

function createParentTaskRelation(standardItem) {
  if (!standardItem.parentTaskId) {
    return null;
  }

  const parentTask = findItemById(standardItem.parentTaskId);

  const relation = document.createElement("div");
  relation.className = "item-relation";

  const label = document.createElement("span");
  label.className = "chip chip-parent";
  label.textContent = "來自任務";

  const title = document.createElement("span");
  title.className = "relation-title";

  title.textContent = parentTask
    ? parentTask.title
    : "找不到原任務，可能已被撤案";

  relation.appendChild(label);
  relation.appendChild(title);

  return relation;
}

function createCheckItem(item, displayNumber) {
  const normalizedItem = normalizeItem(item);

  const itemElement = document.createElement("li");
  itemElement.className = normalizedItem.done
    ? "task-item is-done"
    : "task-item";

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
    const categoryChip = document.createElement("span");
    categoryChip.className = "chip chip-category";
    categoryChip.textContent = normalizedItem.category;

    const difficultyChip = document.createElement("span");
    difficultyChip.className =
      "chip chip-difficulty " + getDifficultyClass(normalizedItem.difficulty);
    difficultyChip.textContent = normalizedItem.difficulty;

    meta.appendChild(categoryChip);
    meta.appendChild(difficultyChip);
  }

  topLine.appendChild(number);

  if (normalizedItem.type === "task") {
    topLine.appendChild(meta);
  }

  content.appendChild(topLine);
  content.appendChild(title);

  if (normalizedItem.type === "standard") {
    const relation = createParentTaskRelation(normalizedItem);

    if (relation) {
      content.appendChild(relation);
    }
  }

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

  checkbox.addEventListener("change", async function () {
    await updateItem(normalizedItem.id, {
      done: checkbox.checked,
    });
  });

  editBtn.addEventListener("click", async function () {
    const newTitle = prompt("請輸入修訂後的公文內容", normalizedItem.title);

    if (newTitle === null) {
      return;
    }

    const trimmedTitle = newTitle.trim();

    if (trimmedTitle === "") {
      alert("公文內容不可空白。本局未更動資料。");
      return;
    }

    await updateItem(normalizedItem.id, {
      title: trimmedTitle,
    });
  });

  deleteBtn.addEventListener("click", async function () {
    const message =
      normalizedItem.type === "task"
        ? "確定要將這項本週任務撤案嗎？本局會將它移出案件板。"
        : "確定要將這項本週驗收標準撤案嗎？本局會將它移出案件板。";

    const shouldDelete = confirm(message);

    if (!shouldDelete) {
      return;
    }

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

  if (tasks.length === 0) {
    taskList.appendChild(
      createEmptyMessage("今天還沒立案也無妨，放一個小任務，就是好的開始。")
    );
    return;
  }

  let displayNumber = 1;

  CATEGORY_OPTIONS.forEach(function (category) {
    const categoryTasks = tasks.filter(function (task) {
      return normalizeCategory(task.category) === category;
    });

    if (categoryTasks.length === 0) {
      return;
    }

    taskList.appendChild(createCategoryHeading(category));

    categoryTasks.forEach(function (task) {
      taskList.appendChild(createCheckItem(task, displayNumber));
      displayNumber += 1;
    });
  });
}

function renderStandards() {
  const standards = getItemsByType("standard");

  standardList.innerHTML = "";

  if (standards.length === 0) {
    standardList.appendChild(
      createEmptyMessage("本週標準尚未成文，寫下一個方向，慢慢前進")
    );
    return;
  }

  standards.forEach(function (standard, index) {
    standardList.appendChild(createCheckItem(standard, index + 1));
  });
}

function renderProgress() {
  const tasks = getItemsByType("task");
  const standards = getItemsByType("standard");

  const doneTasks = tasks.filter(function (task) {
    return task.done;
  });

  const doneStandards = standards.filter(function (standard) {
    return standard.done;
  });

  taskProgress.textContent = `${doneTasks.length} / ${tasks.length}`;
  standardProgress.textContent = `${doneStandards.length} / ${standards.length}`;
}

function renderAll() {
  renderPlanCard();
  renderWeekRange();
  renderTasks();
  renderStandards();
  renderProgress();
}

// === 讀取週次資料 ===
async function loadWeekContext() {
  try {
    const response = await fetch(`${API_BASE_URL}/week-context`);

    if (!response.ok) {
      throw new Error("後端週次資料回應失敗");
    }

    const data = await response.json();

    weekContext = {
      currentWeek: data.currentWeek || null,
      nextWeek: data.nextWeek || null,
    };

    renderPlanCard();
    renderWeekRange();
  } catch (error) {
    console.error("讀取週次資料失敗：", error);

    weekContext = {
      currentWeek: null,
      nextWeek: null,
    };

    renderPlanCard();
  }
}

// === 讀取任務資料 ===
async function loadItems() {
  try {
    const response = await fetch(`${API_BASE_URL}/items`);

    if (!response.ok) {
      throw new Error("後端回應失敗");
    }

    const data = await response.json();

    items = data.map(normalizeItem);

    renderAll();
  } catch (error) {
    console.error("讀取任務資料失敗：", error);
    alert("本局暫時讀不到案件板，資料未更動。請稍後再重新整理。");

    items = [];
    renderAll();
  }
}

// === 重新整理資料 ===
async function refreshItems() {
  if (!refreshBtn) {
    await Promise.all([loadWeekContext(), loadItems()]);
    return;
  }

  try {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "案件板整理中...";

    await Promise.all([loadWeekContext(), loadItems()]);

    refreshBtn.textContent = "重新整理案件板";
  } catch (error) {
    console.error("重新整理資料失敗：", error);
    alert("重新整理資料失敗，請稍後再試。");
    refreshBtn.textContent = "重新整理案件板";
  } finally {
    refreshBtn.disabled = false;
  }
}

// === 新增資料：樂觀更新 ===
async function addItem(type, inputElement, options = {}) {
  const title = inputElement.value.trim();

  if (title === "") {
    return;
  }

  const now = new Date().toISOString();

  const category = normalizeCategory(options.category);
  const difficulty = normalizeDifficulty(options.difficulty);

  const tempItem = {
    id: "temp-" + Date.now(),
    type,
    title,
    category,
    difficulty,
    done: false,
    parentTaskId: "",
    weekNumber: weekContext.currentWeek
      ? weekContext.currentWeek.weekNumber
      : "",
    weekStart: "",
    weekEnd: "",
    createdAt: now,
    updatedAt: now,
  };

  items.push(tempItem);
  inputElement.value = "";
  renderAll();

  try {
    const response = await fetch(`${API_BASE_URL}/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type,
        title,
        category,
        difficulty,
      }),
    });

    if (!response.ok) {
      throw new Error("新增失敗");
    }

    const newItem = await response.json();

    replaceItemById(tempItem.id, newItem);
    renderAll();

    // 目前 server.js 會在新增任務後自動建立驗收標準
    // 前端先重新讀取一次，讓自動標準立刻出現在畫面上
    if (type === "task") {
      await loadItems();
    }
  } catch (error) {
    console.error("新增資料失敗：", error);

    items = items.filter(function (item) {
      return item.id !== tempItem.id;
    });

    inputElement.value = title;
    renderAll();

    alert("新增失敗，已恢復畫面。請確認 Render 後端是否正常運作。");
  }
}

// === 更新資料：樂觀更新 ===
async function updateItem(id, updates) {
  const previousItem = findItemById(id);

  if (!previousItem) {
    return;
  }

  const optimisticItem = normalizeItem({
    ...previousItem,
    ...updates,
    updatedAt: new Date().toISOString(),
  });

  replaceItem(optimisticItem);
  renderAll();

  try {
    const response = await fetch(`${API_BASE_URL}/items/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      throw new Error("更新失敗");
    }

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

// === 刪除資料：樂觀更新 ===
async function deleteItem(id) {
  const previousItem = findItemById(id);
  const previousIndex = findItemIndexById(id);

  if (!previousItem || previousIndex === -1) {
    return;
  }

  items = items.filter(function (item) {
    return item.id !== id;
  });

  renderAll();

  try {
    const response = await fetch(`${API_BASE_URL}/items/${id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error("刪除失敗");
    }
  } catch (error) {
    console.error("刪除資料失敗：", error);

    insertItemAtIndex(previousItem, previousIndex);
    renderAll();

    alert("本局暫時無法撤案，案件已放回原位，資料未更動。請稍後再試。");
  }
}

function addTask() {
  addItem("task", taskInput, {
    category: taskCategory.value,
    difficulty: taskDifficulty.value,
  });
}

function addStandard() {
  addItem("standard", standardInput, {
    category: DEFAULT_CATEGORY,
    difficulty: DEFAULT_DIFFICULTY,
  });
}

// === 初始化 ===
async function initApp() {
  renderWeekRange();
  renderDailyQuote();
  renderPlanCard();

  addTaskBtn.addEventListener("click", addTask);
  addStandardBtn.addEventListener("click", addStandard);

  if (refreshBtn) {
    refreshBtn.addEventListener("click", refreshItems);
  }

  if (currentWeekTab) {
    currentWeekTab.addEventListener("click", function () {
      switchWeekView("current");
    });
  }

  if (nextWeekTab) {
    nextWeekTab.addEventListener("click", function () {
      switchWeekView("next");
    });
  }

  if (completeWeekBtn) {
    completeWeekBtn.addEventListener("click", function () {
      alert("本週結案功能下一步再接上。現在先確認本週 / 下週主線卡片能正常顯示。");
    });
  }

  taskInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      addTask();
    }
  });

  standardInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      addStandard();
    }
  });

  await Promise.all([loadWeekContext(), loadItems()]);
}

initApp();