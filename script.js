// === Step 59：全域 API 等待狀態 ===
// 目的：只要前端呼叫 /items API，就顯示「處理中」，並暫時鎖住按鈕

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
  if (method === "POST") return "新增中...";
  if (method === "PATCH") return "更新中...";
  if (method === "DELETE") return "刪除中...";
  return "讀取中...";
}

// 開始等待狀態
function startApiLoading(message) {
  activeApiRequestCount += 1;

  const toast = ensureLoadingToast();
  toast.textContent = message;

  document.body.classList.add("is-busy");
  toast.classList.add("is-show");

  // 記住原本已經 disabled 的按鈕，避免等一下亂恢復
  disabledButtonsBeforeBusy = Array.from(
    document.querySelectorAll("button:disabled")
  );

  // 操作中先鎖住所有按鈕，避免連點送出重複請求
  document.querySelectorAll("button").forEach(function (button) {
    button.disabled = true;
  });
}

// 結束等待狀態
function stopApiLoading() {
  activeApiRequestCount -= 1;

  if (activeApiRequestCount > 0) return;

  activeApiRequestCount = 0;

  const toast = ensureLoadingToast();

  document.body.classList.remove("is-busy");
  toast.classList.remove("is-show");

  // 只恢復原本不是 disabled 的按鈕
  document.querySelectorAll("button").forEach(function (button) {
    const wasDisabledBeforeBusy = disabledButtonsBeforeBusy.includes(button);

    if (!wasDisabledBeforeBusy) {
      button.disabled = false;
    }
  });

  disabledButtonsBeforeBusy = [];
}

// 判斷這次 fetch 是不是我們的 /items API
function shouldTrackApiRequest(input) {
  const url = typeof input === "string" ? input : input && input.url;

  if (!url) return false;

  return url.includes("/items");
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
  "不要一開張又關門",
  "今天只辦一件，也算營業",
  "先打開，勝過腦內完工",
  "不用燃燒自己，只要點一盞小燈",
  "進度很小也算有動，管理局有紀錄",
  "本週不求神速，只求不要失聯",
  "先做簡單的，讓困難的自己排隊",
  "不是你不行，是任務太大包，請切片",
  "今天的你只要開工，不用登基",
  "拖延可以理解，但不能無限展延",
];

// === 前端狀態 ===
let items = [];

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

  // JavaScript 的週日是 0，所以週日要往前推 6 天才是週一
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

  const actions = document.createElement("div");
  actions.className = "item-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "text-btn";
  editBtn.type = "button";
  editBtn.textContent = "編輯";

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "text-btn danger";
  deleteBtn.type = "button";
  deleteBtn.textContent = "刪除";

  checkbox.addEventListener("change", async function () {
    await updateItem(normalizedItem.id, {
      done: checkbox.checked,
    });
  });

  editBtn.addEventListener("click", async function () {
    const newTitle = prompt("請輸入新的內容：", normalizedItem.title);

    if (newTitle === null) {
      return;
    }

    const trimmedTitle = newTitle.trim();

    if (trimmedTitle === "") {
      alert("內容不能是空白。");
      return;
    }

    await updateItem(normalizedItem.id, {
      title: trimmedTitle,
    });
  });

  deleteBtn.addEventListener("click", async function () {
    const message =
      normalizedItem.type === "task"
        ? "確定要刪除這項本週任務嗎？"
        : "確定要刪除這項本週完成標準嗎？";

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
      createEmptyMessage("目前還沒有任務，管理局還沒營業。")
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
      createEmptyMessage("目前還沒有本週完成標準，小心變成模糊努力。")
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
  renderTasks();
  renderStandards();
  renderProgress();
}

// === 讀取資料 ===
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
    alert("讀取後端資料失敗。請確認 Render 後端是否正常運作。");

    items = [];
    renderAll();
  }
}

// === 重新整理資料 ===
async function refreshItems() {
  if (!refreshBtn) {
    await loadItems();
    return;
  }

  try {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "重新整理中...";

    await loadItems();

    refreshBtn.textContent = "重新整理資料";
  } catch (error) {
    console.error("重新整理資料失敗：", error);
    alert("重新整理資料失敗，請稍後再試。");
    refreshBtn.textContent = "重新整理資料";
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

    alert("更新失敗，已恢復原本狀態。請確認 Render 後端是否正常運作。");
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

    alert("刪除失敗，已恢復原本資料。請確認 Render 後端是否正常運作。");
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
function initApp() {
  renderWeekRange();
  renderDailyQuote();
  loadItems();

  addTaskBtn.addEventListener("click", addTask);
  addStandardBtn.addEventListener("click", addStandard);

  if (refreshBtn) {
    refreshBtn.addEventListener("click", refreshItems);
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
}

initApp();