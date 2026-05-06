require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

const PORT = process.env.PORT || 3000;

const GOOGLE_SHEETS_API_URL = process.env.GOOGLE_SHEETS_API_URL;
const GOOGLE_SHEETS_API_SECRET = process.env.GOOGLE_SHEETS_API_SECRET;

// LINE Bot 回覆訊息用
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// 暫存多步驟操作，例如「修改任務 1」之後等待使用者輸入新文字
const pendingActions = new Map();
const PENDING_ACTION_TTL_MS = 10 * 60 * 1000; // 10 分鐘後視為過期

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

  return data.items;
}

// === 共用函式：新增 item 到 Google Sheets ===
async function createItemToGoogleSheets({ type, title }) {
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

  return data.item;
}

// === 共用函式：更新 item 到 Google Sheets ===
async function updateItemToGoogleSheets(id, updates) {
  const response = await fetch(GOOGLE_SHEETS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      secret: GOOGLE_SHEETS_API_SECRET,
      action: "update",
      id,
      updates,
    }),
  });

  if (!response.ok) {
    throw new Error("呼叫 Google Apps Script 更新失敗，狀態碼：" + response.status);
  }

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.message || "Google Apps Script 更新資料失敗");
  }

  return data.item;
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

  return data.item;
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
  return items.filter((item) => item.type === type);
}

// === LINE 小工具：取得任務與完成標準 ===
async function getTaskBoardForLine() {
  const items = await fetchItemsFromGoogleSheets();

  return {
    tasks: items.filter((item) => item.type === "task"),
    standards: items.filter((item) => item.type === "standard"),
  };
}

// === LINE 小工具：清單底部固定提示 ===
function getLineCommandHintText() {
  return [
    "需要操作說明請輸入：攻略",
    "想看用量請輸入：用量小抄",
  ].join("\n");
}

// === LINE 小工具：格式化單一區塊 ===
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
  const taskSection = formatLineSection(
    "本週任務：",
    tasks,
    "目前沒有任務。"
  );

  const standardSection = formatLineSection(
    "完成標準：",
    standards,
    "目前沒有完成標準。"
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

// === LINE 小工具：把編號轉成真正的 item ===
async function findItemByNumber({ type, numberText, label }) {
  const itemNumber = Number(numberText);

  if (!Number.isInteger(itemNumber) || itemNumber <= 0) {
    return {
      error: `請輸入正確的${label}編號，例如：完成${label} 數字`,
    };
  }

  const items = await getItemsByType(type);
  const targetItem = items[itemNumber - 1];

  if (!targetItem) {
    return {
      error: `找不到第 ${itemNumber} 個${label}，請先輸入「清單」確認編號。`,
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
    "本局目前受理以下指令。",
    "指令可以用正式格式，也可以用比較自然的講法。",
    "",
    "【查看】",
    "清單",
    "查看本週任務與完成標準",
    "",
    "攻略",
    "查看這份辦事攻略",
    "",
    "用量小抄",
    "查看 LINE 訊息用量說明",
    "",
    "【新增】",
    "新增任務 任務內容",
    "例：新增任務 練習 CSS",
    "例：新增任務：練習 CSS",
    "例：新增一個任務：練習 CSS",
    "",
    "新增標準 完成標準內容",
    "例：新增標準 可以說明今天學到什麼",
    "例：新增一個標準：可以說明今天學到什麼",
    "",
    "【任務辦理】",
    "完成任務 數字",
    "例：完成任務 3",
    "例：完成任務3",
    "例：完成第 3 個任務",
    "例：完成第三個任務",
    "例：已完成第三個任務",
    "",
    "取消任務 數字",
    "例：取消任務3",
    "例：取消第三個任務",
    "",
    "修改任務 數字",
    "意思：修改指定編號任務的文字，本局會再問你新文字",
    "例：修改任務3",
    "例：修改第三個任務",
    "",
    "修改任務 數字 新文字",
    "意思：也可以一行直接修改完成",
    "例：修改任務 1 練習 LINE 指令 CRUD",
    "",
    "刪除任務 數字",
    "例：刪除任務3",
    "例：刪除第三個任務",
    "",
    "【完成標準辦理】",
    "完成標準 數字",
    "例：完成標準2",
    "例：完成第二個標準",
    "",
    "取消標準 數字",
    "例：取消標準2",
    "例：取消第二個標準",
    "",
    "修改標準 數字",
    "例：修改標準2",
    "例：修改第二個標準",
    "",
    "刪除標準 數字",
    "例：刪除標準2",
    "例：刪除第二個標準",
    "",
    "【修改中止】",
    "取消修改",
    "意思：如果本局正在等你輸入新文字，可以取消這次修改",
    "",
    "本局溫馨提醒：",
    "不要一開張又關門。",
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
    "意思是：你先敲櫃台，管理局立刻回你。",
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
    "本局溫馨提醒：",
    "你主動問，不太燒額度。",
    "管理局主動找你，才要算郵資。",
  ].join("\n");
}

// === LINE 小工具：處理等待中的修改 ===
async function handlePendingActionIfNeeded(sourceKey, userText) {
  const pending = pendingActions.get(sourceKey);

  if (!pending) {
    return null;
  }

  if (userText === "取消修改") {
    pendingActions.delete(sourceKey);
    return "已取消這次修改。本局把待辦公文收回抽屜了。";
  }

  const isExpired = Date.now() - pending.createdAt > PENDING_ACTION_TTL_MS;

  if (isExpired) {
    pendingActions.delete(sourceKey);

    return [
      "這次修改已經逾時，請重新操作。",
      "",
      `例：修改${pending.label} 數字`,
    ].join("\n");
  }

  const newTitle = userText.trim();

  if (!newTitle) {
    return `請輸入新的${pending.label}文字，或輸入「取消修改」。`;
  }

  const updatedItem = await updateItemToGoogleSheets(pending.itemId, {
    title: newTitle,
  });

  pendingActions.delete(sourceKey);

  return [
    `已更新第 ${pending.itemNumber} 個${pending.label}：`,
    updatedItem.title || newTitle,
  ].join("\n");
}

// === LINE 小工具：處理新增 ===
async function handleCreateCommand({ userText, command, type, label, example }) {
  // 支援：
  // 新增任務練習 CSS
  // 新增任務 練習 CSS
  // 新增任務：練習 CSS
  // 新增一個任務：練習 CSS
  let title = userText.replace(new RegExp(`^${command}\\s*`), "").trim();
  title = title.replace(/^[：:]/, "").trim();

  if (!title) {
    return [
      `請輸入${label}內容。`,
      "",
      `正確格式：${command} ${label}內容`,
      `例：${command} ${example}`,
      "",
      "提醒：指令和內容中間建議加空格，或用冒號也可以。",
    ].join("\n");
  }

  const createdItem = await createItemToGoogleSheets({
    type,
    title,
  });

  return [
    `已新增${label}：`,
    `☐ ${createdItem.title || title}`,
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
  const actionText = done ? "已完成" : "已取消完成";

  return [
    `${actionText}第 ${result.itemNumber} 個${label}：`,
    `${checkbox} ${updatedItem.title || result.item.title}`,
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

  await deleteItemFromGoogleSheets(result.item.id);

  return [
    `已刪除第 ${result.itemNumber} 個${label}：`,
    deletedTitle,
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

  // 一行式修改：修改任務 1 新文字
  if (newTitle && newTitle.trim()) {
    const updatedItem = await updateItemToGoogleSheets(result.item.id, {
      title: newTitle.trim(),
    });

    return [
      `已更新第 ${result.itemNumber} 個${label}：`,
      updatedItem.title || newTitle.trim(),
    ].join("\n");
  }

  // 兩步式修改：修改任務 1 → 下一句輸入新文字
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
    `請輸入第 ${result.itemNumber} 個${label}的新文字：`,
    "",
    `目前內容：${result.item.title}`,
    "",
    "如果不想修改，請輸入：取消修改",
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

  // 支援：十、十一、二十、二十三
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
      error: "請輸入正確的編號，例如：完成第 3 個任務",
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
  // 格式一：完成任務3、完成任務 3、修改標準2 新文字
  let match = userText.match(
    /^(完成|已完成|取消|修改|刪除)\s*(任務|完成標準|標準)\s*(\d+|[零一二三四五六七八九十兩]+)(?:\s+(.+))?$/
  );

  if (match) {
    return buildLineOperationCommand(match[1], match[2], match[3], match[4]);
  }

  // 格式二：完成第3個任務、已完成第三個任務、刪除第 2 個標準
  match = userText.match(
    /^(完成|已完成|取消|修改|刪除)\s*第?\s*(\d+|[零一二三四五六七八九十兩]+)\s*個?\s*(任務|完成標準|標準)(?:\s+(.+))?$/
  );

  if (match) {
    return buildLineOperationCommand(match[1], match[3], match[2], match[4]);
  }

  return null;
}

// === LINE 小工具：格式錯誤提醒 ===
function getFormatReminderText() {
  return [
    "本局看得出你想辦事，但格式有點歪，所以沒有處理任何資料。",
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
    getLineCommandHintText(),
  ].join("\n");
}

// === LINE 小工具：未知文字提醒 ===
function getUnknownCommandText() {
  return [
    "本局看不懂這個指令，所以沒有處理任何資料。",
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

  // === 查看類 ===
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

  if (userText === "清單") {
    const board = await getTaskBoardForLine();
    return formatTaskBoardForLine(board);
  }

  // === 新增類：任務 ===
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

  // === 新增類：完成標準 ===
  if (userText.startsWith("新增一個完成標準")) {
    return handleCreateCommand({
      userText,
      command: "新增一個完成標準",
      type: "standard",
      label: "完成標準",
      example: "可以用 LINE 新增任務",
    });
  }

  if (userText.startsWith("新增一個標準")) {
    return handleCreateCommand({
      userText,
      command: "新增一個標準",
      type: "standard",
      label: "完成標準",
      example: "可以用 LINE 新增任務",
    });
  }

  if (userText.startsWith("新增標準")) {
    return handleCreateCommand({
      userText,
      command: "新增標準",
      type: "standard",
      label: "完成標準",
      example: "可以用 LINE 新增任務",
    });
  }

  // === 完成 / 取消 / 修改 / 刪除：支援自然語句 ===
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

  // === 格式提醒：看起來想操作，但格式不完整或看不懂 ===
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

  // === 其他文字：不要回「管理局收到」，避免誤會已經處理 ===
  return getUnknownCommandText();
}

// === 首頁測試 ===
app.get("/", (req, res) => {
  res.send("不努力時間有限管理局 API 開張中");
});

// === LINE Webhook：處理 LINE 聊天指令 ===
app.post("/line/webhook", async (req, res) => {
  console.log("收到 LINE Webhook：", req.body);

  const events = req.body.events || [];

  for (const event of events) {
    try {
      // 目前只處理文字訊息，貼圖、圖片、加入好友事件先略過
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
          "管理局櫃台剛剛卡住了，請稍後再試一次。"
        );
      }
    }
  }

  // 告訴 LINE：後端已收到 webhook
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
    const { type, title } = req.body;

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

    const createdItem = await createItemToGoogleSheets({ type, title });

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
// 用於打勾 / 取消打勾 / 編輯標題
app.patch("/items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, done } = req.body;

    const updates = {};

    if (title !== undefined) {
      updates.title = title;
    }

    if (done !== undefined) {
      updates.done = done;
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