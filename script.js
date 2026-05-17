// === Tiny Progress Google Sheets API + LINE Queue Gateway ===
// 支援：items / weeks / queue / LINE queue / subCategory

const SHEET_NAME = "items";
const QUEUE_SHEET_NAME = "queue";
const WEEKS_SHEET_NAME = "weeks";

const CATEGORY_OPTIONS = ["程式學習", "身心穩定", "興趣探索"];
const SUBCATEGORY_OPTIONS = ["觀看課程影片", "練習", "寫筆記", "W3Schools"];
const DIFFICULTY_OPTIONS = ["簡單", "適中", "困難"];

const DEFAULT_CATEGORY = "程式學習";
const DEFAULT_SUBCATEGORY = "觀看課程影片";
const EMPTY_SUBCATEGORY = "未分類";
const DEFAULT_DIFFICULTY = "簡單";

const WEEK_STATUS_OPTIONS = ["completed", "current", "next", "upcoming"];

const MAX_RETRY_COUNT = 5;
const RETRY_BATCH_SIZE = 5;

const FALLBACK_RECEIVED_MESSAGE = "已收件，後端醒來後補送。";
const DUPLICATE_PENDING_MESSAGE_REPLY = "這筆公文已收件，後端醒來後補送。請先不用重複送件。";
const DUPLICATE_PROCESSING_MESSAGE_REPLY = "這筆公文正在處理中，請先不用重複送件。";
const DUPLICATE_RECENT_WRITE_MESSAGE_REPLY = "這筆公文剛剛已辦理，為避免重複更動，本局先沒有再受理一次。";

const RECENT_WRITE_DEDUPE_WINDOW_MS = 30 * 1000;
const PROCESSING_STALE_AFTER_MS = 10 * 60 * 1000;

const HEADERS = [
  "id",
  "type",
  "title",
  "category",
  "subCategory",
  "difficulty",
  "done",
  "weekNumber",
  "weekStart",
  "weekEnd",
  "createdAt",
  "updatedAt",
];

const WEEK_HEADERS = [
  "weekNumber",
  "title",
  "achievement",
  "status",
  "weekStart",
  "weekEnd",
];

const QUEUE_HEADERS = [
  "id",
  "userId",
  "messageText",
  "replyToken",
  "status",
  "retryCount",
  "createdAt",
  "updatedAt",
  "lastError",
];

function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.mode === "health") {
      return ContentService
        .createTextOutput("LINE queue gateway is alive")
        .setMimeType(ContentService.MimeType.TEXT);
    }

    checkSecret(e && e.parameter && e.parameter.secret);

    const resource = String((e && e.parameter && e.parameter.resource) || "items").trim();

    if (resource === "weeks") {
      return jsonResponse({ ok: true, resource: "weeks", weeks: getWeeksFromSheet() });
    }

    if (resource === "week-context") {
  const context = getWeekContextFromSheet();

  return jsonResponse({
    ok: true,
    resource: "week-context",
    currentWeek: context.currentWeek,
    nextWeek: context.nextWeek,

    // 是否開放下週預排，交給 Code.gs 統一判斷
    canPlanNextWeek: context.canPlanNextWeek === true,
  });
}

    if (resource === "items") {
      return jsonResponse({ ok: true, resource: "items", message: "Tiny Progress Google Sheets API 開張中", items: getItemsFromSheet() });
    }

    return jsonResponse({ ok: false, message: "不支援的 resource：" + resource });
  } catch (error) {
    return jsonResponse({ ok: false, message: error.message });
  }
}

function doPost(e) {
  try {
    const body = parseJsonBody(e);

    if (isLineWebhookBody(body)) {
      const result = handleLineWebhookToQueue(body);
      return jsonResponse({ ok: true, action: "line_webhook_queue", message: "LINE webhook 已處理", result });
    }

    checkSecret(body.secret);

    const action = body.action || "create";

    if (action === "create") {
      const createdItem = createItemToSheet(body.item || body);
      return jsonResponse({ ok: true, action: "create", item: createdItem });
    }

    if (action === "update") {
      const updatedItem = updateItemInSheet(body.id, body.updates || {});
      return jsonResponse({ ok: true, action: "update", item: updatedItem });
    }

    if (action === "delete") {
      const deletedItem = deleteItemFromSheet(body.id);
      return jsonResponse({ ok: true, action: "delete", item: deletedItem });
    }

    if (action === "complete-current-week") {
      const result = completeCurrentWeekInSheet();
      return jsonResponse({ ok: true, action: "complete-current-week", result });
    }

    return jsonResponse({ ok: false, message: "不支援的 action：" + action });
  } catch (error) {
    Logger.log("doPost error = " + error.message);
    return jsonResponse({ ok: false, message: error.message });
  }
}

function getApiSecret() {
  const secret = PropertiesService.getScriptProperties().getProperty("API_SECRET");
  if (!secret) throw new Error("伺服器設定錯誤：缺少 Script Property API_SECRET");
  return secret;
}

function getLineChannelAccessToken() {
  const token = PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_ACCESS_TOKEN");
  if (!token) throw new Error("伺服器設定錯誤：缺少 Script Property LINE_CHANNEL_ACCESS_TOKEN");
  return token;
}

function getRenderLineWebhookUrl() {
  const url = PropertiesService.getScriptProperties().getProperty("RENDER_LINE_WEBHOOK_URL");
  if (!url) throw new Error("伺服器設定錯誤：缺少 Script Property RENDER_LINE_WEBHOOK_URL");
  return url;
}

function checkSecret(secret) {
  if (!secret) throw new Error("未授權：缺少 secret");
  if (secret !== getApiSecret()) throw new Error("未授權：secret 不正確");
}

function getWeeksFromSheet() {
  const sheet = getWeeksSheet();
  ensureWeekHeaders(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0].map(function (header) { return String(header).trim(); });

  return values
    .slice(1)
    .filter(function (row) { return row[0] !== ""; })
    .map(function (row) { return rowToWeek(headers, row); })
    .sort(function (a, b) { return a.weekNumber - b.weekNumber; });
}

function getWeekContextFromSheet() {
  return { currentWeek: getCurrentWeekFromSheet(), nextWeek: getNextWeekFromSheet() };
}

function getCurrentWeekFromSheet() {
  const currentWeeks = getWeeksFromSheet().filter(function (week) { return week.status === "current"; });
  if (currentWeeks.length === 0) throw new Error("weeks 工作表找不到 status = current 的週次");
  if (currentWeeks.length > 1) throw new Error("weeks 工作表有多筆 status = current，請只保留一筆目前週");
  return currentWeeks[0];
}

function getNextWeekFromSheet() {
  const nextWeeks = getWeeksFromSheet().filter(function (week) { return week.status === "next"; });
  if (nextWeeks.length === 0) return null;
  if (nextWeeks.length > 1) throw new Error("weeks 工作表有多筆 status = next，請只保留一筆下週");
  return nextWeeks[0];
}

function findWeekByNumber(weekNumber) {
  const targetWeekNumber = parsePositiveInteger(weekNumber);
  if (!targetWeekNumber) return null;
  return getWeeksFromSheet().find(function (week) { return week.weekNumber === targetWeekNumber; }) || null;
}

function findNextUpcomingWeek(weeks, afterWeekNumber) {
  return weeks
    .filter(function (week) { return week.status === "upcoming" && week.weekNumber > afterWeekNumber; })
    .sort(function (a, b) { return a.weekNumber - b.weekNumber; })[0] || null;
}

function completeCurrentWeekInSheet() {
  return withWeeksLock(function () {
    const weeks = getWeeksFromSheet();
    const currentWeeks = weeks.filter(function (week) { return week.status === "current"; });
    const nextWeeks = weeks.filter(function (week) { return week.status === "next"; });

    if (currentWeeks.length !== 1) throw new Error("weeks 工作表必須剛好有一筆 status = current");
    if (nextWeeks.length !== 1) throw new Error("目前沒有唯一的 next 週，無法進入下一週");

    const currentWeek = currentWeeks[0];
    const nextWeek = nextWeeks[0];
    const nextUpcomingWeek = findNextUpcomingWeek(weeks, nextWeek.weekNumber);

    updateWeekStatusInSheet(currentWeek.weekNumber, "completed");
    updateWeekStatusInSheet(nextWeek.weekNumber, "current");

    if (nextUpcomingWeek) updateWeekStatusInSheet(nextUpcomingWeek.weekNumber, "next");

    const latestContext = getWeekContextFromSheet();

    return {
      completedWeek: { ...currentWeek, status: "completed" },
      currentWeek: latestContext.currentWeek,
      nextWeek: latestContext.nextWeek,
    };
  });
}

function updateWeekStatusInSheet(weekNumber, newStatus) {
  const targetWeekNumber = parsePositiveInteger(weekNumber);
  const normalizedStatus = normalizeWeekStatus(newStatus);
  if (!targetWeekNumber) throw new Error("更新 week status 時 weekNumber 無效");

  const sheet = getWeeksSheet();
  ensureWeekHeaders(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) throw new Error("weeks 工作表沒有資料可以更新");

  const headers = values[0].map(function (header) { return String(header).trim(); });
  const weekNumberIndex = headers.indexOf("weekNumber");
  const statusIndex = headers.indexOf("status");
  if (weekNumberIndex === -1 || statusIndex === -1) throw new Error("weeks 工作表缺少 weekNumber 或 status 欄位");

  for (let i = 1; i < values.length; i++) {
    if (parsePositiveInteger(values[i][weekNumberIndex]) === targetWeekNumber) {
      sheet.getRange(i + 1, statusIndex + 1).setValue(normalizedStatus);
      return;
    }
  }

  throw new Error("找不到 weekNumber：" + targetWeekNumber);
}

function withWeeksLock(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30 * 1000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function getWeeksSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WEEKS_SHEET_NAME);
  if (!sheet) throw new Error("找不到工作表：" + WEEKS_SHEET_NAME);
  return sheet;
}

function ensureWeekHeaders(sheet) {
  const firstRow = sheet.getRange(1, 1, 1, WEEK_HEADERS.length).getValues()[0];
  const isEmpty = firstRow.every(function (cell) { return String(cell).trim() === ""; });
  if (isEmpty) {
    sheet.getRange(1, 1, 1, WEEK_HEADERS.length).setValues([WEEK_HEADERS]);
    return;
  }

  const isCorrect = WEEK_HEADERS.every(function (header, index) { return String(firstRow[index]).trim() === header; });
  if (!isCorrect) throw new Error("weeks 工作表欄位不正確，請確認第一列為：" + WEEK_HEADERS.join("、"));
}

function rowToWeek(headers, row) {
  const week = {};

  headers.forEach(function (header, index) {
    if (!header) return;
    let value = row[index];
    if (header === "weekNumber") value = parsePositiveInteger(value);
    if (header === "status") value = normalizeWeekStatus(value);
    if ((header === "weekStart" || header === "weekEnd") && value instanceof Date) value = formatDateYmd(value);
    week[header] = value;
  });

  if (!week.weekNumber) throw new Error("weeks 工作表有無效的 weekNumber");
  if (!week.title) throw new Error("weeks 工作表第 " + week.weekNumber + " 週缺少 title");
  if (!week.achievement) throw new Error("weeks 工作表第 " + week.weekNumber + " 週缺少 achievement");
  return week;
}

function normalizeWeekStatus(value) {
  const status = String(value || "").trim();
  if (!WEEK_STATUS_OPTIONS.includes(status)) throw new Error("weeks status 只能是：" + WEEK_STATUS_OPTIONS.join("、"));
  return status;
}

function parsePositiveInteger(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return null;
  return number;
}

function normalizeItemWeekNumber(value, fallbackWeekNumber) {
  return parsePositiveInteger(value) || parsePositiveInteger(fallbackWeekNumber);
}

function getCurrentWeekNumber() {
  return getCurrentWeekFromSheet().weekNumber;
}

function getWeekRangeForItem(weekNumber, fallbackDate) {
  const week = findWeekByNumber(weekNumber);
  if (week && week.weekStart && week.weekEnd) return { weekStart: week.weekStart, weekEnd: week.weekEnd };

  const currentWeekNumber = getCurrentWeekNumber();
  const targetDate = new Date(fallbackDate || new Date());
  const weekOffset = Number(weekNumber) - Number(currentWeekNumber);
  targetDate.setDate(targetDate.getDate() + weekOffset * 7);
  return getCurrentWeekRange(targetDate);
}

function getItemsFromSheet() {
  const sheet = getItemsSheet();
  ensureHeaders(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0].map(function (header) { return String(header).trim(); });
  const rows = values.slice(1);
  const currentWeekNumber = getCurrentWeekNumber();

  return rows
    .filter(function (row) { return row[0] !== ""; })
    .map(function (row) { return rowToItem(headers, row, currentWeekNumber); });
}

function createItemToSheet(input) {
  input = input || {};
  const sheet = getItemsSheet();
  ensureHeaders(sheet);

  const type = String(input.type || "").trim();
  const title = String(input.title || "").trim();

  if (type !== "task" && type !== "standard") throw new Error("type 只能是 task 或 standard");
  if (!title) throw new Error("title 是必填");

  const now = new Date();
  const nowIso = now.toISOString();
  const currentWeekNumber = getCurrentWeekNumber();
  const weekNumber = normalizeItemWeekNumber(input.weekNumber, currentWeekNumber);
  const weekRange = getWeekRangeForItem(weekNumber, now);
  const category = normalizeCategory(input.category);

  const item = {
    id: input.id || "item-" + Utilities.getUuid(),
    type,
    title,
    category,
    subCategory: normalizeSubCategory(input.subCategory, category),
    difficulty: normalizeDifficulty(input.difficulty),
    done: input.done === true || String(input.done).toUpperCase() === "TRUE",
    weekNumber,
    weekStart: input.weekStart || weekRange.weekStart,
    weekEnd: input.weekEnd || weekRange.weekEnd,
    createdAt: input.createdAt || nowIso,
    updatedAt: input.updatedAt || nowIso,
  };

  sheet.appendRow(HEADERS.map(function (header) { return item[header]; }));
  return item;
}

function updateItemInSheet(id, updates) {
  if (!id) throw new Error("更新資料時 id 是必填");
  updates = updates || {};

  const sheet = getItemsSheet();
  ensureHeaders(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) throw new Error("目前沒有任何資料可以更新");

  const headers = values[0].map(function (header) { return String(header).trim(); });
  const target = findRowById(values, headers, id);
  if (!target) throw new Error("找不到 id：" + id);

  const item = rowToItem(headers, target.row, getCurrentWeekNumber());

  if (updates.title !== undefined) {
    const newTitle = String(updates.title).trim();
    if (!newTitle) throw new Error("title 不能是空白");
    item.title = newTitle;
  }

  if (updates.category !== undefined) {
    item.category = normalizeCategory(updates.category);
    if (item.category !== "程式學習") item.subCategory = EMPTY_SUBCATEGORY;
  }

  if (updates.subCategory !== undefined) {
    item.subCategory = normalizeSubCategory(updates.subCategory, item.category);
  }

  if (updates.difficulty !== undefined) {
    item.difficulty = normalizeDifficulty(updates.difficulty);
  }

  if (updates.done !== undefined) {
    item.done = updates.done === true || String(updates.done).toUpperCase() === "TRUE";
  }

  if (updates.weekNumber !== undefined) {
    const nextWeekNumber = normalizeItemWeekNumber(updates.weekNumber, getCurrentWeekNumber());
    if (!findWeekByNumber(nextWeekNumber)) throw new Error("找不到 weekNumber：" + nextWeekNumber);
    item.weekNumber = nextWeekNumber;
    const weekRange = getWeekRangeForItem(nextWeekNumber, new Date());
    item.weekStart = weekRange.weekStart;
    item.weekEnd = weekRange.weekEnd;
  }

  item.updatedAt = new Date().toISOString();

  sheet.getRange(target.rowNumber, 1, 1, HEADERS.length).setValues([HEADERS.map(function (header) { return item[header]; })]);
  return item;
}

function deleteItemFromSheet(id) {
  if (!id) throw new Error("刪除資料時 id 是必填");

  const sheet = getItemsSheet();
  ensureHeaders(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) throw new Error("目前沒有任何資料可以刪除");

  const headers = values[0].map(function (header) { return String(header).trim(); });
  const target = findRowById(values, headers, id);
  if (!target) throw new Error("找不到 id：" + id);

  const deletedItem = rowToItem(headers, target.row, getCurrentWeekNumber());
  sheet.deleteRow(target.rowNumber);
  return deletedItem;
}

function normalizeCategory(value) {
  const category = String(value || "").trim();
  if (!category) return DEFAULT_CATEGORY;
  if (!CATEGORY_OPTIONS.includes(category)) throw new Error("category 只能是：" + CATEGORY_OPTIONS.join("、"));
  return category;
}

function normalizeSubCategory(value, category) {
  const normalizedCategory = normalizeCategory(category);
  if (normalizedCategory !== "程式學習") return EMPTY_SUBCATEGORY;

  const subCategory = String(value || "").trim();
  if (!subCategory) return DEFAULT_SUBCATEGORY;
  if (SUBCATEGORY_OPTIONS.includes(subCategory)) return subCategory;
  if (subCategory === EMPTY_SUBCATEGORY) return EMPTY_SUBCATEGORY;
  throw new Error("subCategory 只能是：" + SUBCATEGORY_OPTIONS.join("、"));
}

function normalizeDifficulty(value) {
  const difficulty = String(value || "").trim();
  if (!difficulty) return DEFAULT_DIFFICULTY;
  if (!DIFFICULTY_OPTIONS.includes(difficulty)) throw new Error("difficulty 只能是：" + DIFFICULTY_OPTIONS.join("、"));
  return difficulty;
}

function findRowById(values, headers, id) {
  const idColumnIndex = headers.indexOf("id");
  if (idColumnIndex === -1) throw new Error("找不到 id 欄位");

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idColumnIndex]) === String(id)) return { rowNumber: i + 1, row: values[i] };
  }
  return null;
}

function rowToItem(headers, row, fallbackWeekNumber) {
  const item = {};

  headers.forEach(function (header, index) {
    if (!header) return;
    let value = row[index];

    if (header === "done") value = value === true || String(value).toUpperCase() === "TRUE";
    if (header === "category") value = normalizeCategory(value);
    if (header === "subCategory") value = normalizeSubCategory(value, item.category || DEFAULT_CATEGORY);
    if (header === "difficulty") value = normalizeDifficulty(value);
    if (header === "weekNumber") value = normalizeItemWeekNumber(value, fallbackWeekNumber);

    if ((header === "weekStart" || header === "weekEnd") && value instanceof Date) {
      value = Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
    }

    if ((header === "createdAt" || header === "updatedAt") && value instanceof Date) {
      value = value.toISOString();
    }

    item[header] = value;
  });

  if (!item.category) item.category = DEFAULT_CATEGORY;
  if (!item.subCategory) item.subCategory = normalizeSubCategory("", item.category);
  if (!item.difficulty) item.difficulty = DEFAULT_DIFFICULTY;
  if (item.done === undefined || item.done === "") item.done = false;
  if (!item.weekNumber) item.weekNumber = normalizeItemWeekNumber("", fallbackWeekNumber);

  return item;
}

function getItemsSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error("找不到工作表：" + SHEET_NAME);
  return sheet;
}

function ensureHeaders(sheet) {
  const lastRow = Math.max(sheet.getLastRow(), 1);
  const lastColumn = Math.max(sheet.getLastColumn(), HEADERS.length);
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const currentHeaders = values[0].map(function (header) { return String(header).trim(); });
  const isEmpty = currentHeaders.every(function (header) { return header === ""; });

  if (isEmpty) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    return;
  }

  const isAlreadyNewHeaders = HEADERS.every(function (header, index) { return currentHeaders[index] === header; });
  if (isAlreadyNewHeaders) return;

  const hasBasicHeaders = currentHeaders.includes("id") && currentHeaders.includes("type") && currentHeaders.includes("title") && currentHeaders.includes("done");
  if (!hasBasicHeaders) throw new Error("items 工作表欄位名稱不正確，請確認第一列至少包含 id, type, title, done");

  const currentWeekNumber = getCurrentWeekNumber();
  const newValues = [HEADERS];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row[0] === "") continue;
    const item = rowToItem(currentHeaders, row, currentWeekNumber);
    newValues.push(HEADERS.map(function (header) { return item[header]; }));
  }

  sheet.clearContents();
  sheet.getRange(1, 1, newValues.length, HEADERS.length).setValues(newValues);
}

function isLineWebhookBody(body) {
  return body && Array.isArray(body.events);
}

function handleLineWebhookToQueue(body) {
  const events = body.events || [];
  const results = [];

  events.forEach(function (event) {
    if (!event.message || event.message.type !== "text") return;
    if (!event.source || !event.source.userId) return;
    if (!event.replyToken) return;

    const messageText = String(event.message.text || "").trim();
    if (!messageText) return;

    const admissionResult = createQueueMessageForImmediateProcessing({ userId: event.source.userId, messageText, replyToken: event.replyToken });

    if (admissionResult.duplicate) {
      const duplicate = admissionResult.duplicate;
      let replyText = DUPLICATE_PENDING_MESSAGE_REPLY;
      if (duplicate.reason === "processing") replyText = DUPLICATE_PROCESSING_MESSAGE_REPLY;
      if (duplicate.reason === "recent_done_write") replyText = DUPLICATE_RECENT_WRITE_MESSAGE_REPLY;

      try {
        const replyResult = replyLineMessage(event.replyToken, replyText);
        results.push({ duplicate: true, duplicateReason: duplicate.reason, reusedQueueId: duplicate.item.id, dedupeKey: duplicate.meta.key, replyResult });
      } catch (error) {
        results.push({ duplicate: true, duplicateReason: duplicate.reason, reusedQueueId: duplicate.item.id, dedupeKey: duplicate.meta.key, error: error.message });
      }
      return;
    }

    const queueMessage = admissionResult.queueMessage;
    const processResult = tryImmediateReplyByRender(queueMessage);
    results.push({ duplicate: false, queueMessage, processResult });
  });

  return { processedCount: results.length, results };
}

function tryImmediateReplyByRender(queueMessage) {
  try {
    if (!isValidLineUserId(queueMessage.userId)) {
      updateQueueMessage(queueMessage.id, { status: "failed", updatedAt: new Date().toISOString(), lastError: "無效 LINE userId，已標記 failed：" + queueMessage.userId });
      return { ok: false, skipped: true, error: "invalid userId" };
    }

    updateQueueMessage(queueMessage.id, { updatedAt: new Date().toISOString(), lastError: "開始呼叫 Render，嘗試直接 reply 真正內容" });
    const renderResult = sendQueueMessageToRender(queueMessage);
    const replyMessages = renderResult.replyMessages;

    try {
      const lineReplyResult = replyLineMessage(queueMessage.replyToken, replyMessages);
      updateQueueMessage(queueMessage.id, { status: "done", updatedAt: new Date().toISOString(), lastError: "Render OK，LINE reply OK" });
      return { ok: true, mode: "reply", renderResult, lineReplyResult };
    } catch (replyError) {
      const pushResult = pushLineMessage(queueMessage.userId, replyMessages);
      updateQueueMessage(queueMessage.id, { status: "done", updatedAt: new Date().toISOString(), lastError: "Render OK，但 LINE reply 失敗，已改用 push 補發：" + replyError.message });
      return { ok: true, mode: "push_after_reply_failed", renderResult, pushResult, replyError: replyError.message };
    }
  } catch (error) {
    const retryCount = Number(queueMessage.retryCount || 0) + 1;
    const newStatus = retryCount >= MAX_RETRY_COUNT ? "failed" : "pending";
    let fallbackReplyResult = null;
    let fallbackReplyError = "";

    try {
      fallbackReplyResult = replyLineMessage(queueMessage.replyToken, FALLBACK_RECEIVED_MESSAGE);
    } catch (lineError) {
      fallbackReplyError = lineError.message;
    }

    updateQueueMessage(queueMessage.id, {
      status: newStatus,
      retryCount,
      updatedAt: new Date().toISOString(),
      lastError: "立即處理失敗：" + error.message + (fallbackReplyError ? "；fallback reply 也失敗：" + fallbackReplyError : "；已 reply fallback"),
    });

    return { ok: false, mode: "fallback_received", error: error.message, retryCount, status: newStatus, fallbackReplyResult, fallbackReplyError };
  }
}

function createQueueMessage(input) {
  input = input || {};
  const sheet = getQueueSheet();
  ensureQueueHeaders(sheet);

  const nowIso = new Date().toISOString();
  const queueMessage = {
    id: input.id || "queue-" + Utilities.getUuid(),
    userId: String(input.userId || "").trim(),
    messageText: String(input.messageText || "").trim(),
    replyToken: String(input.replyToken || "").trim(),
    status: input.status || "pending",
    retryCount: input.retryCount !== undefined ? Number(input.retryCount) : 0,
    createdAt: input.createdAt || nowIso,
    updatedAt: input.updatedAt || nowIso,
    lastError: input.lastError || "",
  };

  if (!queueMessage.userId) throw new Error("queue 缺少 userId");
  if (!queueMessage.messageText) throw new Error("queue 缺少 messageText");

  sheet.appendRow(QUEUE_HEADERS.map(function (header) { return queueMessage[header]; }));
  return queueMessage;
}

function getQueueSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(QUEUE_SHEET_NAME);
  if (!sheet) throw new Error("找不到工作表：" + QUEUE_SHEET_NAME);
  return sheet;
}

function ensureQueueHeaders(sheet) {
  const firstRow = sheet.getRange(1, 1, 1, QUEUE_HEADERS.length).getValues()[0];
  const isEmpty = firstRow.every(function (cell) { return String(cell).trim() === ""; });
  if (isEmpty) {
    sheet.getRange(1, 1, 1, QUEUE_HEADERS.length).setValues([QUEUE_HEADERS]);
    return;
  }

  const isCorrect = QUEUE_HEADERS.every(function (header, index) { return String(firstRow[index]).trim() === header; });
  if (!isCorrect) throw new Error("queue 工作表欄位不正確，請確認第一列欄位名稱");
}

function updateQueueMessage(id, updates) {
  updates = updates || {};
  const sheet = getQueueSheet();
  ensureQueueHeaders(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) throw new Error("queue 工作表沒有資料可以更新");

  const headers = values[0].map(function (header) { return String(header).trim(); });
  const idIndex = headers.indexOf("id");
  if (idIndex === -1) throw new Error("queue 工作表缺少 id 欄位");

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIndex]) === String(id)) {
      const rowNumber = i + 1;
      Object.keys(updates).forEach(function (key) {
        const columnIndex = headers.indexOf(key);
        if (columnIndex !== -1) sheet.getRange(rowNumber, columnIndex + 1).setValue(updates[key]);
      });
      return;
    }
  }

  throw new Error("找不到 queue id：" + id);
}

function getPendingQueueMessages(limit) {
  const sheet = getQueueSheet();
  ensureQueueHeaders(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0].map(function (header) { return String(header).trim(); });
  const messages = [];

  for (let i = 1; i < values.length; i++) {
    const item = rowToObject(headers, values[i]);
    if (item.status !== "pending") continue;

    if (!isValidLineUserId(String(item.userId || ""))) {
      updateQueueMessage(item.id, { status: "failed", updatedAt: new Date().toISOString(), lastError: "無效 LINE userId，已標記 failed：" + item.userId });
      continue;
    }

    if (Number(item.retryCount || 0) >= MAX_RETRY_COUNT) {
      updateQueueMessage(item.id, { status: "failed", updatedAt: new Date().toISOString(), lastError: "超過最大重試次數：" + MAX_RETRY_COUNT });
      continue;
    }

    messages.push(item);
    if (messages.length >= limit) break;
  }

  return messages;
}

function rowToObject(headers, row) {
  const item = {};
  headers.forEach(function (header, index) { if (header) item[header] = row[index]; });
  return item;
}

function isValidLineUserId(userId) {
  return typeof userId === "string" && userId.startsWith("U") && userId.length >= 20;
}

function withQueueLock(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30 * 1000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function getQueueMessageById(id) {
  const sheet = getQueueSheet();
  ensureQueueHeaders(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return null;

  const headers = values[0].map(function (header) { return String(header).trim(); });
  const idIndex = headers.indexOf("id");
  if (idIndex === -1) throw new Error("queue 工作表缺少 id 欄位");

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIndex]) === String(id)) return rowToObject(headers, values[i]);
  }
  return null;
}

function createQueueMessageForImmediateProcessing(input) {
  return withQueueLock(function () {
    recoverStaleProcessingQueueMessagesUnlocked();
    const duplicate = findDuplicateQueueMessage(input.userId, input.messageText);
    if (duplicate) return { duplicate };

    const queueMessage = createQueueMessage({ userId: input.userId, messageText: input.messageText, replyToken: input.replyToken, status: "processing", lastError: "已由立即處理流程鎖定" });
    return { duplicate: null, queueMessage };
  });
}

function claimQueueMessageForRetry(id) {
  return withQueueLock(function () {
    const current = getQueueMessageById(id);
    if (!current) return null;
    if (String(current.status || "").trim() !== "pending") return null;

    const nowIso = new Date().toISOString();
    updateQueueMessage(id, { status: "processing", updatedAt: nowIso, lastError: "已由 retry 流程鎖定" });
    current.status = "processing";
    current.updatedAt = nowIso;
    current.lastError = "已由 retry 流程鎖定";
    return current;
  });
}

function recoverStaleProcessingQueueMessages() {
  return withQueueLock(function () { return recoverStaleProcessingQueueMessagesUnlocked(); });
}

function recoverStaleProcessingQueueMessagesUnlocked() {
  const sheet = getQueueSheet();
  ensureQueueHeaders(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0].map(function (header) { return String(header).trim(); });
  const idIndex = headers.indexOf("id");
  const statusIndex = headers.indexOf("status");
  const updatedAtIndex = headers.indexOf("updatedAt");
  const lastErrorIndex = headers.indexOf("lastError");

  const recoveredIds = [];
  const now = Date.now();

  for (let i = 1; i < values.length; i++) {
    const status = String(values[i][statusIndex] || "").trim();
    if (status !== "processing") continue;

    const updatedAtValue = values[i][updatedAtIndex];
    const updatedAtTime = updatedAtValue instanceof Date ? updatedAtValue.getTime() : new Date(updatedAtValue).getTime();
    if (Number.isNaN(updatedAtTime)) continue;
    if (now - updatedAtTime <= PROCESSING_STALE_AFTER_MS) continue;

    const rowNumber = i + 1;
    const nowIso = new Date().toISOString();
    sheet.getRange(rowNumber, statusIndex + 1).setValue("pending");
    sheet.getRange(rowNumber, updatedAtIndex + 1).setValue(nowIso);
    sheet.getRange(rowNumber, lastErrorIndex + 1).setValue("processing 超過 10 分鐘，已恢復為 pending 等待重試");
    recoveredIds.push(values[i][idIndex]);
  }

  return recoveredIds;
}

function normalizeQueueTextForDedupe(text) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

function parseQueueFlexibleNumber(numberText) {
  const text = String(numberText || "").trim().replace(/兩/g, "二");
  if (/^\d+$/.test(text)) return Number(text);

  const digitMap = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text.length === 1 && digitMap[text] !== undefined) return digitMap[text];
  if (text.includes("十")) {
    const parts = text.split("十");
    const tens = parts[0] === "" ? 1 : digitMap[parts[0]];
    const ones = parts[1] === "" ? 0 : digitMap[parts[1]];
    if (tens === undefined || ones === undefined) return null;
    return tens * 10 + ones;
  }
  return null;
}

function buildQueueOperationMeta(actionText, targetText, numberText, newTitle) {
  const number = parseQueueFlexibleNumber(numberText);
  if (!Number.isInteger(number) || number <= 0) return null;

  const actionMap = { 完成: "done", 已完成: "done", 取消: "cancel", 修改: "edit", 刪除: "delete" };
  const action = actionMap[actionText];
  if (!action) return null;

  const type = targetText.includes("任務") ? "task" : "standard";
  const normalizedNewTitle = normalizeQueueTextForDedupe(newTitle || "");

  return { kind: "write", key: normalizedNewTitle ? `${action}|${type}|${number}|${normalizedNewTitle}` : `${action}|${type}|${number}` };
}

function parseQueueOperationDedupeMeta(userText) {
  const text = normalizeQueueTextForDedupe(userText);
  let match = text.match(/^(完成|已完成|取消|修改|刪除)\s*(任務|完成標準|標準)\s*(\d+|[零一二三四五六七八九十兩]+)(?:\s+(.+))?$/);
  if (match) return buildQueueOperationMeta(match[1], match[2], match[3], match[4]);

  match = text.match(/^(完成|已完成|取消|修改|刪除)\s*第?\s*(\d+|[零一二三四五六七八九十兩]+)\s*個?\s*(任務|完成標準|標準)(?:\s+(.+))?$/);
  if (match) return buildQueueOperationMeta(match[1], match[3], match[2], match[4]);
  return null;
}

function parseQueueCreateDedupeMeta(userText) {
  const text = normalizeQueueTextForDedupe(userText);
  const createCommands = [
    { command: "新增一個完成標準", type: "standard" },
    { command: "新增一個標準", type: "standard" },
    { command: "新增標準", type: "standard" },
    { command: "新增一個任務", type: "task" },
    { command: "新增任務", type: "task" },
  ];

  for (let i = 0; i < createCommands.length; i++) {
    const item = createCommands[i];
    if (!text.startsWith(item.command)) continue;

    let rawText = text.slice(item.command.length).trim();
    rawText = rawText.replace(/^[：:]/, "").trim();
    if (!rawText) return null;

    const parts = rawText.split(/\s*[\/｜|，,、]\s*/).map(function (part) { return part.trim(); }).filter(Boolean);
    const title = parts[0] || "";
    if (!title) return null;

    try {
      const category = normalizeCategory(parts[1]);
      let subCategory = EMPTY_SUBCATEGORY;
      let difficulty = DEFAULT_DIFFICULTY;

      if (category === "程式學習") {
        if (DIFFICULTY_OPTIONS.includes(parts[2])) {
          subCategory = DEFAULT_SUBCATEGORY;
          difficulty = normalizeDifficulty(parts[2]);
        } else {
          subCategory = normalizeSubCategory(parts[2], category);
          difficulty = normalizeDifficulty(parts[3]);
        }
      } else {
        difficulty = normalizeDifficulty(parts[2]);
      }

      return { kind: "write", key: `create|${item.type}|${title}|${category}|${subCategory}|${difficulty}` };
    } catch (error) {
      return null;
    }
  }

  return null;
}

function buildQueueDedupeMeta(messageText) {
  const text = normalizeQueueTextForDedupe(messageText);

  if (text === "攻略" || text === "說明" || text === "help" || text === "Help") return { kind: "read", key: "read|guide" };
  if (text === "用量" || text === "用量小抄" || text === "訊息用量") return { kind: "read", key: "read|usage" };
  if (text === "清單" || text === "全部清單") return { kind: "read", key: "read|list" };
  if (text === "抽一件" || text === "抽任務" || text === "隨機任務" || text === "今天做什麼") return { kind: "read", key: "read|draw_one" };
  if (text === "簡單任務" || text === "簡單") return { kind: "read", key: "read|difficulty|簡單" };
  if (text === "適中任務" || text === "適中") return { kind: "read", key: "read|difficulty|適中" };
  if (text === "困難任務" || text === "困難") return { kind: "read", key: "read|difficulty|困難" };
  if (text === "取消修改") return { kind: "write", key: "edit|cancel_pending" };

  const createMeta = parseQueueCreateDedupeMeta(text);
  if (createMeta) return createMeta;

  const operationMeta = parseQueueOperationDedupeMeta(text);
  if (operationMeta) return operationMeta;

  return { kind: "raw", key: "raw|" + text };
}

function isWithinRecentWriteDedupeWindow(dateValue) {
  const time = dateValue instanceof Date ? dateValue.getTime() : new Date(dateValue).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time <= RECENT_WRITE_DEDUPE_WINDOW_MS;
}

function findDuplicateQueueMessage(userId, messageText) {
  const sheet = getQueueSheet();
  ensureQueueHeaders(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return null;

  const headers = values[0].map(function (header) { return String(header).trim(); });
  const targetUserId = String(userId || "").trim();
  const targetMeta = buildQueueDedupeMeta(messageText);

  for (let i = values.length - 1; i >= 1; i--) {
    const item = rowToObject(headers, values[i]);
    if (String(item.userId || "").trim() !== targetUserId) continue;

    const itemMeta = buildQueueDedupeMeta(item.messageText);
    if (itemMeta.key !== targetMeta.key) continue;

    const status = String(item.status || "").trim();

    if (status === "pending") return { item, reason: "pending", meta: targetMeta };
    if (status === "processing") return { item, reason: "processing", meta: targetMeta };
    if (targetMeta.kind === "write" && status === "done" && isWithinRecentWriteDedupeWindow(item.updatedAt)) return { item, reason: "recent_done_write", meta: targetMeta };
  }

  return null;
}

function retryPendingQueue() {
  const recoveredIds = recoverStaleProcessingQueueMessages();
  const pendingMessages = getPendingQueueMessages(RETRY_BATCH_SIZE);
  const results = [];

  pendingMessages.forEach(function (queueMessage) {
    results.push(tryPushPendingQueueMessage(queueMessage));
  });

  Logger.log("retryPendingQueue recovered = " + JSON.stringify(recoveredIds) + "；results = " + JSON.stringify(results));
  return { recoveredIds, results };
}

function tryPushPendingQueueMessage(queueMessage) {
  const claimedMessage = claimQueueMessageForRetry(queueMessage.id);
  if (!claimedMessage) return { ok: false, skipped: true, reason: "already_claimed_or_not_pending", queueId: queueMessage.id };

  try {
    if (!isValidLineUserId(String(claimedMessage.userId || ""))) {
      updateQueueMessage(claimedMessage.id, { status: "failed", updatedAt: new Date().toISOString(), lastError: "無效 LINE userId，已標記 failed：" + claimedMessage.userId });
      return { ok: false, skipped: true, error: "invalid userId" };
    }

    updateQueueMessage(claimedMessage.id, { updatedAt: new Date().toISOString(), lastError: "retry 已鎖定，開始呼叫 Render" });
    const renderResult = sendQueueMessageToRender(claimedMessage);
    const pushResult = pushLineMessage(claimedMessage.userId, renderResult.replyMessages);

    updateQueueMessage(claimedMessage.id, { status: "done", updatedAt: new Date().toISOString(), lastError: "retry Render OK，LINE push OK" });
    return { ok: true, mode: "retry_push", renderResult, pushResult };
  } catch (error) {
    const retryCount = Number(claimedMessage.retryCount || 0) + 1;
    const newStatus = retryCount >= MAX_RETRY_COUNT ? "failed" : "pending";
    updateQueueMessage(claimedMessage.id, { status: newStatus, retryCount, updatedAt: new Date().toISOString(), lastError: "retry 失敗：" + error.message });
    return { ok: false, error: error.message, retryCount, status: newStatus };
  }
}

function sendQueueMessageToRender(queueMessage) {
  if (!queueMessage) throw new Error("轉送 Render 時缺少 queueMessage");

  const payload = { source: "gas_queue", queueId: queueMessage.id, userId: queueMessage.userId, messageText: queueMessage.messageText, createdAt: queueMessage.createdAt };
  const response = UrlFetchApp.fetch(getRenderLineWebhookUrl(), { method: "post", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true });
  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) throw new Error("Render 呼叫失敗：" + statusCode + " " + responseText);

  let data = null;
  try {
    data = JSON.parse(responseText);
  } catch (error) {
    throw new Error("Render 回傳不是 JSON，目前回傳：" + responseText);
  }

  if (!data || data.ok !== true) throw new Error("Render 回傳 ok 不是 true：" + responseText);

  let replyMessages = null;
  if (Array.isArray(data.replyMessages)) {
    replyMessages = normalizeLineMessages(data.replyMessages);
  } else {
    const replyTextOnly = String(data.replyText || "").trim();
    if (!replyTextOnly) throw new Error("Render 沒有回傳有效 replyText 或 replyMessages：" + responseText);
    replyMessages = normalizeLineMessages(replyTextOnly);
  }

  const replyText = String(data.replyText || getFallbackTextFromLineMessages(replyMessages) || "").trim();
  if (!replyText) throw new Error("Render 回覆內容缺少可記錄的 replyText：" + responseText);

  return { ok: true, statusCode, replyText, replyMessages, renderBody: data };
}

function buildLineTextMessage(text) {
  return { type: "text", text: String(text || "本局目前沒有可回覆的內容。") };
}

function isValidLineMessageObject(message) {
  return message && typeof message === "object" && typeof message.type === "string" && String(message.type).trim() !== "";
}

function normalizeLineMessages(input) {
  if (Array.isArray(input)) {
    const messages = input.filter(function (message) { return isValidLineMessageObject(message); });
    if (messages.length === 0) throw new Error("LINE messages 陣列不可為空");
    if (messages.length > 5) throw new Error("LINE 一次最多只能回覆 5 則 messages");
    return messages;
  }

  const text = String(input || "").trim();
  if (!text) throw new Error("LINE text 不可為空");
  return [buildLineTextMessage(text)];
}

function getFallbackTextFromLineMessages(messages) {
  if (!Array.isArray(messages)) return "";
  const textMessage = messages.find(function (message) { return message && message.type === "text" && message.text; });
  if (textMessage) return String(textMessage.text);
  const flexMessage = messages.find(function (message) { return message && message.type === "flex" && message.altText; });
  if (flexMessage) return String(flexMessage.altText);
  return "Tiny Progress 已回覆。";
}

function replyLineMessage(replyToken, messageInput) {
  if (!replyToken) throw new Error("LINE reply 缺少 replyToken");
  return callLineApi("https://api.line.me/v2/bot/message/reply", { replyToken, messages: normalizeLineMessages(messageInput) });
}

function pushLineMessage(userId, messageInput) {
  if (!isValidLineUserId(String(userId || ""))) throw new Error("LINE push 缺少有效 userId：" + userId);
  return callLineApi("https://api.line.me/v2/bot/message/push", { to: userId, messages: normalizeLineMessages(messageInput) });
}

function callLineApi(url, payload) {
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + getLineChannelAccessToken() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();
  if (statusCode < 200 || statusCode >= 300) throw new Error("LINE API 呼叫失敗：" + statusCode + " " + responseText);
  return { ok: true, statusCode, body: safeParseJson(responseText), raw: responseText };
}

function parseJsonBody(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error("缺少 POST body");
  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    throw new Error("POST body 不是有效 JSON：" + error.message);
  }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function safeParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function getCurrentWeekRange(date) {
  const target = date ? new Date(date) : new Date();
  const day = target.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(target);
  monday.setDate(target.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { weekStart: formatDateYmd(monday), weekEnd: formatDateYmd(sunday) };
}

function formatDateYmd(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function runItemsUpgradeOnce() {
  return getItemsFromSheet();
}
function getLinePushUserId() {
  const userId = PropertiesService
    .getScriptProperties()
    .getProperty("LINE_PUSH_USER_ID");

  if (!isValidLineUserId(String(userId || ""))) {
    throw new Error("缺少或無效的 Script Property：LINE_PUSH_USER_ID");
  }

  return userId;
}



function sendWeeklyMondayTaskCard() {
  const currentWeek = getCurrentWeekFromSheet();
  const items = getItemsFromSheet();
  const currentWeekNumber = Number(currentWeek.weekNumber);

  const weeklyItems = items.filter(function (item) {
    return Number(item.weekNumber) === currentWeekNumber;
  });

  const tasks = sortWeeklyMondayTasks(
    weeklyItems.filter(function (item) {
      return item.type === "task";
    })
  );

  const standards = weeklyItems.filter(function (item) {
    return item.type === "standard";
  });

  const flexMessage = buildWeeklyMondayFlexMessage({
    currentWeek,
    tasks,
    standards,
  });

  return pushLineMessage(getLinePushUserId(), [flexMessage]);
}

function sortWeeklyMondayTasks(tasks) {
  return tasks.slice().sort(function (a, b) {
    const categoryA = normalizeCategory(a.category);
    const categoryB = normalizeCategory(b.category);

    const categoryDiff =
      CATEGORY_OPTIONS.indexOf(categoryA) -
      CATEGORY_OPTIONS.indexOf(categoryB);

    if (categoryDiff !== 0) return categoryDiff;

    if (categoryA === "程式學習") {
      const subA = normalizeSubCategory(a.subCategory, categoryA);
      const subB = normalizeSubCategory(b.subCategory, categoryB);

      const subDiff =
        getWeeklyMondaySubCategoryIndex(subA) -
        getWeeklyMondaySubCategoryIndex(subB);

      if (subDiff !== 0) return subDiff;
    }

    return 0;
  });
}

function getWeeklyMondaySubCategoryIndex(subCategory) {
  const index = SUBCATEGORY_OPTIONS.indexOf(subCategory);
  return index === -1 ? SUBCATEGORY_OPTIONS.length : index;
}

function isWeeklyMondayDone(item) {
  return item.done === true || String(item.done).toUpperCase() === "TRUE";
}

function buildWeeklyMondayProgressRow(label, doneCount, totalCount) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    contents: [
      {
        type: "text",
        text: label,
        size: "sm",
        color: "#7B6E60",
        flex: 0,
      },
      {
        type: "text",
        text: doneCount + " / " + totalCount,
        size: "sm",
        color: "#263D35",
        weight: "bold",
        align: "end",
      },
    ],
  };
}

function getWeeklyMondayTaskLabel(index) {
  const labels = ["暖一下", "動一下", "收一件"];
  return labels[index] || "小進度";
}

function buildWeeklyMondayTaskRows(tasks) {
  if (tasks.length === 0) {
    return [
      {
        type: "text",
        text: "本週還沒有放任務。",
        size: "md",
        color: "#263D35",
        weight: "bold",
        wrap: true,
      },
      {
        type: "text",
        text: "先放一個小任務，讓週一慢慢開機。",
        size: "sm",
        color: "#7B6E60",
        wrap: true,
      },
    ];
  }

  const visibleTasks = tasks.slice(0, 3);

  const rows = visibleTasks.map(function (task, index) {
    const isDone = isWeeklyMondayDone(task);
    const checkbox = isDone ? "☑" : "☐";

    return {
      type: "box",
      layout: "vertical",
      spacing: "xs",
      margin: index === 0 ? "none" : "sm",
      paddingAll: "12px",
      backgroundColor: isDone ? "#F4EFE6" : "#FFF7EC",
      cornerRadius: "16px",
      borderColor: isDone ? "#E4D8C7" : "#E8D8C0",
      borderWidth: "1px",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          alignItems: "center",
          spacing: "sm",
          contents: [
            {
              type: "box",
              layout: "vertical",
              flex: 0,
              backgroundColor: isDone ? "#E7DED0" : "#F5E6C8",
              cornerRadius: "999px",
              paddingTop: "4px",
              paddingBottom: "4px",
              paddingStart: "8px",
              paddingEnd: "8px",
              contents: [
                {
                  type: "text",
                  text: getWeeklyMondayTaskLabel(index),
                  size: "xxs",
                  weight: "bold",
                  color: "#8A6440",
                  align: "center",
                },
              ],
            },
            {
              type: "text",
              text: checkbox + " " + String(task.title || ""),
              size: isDone ? "sm" : "md",
              weight: isDone ? "regular" : "bold",
              color: isDone ? "#8A7E6E" : "#263D35",

              // 任務名稱不換行，維持一行顯示
              wrap: false,
              flex: 1,
              maxLines: 1,
            },
          ],
        },
      ],
    };
  });

  if (tasks.length > visibleTasks.length) {
    rows.push({
      type: "text",
      text: "還有 " + (tasks.length - visibleTasks.length) + " 件在任務板裡。",
      size: "xs",
      color: "#7B6E60",
      wrap: false,
      maxLines: 1,
      margin: "sm",
    });
  }

  return rows;
}

function getWeeklyMondayFirstTask(tasks) {
  return tasks.find(function (task) {
    return !isWeeklyMondayDone(task);
  }) || null;
}

function buildWeeklyMondayFirstTaskCard(tasks) {
  const firstTask = getWeeklyMondayFirstTask(tasks);

  if (!firstTask) {
    return {
      type: "box",
      layout: "vertical",
      spacing: "xs",
      backgroundColor: "#F0F5EA",
      cornerRadius: "16px",
      paddingAll: "14px",
      borderColor: "#D8E4CF",
      borderWidth: "1px",
      contents: [
        {
          type: "text",
          text: "🐾 今日第一件",
          size: "xs",
          weight: "bold",
          color: "#668257",
        },
        {
          type: "text",
          text: tasks.length === 0
            ? "先新增一個小任務，讓本週有地方落腳。"
            : "本週任務都已完成，可以給自己蓋一枚小章。",
          size: "sm",
          weight: "bold",
          color: "#263D35",
          wrap: true,
        },
      ],
    };
  }

  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    backgroundColor: "#F0F5EA",
    cornerRadius: "16px",
    paddingAll: "14px",
    borderColor: "#D8E4CF",
    borderWidth: "1px",
    contents: [
      {
        type: "text",
        text: "🐾 今日第一件",
        size: "xs",
        weight: "bold",
        color: "#668257",
      },
      {
        type: "text",
        text: "☐ " + firstTask.title,
        size: "md",
        weight: "bold",
        color: "#263D35",

        // 今日第一件也維持一行
        wrap: false,
        maxLines: 1,
      },
      {
        type: "text",
        text: "先辦這件就好，其他公文先睡一下。",
        size: "xs",
        color: "#7B6E60",
        wrap: false,
        maxLines: 1,
      },
    ],
  };
}

function buildWeeklyMondayFlexMessage(data) {
  const currentWeek = data.currentWeek;
  const tasks = data.tasks || [];
  const standards = data.standards || [];

  const doneTasks = tasks.filter(isWeeklyMondayDone);
  const doneStandards = standards.filter(isWeeklyMondayDone);

  const weekTitle = currentWeek
    ? "第" + currentWeek.weekNumber + "週｜" + currentWeek.title
    : "本週主題尚未設定";

  const taskRows = buildWeeklyMondayTaskRows(tasks);

  return {
    type: "flex",
    altText: "Tiny Progress｜週一暖機卡",
    contents: {
      type: "bubble",
      size: "mega",
      styles: {
        body: {
          backgroundColor: "#FAF0E1",
        },
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "22px",
        spacing: "md",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            justifyContent: "space-between",
            alignItems: "center",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                spacing: "sm",
                alignItems: "center",
                contents: [
                  {
                    type: "box",
                    layout: "vertical",
                    width: "12px",
                    height: "12px",
                    backgroundColor: "#DDB36A",
                    cornerRadius: "999px",
                    contents: [],
                  },
                  {
                    type: "text",
                    text: "Tiny Progress",
                    size: "sm",
                    weight: "bold",
                    color: "#263D35",
                    flex: 0,
                  },
                ],
              },
              {
                type: "box",
                layout: "vertical",
                backgroundColor: "#F7E0D5",
                cornerRadius: "999px",
                paddingTop: "3px",
                paddingBottom: "3px",
                paddingStart: "8px",
                paddingEnd: "8px",
                contents: [
                  {
                    type: "text",
                    text: "醒醒腦",
                    size: "xxs",
                    weight: "bold",
                    color: "#A45C49",
                    align: "center",
                  },
                ],
              },
            ],
          },
          {
            type: "separator",
            margin: "md",
            color: "#E7D8C3",
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "xs",
            contents: [
              {
                type: "text",
                text: "周一小卡",
                size: "xl",
                weight: "bold",
                color: "#263D35",
                wrap: true,
              },
              {
                type: "text",
                text: "新的一週開門了，今天先辦一件。",
                size: "sm",
                color: "#7B6E60",
                wrap: true,
              },
            ],
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            backgroundColor: "#FFF6E8",
            cornerRadius: "16px",
            paddingAll: "16px",
            borderColor: "#E9CB91",
            borderWidth: "1px",
            contents: [
              {
                type: "text",
                text: "🏷️ 本週小章",
                size: "xs",
                weight: "bold",
                color: "#A67832",
              },
              {
                type: "text",
                text: weekTitle,
                size: "sm",
                weight: "bold",
                color: "#263D35",
                wrap: true,
                maxLines: 2,
              },
              buildWeeklyMondayProgressRow(
                "任務",
                doneTasks.length,
                tasks.length
              ),
              buildWeeklyMondayProgressRow(
                "驗收",
                doneStandards.length,
                standards.length
              ),
            ],
          },
          buildWeeklyMondayFirstTaskCard(tasks),
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            backgroundColor: "#FFFBF2",
            cornerRadius: "16px",
            paddingAll: "16px",
            borderColor: "#E8D9C3",
            borderWidth: "1px",
            contents: [
              {
                type: "text",
                text: "♨️ 週一小開始",
                size: "sm",
                weight: "bold",
                color: "#7B6E60",
              },
            ].concat(taskRows),
          },
          {
            type: "separator",
            margin: "md",
            color: "#E7D8C3",
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "xs",
            contents: [
              {
                type: "text",
                text: "完整內容請打開 Tiny Progress 。",
                size: "sm",
                weight: "bold",
                color: "#263D35",
                wrap: true,
              },
              {
                type: "text",
                text: "週一先暖機就好。",
                size: "xs",
                color: "#8A7E6E",
                wrap: false,
                maxLines: 1,
              },
            ],
          },
        ],
      },
    },
  };
}
