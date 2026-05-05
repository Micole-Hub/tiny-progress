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

// === 前端狀態 ===
let items = [];

// === DOM 元素 ===
const taskList = document.querySelector("#taskList");
const standardList = document.querySelector("#standardList");

const taskProgress = document.querySelector("#taskProgress");
const standardProgress = document.querySelector("#standardProgress");

const taskInput = document.querySelector("#taskInput");
const addTaskBtn = document.querySelector("#addTaskBtn");

const standardInput = document.querySelector("#standardInput");
const addStandardBtn = document.querySelector("#addStandardBtn");

// 重新整理資料按鈕
const refreshBtn = document.getElementById("refreshBtn");

// === 資料工具函式 ===
function getItemsByType(type) {
  return items.filter(function (item) {
    return item.type === type;
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
  items = items.map(function (item) {
    if (item.id === updatedItem.id) {
      return updatedItem;
    }

    return item;
  });
}

// Step 60：用指定 id 替換成後端真正回傳的 item
function replaceItemById(targetId, newItem) {
  items = items.map(function (item) {
    if (item.id === targetId) {
      return newItem;
    }

    return item;
  });
}

// Step 60：失敗時把刪掉的 item 放回原本位置
function insertItemAtIndex(item, index) {
  const safeIndex = Math.max(0, index);

  items = [
    ...items.slice(0, safeIndex),
    item,
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

function createCheckItem(item) {
  const itemElement = document.createElement("li");
  itemElement.className = item.done ? "task-item is-done" : "task-item";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = item.done;

  const title = document.createElement("span");
  title.className = "item-title";
  title.textContent = item.title;

  const editBtn = document.createElement("button");
  editBtn.className = "text-btn";
  editBtn.type = "button";
  editBtn.textContent = "編輯";

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "text-btn danger";
  deleteBtn.type = "button";
  deleteBtn.textContent = "刪除";

  checkbox.addEventListener("change", async function () {
    await updateItem(item.id, {
      done: checkbox.checked,
    });
  });

  editBtn.addEventListener("click", async function () {
    const newTitle = prompt("請輸入新的內容：", item.title);

    if (newTitle === null) {
      return;
    }

    const trimmedTitle = newTitle.trim();

    if (trimmedTitle === "") {
      alert("內容不能是空白。");
      return;
    }

    await updateItem(item.id, {
      title: trimmedTitle,
    });
  });

  deleteBtn.addEventListener("click", async function () {
    const message =
      item.type === "task"
        ? "確定要刪除這項本週任務嗎？"
        : "確定要刪除這項完成標準嗎？";

    const shouldDelete = confirm(message);

    if (!shouldDelete) {
      return;
    }

    await deleteItem(item.id);
  });

  itemElement.appendChild(checkbox);
  itemElement.appendChild(title);
  itemElement.appendChild(editBtn);
  itemElement.appendChild(deleteBtn);

  return itemElement;
}

function renderTasks() {
  const tasks = getItemsByType("task");

  taskList.innerHTML = "";

  if (tasks.length === 0) {
    taskList.appendChild(
      createEmptyMessage("目前還沒有任務，管理局還沒營業。")
    );
    return;
  }

  tasks.forEach(function (task) {
    taskList.appendChild(createCheckItem(task));
  });
}

function renderStandards() {
  const standards = getItemsByType("standard");

  standardList.innerHTML = "";

  if (standards.length === 0) {
    standardList.appendChild(
      createEmptyMessage("目前還沒有完成標準，小心變成模糊努力。")
    );
    return;
  }

  standards.forEach(function (standard) {
    standardList.appendChild(createCheckItem(standard));
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

    items = data;

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

// Step 60：新增改成樂觀更新
async function addItem(type, inputElement) {
  const title = inputElement.value.trim();

  if (title === "") {
    return;
  }

  const now = new Date().toISOString();

  // 先做一筆暫時資料，讓畫面立刻出現
  const tempItem = {
    id: "temp-" + Date.now(),
    type: type,
    title: title,
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
        type: type,
        title: title,
      }),
    });

    if (!response.ok) {
      throw new Error("新增失敗");
    }

    const newItem = await response.json();

    // 後端成功後，用真正的 Google Sheets item 替換暫時資料
    replaceItemById(tempItem.id, newItem);
    renderAll();
  } catch (error) {
    console.error("新增資料失敗：", error);

    // 失敗時移除暫時資料，並把輸入內容還給使用者
    items = items.filter(function (item) {
      return item.id !== tempItem.id;
    });

    inputElement.value = title;
    renderAll();

    alert("新增失敗，已恢復畫面。請確認 Render 後端是否正常運作。");
  }
}

// Step 60：更新改成樂觀更新
async function updateItem(id, updates) {
  const previousItem = findItemById(id);

  if (!previousItem) {
    return;
  }

  const optimisticItem = {
    ...previousItem,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  // 先更新畫面
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

    // 後端成功後，用 Google Sheets 回傳的正式資料校正一次
    replaceItem(updatedItem);
    renderAll();
  } catch (error) {
    console.error("更新資料失敗：", error);

    // 失敗時回復成更新前的狀態
    replaceItem(previousItem);
    renderAll();

    alert("更新失敗，已恢復原本狀態。請確認 Render 後端是否正常運作。");
  }
}

// Step 60：刪除改成樂觀更新
async function deleteItem(id) {
  const previousItem = findItemById(id);
  const previousIndex = findItemIndexById(id);

  if (!previousItem || previousIndex === -1) {
    return;
  }

  // 先從畫面移除
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

    // 刪除成功不用再重新 fetch，因為畫面已經先移除了
  } catch (error) {
    console.error("刪除資料失敗：", error);

    // 失敗時放回原本位置
    insertItemAtIndex(previousItem, previousIndex);
    renderAll();

    alert("刪除失敗，已恢復原本資料。請確認 Render 後端是否正常運作。");
  }
}

function addTask() {
  addItem("task", taskInput);
}

function addStandard() {
  addItem("standard", standardInput);
}

// === 初始化 ===
function initApp() {
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