require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

const PORT = process.env.PORT || 3000;

const GOOGLE_SHEETS_API_URL = process.env.GOOGLE_SHEETS_API_URL;
const GOOGLE_SHEETS_API_SECRET = process.env.GOOGLE_SHEETS_API_SECRET;

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// 暫存多步驟操作，例如「修改任務 1」之後等待使用者輸入新文字
const pendingActions = new Map();
const PENDING_ACTION_TTL_MS = 10 * 60 * 1000;

const CATEGORY_OPTIONS = ["程式學習", "身心穩定", "興趣探索"];
const DIFFICULTY_OPTIONS = ["簡單", "適中", "困難"];

const DEFAULT_CATEGORY = "程式學習";
const DEFAULT_DIFFICULTY = "簡單";

if (!GOOGLE_SHEETS_API_URL) {
  throw new Error(
    "缺少環境變數 GOOGLE_SHEETS_API_URL，請檢查 backend/.env 或 Render 環境變數"
  );
}

if (!GOOGLE_SHEETS_API_SECRET) {
  throw new Error(
    "缺少環境變數 GOOGLE_SHEETS_API_SECRET，請檢查 backend/.env 或 Render 環境變數"
  );
}

app.use(cors());
app.use(express.json());

// === 共用工具：分類正規化 ===
function normalizeCategory(value) {
  const category = String(value || "").trim();

  if (!category) {
    return DEFAULT_CATEGORY;
  }

  if (!CATEGORY_OPTIONS.includes(category)) {
    throw new Error("category 只能是：" + CATEGORY_OPTIONS.join("、"));
  }

  return category;
}

// === 共用工具：難度正規化 ===
function normalizeDifficulty(value) {
  const difficulty = String(value || "").trim();

  if (!difficulty) {
    return DEFAULT_DIFFICULTY;
  }

  if (!DIFFICULTY_OPTIONS.includes(difficulty)) {
    throw new Error("difficulty 只能是：" + DIFFICULTY_OPTIONS.join("、"));
  }

  return difficulty;
}

// === 共用工具：整理 item，避免舊資料缺欄位時畫面壞掉 ===
function normalizeItem(item) {
  return {
    ...item,
    category: normalizeCategory(item.category),
    difficulty: normalizeDifficulty(item.difficulty),
  };
}

// === 共用工具：任務排序，讓 LINE 清單和編號邏輯一致 ===
function sortTasksByCategory(tasks) {
  return [...tasks].sort(function (a, b) {
    const categoryA = normalizeCategory(a.category);
    const categoryB = normalizeCategory(b.category);

    const indexA = CATEGORY_OPTIONS.indexOf(categoryA);
    const indexB = CATEGORY_OPTIONS.indexOf(categoryB);

    if (indexA !== indexB) {
      return indexA - indexB;
    }

    return 0;
  });
}

// === 共用工具：對外顯示名稱 ===
function getDisplayLabel(label) {
  if (label === "完成標準") {
    return "本週驗收標準";
  }

  return label;
}

// === 共用工具：溫柔公文感收尾句 ===
function getGentleFooterText() {
  return "今日有學，即可記上一筆。";
}

// === 產生帶 secret 的 Google Sheets API URL，用於 GET 讀取 ===
function buildGoogleSheetsGetUrl() {
  const url = new URL(GOOGLE_SHEETS_API_URL);
  url.searchParams.set("secret", GOOGLE_SHEETS_API_SECRET);
  return url.toString();
}

// === 共用函式：從 Google Sheets 讀 items ===
async function fetchItemsFromGoogleSheets() {
  const response = await fetch(buildGoogleSheetsGetUrl());

  if (!response.ok) {
    throw new Error("呼叫 Google Apps Script 失敗，狀態碼：" + response.status);
  }

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.message || "Google Apps Script 回傳失敗");
  }

  return data.items.map(normalizeItem);
}

// === 共用函式：新增 item 到 Google Sheets ===
async function createItemToGoogleSheets({
  type,
  title,
  category,
  difficulty,
}) {
  const response = await fetch(GOOGLE_SHEETS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      secret: GOOGLE_SHEETS_API_SECRET,
      action: "create",
      item: {
        type,
        title,
        category: normalizeCategory(category),
        difficulty: normalizeDifficulty(difficulty),
        done: false,
      },
    }),
  });

  if (!response.ok) {
    throw new Error("呼叫 Google Apps Script 新增失敗，狀態碼：" + response.status);
  }

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.message || "Google Apps Script 新增資料失敗");
  }

  return normalizeItem(data.item);
}

// === 共用函式：更新 item 到 Google Sheets ===
async function updateItemToGoogleSheets(id, updates) {
  const safeUpdates = { ...updates };

  if (safeUpdates.category !== undefined) {
    safeUpdates.category = normalizeCategory(safeUpdates.category);
  }

  if (safeUpdates.difficulty !== undefined) {
    safeUpdates.difficulty = normalizeDifficulty(safeUpdates.difficulty);
  }

  const response = await fetch(GOOGLE_SHEETS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      secret: GOOGLE_SHEETS_API_SECRET,
      action: "update",
      id,
      updates: safeUpdates,
    }),
  });

  if (!response.ok) {
    throw new Error("呼叫 Google Apps Script 更新失敗，狀態碼：" + response.status);
  }

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.message || "Google Apps Script 更新資料失敗");
  }

  return normalizeItem(data.item);
}

// === 共用函式：刪除 item from Google Sheets ===
async function deleteItemFromGoogleSheets(id) {
  const response = await fetch(GOOGLE_SHEETS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      secret: GOOGLE_SHEETS_API_SECRET,
      action: "delete",
      id,
    }),
  });

  if (!response.ok) {
    throw new Error("呼叫 Google Apps Script 刪除失敗，狀態碼：" + response.status);
  }

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.message || "Google Apps Script 刪除資料失敗");
  }

  return normalizeItem(data.item);
}

// === LINE 小工具：取得使用者識別 key，用來記住修改狀態 ===
function getLineSourceKey(event) {
  return (
    event.source?.userId ||
    event.source?.groupId ||
    event.source?.roomId ||
    "unknown-source"
  );
}

// === LINE 小工具：取得某一類資料 ===
async function getItemsByType(type) {
  const items = await fetchItemsFromGoogleSheets();
  const filteredItems = items.filter((item) => item.type === type);

  if (type === "task") {
    return sortTasksByCategory(filteredItems);
  }

  return filteredItems;
}

// === LINE 小工具：取得任務與驗收標準 ===
async function getTaskBoardForLine() {
  const items = await fetchItemsFromGoogleSheets();

  const tasks = sortTasksByCategory(
    items.filter((item) => item.type === "task")
  );

  const standards = items.filter((item) => item.type === "standard");

  return {
    tasks,
    standards,
  };
}

// === LINE 小工具：清單底部固定提示 ===
function getLineCommandHintText() {
  return [
    "需要辦事攻略請輸入：攻略",
    "想看用量小抄請輸入：用量小抄",
  ].join("\n");
}

// === LINE 小工具：格式化任務分類區塊，任務編號維持連續 ===
function formatTaskSectionByCategory(tasks) {
  if (tasks.length === 0) {
    return [
      "本週任務：",
      "",
      "本週尚未立案也無妨，放一個小任務，就是好的開始。",
    ].join("\n");
  }

  const lines = ["本週任務：", ""];

  let taskNumber = 1;

  CATEGORY_OPTIONS.forEach(function (category) {
    const categoryTasks = tasks.filter(function (task) {
      return normalizeCategory(task.category) === category;
    });

    if (categoryTasks.length === 0) {
      return;
    }

    lines.push(`【${category}】`);

    categoryTasks.forEach(function (task) {
      const checkbox = task.done ? "☑" : "☐";
      const difficulty = normalizeDifficulty(task.difficulty);

      lines.push(`${taskNumber}. ${checkbox} ${task.title}（${difficulty}）`);
      taskNumber += 1;
    });

    lines.push("");
  });

  return lines.join("\n").trim();
}

// === LINE 小工具：格式化驗收標準區塊 ===
function formatLineSection(title, items, emptyText) {
  if (items.length === 0) {
    return [title, "", emptyText].join("\n");
  }

  const lines = items.map((item, index) => {
    const checkbox = item.done ? "☑" : "☐";
    return `${index + 1}. ${checkbox} ${item.title}`;
  });

  return [title, "", ...lines].join("\n");
}

// === LINE 小工具：格式化完整清單 ===
function formatTaskBoardForLine({ tasks, standards }) {
  const taskSection = formatTaskSectionByCategory(tasks);

  const standardSection = formatLineSection(
    "本週驗收標準：",
    standards,
    "本週標準尚未成文，寫下一個方向，慢慢前進"
  );

  return [
    "📋 不努力時間有限管理局｜本週案件板",
    "",
    taskSection,
    "",
    standardSection,
    "",
    getLineCommandHintText(),
  ].join("\n");
}

// === LINE 小工具：格式化指定難度任務 ===
// 注意：這裡保留「清單」中的原始編號，避免使用者完成錯任務
function formatTasksByDifficultyForLine(tasks, difficulty) {
  const matchedTasks = tasks
    .map(function (task, index) {
      return {
        task,
        originalNumber: index + 1,
      };
    })
    .filter(function (entry) {
      return normalizeDifficulty(entry.task.difficulty) === difficulty;
    });

  if (matchedTasks.length === 0) {
    return [
      `📌 本週${difficulty}任務`,
      "",
      `目前沒有${difficulty}任務。`,
      "",
      "沒有案件也無妨，已經很棒。",
      "",
      "需要完整清單請輸入：清單",
    ].join("\n");
  }

  const lines = matchedTasks.map(function (entry) {
    const checkbox = entry.task.done ? "☑" : "☐";
    const category = normalizeCategory(entry.task.category);

    return `${entry.originalNumber}. ${checkbox} ${entry.task.title}（${category}）`;
  });

  return [
    `📌 本週${difficulty}任務`,
    "",
    ...lines,
    "",
    "以上編號沿用完整清單，可直接輸入：完成任務 編號",
    "步子再小，也算靠岸。",
    "",
    "需要完整清單請輸入：清單",
  ].join("\n");
}

// === LINE 小工具：把編號轉成真正的 item ===
async function findItemByNumber({ type, numberText, label }) {
  const itemNumber = Number(numberText);
  const displayLabel = getDisplayLabel(label);

  if (!Number.isInteger(itemNumber) || itemNumber <= 0) {
    return {
      error: [
        `這份公文還缺少正確的${displayLabel}編號，本局未更動資料。`,
        "",
        "可以這樣輸入：",
        `完成${label}3`,
        `完成第三個${label}`,
      ].join("\n"),
    };
  }

  const items = await getItemsByType(type);
  const targetItem = items[itemNumber - 1];

  if (!targetItem) {
    return {
      error: [
        `本局目前查無第 ${itemNumber} 個${displayLabel}。`,
        "",
        "可以先輸入「清單」確認編號，慢慢來，案件會排好。",
      ].join("\n"),
    };
  }

  return {
    itemNumber,
    item: targetItem,
    items,
  };
}

// === LINE 小工具：回覆 LINE 訊息 ===
async function replyToLine(replyToken, replyText) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.error("缺少 LINE_CHANNEL_ACCESS_TOKEN，無法回覆 LINE 訊息");
    return;
  }

  const lineResponse = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [
        {
          type: "text",
          text: replyText,
        },
      ],
    }),
  });

  if (!lineResponse.ok) {
    const errorText = await lineResponse.text();
    console.error("LINE Reply API 回覆失敗：", lineResponse.status, errorText);
  }
}

// === LINE 小工具：攻略 ===
function getGuideText() {
  return [
    "📋 不努力時間有限管理局｜辦事攻略",
    "",
    "管理局小櫃台受理以下案件。",
    "格式不用完美，補齊即可辦理。",
    "",
    "━━━━━━━━━━━━",
    "🔎 一、查看案件",
    "━━━━━━━━━━━━",
    "📌 清單",
    "查看本週任務與本週驗收標準",
    "",
    "📌 簡單任務",
    "查看難度為「簡單」的任務",
    "",
    "📌 適中任務",
    "查看難度為「適中」的任務",
    "",
    "📌 困難任務",
    "查看難度為「困難」的任務",
    "",
    "━━━━━━━━━━━━",
    "📝 二、新增案件",
    "━━━━━━━━━━━━",
    "📌 新增任務 任務內容",
    "例：新增任務 練習 CSS",
    "",
    "📌 新增任務 任務內容｜分類｜難度",
    "例：新增任務 練習 CSS Flex｜程式學習｜適中",
    "",
    "可用分類：",
    "・程式學習",
    "・身心穩定",
    "・興趣探索",
    "",
    "可用難度：",
    "・簡單",
    "・適中",
    "・困難",
    "",
    "━━━━━━━━━━━━",
    "✅ 三、辦理任務",
    "━━━━━━━━━━━━",
    "📌 完成任務3",
    "📌 完成第三個任務",
    "📌 已完成第 3 個任務",
    "",
    "📌 取消任務3",
    "撤回已辦理狀態",
    "",
    "📌 修改任務3",
    "本局會請你輸入新文字",
    "",
    "📌 刪除任務3",
    "將該任務撤案",
    "",
    "━━━━━━━━━━━━",
    "📎 四、本週驗收標準",
    "━━━━━━━━━━━━",
    "📌 新增標準 本週能說明一個學到的觀念",
    "📌 新增標準 本週有整理一次學習筆記",
    "📌 新增標準 本週有完成一個小練習",
    "",
    "📌 完成標準2",
    "📌 取消標準2",
    "📌 修改標準2",
    "📌 刪除標準2",
    "",
    "驗收標準是看見本週靠近了哪裡，",
    "不是拿來規定自己完成幾個。",
    "",
    "━━━━━━━━━━━━",
    "🛑 五、修訂中止",
    "━━━━━━━━━━━━",
    "📌 取消修改",
    "若本局正在等你輸入新文字，",
    "可用此指令取消修訂。",
    "",
    "━━━━━━━━━━━━",
    "🌿 本局提醒",
    "━━━━━━━━━━━━",
    "今日有學，即可記上一筆。",
    "步子再小，也算靠岸。",
  ].join("\n");
}

// === LINE 小工具：用量小抄 ===
function getUsageText() {
  return [
    "📮 不努力時間有限管理局｜LINE 用量小抄",
    "",
    "【通常不太吃每月訊息額度】",
    "你主動傳訊息，Bot 立刻回覆：",
    "- 清單",
    "- 攻略",
    "- 用量小抄",
    "- 新增任務 任務內容",
    "- 完成任務 數字",
    "- 修改任務 數字",
    "- 點選圖文選單後，Bot 立刻回覆",
    "",
    "這類通常是 reply message。",
    "意思是：你先敲櫃台，管理局小櫃台立刻回你。",
    "",
    "【會計入訊息額度】",
    "Bot 主動傳給你：",
    "- 每日提醒",
    "- 主動補提醒",
    "- 主動通知你還沒完成",
    "- 群發 / 廣播",
    "",
    "這類通常是 push message。",
    "意思是：管理局主動派公文到你家。",
    "",
    "【目前本局規則】",
    "- 每天主動提醒最多 1 則",
    "- 你自己打指令，Bot 立刻回覆，走 reply",
    "- 不做群發",
    "- 不做廣播",
    "- 不亂發主動通知",
    "",
    "【一人使用估算】",
    "每天提醒 1 次：約 30 則 / 月",
    "",
    "輕用量方案目前：",
    "月費 0 元",
    "免費訊息 200 則 / 月",
    "",
    "所以一人使用，每天提醒 1 次很安全。",
    "",
    "本局提醒：你主動問，不太燒額度；管理局主動找你，才要算郵資。",
  ].join("\n");
}

// === LINE 小工具：處理等待中的修改 ===
async function handlePendingActionIfNeeded(sourceKey, userText) {
  const pending = pendingActions.get(sourceKey);

  if (!pending) {
    return null;
  }

  const displayLabel = getDisplayLabel(pending.label);

  if (userText === "取消修改") {
    pendingActions.delete(sourceKey);
    return "已取消這次修訂。本局把待辦公文收回抽屜了。";
  }

  const isExpired = Date.now() - pending.createdAt > PENDING_ACTION_TTL_MS;

  if (isExpired) {
    pendingActions.delete(sourceKey);

    return [
      "這次修訂已經逾時，本局未更動資料。",
      "",
      `可以重新輸入：修改${pending.label} 數字`,
      "",
      "慢慢來，案件不會責備你。",
    ].join("\n");
  }

  const newTitle = userText.trim();

  if (!newTitle) {
    return `請輸入新的${displayLabel}文字，或輸入「取消修改」。`;
  }

  const updatedItem = await updateItemToGoogleSheets(pending.itemId, {
    title: newTitle,
  });

  pendingActions.delete(sourceKey);

  return [
    `已修訂第 ${pending.itemNumber} 個${displayLabel}：`,
    updatedItem.title || newTitle,
    "",
    "本局已更新公文內容，請安心續辦。",
  ].join("\n");
}

// === LINE 小工具：解析新增文字裡的分類與難度 ===
function parseCreateText({ userText, command }) {
  let rawText = userText.replace(new RegExp(`^${command}\\s*`), "").trim();
  rawText = rawText.replace(/^[：:]/, "").trim();

  if (!rawText) {
    return {
      title: "",
      category: DEFAULT_CATEGORY,
      difficulty: DEFAULT_DIFFICULTY,
    };
  }

  const delimiterPattern = /\s*[\/｜|，,、]\s*/;

  const parts = rawText
    .split(delimiterPattern)
    .map(function (part) {
      return part.trim();
    })
    .filter(Boolean);

  return {
    title: parts[0] || "",
    category: parts[1] || DEFAULT_CATEGORY,
    difficulty: parts[2] || DEFAULT_DIFFICULTY,
  };
}

// === LINE 小工具：處理新增 ===
async function handleCreateCommand({ userText, command, type, label, example }) {
  const parsed = parseCreateText({
    userText,
    command,
  });

  const displayLabel = getDisplayLabel(label);

  if (!parsed.title) {
    return [
      `這份立案公文還缺少${displayLabel}內容，本局未更動資料。`,
      "",
      `可以這樣輸入：${command} ${label}內容`,
      `例：${command} ${example}`,
      "",
      "任務也可以加分類與難度：",
      "例：新增任務 練習 CSS / 程式學習 / 適中",
      "例：新增任務 練習 CSS｜程式學習｜適中",
    ].join("\n");
  }

  let category;
  let difficulty;

  try {
    category = normalizeCategory(parsed.category);
    difficulty = normalizeDifficulty(parsed.difficulty);
  } catch (error) {
    return [
      "分類或難度需要補正，本局未更動資料。",
      "",
      error.message,
      "",
      "可以這樣輸入：",
      "新增任務 練習 CSS / 程式學習 / 適中",
      "新增任務 練習 CSS｜程式學習｜適中",
    ].join("\n");
  }

  const createdItem = await createItemToGoogleSheets({
    type,
    title: parsed.title,
    category,
    difficulty,
  });

  const titleText =
    createdItem.type === "task"
      ? "管理局小櫃台已立案："
      : "管理局小櫃台已新增本週驗收標準：";

  const metaText =
    createdItem.type === "task"
      ? `分類：${createdItem.category}｜難度：${createdItem.difficulty}`
      : "這份標準會用來看見本週靠近了哪裡。";

  return [
    titleText,
    `☐ ${createdItem.title || parsed.title}`,
    metaText,
    "",
    getGentleFooterText(),
    "",
    "可以輸入「清單」查看目前案件板。",
  ].join("\n");
}

// === LINE 小工具：處理完成 / 取消 ===
async function handleDoneCommand({ numberText, type, label, done }) {
  const result = await findItemByNumber({
    type,
    numberText,
    label,
  });

  if (result.error) {
    return result.error;
  }

  const updatedItem = await updateItemToGoogleSheets(result.item.id, {
    done,
  });

  const checkbox = done ? "☑" : "☐";
  const actionText = done ? "已辦理" : "已撤回辦理";
  const displayLabel = getDisplayLabel(label);

  return [
    `${actionText}第 ${result.itemNumber} 個${displayLabel}：`,
    `${checkbox} ${updatedItem.title || result.item.title}`,
    "",
    "步子再小，也算靠岸。",
  ].join("\n");
}

// === LINE 小工具：處理刪除 ===
async function handleDeleteCommand({ numberText, type, label }) {
  const result = await findItemByNumber({
    type,
    numberText,
    label,
  });

  if (result.error) {
    return result.error;
  }

  const deletedTitle = result.item.title;
  const displayLabel = getDisplayLabel(label);

  await deleteItemFromGoogleSheets(result.item.id);

  return [
    `已撤案第 ${result.itemNumber} 個${displayLabel}：`,
    deletedTitle,
    "",
    "本局已更新案件板，資料不再列入本週。",
  ].join("\n");
}

// === LINE 小工具：處理修改 ===
async function handleEditCommand({
  sourceKey,
  numberText,
  newTitle,
  type,
  label,
}) {
  const result = await findItemByNumber({
    type,
    numberText,
    label,
  });

  if (result.error) {
    return result.error;
  }

  const displayLabel = getDisplayLabel(label);

  if (newTitle && newTitle.trim()) {
    const updatedItem = await updateItemToGoogleSheets(result.item.id, {
      title: newTitle.trim(),
    });

    return [
      `已修訂第 ${result.itemNumber} 個${displayLabel}：`,
      updatedItem.title || newTitle.trim(),
      "",
      "本局已更新公文內容，請安心續辦。",
    ].join("\n");
  }

  pendingActions.set(sourceKey, {
    action: "edit",
    type,
    label,
    itemNumber: result.itemNumber,
    itemId: result.item.id,
    oldTitle: result.item.title,
    createdAt: Date.now(),
  });

  return [
    `請輸入第 ${result.itemNumber} 個${displayLabel}的新文字：`,
    "",
    `目前內容：${result.item.title}`,
    "",
    "如果暫時不想修訂，請輸入：取消修改",
  ].join("\n");
}

// === LINE 小工具：把中文數字轉成阿拉伯數字 ===
function parseFlexibleNumber(numberText) {
  const text = String(numberText || "").trim().replace(/兩/g, "二");

  if (/^\d+$/.test(text)) {
    return Number(text);
  }

  const digitMap = {
    零: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (text.length === 1 && digitMap[text] !== undefined) {
    return digitMap[text];
  }

  if (text.includes("十")) {
    const parts = text.split("十");
    const tenPart = parts[0];
    const onePart = parts[1];

    const tens = tenPart === "" ? 1 : digitMap[tenPart];
    const ones = onePart === "" ? 0 : digitMap[onePart];

    if (tens === undefined || ones === undefined) {
      return null;
    }

    return tens * 10 + ones;
  }

  return null;
}

// === LINE 小工具：把自然語句解析成操作指令 ===
function buildLineOperationCommand(actionText, targetText, numberText, newTitle) {
  const number = parseFlexibleNumber(numberText);

  if (!Number.isInteger(number) || number <= 0) {
    return {
      error:
        "這份公文還缺少正確編號，本局未更動資料。可以這樣輸入：完成第 3 個任務",
    };
  }

  const isTask = targetText.includes("任務");

  let action = "";

  if (actionText === "完成" || actionText === "已完成") {
    action = "done";
  }

  if (actionText === "取消") {
    action = "cancel";
  }

  if (actionText === "修改") {
    action = "edit";
  }

  if (actionText === "刪除") {
    action = "delete";
  }

  return {
    action,
    numberText: String(number),
    newTitle,
    type: isTask ? "task" : "standard",
    label: isTask ? "任務" : "完成標準",
  };
}

// === LINE 小工具：解析完成 / 取消 / 修改 / 刪除指令 ===
function parseLineOperationCommand(userText) {
  let match = userText.match(
    /^(完成|已完成|取消|修改|刪除)\s*(任務|完成標準|標準)\s*(\d+|[零一二三四五六七八九十兩]+)(?:\s+(.+))?$/
  );

  if (match) {
    return buildLineOperationCommand(match[1], match[2], match[3], match[4]);
  }

  match = userText.match(
    /^(完成|已完成|取消|修改|刪除)\s*第?\s*(\d+|[零一二三四五六七八九十兩]+)\s*個?\s*(任務|完成標準|標準)(?:\s+(.+))?$/
  );

  if (match) {
    return buildLineOperationCommand(match[1], match[3], match[2], match[4]);
  }

  return null;
}

// === LINE 小工具：格式需補正提醒 ===
function getFormatReminderText() {
  return [
    "這份公文格式需補正，本局未更動資料。",
    "",
    "可以這樣輸入：",
    "完成任務3",
    "完成第 3 個任務",
    "完成第三個任務",
    "已完成第三個任務",
    "",
    "取消任務3",
    "修改任務3",
    "刪除任務3",
    "",
    "完成標準2",
    "取消第二個標準",
    "修改第 2 個標準",
    "刪除第二個標準",
    "",
    "新增任務 練習 CSS / 程式學習 / 適中",
    "新增任務 練習 CSS｜程式學習｜適中",
    "",
    "不急著一次寫完，先把格式補齊就好。",
    "",
    getLineCommandHintText(),
  ].join("\n");
}

// === LINE 小工具：未知文字提醒 ===
function getUnknownCommandText() {
  return [
    "本局目前看不懂這份公文，所以未更動資料。",
    "",
    "可以輸入「清單」查看本週案件板，或輸入「攻略」查看辦事方式。",
    "",
    "慢慢來，先讓案件排成一列。",
    "",
    getLineCommandHintText(),
  ].join("\n");
}

// === LINE 小工具：處理文字指令 ===
async function handleLineTextCommand({ sourceKey, userText }) {
  const pendingReply = await handlePendingActionIfNeeded(sourceKey, userText);

  if (pendingReply) {
    return pendingReply;
  }

  if (
    userText === "攻略" ||
    userText === "說明" ||
    userText === "help" ||
    userText === "Help"
  ) {
    return getGuideText();
  }

  if (
    userText === "用量" ||
    userText === "用量小抄" ||
    userText === "訊息用量"
  ) {
    return getUsageText();
  }

  if (userText === "清單" || userText === "全部清單") {
    const board = await getTaskBoardForLine();
    return formatTaskBoardForLine(board);
  }

  if (userText === "簡單任務" || userText === "簡單") {
    const tasks = await getItemsByType("task");
    return formatTasksByDifficultyForLine(tasks, "簡單");
  }

  if (userText === "適中任務" || userText === "適中") {
    const tasks = await getItemsByType("task");
    return formatTasksByDifficultyForLine(tasks, "適中");
  }

  if (userText === "困難任務" || userText === "困難") {
    const tasks = await getItemsByType("task");
    return formatTasksByDifficultyForLine(tasks, "困難");
  }

  if (userText.startsWith("新增一個任務")) {
    return handleCreateCommand({
      userText,
      command: "新增一個任務",
      type: "task",
      label: "任務",
      example: "練習 LINE Bot",
    });
  }

  if (userText.startsWith("新增任務")) {
    return handleCreateCommand({
      userText,
      command: "新增任務",
      type: "task",
      label: "任務",
      example: "練習 LINE Bot",
    });
  }

  if (userText.startsWith("新增一個完成標準")) {
    return handleCreateCommand({
      userText,
      command: "新增一個完成標準",
      type: "standard",
      label: "完成標準",
      example: "本週能說明一個學到的觀念",
    });
  }

  if (userText.startsWith("新增一個標準")) {
    return handleCreateCommand({
      userText,
      command: "新增一個標準",
      type: "standard",
      label: "完成標準",
      example: "本週能說明一個學到的觀念",
    });
  }

  if (userText.startsWith("新增標準")) {
    return handleCreateCommand({
      userText,
      command: "新增標準",
      type: "standard",
      label: "完成標準",
      example: "本週能說明一個學到的觀念",
    });
  }

  const operation = parseLineOperationCommand(userText);

  if (operation) {
    if (operation.error) {
      return operation.error;
    }

    if (operation.action === "done") {
      return handleDoneCommand({
        numberText: operation.numberText,
        type: operation.type,
        label: operation.label,
        done: true,
      });
    }

    if (operation.action === "cancel") {
      return handleDoneCommand({
        numberText: operation.numberText,
        type: operation.type,
        label: operation.label,
        done: false,
      });
    }

    if (operation.action === "edit") {
      return handleEditCommand({
        sourceKey,
        numberText: operation.numberText,
        newTitle: operation.newTitle,
        type: operation.type,
        label: operation.label,
      });
    }

    if (operation.action === "delete") {
      return handleDeleteCommand({
        numberText: operation.numberText,
        type: operation.type,
        label: operation.label,
      });
    }
  }

  if (
    userText.startsWith("完成") ||
    userText.startsWith("已完成") ||
    userText.startsWith("取消") ||
    userText.startsWith("修改") ||
    userText.startsWith("刪除") ||
    userText.startsWith("新增")
  ) {
    return getFormatReminderText();
  }

  return getUnknownCommandText();
}

// === 首頁測試 ===
app.get("/", (req, res) => {
  res.send("不努力時間有限管理局 API 開張中。本局小櫃台今日值班。");
});

// === LINE Webhook：處理 LINE 聊天指令 ===
app.post("/line/webhook", async (req, res) => {
  console.log("收到 LINE Webhook：", req.body);

  const events = req.body.events || [];

  for (const event of events) {
    try {
      if (event.type !== "message" || event.message.type !== "text") {
        continue;
      }

      const sourceKey = getLineSourceKey(event);
      const userText = event.message.text.trim();
      const replyToken = event.replyToken;

      const replyText = await handleLineTextCommand({
        sourceKey,
        userText,
      });

      await replyToLine(replyToken, replyText);
    } catch (error) {
      console.error("處理 LINE Webhook 發生錯誤：", error);

      if (event.replyToken) {
        await replyToLine(
          event.replyToken,
          "管理局小櫃台剛剛卡住了，本局未更動資料。請稍後再試一次。"
        );
      }
    }
  }

  res.status(200).send("OK");
});

// === Read：讀取所有 items ===
app.get("/items", async (req, res) => {
  try {
    const items = await fetchItemsFromGoogleSheets();
    res.json(items);
  } catch (error) {
    console.error("GET /items 讀取 Google Sheets 發生錯誤：", error);

    res.status(500).json({
      message: "讀取 Google Sheets 資料失敗",
      error: error.message,
    });
  }
});

// === Create：新增 item ===
app.post("/items", async (req, res) => {
  try {
    const { type, title, category, difficulty } = req.body;

    if (!type || !title) {
      return res.status(400).json({
        message: "type 和 title 都是必填",
      });
    }

    if (type !== "task" && type !== "standard") {
      return res.status(400).json({
        message: "type 只能是 task 或 standard",
      });
    }

    const createdItem = await createItemToGoogleSheets({
      type,
      title,
      category,
      difficulty,
    });

    res.status(201).json(createdItem);
  } catch (error) {
    console.error("POST /items 新增 Google Sheets 發生錯誤：", error);

    res.status(500).json({
      message: "新增資料到 Google Sheets 失敗",
      error: error.message,
    });
  }
});

// === Update：更新 item ===
app.patch("/items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, done, category, difficulty } = req.body;

    const updates = {};

    if (title !== undefined) {
      updates.title = title;
    }

    if (done !== undefined) {
      updates.done = done;
    }

    if (category !== undefined) {
      updates.category = category;
    }

    if (difficulty !== undefined) {
      updates.difficulty = difficulty;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message: "沒有收到要更新的欄位",
      });
    }

    const updatedItem = await updateItemToGoogleSheets(id, updates);

    res.json(updatedItem);
  } catch (error) {
    console.error("PATCH /items/:id 更新 Google Sheets 發生錯誤：", error);

    res.status(500).json({
      message: "更新資料到 Google Sheets 失敗",
      error: error.message,
    });
  }
});

// === Delete：刪除 item ===
app.delete("/items/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const deletedItem = await deleteItemFromGoogleSheets(id);

    res.json({
      message: "刪除成功",
      id: deletedItem.id,
      item: deletedItem,
    });
  } catch (error) {
    console.error("DELETE /items/:id 刪除 Google Sheets 發生錯誤：", error);

    res.status(500).json({
      message: "刪除 Google Sheets 資料失敗",
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`不努力時間有限管理局後端啟動：http://localhost:${PORT}`);
});