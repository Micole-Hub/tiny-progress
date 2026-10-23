// === Tiny Progress Google Sheets API + LINE Queue Gateway ===
// 12-week Cycle / Week 狀態 / History / 日常小事 / 封存 / LINE Queue
// Schema 更新只補必要欄位，不清空既有資料。

const SHEET_NAME = "items";
const QUEUE_SHEET_NAME = "queue";
const WEEKS_SHEET_NAME = "weeks";
const CYCLES_SHEET_NAME = "cycles";
const CATEGORIES_SHEET_NAME = "categories";
const EVENTS_SHEET_NAME = "events";
const RETROS_SHEET_NAME = "retrospectives";

// LINE 卡片排序與預設值使用。
const CATEGORY_OPTIONS = ["程式學習", "身心穩定", "興趣探索"];
const SUBCATEGORY_OPTIONS = [
  "觀看課程影片",
  "練習",
  "寫筆記",
  "W3Schools",
  "freeCodeCamp",
  "Vibe Coding",
];

const DEFAULT_CATEGORY = "程式學習";
const DEFAULT_SUBCATEGORY = "觀看課程影片";
const EMPTY_SUBCATEGORY = "未分類";

// 把你自己的 Tiny Progress 網頁網址貼在下面。
// 例如：https://你的網站網址
const TINY_PROGRESS_WEB_URL = "https://micole-hub.github.io/tiny-progress/";

const WEEK_STATUS_OPTIONS = ["completed", "current", "next", "upcoming"];
const TASK_STATUS_OPTIONS = [
  "active",
  "overdue",
  "completed",
  "replanned",
  "cancelled",
];

const MAX_RETRY_COUNT = 5;
const RETRY_BATCH_SIZE = 5;
const FALLBACK_RECEIVED_MESSAGE = "已收到，後端醒來後會繼續處理。";
const DUPLICATE_PENDING_MESSAGE_REPLY =
  "這筆訊息已收到，後端醒來後會繼續處理。請先不用重複送。";
const DUPLICATE_PROCESSING_MESSAGE_REPLY =
  "這筆訊息正在處理中，請先不用重複送。";
const DUPLICATE_RECENT_WRITE_MESSAGE_REPLY =
  "這筆剛剛已處理，為避免重複更動，先不再執行一次。";
const RECENT_WRITE_DEDUPE_WINDOW_MS = 30 * 1000;
const PROCESSING_STALE_AFTER_MS = 10 * 60 * 1000;

// LINE Flex 按鈕改用 postback + task id。需要輸入文字的流程暫存在 GAS Cache，避免 Render 休眠後遺失。
const TP_LINE_POSTBACK_PREFIX = "__TP_POSTBACK__:";
const TP_LINE_PENDING_CACHE_PREFIX = "tiny-progress-line-pending-v1:";
const TP_LINE_PENDING_TTL_SECONDS = 10 * 60;

// Timeline 同一天只需校正一次；跨日或時間軸被修改時強制失效。
// 這裡只快取「已完成校正」的 marker 1 小時，資料本身仍直接讀取 Sheets。
const TP_TIMELINE_SYNC_CACHE_KEY = "tiny-progress-timeline-sync";
const TP_TIMELINE_SYNC_CACHE_SECONDS = 60 * 60;

// Sheets schema：必要欄位只往右追加，避免破壞現有列。
const ITEM_HEADERS = [
  "id",
  "type",
  "title",
  "category",
  "subCategory",
  "difficulty", // 已停用：僅為不位移既有欄位而保留，程式不再讀寫
  "done",
  "weekNumber",
  "weekStart",
  "weekEnd",
  "createdAt",
  "updatedAt",
  "categoryId",
  "subCategoryId",
  "status",
  "cycleNumber",
  "originalCycleNumber",
  "originalWeekNumber",
  "scheduledCycleNumber",
  "scheduledWeekNumber",
  "completedAt",
  "cancelledAt",
  "cancelReason",
  "cancelNote",
  "replannedAt",
  "recurringRuleId",
  "frequency",
  "timesPerWeek",
  "occurrencesJson",
  "completionNote",
  "webNumericId",
  "webGoal",
  "webFocusDate",
];

const WEEK_HEADERS = [
  "weekNumber",
  "title",
  "achievement",
  "status",
  "weekStart",
  "weekEnd",
  "weekId",
  "cycleNumber",
  "postponed",
  "postponeDays",
  "postponeReason",
  "postponeNote",
  "createdAt",
  "updatedAt",
  "archived",
  "archivedAt",
  "archiveReason",
];

const CYCLE_HEADERS = [
  "cycleNumber",
  "startDate",
  "theme",
  "status",
  "createdAt",
  "updatedAt",
];

const CATEGORY_HEADERS = [
  "id",
  "name",
  "parentId",
  "type",
  "active",
  "createdAt",
  "updatedAt",
];

const EVENT_HEADERS = [
  "id",
  "eventType",
  "entityType",
  "entityId",
  "cycleNumber",
  "weekNumber",
  "occurredAt",
  "summary",
  "beforeJson",
  "afterJson",
  "reason",
  "note",
];

const RETRO_HEADERS = [
  "cycleNumber",
  "weekNumber",
  "q1",
  "q2",
  "q3",
  "q4",
  "submittedAt",
  "createdAt",
  "updatedAt",
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
let TP_DATA_LOCK_DEPTH = 0;
function tpSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}
function doGet(e) {
  if (e?.parameter?.mode === "health") return tpDoGetUnlocked(e);
  try {
    checkSecret(e?.parameter?.secret);
    ensureSchema();
    return withTinyProgressDataLock(function () {
      return tpDoGetUnlocked(e);
    });
  } catch (error) {
    return jsonResponse({ ok: false, message: error.message });
  }
}

function tpDoGetUnlocked(e) {
  try {
    if (e && e.parameter && e.parameter.mode === "health") {
      return ContentService.createTextOutput(
        "Tiny Progress is alive",
      ).setMimeType(ContentService.MimeType.TEXT);
    }

    checkSecret(e && e.parameter && e.parameter.secret);
    ensureSchema();

    const p = (e && e.parameter) || {};
    const resource = String(p.resource || "items").trim();

    // core / week-context 才校正 timeline，而且 1 小時內不重複掃描。
    // Routine reads (items/weeks/cycles/categories) remain read-only and fast.
    if (resource === "week-context" || resource === "core") {
      syncTimelineAndOverdueIfNeeded(false);
    }

    if (resource === "core") {
      return jsonResponse(
        Object.assign({ ok: true, resource: resource }, buildCoreSnapshot()),
      );
    }
    if (resource === "items") {
      return jsonResponse({
        ok: true,
        resource: resource,
        items: getItemsFromSheetRaw(),
      });
    }
    if (resource === "weeks") {
      return jsonResponse({
        ok: true,
        resource: resource,
        weeks: getWeeksFromSheetRaw(),
      });
    }
    if (resource === "cycles") {
      return jsonResponse({
        ok: true,
        resource: resource,
        cycles: getCyclesFromSheetRaw(),
      });
    }
    if (resource === "week-context") {
      const context = getWeekContextFromSheet();
      return jsonResponse(
        Object.assign({ ok: true, resource: resource }, context),
      );
    }
    if (resource === "categories") {
      return jsonResponse({
        ok: true,
        resource: resource,
        categories: getCategoriesFromSheetRaw(),
      });
    }
    if (resource === "history") {
      return jsonResponse({
        ok: true,
        resource: resource,
        history: buildHistoryData(),
      });
    }
    if (resource === "review") {
      const cycleNumber = parsePositiveInteger(p.cycleNumber);
      if (!cycleNumber) throw new Error("缺少 cycleNumber");
      return jsonResponse({
        ok: true,
        resource: resource,
        review: buildCycleReview(cycleNumber),
      });
    }
    if (resource === "retrospectives") {
      return jsonResponse({
        ok: true,
        resource: resource,
        retrospectives: getRetrospectivesFromSheetRaw(),
      });
    }

    return jsonResponse({
      ok: false,
      message: "不支援的 resource：" + resource,
    });
  } catch (error) {
    return jsonResponse({ ok: false, message: error.message });
  }
}

function doPost(e) {
  try {
    const body = parseJsonBody(e);
    checkSecret(body.secret);
    const action = String(body.action || "create");
    // Device sessions live in Script Properties, not user task sheets.
    // Use an independent lock and do not invoke schema/data migration for auth refresh.
    if (action.indexOf("auth-remember-") === 0) {
      const result = tpRememberDeviceAction(action, body);
      return jsonResponse({ ok: true, action: action, result: result });
    }
    ensureSchema();
    if (isLineWebhookBody(body) && action !== "line-ingress")
      throw new Error("LINE 請改由 Render 簽章入口接收");
    const unlocked = [
      "line-ingress",
      "retry-pending-queue",
      "line-pending-set",
      "line-pending-clear",
      "line-pending-consume",
      "disable-retry-pending-queue-trigger",
    ];
    const execute = function () {
      return tpLegacyMutationAction(action)
        ? tpExecuteLegacyMutation(action, body)
        : executeTinyProgressAction(action, body);
    };
    const result =
      unlocked.indexOf(action) >= 0
        ? execute()
        : withTinyProgressDataLock(execute);
    return jsonResponse({
      ok: true,
      action: action,
      result: result,
      item: isItemLikeResult(result) ? result : undefined,
    });
  } catch (error) {
    Logger.log("doPost error = " + error.message);
    return jsonResponse({
      ok: false,
      status: error.status || (/未授權/.test(error.message) ? 401 : 400),
      message: error.message,
    });
  }
}

// ---------- 記住這台裝置（30 天，可撤銷、續期時輪換憑證） ----------
// Only SHA-256 digests arrive here. Never store a plaintext refresh token.
const TP_DEVICE_PREFIX = "TP_REMEMBER_DEVICE_";
const TP_DEVICE_DAYS = 30;
function tpRememberDeviceAction(action, body) {
  const digestPattern = /^[a-f0-9]{64}$/;
  const hash = String(body.hash || "");
  const oldHash = String(body.oldHash || "");
  const newHash = String(body.newHash || "");
  const valid = (value) => digestPattern.test(value);
  if (action === "auth-remember-create" && !valid(hash))
    throw new Error("裝置識別資料格式錯誤");
  if (action === "auth-remember-rotate" &&
      (!valid(oldHash) || !valid(newHash) || oldHash === newHash))
    throw new Error("裝置識別資料格式錯誤");
  if (action === "auth-remember-revoke" && !valid(hash))
    throw new Error("裝置識別資料格式錯誤");
  if (["auth-remember-create", "auth-remember-rotate", "auth-remember-revoke"].indexOf(action) < 0)
    throw new Error("不支援的裝置操作");
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    const now = Date.now();
    const key = (value) => TP_DEVICE_PREFIX + value;
    if (action === "auth-remember-create") {
      // Compact expired records and cap the number of remembered devices.
      const all = props.getProperties();
      let active = 0;
      Object.keys(all).forEach(function (name) {
        if (name.indexOf(TP_DEVICE_PREFIX) !== 0) return;
        if (Number(all[name]) <= now) props.deleteProperty(name);
        else active++;
      });
      if (active >= 40) throw new Error("記住裝置數量已達上限");
      const expiresAt = now + TP_DEVICE_DAYS * 24 * 3600000;
      props.setProperty(key(hash), String(expiresAt));
      return { expiresAt: expiresAt };
    }
    if (action === "auth-remember-rotate") {
      const expiresAt = Number(props.getProperty(key(oldHash)));
      if (!expiresAt || expiresAt <= now) {
        props.deleteProperty(key(oldHash));
        const error = new Error("裝置登入已失效");
        error.status = 401;
        throw error;
      }
      props.deleteProperty(key(oldHash));
      props.setProperty(key(newHash), String(expiresAt));
      return { expiresAt: expiresAt };
    }
    props.deleteProperty(key(hash));
    return { revoked: true };
  } finally {
    lock.releaseLock();
  }
}

function isItemWriteAction(action) {
  return (
    [
      "create",
      "update",
      "delete",
      "complete-task",
      "correct-completion",
      "cancel-task",
      "restore-cancelled-task",
      "remove-draft-task",
      "reschedule-task",
      "replan-task",
      "complete-occurrence",
      "correct-occurrence",
      "schedule-occurrence",
    ].indexOf(String(action || "")) >= 0
  );
}

function withTinyProgressDataLock(callback) {
  if (TP_DATA_LOCK_DEPTH > 0) return callback();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  TP_DATA_LOCK_DEPTH++;
  try {
    tpRecoverWebTransaction();
    return callback();
  } finally {
    try {
      SpreadsheetApp.flush();
    } finally {
      TP_DATA_LOCK_DEPTH--;
      lock.releaseLock();
    }
  }
}

function executeTinyProgressAction(action, body) {
  if (action === "read-resource")
    return tpReadResource(body.resource, body.params || {});
  if (action === "web-read") return tpWebRead(body.cycle);
  if (action === "web-save") return tpWebSave(body);
  if (action === "line-state-read") return tpLineStateRead(body);
  if (action === "line-state-save") return tpLineStateSave(body);
  if (action === "line-bot-pending-read") return tpLineBotPendingRead(body);
  if (action === "line-bot-pending-save") return tpLineBotPendingSave(body);
  if (action === "reminder-claim") return tpReminderClaim();
  if (action === "reminder-sent") return tpReminderSent(body);
  if (action === "line-ingress") return tpLineIngress(body);
  if (action === "web-import") return tpImportLocal(body);

  if (action === "create") return createItemToSheet(body.item || body);
  if (action === "update")
    return updateItemInSheet(body.id, body.updates || {});
  if (action === "delete") return deleteItemFromSheet(body.id);
  if (action === "complete-task") return completeTaskInSheet(body.id);
  if (action === "correct-completion") return correctCompletionInSheet(body.id);
  if (action === "cancel-task")
    return cancelTaskInSheet(body.id, body.reason, body.note);
  if (action === "restore-cancelled-task")
    return restoreCancelledTaskInSheet(body.id);
  if (action === "remove-draft-task") return removeDraftTaskInSheet(body.id);
  if (action === "reschedule-task")
    return rescheduleTaskInSheet(
      body.id,
      body.target || {},
      body.reason,
      body.note,
    );
  if (action === "replan-task")
    return replanTaskInSheet(body.id, body.tasks || []);
  if (action === "complete-occurrence")
    return completeRecurringOccurrenceInSheet(
      body.id,
      body.occurrenceId,
      body.date,
      body.note,
    );
  if (action === "correct-occurrence")
    return correctRecurringOccurrenceInSheet(body.id, body.occurrenceId);
  if (action === "schedule-occurrence")
    return scheduleRecurringOccurrenceInSheet(
      body.id,
      body.occurrenceId,
      body.date,
    );
  if (action === "archive-week") return archiveWeekInSheet(body);
  if (action === "postpone-current-week")
    return postponeCurrentWeekInSheet(body);
  if (action === "update-current-week-plan")
    return updateCurrentWeekPlanInSheet(body);
  if (action === "update-week-plan") return updateWeekPlanInSheet(body);
  if (action === "create-cycle") return createCycleInSheet(body);
  if (action === "update-cycle-theme")
    return updateCycleThemeInSheet(body.cycleNumber, body.theme);
  if (action === "change-cycle-start")
    return changeCycleStartDateInSheet(
      body.cycleNumber,
      body.startDate,
      body.reason,
      body.note,
    );
  if (action === "create-category")
    return createCategoryInSheet(body.category || body);
  if (action === "update-category")
    return updateCategoryInSheet(body.id, body.updates || {});
  if (action === "save-retrospective" || action === "submit-retrospective")
    return saveRetrospectiveInSheet(body.retro || body);
  if (action === "retry-pending-queue") return retryPendingQueue();
  if (action === "disable-retry-pending-queue-trigger")
    return disableRetryPendingQueueTimeTriggers();
  if (action === "line-pending-set")
    return setLinePendingState(
      body.userId,
      body.pending || {},
      body.ttlSeconds,
    );
  if (action === "line-pending-clear")
    return clearLinePendingState(body.userId);
  if (action === "line-pending-consume")
    return consumeLinePendingText(body.userId, body.text);
  if (action === "complete-current-week")
    throw new Error("Week 會依日期自動前進，不需要手動完成整週");
  throw new Error("不支援的 action：" + action);
}

function isItemLikeResult(value) {
  return (
    value && typeof value === "object" && value.id && value.title !== undefined
  );
}

function getApiSecret() {
  const secret =
    PropertiesService.getScriptProperties().getProperty("API_SECRET");
  if (!secret)
    throw new Error("伺服器設定錯誤：缺少 Script Property API_SECRET");
  return secret;
}

function getLineChannelAccessToken() {
  const token = PropertiesService.getScriptProperties().getProperty(
    "LINE_CHANNEL_ACCESS_TOKEN",
  );
  if (!token)
    throw new Error(
      "伺服器設定錯誤：缺少 Script Property LINE_CHANNEL_ACCESS_TOKEN",
    );
  return token;
}

function getRenderLineWebhookUrl() {
  const url = PropertiesService.getScriptProperties().getProperty(
    "RENDER_LINE_WEBHOOK_URL",
  );
  if (!url)
    throw new Error(
      "伺服器設定錯誤：缺少 Script Property RENDER_LINE_WEBHOOK_URL",
    );
  return url;
}

function checkSecret(secret) {
  if (!secret) throw new Error("未授權：缺少 secret");
  if (secret !== getApiSecret()) throw new Error("未授權：secret 不正確");
}

// ---------- Schema ----------

const TP_SCHEMA_VERSION = "3.1-preserved-web-sync";
const TP_SCHEMA_VERSION_PROPERTY = "TINY_PROGRESS_SCHEMA_VERSION";

function isSchemaReady() {
  return (
    PropertiesService.getScriptProperties().getProperty(
      TP_SCHEMA_VERSION_PROPERTY,
    ) === TP_SCHEMA_VERSION
  );
}

function performSchemaUpdateUnlocked() {
  ensureColumns(getItemsSheet(), ITEM_HEADERS);
  ensureColumns(getWeeksSheet(), WEEK_HEADERS);
  ensureColumns(getOrCreateSheet(CYCLES_SHEET_NAME), CYCLE_HEADERS);
  ensureColumns(getOrCreateSheet(CATEGORIES_SHEET_NAME), CATEGORY_HEADERS);
  ensureColumns(getOrCreateSheet(EVENTS_SHEET_NAME), EVENT_HEADERS);
  ensureColumns(getOrCreateSheet(RETROS_SHEET_NAME), RETRO_HEADERS);
  ensureColumns(getOrCreateSheet(QUEUE_SHEET_NAME), QUEUE_HEADERS);

  seedDefaultCategories();
  normalizeExistingWeeksForSchema();
  normalizeExistingItemsForSchema();
  ensureCycleRecordsFromWeeks();
  SpreadsheetApp.flush();
}

function ensureSchema() {
  // 一般 Web 請求不重跑 schema 更新，也不爭用全域鎖。
  if (isSchemaReady()) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    // Another invocation may have just finished initialization while we waited.
    if (isSchemaReady()) return;
    throw new Error("初始化仍在進行，請稍後再試");
  }

  try {
    if (isSchemaReady()) return;
    performSchemaUpdateUnlocked();
    PropertiesService.getScriptProperties().setProperty(
      TP_SCHEMA_VERSION_PROPERTY,
      TP_SCHEMA_VERSION,
    );
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateSheet(name) {
  const ss = tpSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function ensureColumns(sheet, requiredHeaders) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  let headers =
    sheet.getLastRow() >= 1
      ? sheet
          .getRange(1, 1, 1, lastColumn)
          .getValues()[0]
          .map(function (v) {
            return String(v || "").trim();
          })
      : [];

  const hasAny = headers.some(function (h) {
    return h !== "";
  });
  if (!hasAny) {
    sheet
      .getRange(1, 1, 1, requiredHeaders.length)
      .setValues([requiredHeaders]);
    sheet.setFrozenRows(1);
    return requiredHeaders.slice();
  }

  const missing = requiredHeaders.filter(function (h) {
    return headers.indexOf(h) === -1;
  });
  if (missing.length > 0) {
    sheet
      .getRange(1, headers.length + 1, 1, missing.length)
      .setValues([missing]);
    headers = headers.concat(missing);
  }
  sheet.setFrozenRows(1);
  return headers;
}

function getHeaders(sheet) {
  if (sheet.getLastRow() < 1) return [];
  return sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(function (v) {
      return String(v || "").trim();
    });
}

function sheetRowsAsObjects(sheet) {
  if (sheet.getLastRow() <= 1) return [];
  const headers = getHeaders(sheet);
  const rows = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, headers.length)
    .getValues();
  return rows
    .map(function (row, index) {
      const obj = {};
      headers.forEach(function (h, i) {
        if (h) obj[h] = row[i];
      });
      obj.__rowNumber = index + 2;
      return obj;
    })
    .filter(function (obj) {
      return headers.some(function (h) {
        return h && obj[h] !== "";
      });
    });
}

function appendObject(sheet, object) {
  const headers = getHeaders(sheet);
  const row = headers.map(function (h) {
    const value = object[h];
    if (value === undefined || value === null) return "";
    return value;
  });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function updateObjectRow(sheet, rowNumber, updates) {
  const headers = getHeaders(sheet);
  const keys = Object.keys(updates || {}).filter(function (key) {
    return headers.indexOf(key) !== -1;
  });
  if (!keys.length) return;

  // 任務更新採「讀一列、寫一列」，避免逐欄位 setValue。
  // 這些工作表都是 Tiny Progress 自己管理的資料列，因此改成「讀一列、寫一列」一次完成。
  const range = sheet.getRange(rowNumber, 1, 1, headers.length);
  const row = range.getValues()[0];
  keys.forEach(function (key) {
    const index = headers.indexOf(key);
    row[index] =
      updates[key] === undefined || updates[key] === null ? "" : updates[key];
  });
  range.setValues([row]);
}

function seedDefaultCategories() {
  const sheet = getOrCreateSheet(CATEGORIES_SHEET_NAME);
  const existing = sheetRowsAsObjects(sheet);
  const now = new Date().toISOString();

  const seeds = [
    {
      id: "cat-programming",
      name: "程式學習",
      parentId: "",
      type: "category",
      active: true,
    },
    {
      id: "cat-wellness",
      name: "身心穩定",
      parentId: "",
      type: "category",
      active: true,
    },
    {
      id: "cat-interest",
      name: "興趣探索",
      parentId: "",
      type: "category",
      active: true,
    },
    {
      id: "sub-video",
      name: "觀看課程影片",
      parentId: "cat-programming",
      type: "subcategory",
      active: true,
    },
    {
      id: "sub-practice",
      name: "練習",
      parentId: "cat-programming",
      type: "subcategory",
      active: true,
    },
    {
      id: "sub-note",
      name: "寫筆記",
      parentId: "cat-programming",
      type: "subcategory",
      active: true,
    },
    {
      id: "sub-w3schools",
      name: "W3Schools",
      parentId: "cat-programming",
      type: "subcategory",
      active: true,
    },
    {
      id: "sub-freecodecamp",
      name: "freeCodeCamp",
      parentId: "cat-programming",
      type: "subcategory",
      active: true,
    },
    {
      id: "sub-vibecoding",
      name: "Vibe Coding",
      parentId: "cat-programming",
      type: "subcategory",
      active: true,
    },
  ];

  seeds.forEach(function (seed) {
    if (
      existing.some(function (row) {
        return String(row.id) === seed.id;
      })
    )
      return;
    appendObject(
      sheet,
      Object.assign({}, seed, { createdAt: now, updatedAt: now }),
    );
  });
}

function normalizeExistingWeeksForSchema() {
  const sheet = getWeeksSheet();
  const rows = sheetRowsAsObjects(sheet);
  const now = new Date().toISOString();

  rows.forEach(function (row) {
    const weekNumber = parsePositiveInteger(row.weekNumber);
    if (!weekNumber) return;
    const updates = {};
    if (!row.weekId) updates.weekId = "c1-w" + weekNumber;
    if (!parsePositiveInteger(row.cycleNumber)) updates.cycleNumber = 1;
    if (row.postponed === "") updates.postponed = false;
    if (row.postponeDays === "") updates.postponeDays = 0;
    if (row.archived === "") updates.archived = false;
    if (!row.createdAt) updates.createdAt = now;
    if (!row.updatedAt) updates.updatedAt = now;
    if (Object.keys(updates).length)
      updateObjectRow(sheet, row.__rowNumber, updates);
  });
}

function normalizeExistingItemsForSchema() {
  const sheet = getItemsSheet();
  const rows = sheetRowsAsObjects(sheet);
  const categories = getCategoriesFromSheetRaw();
  const now = new Date().toISOString();

  rows.forEach(function (row) {
    if (!row.id) return;
    const weekNumber = parsePositiveInteger(row.weekNumber) || 1;
    const updates = {};

    if (!row.categoryId) {
      let cat = findCategoryByName(
        getCategoriesFromSheetRaw(),
        String(row.category || DEFAULT_CATEGORY),
        "category",
        "",
      );
      if (!cat)
        cat = createCategoryInSheet({
          name: String(row.category || DEFAULT_CATEGORY),
          type: "category",
        });
      updates.categoryId = cat.id;
    }

    if (
      !row.subCategoryId &&
      String(row.subCategory || "") &&
      String(row.subCategory) !== EMPTY_SUBCATEGORY
    ) {
      const parentId =
        updates.categoryId || row.categoryId || "cat-programming";
      let sub = findCategoryByName(
        getCategoriesFromSheetRaw(),
        String(row.subCategory),
        "subcategory",
        parentId,
      );
      if (!sub)
        sub = createCategoryInSheet({
          name: String(row.subCategory),
          type: "subcategory",
          parentId: parentId,
        });
      updates.subCategoryId = sub.id;
    }

    if (!parsePositiveInteger(row.cycleNumber)) updates.cycleNumber = 1;
    if (!parsePositiveInteger(row.originalCycleNumber))
      updates.originalCycleNumber = 1;
    if (!parsePositiveInteger(row.originalWeekNumber))
      updates.originalWeekNumber = weekNumber;
    if (!parsePositiveInteger(row.scheduledCycleNumber))
      updates.scheduledCycleNumber = 1;
    if (!parsePositiveInteger(row.scheduledWeekNumber))
      updates.scheduledWeekNumber = weekNumber;

    if (!String(row.status || "").trim()) {
      updates.status = normalizeBoolean(row.done) ? "completed" : "active";
    }

    if (normalizeBoolean(row.done) && !row.completedAt)
      updates.completedAt = row.updatedAt || row.createdAt || now;
    if (!row.createdAt) updates.createdAt = now;
    if (!row.updatedAt) updates.updatedAt = now;

    if (Object.keys(updates).length)
      updateObjectRow(sheet, row.__rowNumber, updates);
  });
}

function ensureCycleRecordsFromWeeks() {
  const cycleSheet = getOrCreateSheet(CYCLES_SHEET_NAME);
  const existing = sheetRowsAsObjects(cycleSheet);
  const weeks = getWeeksFromSheetRawNoEnsure();
  const cycleNumbers = {};
  weeks.forEach(function (week) {
    cycleNumbers[week.cycleNumber || 1] = true;
  });
  const now = new Date().toISOString();

  Object.keys(cycleNumbers).forEach(function (key) {
    const cycleNumber = Number(key);
    if (
      existing.some(function (row) {
        return Number(row.cycleNumber) === cycleNumber;
      })
    )
      return;
    const cycleWeeks = weeks.filter(function (week) {
      return Number(week.cycleNumber) === cycleNumber;
    });
    const startDate =
      cycleWeeks
        .map(function (w) {
          return w.weekStart;
        })
        .filter(Boolean)
        .sort()[0] || "";
    appendObject(cycleSheet, {
      cycleNumber: cycleNumber,
      startDate: startDate,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  });
}

// ---------- Normalizers ----------

function normalizeBoolean(value) {
  return (
    value === true ||
    String(value || "").toUpperCase() === "TRUE" ||
    String(value) === "1"
  );
}

function normalizeCategory(value) {
  const category = String(value || "").trim();
  return category || DEFAULT_CATEGORY;
}

function normalizeSubCategory(value, category) {
  const sub = String(value || "").trim();
  if (sub) return sub;
  return normalizeCategory(category) === DEFAULT_CATEGORY
    ? DEFAULT_SUBCATEGORY
    : EMPTY_SUBCATEGORY;
}

function parsePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeWeekStatus(value) {
  const status = String(value || "").trim();
  return WEEK_STATUS_OPTIONS.indexOf(status) >= 0 ? status : "upcoming";
}

function normalizeTaskStatus(value, done) {
  if (normalizeBoolean(done)) return "completed";
  const status = String(value || "").trim();
  return TASK_STATUS_OPTIONS.indexOf(status) >= 0 ? status : "active";
}

function cleanText(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function generateId(prefix) {
  return prefix + "-" + Utilities.getUuid();
}

function getTodayYmd() {
  return Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd",
  );
}

function addDaysToYmd(value, days) {
  const date = parseSheetDateOnly(value);
  date.setDate(date.getDate() + Number(days || 0));
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function parseSheetDateOnly(value) {
  if (
    Object.prototype.toString.call(value) === "[object Date]" &&
    !isNaN(value.getTime())
  ) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const text = cleanText(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new Error("日期格式錯誤：" + text);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function compareYmd(a, b) {
  const aa = cleanText(a).slice(0, 10);
  const bb = cleanText(b).slice(0, 10);
  if (aa === bb) return 0;
  return aa < bb ? -1 : 1;
}

function daysBetweenYmd(fromValue, toValue) {
  const from = parseSheetDateOnly(fromValue);
  const to = parseSheetDateOnly(toValue);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

// ---------- Categories ----------

function getCategoriesFromSheetRaw() {
  const sheet = getOrCreateSheet(CATEGORIES_SHEET_NAME);
  ensureColumns(sheet, CATEGORY_HEADERS);
  return sheetRowsAsObjects(sheet)
    .map(function (row) {
      return {
        id: cleanText(row.id),
        name: cleanText(row.name),
        parentId: cleanText(row.parentId),
        type: cleanText(row.type) || "category",
        active: row.active === "" ? true : normalizeBoolean(row.active),
        createdAt: row.createdAt || "",
        updatedAt: row.updatedAt || "",
      };
    })
    .filter(function (row) {
      return row.id && row.name;
    });
}

function findCategoryByName(categories, name, type, parentId) {
  const target = cleanText(name).toLowerCase();
  return (
    categories.find(function (cat) {
      return (
        cleanText(cat.name).toLowerCase() === target &&
        cat.type === type &&
        (type !== "subcategory" ||
          cleanText(cat.parentId) === cleanText(parentId))
      );
    }) || null
  );
}

function getCategoryById(id, preloadedCategories) {
  const target = cleanText(id);
  if (!target) return null;
  const categories = Array.isArray(preloadedCategories)
    ? preloadedCategories
    : getCategoriesFromSheetRaw();
  return (
    categories.find(function (cat) {
      return cat.id === target;
    }) || null
  );
}

function createCategoryInSheet(input) {
  const name = cleanText(input.name);
  const type = cleanText(input.type) || "category";
  const parentId = cleanText(input.parentId);
  if (!name) throw new Error("分類名稱必填");
  if (["category", "subcategory"].indexOf(type) === -1)
    throw new Error("type 只能是 category 或 subcategory");
  if (type === "subcategory") {
    const parent = getCategoryById(parentId);
    if (!parent || parent.type !== "category")
      throw new Error("子分類需要有效的父分類");
  }

  const categories = getCategoriesFromSheetRaw();
  if (findCategoryByName(categories, name, type, parentId))
    throw new Error("已有同名分類");

  const now = new Date().toISOString();
  const category = {
    id: generateId(type === "category" ? "cat" : "sub"),
    name: name,
    parentId: type === "subcategory" ? parentId : "",
    type: type,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  appendObject(getOrCreateSheet(CATEGORIES_SHEET_NAME), category);
  return category;
}

function updateCategoryInSheet(id, updates) {
  const sheet = getOrCreateSheet(CATEGORIES_SHEET_NAME);
  const rows = sheetRowsAsObjects(sheet);
  const row = rows.find(function (r) {
    return cleanText(r.id) === cleanText(id);
  });
  if (!row) throw new Error("找不到分類：" + id);

  const patch = { updatedAt: new Date().toISOString() };
  if (updates.name !== undefined) {
    const name = cleanText(updates.name);
    if (!name) throw new Error("分類名稱不可空白");
    patch.name = name;
  }
  if (updates.active !== undefined) patch.active = updates.active === true;
  // parentId 故意不支援修改，避免子分類搬家破壞歷史。

  updateObjectRow(sheet, row.__rowNumber, patch);
  return getCategoryById(id);
}

function resolveCategoryIds(input, preloadedCategories) {
  const categories = Array.isArray(preloadedCategories)
    ? preloadedCategories
    : getCategoriesFromSheetRaw();
  let categoryId = cleanText(input.categoryId);
  let subCategoryId = cleanText(input.subCategoryId);

  if (!categoryId) {
    const categoryName = normalizeCategory(input.category);
    const cat = findCategoryByName(categories, categoryName, "category", "");
    if (!cat) throw new Error("分類不存在：" + categoryName);
    categoryId = cat.id;
  }

  const category = getCategoryById(categoryId, categories);
  if (!category || category.type !== "category") throw new Error("分類不存在");

  if (
    !subCategoryId &&
    cleanText(input.subCategory) &&
    cleanText(input.subCategory) !== EMPTY_SUBCATEGORY
  ) {
    const subName = cleanText(input.subCategory);
    const sub = findCategoryByName(
      categories,
      subName,
      "subcategory",
      categoryId,
    );
    if (!sub) throw new Error("子分類不存在：" + subName);
    subCategoryId = sub.id;
  }

  if (subCategoryId) {
    const sub = getCategoryById(subCategoryId, categories);
    if (!sub || sub.type !== "subcategory" || sub.parentId !== categoryId)
      throw new Error("子分類不屬於目前分類");
  }

  return { categoryId: categoryId, subCategoryId: subCategoryId };
}

// ---------- Weeks / Cycles ----------

function getWeeksSheet() {
  return getOrCreateSheet(WEEKS_SHEET_NAME);
}

function getWeeksFromSheetRawNoEnsure() {
  const sheet = getWeeksSheet();
  ensureColumns(sheet, WEEK_HEADERS);
  return sheetRowsAsObjects(sheet)
    .map(rowToWeek)
    .filter(function (w) {
      return w.weekNumber;
    })
    .sort(function (a, b) {
      return a.cycleNumber - b.cycleNumber || a.weekNumber - b.weekNumber;
    });
}

function getWeeksFromSheetRaw() {
  return getWeeksFromSheetRawNoEnsure();
}

function rowToWeek(rowOrHeaders, maybeRow) {
  let row = rowOrHeaders;
  if (Array.isArray(rowOrHeaders) && Array.isArray(maybeRow)) {
    row = {};
    rowOrHeaders.forEach(function (h, i) {
      row[h] = maybeRow[i];
    });
  }
  const weekNumber = parsePositiveInteger(row.weekNumber);
  const cycleNumber = parsePositiveInteger(row.cycleNumber) || 1;
  return {
    weekId: cleanText(row.weekId) || "c" + cycleNumber + "-w" + weekNumber,
    cycleNumber: cycleNumber,
    weekNumber: weekNumber,
    title: cleanText(row.title),
    achievement: cleanText(row.achievement),
    status: normalizeWeekStatus(row.status),
    weekStart: formatCellDate(row.weekStart),
    weekEnd: formatCellDate(row.weekEnd),
    postponed: normalizeBoolean(row.postponed),
    postponeDays: Number(row.postponeDays || 0),
    postponeReason: cleanText(row.postponeReason),
    postponeNote: cleanText(row.postponeNote),
    createdAt: row.createdAt || "",
    updatedAt: row.updatedAt || "",
    archived: normalizeBoolean(row.archived),
    archivedAt: row.archivedAt || "",
    archiveReason: cleanText(row.archiveReason),
  };
}

function formatCellDate(value) {
  if (!value) return "";
  if (
    Object.prototype.toString.call(value) === "[object Date]" &&
    !isNaN(value.getTime())
  ) {
    return Utilities.formatDate(
      value,
      Session.getScriptTimeZone(),
      "yyyy-MM-dd",
    );
  }
  return cleanText(value).slice(0, 10);
}

function getCyclesFromSheetRaw() {
  const sheet = getOrCreateSheet(CYCLES_SHEET_NAME);
  ensureColumns(sheet, CYCLE_HEADERS);
  return sheetRowsAsObjects(sheet)
    .map(function (row) {
      return {
        cycleNumber: parsePositiveInteger(row.cycleNumber),
        startDate: formatCellDate(row.startDate),
        theme: cleanText(row.theme),
        status: cleanText(row.status) || "upcoming",
        createdAt: row.createdAt || "",
        updatedAt: row.updatedAt || "",
      };
    })
    .filter(function (c) {
      return c.cycleNumber;
    })
    .sort(function (a, b) {
      return a.cycleNumber - b.cycleNumber;
    });
}

function findWeek(cycleNumber, weekNumber) {
  const c = parsePositiveInteger(cycleNumber);
  const w = parsePositiveInteger(weekNumber);
  if (!c || !w) return null;
  return (
    getWeeksFromSheetRaw().find(function (week) {
      return week.cycleNumber === c && week.weekNumber === w;
    }) || null
  );
}

function getCurrentWeekFromSheet() {
  const context = getWeekContextFromSheet();
  if (!context.currentWeek) throw new Error("目前不在進行中的 Week");
  return context.currentWeek;
}

function getPreviousCompletedWeekFromData(allWeeks, currentWeek) {
  const weeks = (allWeeks || []).filter(function (week) {
    return week.status === "completed";
  });
  if (!weeks.length) return null;
  if (!currentWeek) return weeks[weeks.length - 1];
  return (
    weeks
      .filter(function (week) {
        return (
          week.cycleNumber < currentWeek.cycleNumber ||
          (week.cycleNumber === currentWeek.cycleNumber &&
            week.weekNumber < currentWeek.weekNumber)
        );
      })
      .slice(-1)[0] || null
  );
}

function weekIsCompleteFromItems(items, cycleNumber, weekNumber) {
  const tasks = (items || []).filter(function (item) {
    return (
      item.type === "task" &&
      Number(item.scheduledCycleNumber || item.cycleNumber) ===
        Number(cycleNumber) &&
      Number(item.scheduledWeekNumber || item.weekNumber) ===
        Number(weekNumber) &&
      ["cancelled", "replanned"].indexOf(item.status) < 0
    );
  });
  return (
    tasks.length > 0 &&
    tasks.every(function (item) {
      return item.status === "completed";
    })
  );
}

// 回傳「目前可以安排到的最後一週」：從本週開始，每一週完成就再往下一週解鎖，最多到 Week 12。
function computeMaxPlannableWeek(items, currentWeek) {
  let w = Number(currentWeek.weekNumber);
  while (w < 12 && weekIsCompleteFromItems(items, currentWeek.cycleNumber, w))
    w++;
  return w;
}

// 本週足跡走完後封存；日期已走過的 Week 也可由 timeline 自動封存。
function archiveWeekInSheet(input) {
  const cycleNumber = parsePositiveInteger(input.cycleNumber);
  const weekNumber = parsePositiveInteger(input.weekNumber);
  const reason = cleanText(input.reason) || "review";
  if (!cycleNumber || !weekNumber) throw new Error("封存需要 Cycle 與 Week");

  return withWeeksLock(function () {
    const sheet = getWeeksSheet();
    const row = sheetRowsAsObjects(sheet).find(function (r) {
      return (
        Number(r.cycleNumber || 1) === cycleNumber &&
        Number(r.weekNumber) === weekNumber
      );
    });
    if (!row)
      throw new Error("找不到 Cycle " + cycleNumber + " · Week " + weekNumber);
    if (normalizeBoolean(row.archived)) return rowToWeek(row);

    const week = rowToWeek(row);
    const today = getTodayYmd();
    const dateAlreadyPassed = !!(
      week.weekEnd && compareYmd(week.weekEnd, today) < 0
    );
    const complete = weekIsCompleteFromItems(
      getItemsFromSheetRaw(),
      cycleNumber,
      weekNumber,
    );
    if (!dateAlreadyPassed && !complete)
      throw new Error("這週還有任務沒完成，現在不能封存");

    const now = new Date().toISOString();
    const patch = {
      archived: true,
      archivedAt: now,
      archiveReason: reason,
      updatedAt: now,
    };
    updateObjectRow(sheet, row.__rowNumber, patch);
    writeEvent({
      eventType: "week_archived",
      entityType: "week",
      entityId: week.weekId,
      cycleNumber: cycleNumber,
      weekNumber: weekNumber,
      summary:
        reason === "date" ? "日期到期，自動封存" : "本週足跡完成，封存 Week",
      afterJson: { archived: true, archivedAt: now, archiveReason: reason },
    });
    return rowToWeek(Object.assign({}, row, patch));
  });
}

function getWeekContextFromData(weeks, cycles, today, items) {
  const currentWeek =
    weeks.find(function (week) {
      return (
        week.weekStart &&
        week.weekEnd &&
        compareYmd(week.weekStart, today) <= 0 &&
        compareYmd(today, week.weekEnd) <= 0
      );
    }) || null;

  let nextWeek = null;
  if (currentWeek) {
    nextWeek =
      weeks.find(function (week) {
        return (
          week.cycleNumber === currentWeek.cycleNumber &&
          week.weekNumber === currentWeek.weekNumber + 1
        );
      }) || null;
  } else {
    nextWeek =
      weeks.filter(function (week) {
        return week.weekStart && compareYmd(week.weekStart, today) > 0;
      })[0] || null;
  }

  const previousWeek = getPreviousCompletedWeekFromData(weeks, currentWeek);
  const futureCycle =
    cycles.find(function (cycle) {
      return cycle.startDate && compareYmd(cycle.startDate, today) > 0;
    }) || null;

  // Planning opens during the final two calendar days before the current Week ends.
  // Postponed Weeks naturally follow their updated weekEnd value.
  const daysUntilWeekEnd =
    currentWeek && currentWeek.weekEnd
      ? daysBetweenYmd(today, currentWeek.weekEnd)
      : null;
  const inPlanningWindow =
    daysUntilWeekEnd !== null && daysUntilWeekEnd >= 0 && daysUntilWeekEnd <= 2;
  const isFinalWeek = !!(currentWeek && Number(currentWeek.weekNumber) === 12);
  const maxPlannableWeek = currentWeek
    ? Array.isArray(items)
      ? computeMaxPlannableWeek(items, currentWeek)
      : Number(currentWeek.weekNumber)
    : null;
  const canPlanNextWeek = !!(
    currentWeek &&
    !isFinalWeek &&
    nextWeek &&
    maxPlannableWeek > Number(currentWeek.weekNumber)
  );
  const canPlanNextCycle = !!(currentWeek && isFinalWeek && inPlanningWindow);

  // A future Cycle may already have been prepared during Week 12.
  // Still surface the just-finished Cycle so its summary can be shown before the rest period.
  let latestCompletedCycleNumber = null;
  cycles.forEach(function (cycle) {
    const cycleWeeks = weeks.filter(function (w) {
      return Number(w.cycleNumber) === Number(cycle.cycleNumber);
    });
    const complete =
      cycleWeeks.length === 12 &&
      cycleWeeks.every(function (w) {
        return w.weekEnd && compareYmd(w.weekEnd, today) < 0;
      });
    if (
      complete &&
      (latestCompletedCycleNumber === null ||
        Number(cycle.cycleNumber) > latestCompletedCycleNumber)
    ) {
      latestCompletedCycleNumber = Number(cycle.cycleNumber);
    }
  });

  return {
    previousWeek: previousWeek,
    currentWeek: currentWeek,
    nextWeek: nextWeek,
    canPlanNextWeek: canPlanNextWeek,
    maxPlannableWeek: maxPlannableWeek,
    archivedWeekNumbers: weeks
      .filter(function (w) {
        return w.archived;
      })
      .map(function (w) {
        return w.weekNumber;
      }),
    canPlanNextCycle: canPlanNextCycle,
    restPeriod: !currentWeek && !!futureCycle,
    nextCycle: futureCycle,
    cycleComplete: !currentWeek && latestCompletedCycleNumber !== null,
    completedCycleNumber: !currentWeek ? latestCompletedCycleNumber : null,
  };
}

function getWeekContextFromSheet() {
  const weeks = getWeeksFromSheetRaw();
  const cycles = getCyclesFromSheetRaw();
  return getWeekContextFromData(
    weeks,
    cycles,
    getTodayYmd(),
    getItemsFromSheetRaw(),
  );
}

function buildCoreSnapshot() {
  // 核心畫面一次取回需要的資料，避免同時打多個 Web App invocation。
  const weeks = getWeeksFromSheetRaw();
  const cycles = getCyclesFromSheetRaw();
  const categories = getCategoriesFromSheetRaw();
  const items = getItemsFromSheetRaw(categories);
  const context = getWeekContextFromData(weeks, cycles, getTodayYmd(), items);
  const retrospectives =
    context.currentWeek && Number(context.currentWeek.cycleNumber) >= 2
      ? getRetrospectivesFromSheetRaw()
      : [];

  return {
    context: context,
    items: items,
    weeks: weeks,
    cycles: cycles,
    categories: categories,
    retrospectives: retrospectives,
  };
}

function invalidateTimelineSyncCache() {
  try {
    CacheService.getScriptCache().remove(TP_TIMELINE_SYNC_CACHE_KEY);
  } catch (error) {}
}

function syncTimelineAndOverdueIfNeeded(force) {
  const cache = CacheService.getScriptCache();
  const today = getTodayYmd();
  if (!force) {
    const marker = cache.get(TP_TIMELINE_SYNC_CACHE_KEY);
    if (marker === today) return { ok: true, skipped: true };
  }

  syncTimelineAndOverdue();
  try {
    cache.put(
      TP_TIMELINE_SYNC_CACHE_KEY,
      today,
      TP_TIMELINE_SYNC_CACHE_SECONDS,
    );
  } catch (error) {}
  return { ok: true, skipped: false };
}

function syncTimelineAndOverdue() {
  return withTinyProgressDataLock(function () {
    return syncTimelineAndOverdueUnlocked();
  });
}

function syncTimelineAndOverdueUnlocked() {
  const weeksSheet = getWeeksSheet();
  const weeksRows = sheetRowsAsObjects(weeksSheet);
  const today = getTodayYmd();
  let currentFound = false;
  let nextMarked = false;

  const sorted = weeksRows.slice().sort(function (a, b) {
    const ca = parsePositiveInteger(a.cycleNumber) || 1;
    const cb = parsePositiveInteger(b.cycleNumber) || 1;
    return (
      ca - cb ||
      (parsePositiveInteger(a.weekNumber) || 0) -
        (parsePositiveInteger(b.weekNumber) || 0)
    );
  });

  sorted.forEach(function (row) {
    const start = formatCellDate(row.weekStart);
    const end = formatCellDate(row.weekEnd);
    if (!start || !end) return;
    let status = "upcoming";
    if (compareYmd(end, today) < 0) status = "completed";
    else if (compareYmd(start, today) <= 0 && compareYmd(today, end) <= 0) {
      status = "current";
      currentFound = true;
    } else if (compareYmd(start, today) > 0 && currentFound && !nextMarked) {
      status = "next";
      nextMarked = true;
    }
    const patch = {};
    if (cleanText(row.status) !== status) patch.status = status;
    if (status === "completed" && !normalizeBoolean(row.archived)) {
      patch.archived = true;
      patch.archivedAt = new Date().toISOString();
      patch.archiveReason = cleanText(row.archiveReason) || "date";
    }
    if (Object.keys(patch).length) {
      patch.updatedAt = new Date().toISOString();
      updateObjectRow(weeksSheet, row.__rowNumber, patch);
    }
  });

  syncCycleStatuses(today);
  syncOverdueItems(today);
}

function syncCycleStatuses(today) {
  const sheet = getOrCreateSheet(CYCLES_SHEET_NAME);
  const rows = sheetRowsAsObjects(sheet);
  const weeks = getWeeksFromSheetRawNoEnsure();
  rows.forEach(function (row) {
    const c = parsePositiveInteger(row.cycleNumber);
    const cycleWeeks = weeks.filter(function (w) {
      return w.cycleNumber === c;
    });
    if (!cycleWeeks.length) return;
    const start = cycleWeeks[0].weekStart;
    const end = cycleWeeks[cycleWeeks.length - 1].weekEnd;
    let status = "upcoming";
    if (end && compareYmd(end, today) < 0) status = "completed";
    else if (start && compareYmd(start, today) <= 0) status = "active";
    if (cleanText(row.status) !== status)
      updateObjectRow(sheet, row.__rowNumber, {
        status: status,
        updatedAt: new Date().toISOString(),
      });
  });
}

function syncOverdueItems(today) {
  const sheet = getItemsSheet();
  const rows = sheetRowsAsObjects(sheet);

  // 預先載入 Weeks，一次重用，避免每個 task 重讀 Sheets。
  const weekMap = {};
  getWeeksFromSheetRaw().forEach(function (week) {
    weekMap[week.cycleNumber + ":" + week.weekNumber] = week;
  });

  rows.forEach(function (row) {
    if (cleanText(row.type) !== "task") return;
    const status = normalizeTaskStatus(row.status, row.done);
    if (["completed", "cancelled", "replanned"].indexOf(status) >= 0) return;
    const cycleNumber =
      parsePositiveInteger(row.scheduledCycleNumber) ||
      parsePositiveInteger(row.cycleNumber) ||
      1;
    const weekNumber =
      parsePositiveInteger(row.scheduledWeekNumber) ||
      parsePositiveInteger(row.weekNumber);
    const week = weekMap[cycleNumber + ":" + weekNumber] || null;
    if (!week || !week.weekEnd) return;
    if (compareYmd(week.weekEnd, today) < 0 && status !== "overdue") {
      updateObjectRow(sheet, row.__rowNumber, {
        status: "overdue",
        done: false,
        updatedAt: new Date().toISOString(),
      });
      writeEvent({
        eventType: "task_overdue",
        entityType: "task",
        entityId: cleanText(row.id),
        cycleNumber: cycleNumber,
        weekNumber: weekNumber,
        summary: "未完待續",
        beforeJson: { status: status },
        afterJson: { status: "overdue" },
      });
    }
  });
}

function updateWeekPlanInSheet(input) {
  const cycleNumber = parsePositiveInteger(input.cycleNumber);
  const weekNumber = parsePositiveInteger(input.weekNumber);
  const title = cleanText(input.title);
  const achievement = cleanText(input.achievement || input.goal);
  if (!cycleNumber || !weekNumber) throw new Error("缺少 Cycle 或 Week");
  if (!title || !achievement) throw new Error("本週主題與目標都必填");

  const sheet = getWeeksSheet();
  const row = sheetRowsAsObjects(sheet).find(function (r) {
    return (
      Number(r.cycleNumber || 1) === cycleNumber &&
      Number(r.weekNumber) === weekNumber
    );
  });
  if (!row)
    throw new Error("找不到 Cycle " + cycleNumber + " · Week " + weekNumber);
  if (normalizeBoolean(row.archived))
    throw new Error("這個 Week 已封存，不能修改安排");

  const weekEnd = formatCellDate(row.weekEnd);
  if (weekEnd && compareYmd(weekEnd, getTodayYmd()) < 0) {
    throw new Error("這個 Week 已經走完，不能再修改安排");
  }

  const patch = {
    title: title,
    achievement: achievement,
    updatedAt: new Date().toISOString(),
  };
  updateObjectRow(sheet, row.__rowNumber, patch);
  return rowToWeek(Object.assign({}, row, patch));
}

function updateCurrentWeekPlanInSheet(input) {
  const current = getCurrentWeekFromSheet();
  return updateWeekPlanInSheet({
    cycleNumber: current.cycleNumber,
    weekNumber: current.weekNumber,
    title: input.title,
    achievement: input.achievement || input.goal,
  });
}

function postponeCurrentWeekInSheet(input) {
  return withWeeksLock(function () {
    syncTimelineAndOverdueIfNeeded(false);
    const current = getCurrentWeekFromSheet();
    if (current.archived) throw new Error("這個 Week 已封存，不能再順延");
    if (current.postponed) throw new Error("本週已經順延過一次，不能再次順延");
    const days = Number(input.days || 7);
    if (!Number.isInteger(days) || days < 1 || days > 7)
      throw new Error("延後天數必須是 1 到 7 的整數");
    const end = findWeek(current.cycleNumber, 12).weekEnd;
    const nextCycle = getCyclesFromSheetRaw().find(function (c) {
      return c.cycleNumber === current.cycleNumber + 1;
    });
    if (nextCycle && nextCycle.startDate <= addDaysToYmd(end, days))
      throw new Error("延後後會和下一輪重疊，請先修改下一輪開始日期");
    const reason = cleanText(input.reason);
    const note = cleanText(input.note);
    if (!reason) throw new Error("順延原因必填");

    const sheet = getWeeksSheet();
    const rows = sheetRowsAsObjects(sheet).filter(function (r) {
      return (
        Number(r.cycleNumber || 1) === current.cycleNumber &&
        Number(r.weekNumber) >= current.weekNumber
      );
    });
    const before = { weekEnd: current.weekEnd };

    rows.forEach(function (row) {
      const weekNumber = Number(row.weekNumber);
      const updates = { updatedAt: new Date().toISOString() };
      if (weekNumber === current.weekNumber) {
        updates.weekEnd = addDaysToYmd(row.weekEnd, days);
        updates.postponed = true;
        updates.postponeDays = days;
        updates.postponeReason = reason;
        updates.postponeNote = note;
      } else {
        updates.weekStart = addDaysToYmd(row.weekStart, days);
        updates.weekEnd = addDaysToYmd(row.weekEnd, days);
      }
      updateObjectRow(sheet, row.__rowNumber, updates);
    });

    refreshCachedItemWeekDates(current.cycleNumber, current.weekNumber);
    writeEvent({
      eventType: "week_postponed",
      entityType: "week",
      entityId: current.weekId,
      cycleNumber: current.cycleNumber,
      weekNumber: current.weekNumber,
      summary: "Week 順延 " + days + " 天",
      beforeJson: before,
      afterJson: { weekEnd: addDaysToYmd(current.weekEnd, days) },
      reason: reason,
      note: note,
    });
    invalidateTimelineSyncCache();
    syncTimelineAndOverdueIfNeeded(true);
    return getWeekContextFromSheet();
  });
}

function refreshCachedItemWeekDates(cycleNumber, fromWeekNumber) {
  const sheet = getItemsSheet();
  const rows = sheetRowsAsObjects(sheet);
  rows.forEach(function (row) {
    const c =
      parsePositiveInteger(row.scheduledCycleNumber) ||
      parsePositiveInteger(row.cycleNumber) ||
      1;
    const w =
      parsePositiveInteger(row.scheduledWeekNumber) ||
      parsePositiveInteger(row.weekNumber);
    if (c !== cycleNumber || w < fromWeekNumber) return;
    const week = findWeek(c, w);
    if (!week) return;
    const delta = row.weekStart
      ? daysBetweenYmd(formatCellDate(row.weekStart), week.weekStart)
      : 0;
    const patch = {
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      updatedAt: new Date().toISOString(),
    };
    if (delta) {
      if (row.webFocusDate)
        patch.webFocusDate = addDaysToYmd(row.webFocusDate, delta);
      if (row.frequency) {
        const occurrences = normalizeOccurrences(row.occurrencesJson);
        occurrences.forEach(function (o) {
          if (o.date) o.date = addDaysToYmd(o.date, delta);
        });
        patch.occurrencesJson = JSON.stringify(occurrences);
      }
    }
    updateObjectRow(sheet, row.__rowNumber, patch);
  });
}

function withWeeksLock(callback) {
  return withTinyProgressDataLock(callback);
}

function createCycleInSheet(input) {
  const startDate = cleanText(input.startDate).slice(0, 10);
  const cycleTheme = cleanText(input.theme || input.cycleTheme || input.title);
  const title = cleanText(input.title);
  const achievement = cleanText(input.achievement || input.goal);
  if (!startDate) throw new Error("新 Cycle 開始日期必填");
  tpCheckYmd(startDate);
  if (!cycleTheme) throw new Error("本輪主題必填");
  // Weekly goals are optional; preserve their existing columns.

  const cycles = getCyclesFromSheetRaw();
  const weeks = getWeeksFromSheetRaw();
  const today = getTodayYmd();
  const existingFutureCycle =
    cycles.find(function (cycle) {
      return (
        cycle.startDate &&
        compareYmd(cycle.startDate, today) > 0 &&
        cleanText(cycle.status) !== "completed"
      );
    }) || null;
  if (existingFutureCycle) {
    throw new Error(
      "已經有 Cycle " +
        existingFutureCycle.cycleNumber +
        " 的下一輪安排，可以直接修改它",
    );
  }
  const lastCycleNumber = cycles.length
    ? cycles[cycles.length - 1].cycleNumber
    : 0;
  const newCycleNumber = lastCycleNumber + 1;
  const priorWeeks = weeks.filter(function (w) {
    return w.cycleNumber === lastCycleNumber;
  });
  if (priorWeeks.length) {
    const priorEnd = priorWeeks[priorWeeks.length - 1].weekEnd;
    if (priorEnd && compareYmd(startDate, priorEnd) <= 0)
      throw new Error("新 Cycle 必須在上一個 Cycle 結束之後開始");
  }

  const now = new Date().toISOString();
  appendObject(getOrCreateSheet(CYCLES_SHEET_NAME), {
    cycleNumber: newCycleNumber,
    startDate: startDate,
    theme: cycleTheme,
    status: compareYmd(startDate, getTodayYmd()) > 0 ? "upcoming" : "active",
    createdAt: now,
    updatedAt: now,
  });

  const weekSheet = getWeeksSheet();
  for (let i = 1; i <= 12; i++) {
    const weekStart = addDaysToYmd(startDate, (i - 1) * 7);
    const weekEnd = addDaysToYmd(weekStart, 6);
    appendObject(weekSheet, {
      weekNumber: i,
      title: i === 1 ? title : "",
      achievement: i === 1 ? achievement : "",
      status: "upcoming",
      weekStart: weekStart,
      weekEnd: weekEnd,
      weekId:
        "c" + newCycleNumber + "-w" + i + "-" + Utilities.getUuid().slice(0, 8),
      cycleNumber: newCycleNumber,
      postponed: false,
      postponeDays: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  // 下一輪在開始日前都視為草稿，不寫進事件紀錄。
  // 等到開始日真正到來後，History 才會顯示這個 Cycle。
  if (compareYmd(startDate, getTodayYmd()) <= 0) {
    writeEvent({
      eventType: "cycle_created",
      entityType: "cycle",
      entityId: "cycle-" + newCycleNumber,
      cycleNumber: newCycleNumber,
      weekNumber: 1,
      summary: "建立 Cycle " + newCycleNumber,
      afterJson: { startDate: startDate },
    });
  }
  invalidateTimelineSyncCache();
  syncTimelineAndOverdueIfNeeded(true);
  return {
    cycleNumber: newCycleNumber,
    startDate: startDate,
    context: getWeekContextFromSheet(),
  };
}

function updateCycleThemeInSheet(cycleNumber, theme) {
  const c = parsePositiveInteger(cycleNumber);
  const value = cleanText(theme);
  if (!c) throw new Error("缺少 Cycle");
  if (!value) throw new Error("本輪主題不可空白");

  const sheet = getOrCreateSheet(CYCLES_SHEET_NAME);
  ensureColumns(sheet, CYCLE_HEADERS);
  const row = sheetRowsAsObjects(sheet).find(function (r) {
    return Number(r.cycleNumber) === c;
  });
  if (!row) throw new Error("找不到 Cycle " + c);

  const cycleWeeks = getWeeksFromSheetRaw().filter(function (week) {
    return Number(week.cycleNumber) === c;
  });
  const lastWeek = cycleWeeks.length ? cycleWeeks[cycleWeeks.length - 1] : null;
  if (
    lastWeek &&
    lastWeek.weekEnd &&
    compareYmd(lastWeek.weekEnd, getTodayYmd()) < 0
  ) {
    throw new Error("已完成的 Cycle 不再修改本輪主題");
  }

  const patch = { theme: value, updatedAt: new Date().toISOString() };
  updateObjectRow(sheet, row.__rowNumber, patch);
  return {
    cycleNumber: c,
    startDate: formatCellDate(row.startDate),
    theme: value,
    status: cleanText(row.status) || "upcoming",
    createdAt: row.createdAt || "",
    updatedAt: patch.updatedAt,
  };
}

function changeCycleStartDateInSheet(cycleNumber, startDate, reason, note) {
  const c = parsePositiveInteger(cycleNumber);
  const newStart = cleanText(startDate).slice(0, 10);
  if (!c || !newStart) throw new Error("Cycle 與開始日期都必填");
  tpCheckYmd(newStart);

  const today = getTodayYmd();
  const cycleSheet = getOrCreateSheet(CYCLES_SHEET_NAME);
  const cycleRow = sheetRowsAsObjects(cycleSheet).find(function (r) {
    return Number(r.cycleNumber) === c;
  });
  if (!cycleRow) throw new Error("找不到 Cycle " + c);

  const oldStart = formatCellDate(cycleRow.startDate);
  if (!oldStart || compareYmd(oldStart, today) <= 0)
    throw new Error("Cycle 已開始，不能再修改開始日期");

  const priorCycleWeeks = getWeeksFromSheetRaw().filter(function (w) {
    return Number(w.cycleNumber) === c - 1;
  });
  if (priorCycleWeeks.length) {
    const priorEnd = priorCycleWeeks[priorCycleWeeks.length - 1].weekEnd;
    if (priorEnd && compareYmd(newStart, priorEnd) <= 0) {
      throw new Error("新 Cycle 必須在上一個 Cycle 結束之後開始");
    }
  }

  const oldDate = parseSheetDateOnly(oldStart);
  const newDate = parseSheetDateOnly(newStart);
  const delta = Math.round((newDate.getTime() - oldDate.getTime()) / 86400000);

  const weekSheet = getWeeksSheet();
  sheetRowsAsObjects(weekSheet)
    .filter(function (r) {
      return Number(r.cycleNumber || 1) === c;
    })
    .forEach(function (row) {
      updateObjectRow(weekSheet, row.__rowNumber, {
        weekStart: addDaysToYmd(row.weekStart, delta),
        weekEnd: addDaysToYmd(row.weekEnd, delta),
        updatedAt: new Date().toISOString(),
      });
    });

  updateObjectRow(cycleSheet, cycleRow.__rowNumber, {
    startDate: newStart,
    updatedAt: new Date().toISOString(),
  });

  refreshCachedItemWeekDates(c, 1);

  // 草稿期可以自由修改，但「時間」屬於有意義的決策，因此留下單一事件。
  if (oldStart !== newStart) {
    writeEvent({
      eventType: "cycle_start_changed",
      entityType: "cycle",
      entityId: "cycle-" + c,
      cycleNumber: c,
      weekNumber: 1,
      summary: "調整 Cycle 開始日期",
      beforeJson: { startDate: oldStart },
      afterJson: { startDate: newStart },
      reason: cleanText(reason),
      note: cleanText(note),
    });
  }

  invalidateTimelineSyncCache();
  syncTimelineAndOverdueIfNeeded(true);
  return {
    cycleNumber: c,
    previousStartDate: oldStart,
    startDate: newStart,
    context: getWeekContextFromSheet(),
  };
}

// ---------- Items ----------

function getItemsSheet() {
  return getOrCreateSheet(SHEET_NAME);
}

function getItemsFromSheetRaw(preloadedCategories) {
  const sheet = getItemsSheet();
  ensureColumns(sheet, ITEM_HEADERS);
  const categories = Array.isArray(preloadedCategories)
    ? preloadedCategories
    : getCategoriesFromSheetRaw();
  const categoryMap = {};
  categories.forEach(function (c) {
    categoryMap[c.id] = c;
  });
  return sheetRowsAsObjects(sheet)
    .map(function (row) {
      return rowToItemObject(row, categoryMap);
    })
    .filter(function (item) {
      return item.id;
    });
}

function normalizeRecurringFrequency(value) {
  const frequency = cleanText(value);
  return ["daily", "weekly"].indexOf(frequency) >= 0 ? frequency : "";
}

function normalizeOccurrences(value) {
  let rows = value;
  if (!Array.isArray(rows)) rows = safeParseJson(cleanText(value)) || [];
  if (!Array.isArray(rows)) return [];
  return rows.map(function (row, index) {
    row = row || {};
    return {
      id: cleanText(row.id) || "occ-" + (index + 1),
      date: cleanText(row.date).slice(0, 10),
      done: normalizeBoolean(row.done),
      doneDate: cleanText(row.doneDate).slice(0, 10),
      note: cleanText(row.note),
    };
  });
}

function recurrenceTargetCount(frequency, timesPerWeek) {
  if (frequency === "daily") return 7;
  if (frequency === "weekly")
    return Math.max(1, Math.min(7, parsePositiveInteger(timesPerWeek) || 1));
  return 0;
}

function rowToItemObject(row, categoryMap) {
  const scheduledCycle =
    parsePositiveInteger(row.scheduledCycleNumber) ||
    parsePositiveInteger(row.cycleNumber) ||
    1;
  const scheduledWeek =
    parsePositiveInteger(row.scheduledWeekNumber) ||
    parsePositiveInteger(row.weekNumber) ||
    1;
  const originalCycle =
    parsePositiveInteger(row.originalCycleNumber) || scheduledCycle;
  const originalWeek =
    parsePositiveInteger(row.originalWeekNumber) || scheduledWeek;
  const cat = categoryMap[cleanText(row.categoryId)] || null;
  const sub = categoryMap[cleanText(row.subCategoryId)] || null;
  const categoryName = cat ? cat.name : normalizeCategory(row.category);
  const subName = sub
    ? sub.name
    : cleanText(row.subCategory) || EMPTY_SUBCATEGORY;
  const frequency = normalizeRecurringFrequency(row.frequency);
  const timesPerWeek = recurrenceTargetCount(frequency, row.timesPerWeek);
  const occurrences = normalizeOccurrences(row.occurrencesJson);
  const occurrenceDoneCount = occurrences.filter(function (o) {
    return o.done;
  }).length;
  let status = normalizeTaskStatus(row.status, row.done);
  if (frequency && ["cancelled", "replanned"].indexOf(status) < 0) {
    if (occurrenceDoneCount >= timesPerWeek && timesPerWeek > 0)
      status = "completed";
    else if (status !== "overdue") status = "active";
  }
  const occurrenceDates = occurrences
    .filter(function (o) {
      return o.doneDate;
    })
    .map(function (o) {
      return o.doneDate;
    })
    .sort();

  return {
    id: cleanText(row.id),
    type: cleanText(row.type) || "task",
    title: cleanText(row.title),
    categoryId: cleanText(row.categoryId),
    subCategoryId: cleanText(row.subCategoryId),
    category: categoryName,
    subCategory: subName,
    status: status,
    done: status === "completed",
    cycleNumber: scheduledCycle,
    weekNumber: scheduledWeek,
    originalCycleNumber: originalCycle,
    originalWeekNumber: originalWeek,
    scheduledCycleNumber: scheduledCycle,
    scheduledWeekNumber: scheduledWeek,
    weekStart: formatCellDate(row.weekStart),
    weekEnd: formatCellDate(row.weekEnd),
    completedAt:
      row.completedAt ||
      (status === "completed" && occurrenceDates.length
        ? occurrenceDates[occurrenceDates.length - 1]
        : ""),
    cancelledAt: row.cancelledAt || "",
    cancelReason: cleanText(row.cancelReason),
    cancelNote: cleanText(row.cancelNote),
    replannedAt: row.replannedAt || "",
    recurringRuleId: cleanText(row.recurringRuleId),
    frequency: frequency,
    timesPerWeek: timesPerWeek,
    occurrences: occurrences,
    completionNote: cleanText(row.completionNote),
    webNumericId: Number(row.webNumericId) || "",
    webGoal: cleanText(row.webGoal),
    webFocusDate: cleanText(row.webFocusDate),
    createdAt: row.createdAt || "",
    updatedAt: row.updatedAt || "",
  };
}

function getItemTargetById(id, includeCategories) {
  const targetId = cleanText(id);
  if (!targetId) return null;

  const sheet = getItemsSheet();
  ensureColumns(sheet, ITEM_HEADERS);
  const headers = getHeaders(sheet);
  const idIndex = headers.indexOf("id");
  if (idIndex === -1 || sheet.getLastRow() <= 1) return null;

  // 只在 id 欄搜尋，不再為了完成 / 修改一件任務讀完整張 items。
  const idRange = sheet.getRange(2, idIndex + 1, sheet.getLastRow() - 1, 1);
  const match = idRange
    .createTextFinder(targetId)
    .matchEntireCell(true)
    .findNext();
  if (!match) return null;

  const rowNumber = match.getRow();
  const values = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const row = {};
  headers.forEach(function (header, index) {
    if (header) row[header] = values[index];
  });
  row.__rowNumber = rowNumber;

  // 完成 / 更正 / 刪除 / 調整時間都不需要重新讀 categories。
  // 只有真的要改分類時才載入，避免每個任務按鈕多一次 Sheets 讀取。
  const categories = includeCategories ? getCategoriesFromSheetRaw() : [];
  const categoryMap = {};
  categories.forEach(function (c) {
    categoryMap[c.id] = c;
  });
  return {
    sheet: sheet,
    row: row,
    item: rowToItemObject(row, categoryMap),
    categories: categories,
    categoryMap: categoryMap,
  };
}

function assertWeekNotArchived(cycleNumber, weekNumber, actionText) {
  const c = parsePositiveInteger(cycleNumber);
  const w = parsePositiveInteger(weekNumber);
  const week = findWeek(c, w);
  if (!week) throw new Error("找不到 Cycle " + c + " · Week " + w);
  if (week.archived)
    throw new Error("這個 Week 已封存，不能" + (actionText || "修改"));
  return week;
}

function assertItemWeekNotArchived(item, actionText) {
  return assertWeekNotArchived(
    item.scheduledCycleNumber || item.cycleNumber,
    item.scheduledWeekNumber || item.weekNumber,
    actionText,
  );
}

function createItemToSheet(input) {
  // doPost 只負責 schema；這裡直接以 Week 日期做必要驗證，不重跑整套 timeline。
  const title = cleanText(input.title);
  const type = cleanText(input.type) || "task";
  if (!title) throw new Error("任務名稱不可空白");
  if (["task", "standard"].indexOf(type) === -1)
    throw new Error("type 只能是 task 或 standard");

  const weeks = getWeeksFromSheetRaw();
  const today = getTodayYmd();
  const current =
    weeks.find(function (row) {
      return (
        row.weekStart &&
        row.weekEnd &&
        compareYmd(row.weekStart, today) <= 0 &&
        compareYmd(today, row.weekEnd) <= 0
      );
    }) || null;

  let cycleNumber = parsePositiveInteger(
    input.scheduledCycleNumber || input.cycleNumber,
  );
  let weekNumber = parsePositiveInteger(
    input.scheduledWeekNumber || input.weekNumber,
  );
  if (!cycleNumber || !weekNumber) {
    if (!current) throw new Error("目前不在進行中的 Week，不能新增任務");
    cycleNumber = current.cycleNumber;
    weekNumber = current.weekNumber;
  }

  const week =
    weeks.find(function (row) {
      return (
        Number(row.cycleNumber) === Number(cycleNumber) &&
        Number(row.weekNumber) === Number(weekNumber)
      );
    }) || null;
  if (!week)
    throw new Error("找不到 Cycle " + cycleNumber + " · Week " + weekNumber);
  if (week.archived) throw new Error("這個 Week 已封存，不能新增");
  if (week.weekEnd && compareYmd(week.weekEnd, today) < 0)
    throw new Error("這個 Week 已封存，不能新增");
  if (
    current &&
    Number(week.cycleNumber) === Number(current.cycleNumber) &&
    Number(week.weekNumber) > Number(current.weekNumber)
  ) {
    const maxWeek = computeMaxPlannableWeek(getItemsFromSheetRaw(), current);
    if (Number(week.weekNumber) > maxWeek) {
      throw new Error(
        "先把 Week " +
          maxWeek +
          " 的任務完成，Week " +
          week.weekNumber +
          " 才會開放安排",
      );
    }
  }

  const isCurrentTarget =
    week.weekStart &&
    week.weekEnd &&
    compareYmd(week.weekStart, today) <= 0 &&
    compareYmd(today, week.weekEnd) <= 0;
  // Adding a task no longer requires a weekly goal.

  const categories = getCategoriesFromSheetRaw();
  const ids = resolveCategoryIds(input, categories);
  const category = getCategoryById(ids.categoryId, categories);
  const sub = ids.subCategoryId
    ? getCategoryById(ids.subCategoryId, categories)
    : null;
  const now = new Date().toISOString();
  const itemId = cleanText(input.id) || generateId(type);
  if (getItemTargetById(itemId)) throw new Error("任務 ID 已存在");
  const frequency = normalizeRecurringFrequency(input.frequency);
  const timesPerWeek = recurrenceTargetCount(frequency, input.timesPerWeek);
  let occurrences = normalizeOccurrences(
    input.occurrences || input.occurrencesJson,
  );
  if (frequency) {
    while (occurrences.length < timesPerWeek) {
      const index = occurrences.length;
      occurrences.push({
        id: itemId + "-o" + (index + 1),
        date:
          frequency === "daily" && week.weekStart
            ? addDaysToYmd(week.weekStart, index)
            : "",
        done: false,
        doneDate: "",
        note: "",
      });
    }
    if (occurrences.length > timesPerWeek)
      occurrences = occurrences.slice(0, timesPerWeek);
  }

  const item = {
    id: itemId,
    type: type,
    title: title,
    category: category ? category.name : normalizeCategory(input.category),
    subCategory: sub
      ? sub.name
      : cleanText(input.subCategory) || EMPTY_SUBCATEGORY,
    done: false,
    weekNumber: weekNumber,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    createdAt: now,
    updatedAt: now,
    categoryId: ids.categoryId,
    subCategoryId: ids.subCategoryId,
    status: "active",
    cycleNumber: cycleNumber,
    originalCycleNumber: cycleNumber,
    originalWeekNumber: weekNumber,
    scheduledCycleNumber: cycleNumber,
    scheduledWeekNumber: weekNumber,
    recurringRuleId: cleanText(input.recurringRuleId),
    frequency: frequency,
    timesPerWeek: timesPerWeek || "",
    occurrencesJson: frequency ? JSON.stringify(occurrences) : "",
    completionNote: cleanText(input.completionNote),
  };

  appendObject(getItemsSheet(), item);
  if (type === "task" && compareYmd(week.weekStart, getTodayYmd()) <= 0) {
    writeEvent({
      eventType: "task_created",
      entityType: "task",
      entityId: item.id,
      cycleNumber: cycleNumber,
      weekNumber: weekNumber,
      summary: "建立任務",
      afterJson: { title: title },
    });
  }

  // 不再為了回傳剛寫好的任務重讀整張 items + categories。
  const categoryMap = {};
  categories.forEach(function (c) {
    categoryMap[c.id] = c;
  });
  return rowToItemObject(item, categoryMap);
}

function updateItemInSheet(id, updates) {
  const target = getItemTargetById(id);
  if (!target) throw new Error("找不到任務：" + id);
  const existing = target.item;
  assertItemWeekNotArchived(existing, "修改");

  if (updates.done !== undefined) {
    if (normalizeBoolean(updates.done)) return completeTaskInSheet(id);
    if (existing.frequency) return correctRecurringOccurrenceInSheet(id, "");
    if (existing.status === "completed") return correctCompletionInSheet(id);
  }
  if (existing.status === "completed") throw new Error("已完成任務不能再編輯");
  if (["cancelled", "replanned"].indexOf(existing.status) >= 0)
    throw new Error("此任務已封存，不能編輯");

  const patch = { updatedAt: new Date().toISOString() };
  if (updates.title !== undefined) {
    const title = cleanText(updates.title);
    if (!title) throw new Error("任務名稱不可空白");
    patch.title = title;
  }
  if (
    updates.categoryId !== undefined ||
    updates.subCategoryId !== undefined ||
    updates.category !== undefined ||
    updates.subCategory !== undefined
  ) {
    const categories = getCategoriesFromSheetRaw();
    const ids = resolveCategoryIds(
      {
        categoryId:
          updates.categoryId !== undefined
            ? updates.categoryId
            : existing.categoryId,
        subCategoryId:
          updates.subCategoryId !== undefined
            ? updates.subCategoryId
            : existing.subCategoryId,
        category:
          updates.category !== undefined ? updates.category : existing.category,
        subCategory:
          updates.subCategory !== undefined
            ? updates.subCategory
            : existing.subCategory,
      },
      categories,
    );
    const cat = getCategoryById(ids.categoryId, categories);
    const sub = ids.subCategoryId
      ? getCategoryById(ids.subCategoryId, categories)
      : null;
    patch.categoryId = ids.categoryId;
    patch.subCategoryId = ids.subCategoryId;
    patch.category = cat ? cat.name : existing.category;
    patch.subCategory = sub ? sub.name : EMPTY_SUBCATEGORY;
  }
  if (updates.completionNote !== undefined)
    patch.completionNote = cleanText(updates.completionNote);
  if (
    updates.frequency !== undefined ||
    updates.timesPerWeek !== undefined ||
    updates.occurrences !== undefined ||
    updates.occurrencesJson !== undefined
  ) {
    const frequency = normalizeRecurringFrequency(
      updates.frequency !== undefined ? updates.frequency : existing.frequency,
    );
    const timesPerWeek = recurrenceTargetCount(
      frequency,
      updates.timesPerWeek !== undefined
        ? updates.timesPerWeek
        : existing.timesPerWeek,
    );
    let occurrences =
      updates.occurrences !== undefined || updates.occurrencesJson !== undefined
        ? normalizeOccurrences(updates.occurrences || updates.occurrencesJson)
        : (existing.occurrences || []).map(function (o) {
            return Object.assign({}, o);
          });
    const week = findWeek(
      existing.scheduledCycleNumber,
      existing.scheduledWeekNumber,
    );
    while (frequency && occurrences.length < timesPerWeek) {
      const index = occurrences.length;
      occurrences.push({
        id: existing.id + "-o" + (index + 1),
        date:
          frequency === "daily" && week && week.weekStart
            ? addDaysToYmd(week.weekStart, index)
            : "",
        done: false,
        doneDate: "",
        note: "",
      });
    }
    if (frequency && occurrences.length > timesPerWeek) {
      const doneRows = occurrences.filter(function (o) {
        return o.done;
      });
      const undoneRows = occurrences.filter(function (o) {
        return !o.done;
      });
      occurrences = doneRows.concat(
        undoneRows.slice(0, Math.max(0, timesPerWeek - doneRows.length)),
      );
    }
    patch.frequency = frequency;
    patch.timesPerWeek = frequency
      ? Math.max(
          timesPerWeek,
          occurrences.filter(function (o) {
            return o.done;
          }).length,
        )
      : "";
    patch.occurrencesJson = frequency ? JSON.stringify(occurrences) : "";
    if (!frequency) patch.recurringRuleId = "";
  }

  updateObjectRow(target.sheet, target.row.__rowNumber, patch);
  return Object.assign({}, existing, patch);
}

function removeDraftTaskInSheet(id) {
  const target = getItemTargetById(id);
  if (!target) throw new Error("找不到任務");
  const existing = target.item;
  assertItemWeekNotArchived(existing, "移除");

  const cycleNumber = Number(
    existing.scheduledCycleNumber || existing.cycleNumber,
  );
  const cycle =
    getCyclesFromSheetRaw().find(function (row) {
      return Number(row.cycleNumber) === cycleNumber;
    }) || null;

  const today = getTodayYmd();
  if (!cycle || !cycle.startDate || compareYmd(cycle.startDate, today) <= 0) {
    throw new Error("只有尚未開始的下一輪任務可以直接移除");
  }

  target.sheet.deleteRow(target.row.__rowNumber);

  // 草稿期直接移除，不留下取消或刪除事件。
  return { id: id, removed: true, cycleNumber: cycleNumber };
}

function buildRecurringCompletionPatch(existing, occurrences) {
  const targetCount = recurrenceTargetCount(
    existing.frequency,
    existing.timesPerWeek,
  );
  const doneRows = occurrences.filter(function (o) {
    return o.done;
  });
  const completed = targetCount > 0 && doneRows.length >= targetCount;
  const week = findWeek(
    existing.scheduledCycleNumber,
    existing.scheduledWeekNumber,
  );
  const overdue =
    !completed &&
    week &&
    week.weekEnd &&
    compareYmd(week.weekEnd, getTodayYmd()) < 0;
  const latestDone =
    doneRows
      .map(function (o) {
        return cleanText(o.doneDate);
      })
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || "";
  return {
    occurrencesJson: JSON.stringify(occurrences),
    status: completed ? "completed" : overdue ? "overdue" : "active",
    done: completed,
    completedAt: completed ? latestDone : "",
    updatedAt: new Date().toISOString(),
  };
}

function recurringResult(existing, occurrences, patch) {
  return Object.assign({}, existing, patch, {
    occurrences: occurrences,
    done: patch.status === "completed",
    completedAt: patch.completedAt || "",
  });
}

function completeRecurringOccurrenceInSheet(id, occurrenceId, date, note) {
  const target = getItemTargetById(id);
  if (!target) throw new Error("找不到任務");
  const existing = target.item;
  assertItemWeekNotArchived(existing, "完成");
  if (!existing.frequency) throw new Error("這不是日常小事");
  if (["cancelled", "replanned"].indexOf(existing.status) >= 0)
    throw new Error("這個日常小事已封存");

  const occurrences = (existing.occurrences || []).map(function (o) {
    return Object.assign({}, o);
  });
  let occurrence = occurrenceId
    ? occurrences.find(function (o) {
        return o.id === cleanText(occurrenceId);
      })
    : null;
  if (occurrenceId && !occurrence) throw new Error("找不到這次日常紀錄");
  if (!occurrence)
    occurrence =
      occurrences.find(function (o) {
        return !o.done;
      }) || null;
  if (!occurrence) return existing;
  if (occurrence.done) return existing;

  occurrence.done = true;
  occurrence.doneDate = cleanText(date).slice(0, 10) || getTodayYmd();
  if (note !== undefined) occurrence.note = cleanText(note);
  const patch = buildRecurringCompletionPatch(existing, occurrences);
  updateObjectRow(target.sheet, target.row.__rowNumber, patch);
  writeEvent({
    eventType: "task_occurrence_completed",
    entityType: "task",
    entityId: id,
    cycleNumber: existing.scheduledCycleNumber,
    weekNumber: existing.scheduledWeekNumber,
    summary: "日常小事完成一次",
    beforeJson: { occurrenceId: occurrence.id, done: false },
    afterJson: {
      occurrenceId: occurrence.id,
      done: true,
      doneDate: occurrence.doneDate,
    },
  });
  return recurringResult(existing, occurrences, patch);
}

function correctRecurringOccurrenceInSheet(id, occurrenceId) {
  const target = getItemTargetById(id);
  if (!target) throw new Error("找不到任務");
  const existing = target.item;
  assertItemWeekNotArchived(existing, "改回未完成");
  if (!existing.frequency) throw new Error("這不是日常小事");
  const occurrences = (existing.occurrences || []).map(function (o) {
    return Object.assign({}, o);
  });
  let occurrence = occurrenceId
    ? occurrences.find(function (o) {
        return o.id === cleanText(occurrenceId);
      })
    : null;
  if (occurrenceId && !occurrence) throw new Error("找不到這次日常紀錄");
  if (occurrenceId && occurrence && !occurrence.done) return existing;
  if (!occurrence)
    occurrence =
      occurrences
        .slice()
        .reverse()
        .find(function (o) {
          return o.done;
        }) || null;
  if (!occurrence || !occurrence.done)
    throw new Error("沒有可以改回未完成的紀錄");

  const before = { occurrenceId: occurrence.id, doneDate: occurrence.doneDate };
  occurrence.done = false;
  occurrence.doneDate = "";
  occurrence.note = "";
  const patch = buildRecurringCompletionPatch(existing, occurrences);
  updateObjectRow(target.sheet, target.row.__rowNumber, patch);
  writeEvent({
    eventType: "occurrence_completion_corrected",
    entityType: "task",
    entityId: id,
    cycleNumber: existing.scheduledCycleNumber,
    weekNumber: existing.scheduledWeekNumber,
    summary: "日常小事改回未完成",
    beforeJson: before,
    afterJson: { occurrenceId: occurrence.id, done: false },
  });
  return recurringResult(existing, occurrences, patch);
}

function scheduleRecurringOccurrenceInSheet(id, occurrenceId, date) {
  const target = getItemTargetById(id);
  if (!target) throw new Error("找不到任務");
  const existing = target.item;
  assertItemWeekNotArchived(existing, "安排日期");
  if (!existing.frequency) throw new Error("這不是日常小事");
  const ymd = cleanText(date).slice(0, 10);
  if (!ymd) throw new Error("缺少日期");
  const week = findWeek(
    existing.scheduledCycleNumber,
    existing.scheduledWeekNumber,
  );
  if (
    !week ||
    !week.weekStart ||
    !week.weekEnd ||
    compareYmd(ymd, week.weekStart) < 0 ||
    compareYmd(ymd, week.weekEnd) > 0
  ) {
    throw new Error("只能放進這一週的日期");
  }
  const occurrences = (existing.occurrences || []).map(function (o) {
    return Object.assign({}, o);
  });
  let occurrence = occurrenceId
    ? occurrences.find(function (o) {
        return o.id === cleanText(occurrenceId);
      })
    : null;
  if (!occurrence)
    occurrence =
      occurrences.find(function (o) {
        return !o.done && !o.date;
      }) || null;
  if (!occurrence) throw new Error("沒有可以安排的次數");
  if (occurrence.done) throw new Error("已完成的紀錄不能再改日期");
  occurrence.date = ymd;
  const patch = {
    occurrencesJson: JSON.stringify(occurrences),
    updatedAt: new Date().toISOString(),
  };
  updateObjectRow(target.sheet, target.row.__rowNumber, patch);
  return recurringResult(
    existing,
    occurrences,
    Object.assign(
      { status: existing.status, completedAt: existing.completedAt },
      patch,
    ),
  );
}

function completeTaskInSheet(id) {
  const target = getItemTargetById(id);
  if (!target) throw new Error("找不到任務");
  const existing = target.item;
  assertItemWeekNotArchived(existing, "完成");
  if (existing.frequency)
    return completeRecurringOccurrenceInSheet(id, "", getTodayYmd(), "");
  if (existing.status === "completed") return existing;
  if (["cancelled", "replanned"].indexOf(existing.status) >= 0)
    throw new Error("此任務已封存，不能完成");

  const now = new Date().toISOString();
  const patch = {
    status: "completed",
    done: true,
    completedAt: now,
    updatedAt: now,
  };
  updateObjectRow(target.sheet, target.row.__rowNumber, patch);
  writeEvent({
    eventType: "task_completed",
    entityType: "task",
    entityId: id,
    cycleNumber: existing.scheduledCycleNumber,
    weekNumber: existing.scheduledWeekNumber,
    summary: "任務完成",
    beforeJson: { status: existing.status },
    afterJson: { status: "completed", completedAt: now },
  });
  return Object.assign({}, existing, patch);
}

function correctCompletionInSheet(id) {
  const target = getItemTargetById(id);
  if (!target || target.item.status !== "completed")
    throw new Error("只有已完成任務可以做誤操作更正");
  const existing = target.item;
  assertItemWeekNotArchived(existing, "改回未完成");
  if (existing.frequency) return correctRecurringOccurrenceInSheet(id, "");
  const week = findWeek(
    existing.scheduledCycleNumber,
    existing.scheduledWeekNumber,
  );
  const status =
    week && week.weekEnd && compareYmd(week.weekEnd, getTodayYmd()) < 0
      ? "overdue"
      : "active";
  const now = new Date().toISOString();
  const patch = {
    status: status,
    done: false,
    completedAt: "",
    updatedAt: now,
  };
  updateObjectRow(target.sheet, target.row.__rowNumber, patch);
  writeEvent({
    eventType: "completion_corrected",
    entityType: "task",
    entityId: id,
    cycleNumber: existing.scheduledCycleNumber,
    weekNumber: existing.scheduledWeekNumber,
    summary: "誤操作更正：改回未完成",
    beforeJson: { status: "completed" },
    afterJson: { status: status },
  });
  return Object.assign({}, existing, patch);
}

function cancelTaskInSheet(id, reason, note) {
  const target = getItemTargetById(id);
  if (!target) throw new Error("找不到任務");
  const existing = target.item;
  assertItemWeekNotArchived(existing, "刪除");
  if (["cancelled", "replanned"].indexOf(existing.status) >= 0) return existing;
  const why = cleanText(reason);
  if (!why) throw new Error("刪除原因必填");
  const now = new Date().toISOString();
  const patch = {
    status: "cancelled",
    done: false,
    completedAt: "",
    cancelledAt: now,
    cancelReason: why,
    cancelNote: cleanText(note),
    updatedAt: now,
  };
  updateObjectRow(target.sheet, target.row.__rowNumber, patch);
  writeEvent({
    eventType: "task_deleted",
    entityType: "task",
    entityId: id,
    cycleNumber: existing.scheduledCycleNumber,
    weekNumber: existing.scheduledWeekNumber,
    summary: "刪除任務",
    beforeJson: { status: existing.status },
    afterJson: { status: "cancelled" },
    reason: why,
    note: cleanText(note),
  });
  return Object.assign({}, existing, patch);
}

function restoreCancelledTaskInSheet(id) {
  const target = getItemTargetById(id);
  if (!target) throw new Error("找不到任務");
  const existing = target.item;
  assertItemWeekNotArchived(existing, "復原");
  if (existing.status !== "cancelled")
    throw new Error("只有已刪除的任務可以復原");
  const now = new Date().toISOString();
  const patch = {
    status: "active",
    done: false,
    completedAt: "",
    cancelledAt: "",
    cancelReason: "",
    cancelNote: "",
    updatedAt: now,
  };
  updateObjectRow(target.sheet, target.row.__rowNumber, patch);
  writeEvent({
    eventType: "task_restored",
    entityType: "task",
    entityId: id,
    cycleNumber: existing.scheduledCycleNumber,
    weekNumber: existing.scheduledWeekNumber,
    summary: "復原刪除任務",
    beforeJson: { status: "cancelled" },
    afterJson: { status: "active" },
  });
  return Object.assign({}, existing, patch);
}

function deleteItemFromSheet(id) {
  // 舊 LINE「刪除」指令改走 Soft Delete。
  return cancelTaskInSheet(id, "LINE 刪除", "由 LINE 刪除指令保留一筆刪除紀錄");
}

function rescheduleTaskInSheet(id, targetInfo, reason, note) {
  const target = getItemTargetById(id);
  if (!target) throw new Error("找不到任務");
  const existing = target.item;
  assertItemWeekNotArchived(existing, "調整時間");
  if (["completed", "cancelled", "replanned"].indexOf(existing.status) >= 0)
    throw new Error("這個任務目前不能調整時間");
  const why = cleanText(reason);
  if (!why) throw new Error("調整時間的原因必填");
  const cycleNumber = parsePositiveInteger(targetInfo.cycleNumber);
  const weekNumber = parsePositiveInteger(targetInfo.weekNumber);
  const week = findWeek(cycleNumber, weekNumber);
  if (!week) throw new Error("目標 Week 不存在");
  if (week.archived) throw new Error("目標 Week 已封存");
  if (week.weekEnd && compareYmd(week.weekEnd, getTodayYmd()) < 0)
    throw new Error("不能重新排到過去的 Week");
  const currentForReschedule = getWeekContextFromSheet().currentWeek;
  if (
    currentForReschedule &&
    cycleNumber === Number(currentForReschedule.cycleNumber) &&
    weekNumber > Number(currentForReschedule.weekNumber) &&
    weekNumber !== Number(existing.scheduledWeekNumber) + 1
  ) {
    const maxWeekForReschedule = computeMaxPlannableWeek(
      getItemsFromSheetRaw(),
      currentForReschedule,
    );
    if (weekNumber > maxWeekForReschedule) {
      throw new Error(
        "這一週還沒開放，先把 Week " + maxWeekForReschedule + " 的任務完成",
      );
    }
  }

  const now = new Date().toISOString();
  const before = {
    cycleNumber: existing.scheduledCycleNumber,
    weekNumber: existing.scheduledWeekNumber,
  };
  const patch = {
    status: "active",
    done: false,
    cycleNumber: cycleNumber,
    weekNumber: weekNumber,
    scheduledCycleNumber: cycleNumber,
    scheduledWeekNumber: weekNumber,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    updatedAt: now,
  };
  updateObjectRow(target.sheet, target.row.__rowNumber, patch);
  writeEvent({
    eventType: "task_rescheduled",
    entityType: "task",
    entityId: id,
    cycleNumber: cycleNumber,
    weekNumber: weekNumber,
    summary: "調整時間",
    beforeJson: before,
    afterJson: { cycleNumber: cycleNumber, weekNumber: weekNumber },
    reason: why,
    note: cleanText(note),
  });
  return Object.assign({}, existing, patch);
}

function replanTaskInSheet(id, newTasks) {
  const target = getItemTargetById(id);
  if (!target) throw new Error("找不到任務");
  const existing = target.item;
  assertItemWeekNotArchived(existing, "重新整理");
  if (["completed", "cancelled", "replanned"].indexOf(existing.status) >= 0)
    throw new Error("這個任務目前不能重新整理");
  if (!Array.isArray(newTasks) || newTasks.length < 1)
    throw new Error("至少需要一個拆分後的新任務");
  const current = getCurrentWeekFromSheet();
  const now = new Date().toISOString();
  const originalPatch = {
    status: "replanned",
    done: false,
    replannedAt: now,
    updatedAt: now,
  };
  updateObjectRow(target.sheet, target.row.__rowNumber, originalPatch);

  const created = newTasks.map(function (task) {
    return createItemToSheet({
      type: "task",
      title: task.title,
      categoryId: task.categoryId,
      subCategoryId: task.subCategoryId,
      category: task.category,
      subCategory: task.subCategory,
      cycleNumber: current.cycleNumber,
      weekNumber: current.weekNumber,
    });
  });

  writeEvent({
    eventType: "task_replanned",
    entityType: "task",
    entityId: id,
    cycleNumber: existing.scheduledCycleNumber,
    weekNumber: existing.scheduledWeekNumber,
    summary: "任務已重新整理",
    beforeJson: { status: existing.status },
    afterJson: {
      status: "replanned",
      newTaskIds: created.map(function (x) {
        return x.id;
      }),
      newTaskTitles: created.map(function (x) {
        return x.title;
      }),
    },
  });
  return {
    original: Object.assign({}, existing, originalPatch),
    newTasks: created,
  };
}

// ---------- Events / History / Review ----------

function writeEvent(input) {
  const event = {
    id: generateId("evt"),
    eventType: cleanText(input.eventType),
    entityType: cleanText(input.entityType),
    entityId: cleanText(input.entityId),
    cycleNumber: parsePositiveInteger(input.cycleNumber) || "",
    weekNumber: parsePositiveInteger(input.weekNumber) || "",
    occurredAt: input.occurredAt || new Date().toISOString(),
    summary: cleanText(input.summary),
    beforeJson: input.beforeJson ? JSON.stringify(input.beforeJson) : "",
    afterJson: input.afterJson ? JSON.stringify(input.afterJson) : "",
    reason: cleanText(input.reason),
    note: cleanText(input.note),
  };
  appendObject(getOrCreateSheet(EVENTS_SHEET_NAME), event);
  return event;
}

function getEventsFromSheetRaw() {
  const sheet = getOrCreateSheet(EVENTS_SHEET_NAME);
  ensureColumns(sheet, EVENT_HEADERS);
  return sheetRowsAsObjects(sheet)
    .map(function (row) {
      return {
        id: cleanText(row.id),
        eventType: cleanText(row.eventType),
        entityType: cleanText(row.entityType),
        entityId: cleanText(row.entityId),
        cycleNumber: parsePositiveInteger(row.cycleNumber),
        weekNumber: parsePositiveInteger(row.weekNumber),
        occurredAt: row.occurredAt || "",
        summary: cleanText(row.summary),
        before: safeParseJson(row.beforeJson),
        after: safeParseJson(row.afterJson),
        reason: cleanText(row.reason),
        note: cleanText(row.note),
      };
    })
    .filter(function (e) {
      return e.id;
    })
    .sort(function (a, b) {
      return String(a.occurredAt).localeCompare(String(b.occurredAt));
    });
}

function getRetrospectivesFromSheetRaw() {
  const sheet = getOrCreateSheet(RETROS_SHEET_NAME);
  ensureColumns(sheet, RETRO_HEADERS);
  return sheetRowsAsObjects(sheet)
    .map(function (row) {
      const cycleNumber = parsePositiveInteger(row.cycleNumber);
      const q1 = cleanText(row.q1);
      const q2 = cleanText(row.q2);
      const q3 = cleanText(row.q3);
      const q4 = cleanText(row.q4);
      const hasAnswers = !!(q1 || q2 || q3 || q4);
      return {
        cycleNumber: cycleNumber,
        weekNumber: parsePositiveInteger(row.weekNumber),
        q1: q1,
        q2: q2,
        q3: q3,
        q4: q4,
        submittedAt:
          row.submittedAt ||
          (cycleNumber >= 2 && hasAnswers
            ? row.updatedAt || row.createdAt || ""
            : ""),
        createdAt: row.createdAt || "",
        updatedAt: row.updatedAt || "",
      };
    })
    .filter(function (r) {
      return r.cycleNumber && r.weekNumber;
    });
}

function saveRetrospectiveInSheet(input) {
  const cycleNumber = parsePositiveInteger(input.cycleNumber);
  const weekNumber = parsePositiveInteger(input.weekNumber);
  if (!cycleNumber || !weekNumber)
    throw new Error("Weekly Review 需要 Cycle 與 Week");
  if (cycleNumber < 2) throw new Error("Weekly Review 從 Cycle 2 開始使用");

  const q1 = cleanText(input.q1);
  const q2 = cleanText(input.q2);
  const q3 = cleanText(input.q3);
  const q4 = cleanText(input.q4);
  if (!q1 || !q2 || !q3 || !q4) throw new Error("四個問題都寫完後再送出");

  const week = findWeek(cycleNumber, weekNumber);
  if (!week) throw new Error("找不到這一週");

  const sheet = getOrCreateSheet(RETROS_SHEET_NAME);
  ensureColumns(sheet, RETRO_HEADERS);
  const rows = sheetRowsAsObjects(sheet);
  const existing = rows.find(function (r) {
    return (
      Number(r.cycleNumber) === cycleNumber &&
      Number(r.weekNumber) === weekNumber
    );
  });

  if (existing) {
    const alreadySubmitted =
      cleanText(existing.submittedAt) ||
      cleanText(existing.q1) ||
      cleanText(existing.q2) ||
      cleanText(existing.q3) ||
      cleanText(existing.q4);
    if (alreadySubmitted)
      throw new Error("這週的 Weekly Review 已經送出，之後只能查看");
  }

  const now = new Date().toISOString();
  const payload = {
    cycleNumber: cycleNumber,
    weekNumber: weekNumber,
    q1: q1,
    q2: q2,
    q3: q3,
    q4: q4,
    submittedAt: now,
    updatedAt: now,
  };
  if (existing) {
    updateObjectRow(sheet, existing.__rowNumber, payload);
  } else {
    appendObject(sheet, Object.assign({}, payload, { createdAt: now }));
  }
  return getRetrospectivesFromSheetRaw().find(function (r) {
    return r.cycleNumber === cycleNumber && r.weekNumber === weekNumber;
  });
}

function buildCycleReviewFromData(cycleNumber, allItems, allWeeks, allRetros) {
  const c = parsePositiveInteger(cycleNumber);
  const items = allItems.filter(function (item) {
    return item.type === "task" && item.originalCycleNumber === c;
  });
  const weeks = allWeeks.filter(function (week) {
    return week.cycleNumber === c;
  });
  const retros = allRetros.filter(function (r) {
    return r.cycleNumber === c && !!r.submittedAt;
  });

  const weekMap = {};
  weeks.forEach(function (week) {
    weekMap[week.weekNumber] = week;
  });

  let onTime = 0;
  let late = 0;
  let incomplete = 0;
  let replanned = 0;
  let cancelled = 0;

  items.forEach(function (item) {
    if (item.status === "replanned") {
      replanned++;
      return;
    }
    if (item.status === "cancelled") {
      cancelled++;
      return;
    }
    if (item.status === "completed") {
      const originalWeek = weekMap[item.originalWeekNumber] || null;
      const completedDate = cleanText(item.completedAt).slice(0, 10);
      if (
        originalWeek &&
        originalWeek.weekEnd &&
        completedDate &&
        compareYmd(completedDate, originalWeek.weekEnd) <= 0
      )
        onTime++;
      else late++;
      return;
    }
    incomplete++;
  });

  const trend = [];
  for (let w = 1; w <= 12; w++) {
    const weekItems = items.filter(function (item) {
      return item.originalWeekNumber === w;
    });
    if (!weekItems.length) {
      trend.push({ weekNumber: w, rate: null, label: "無任務" });
      continue;
    }

    const originalWeek = weekMap[w] || null;
    let weekOnTime = 0;
    weekItems.forEach(function (item) {
      if (item.status !== "completed") return;
      const completedDate = cleanText(item.completedAt).slice(0, 10);
      if (
        originalWeek &&
        originalWeek.weekEnd &&
        completedDate &&
        compareYmd(completedDate, originalWeek.weekEnd) <= 0
      )
        weekOnTime++;
    });
    trend.push({
      weekNumber: w,
      rate: Math.round((weekOnTime / weekItems.length) * 100),
      label: weekOnTime + "/" + weekItems.length,
    });
  }

  return {
    cycleNumber: c,
    totalTasks: items.length,
    onTimeCompleted: onTime,
    lateCompleted: late,
    incomplete: incomplete,
    replanned: replanned,
    cancelled: cancelled,
    onTimeRate: items.length ? Math.round((onTime / items.length) * 100) : 0,
    postponedWeeks: weeks.filter(function (week) {
      return week.postponed;
    }).length,
    retrospectiveCount: retros.length,
    trend: trend,
  };
}

function buildCycleReview(cycleNumber) {
  // Read each sheet once, then calculate entirely in memory.
  const items = getItemsFromSheetRaw();
  const weeks = getWeeksFromSheetRaw();
  const retros = getRetrospectivesFromSheetRaw();
  return buildCycleReviewFromData(cycleNumber, items, weeks, retros);
}

function buildHistoryData() {
  // History is read-heavy, so preload all source sheets once and reuse the same arrays.
  const today = getTodayYmd();
  const cycles = getCyclesFromSheetRaw().filter(function (cycle) {
    return !cycle.startDate || compareYmd(cycle.startDate, today) <= 0;
  });
  const weeks = getWeeksFromSheetRaw();
  const items = getItemsFromSheetRaw().filter(function (item) {
    return item.type === "task";
  });
  const events = getEventsFromSheetRaw();
  const retros = getRetrospectivesFromSheetRaw();

  const eventsByTaskId = {};
  const eventsByCycleNumber = {};
  events.forEach(function (event) {
    if (event.entityType === "task" && event.entityId) {
      if (!eventsByTaskId[event.entityId]) eventsByTaskId[event.entityId] = [];
      eventsByTaskId[event.entityId].push(event);
    }
    if (event.entityType === "cycle" && event.cycleNumber) {
      if (!eventsByCycleNumber[event.cycleNumber])
        eventsByCycleNumber[event.cycleNumber] = [];
      eventsByCycleNumber[event.cycleNumber].push(event);
    }
  });

  const tasksByWeekKey = {};
  items.forEach(function (item) {
    const key = item.originalCycleNumber + ":" + item.originalWeekNumber;
    if (!tasksByWeekKey[key]) tasksByWeekKey[key] = [];
    tasksByWeekKey[key].push({
      item: item,
      events: eventsByTaskId[item.id] || [],
    });
  });

  const retroByWeekKey = {};
  retros.forEach(function (retro) {
    retroByWeekKey[retro.cycleNumber + ":" + retro.weekNumber] = retro;
  });

  return cycles
    .slice()
    .sort(function (a, b) {
      return b.cycleNumber - a.cycleNumber;
    })
    .map(function (cycle) {
      const cycleWeeks = weeks.filter(function (w) {
        return w.cycleNumber === cycle.cycleNumber;
      });
      return {
        cycle: cycle,
        summary: buildCycleReviewFromData(
          cycle.cycleNumber,
          items,
          weeks,
          retros,
        ),
        events: eventsByCycleNumber[cycle.cycleNumber] || [],
        weeks: cycleWeeks.map(function (week) {
          const key = week.cycleNumber + ":" + week.weekNumber;
          return {
            week: week,
            tasks: tasksByWeekKey[key] || [],
            retrospective: retroByWeekKey[key] || null,
          };
        }),
      };
    });
}

function tpLinePendingCacheKey(userId) {
  const id = String(userId || "").trim();
  if (!id) throw new Error("LINE pending 缺少 userId");
  return TP_LINE_PENDING_CACHE_PREFIX + id;
}

function getLinePendingState(userId) {
  const raw = CacheService.getScriptCache().get(tpLinePendingCacheKey(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function setLinePendingState(userId, pending, ttlSeconds) {
  const payload = Object.assign({}, pending || {}, {
    createdAt: new Date().toISOString(),
  });
  const ttl = Math.max(
    60,
    Math.min(21600, Number(ttlSeconds || TP_LINE_PENDING_TTL_SECONDS)),
  );
  CacheService.getScriptCache().put(
    tpLinePendingCacheKey(userId),
    JSON.stringify(payload),
    ttl,
  );
  return { ok: true, pending: payload, ttlSeconds: ttl };
}

function clearLinePendingState(userId) {
  CacheService.getScriptCache().remove(tpLinePendingCacheKey(userId));
  return { ok: true, cleared: true };
}

function tpLineDecode(value) {
  return decodeURIComponent(String(value || "").replace(/\+/g, "%20"));
}

function tpLineEncode(value) {
  return encodeURIComponent(
    String(value === undefined || value === null ? "" : value),
  );
}

function parseLinePostbackData(raw) {
  const out = {};
  String(raw || "")
    .split("&")
    .forEach(function (pair) {
      if (!pair) return;
      const pos = pair.indexOf("=");
      const key = tpLineDecode(pos >= 0 ? pair.slice(0, pos) : pair);
      const value = tpLineDecode(pos >= 0 ? pair.slice(pos + 1) : "");
      if (key) out[key] = value;
    });
  return out;
}

function buildLinePostbackData(action, params) {
  const parts = ["action=" + tpLineEncode(action)];
  Object.keys(params || {}).forEach(function (key) {
    const value = params[key];
    if (value === undefined || value === null || value === "") return;
    parts.push(tpLineEncode(key) + "=" + tpLineEncode(value));
  });
  return parts.join("&");
}

function prepareLinePendingFromPostback(userId, rawData) {
  const data = parseLinePostbackData(rawData);
  if (data.a) {
    clearLinePendingState(userId);
    return;
  }
  const action = String(data.action || "");
  if (action === "add_prompt") {
    setLinePendingState(
      userId,
      { kind: "add_title" },
      TP_LINE_PENDING_TTL_SECONDS,
    );
  } else if (action === "edit_prompt") {
    setLinePendingState(
      userId,
      { kind: "edit_title", id: data.id },
      TP_LINE_PENDING_TTL_SECONDS,
    );
  } else if (action === "delete_reason_prompt") {
    setLinePendingState(
      userId,
      { kind: "delete_reason", id: data.id },
      TP_LINE_PENDING_TTL_SECONDS,
    );
  } else if (action === "reschedule_reason_prompt") {
    setLinePendingState(
      userId,
      {
        kind: "reschedule_reason",
        id: data.id,
        cycle: Number(data.cycle),
        week: Number(data.week),
      },
      TP_LINE_PENDING_TTL_SECONDS,
    );
  } else if (
    [
      "delete_reason",
      "reschedule_reason",
      "add_submit",
      "edit_submit",
      "pending_cancel",
    ].indexOf(action) >= 0
  ) {
    clearLinePendingState(userId);
  }
  return data;
}

function buildPendingSubmissionMessage(pending, inputText) {
  const text = String(inputText || "").trim();
  if (!pending) return text;
  if (text === "取消") {
    return (
      TP_LINE_POSTBACK_PREFIX +
      buildLinePostbackData("pending_cancel", { id: pending.id || "" })
    );
  }
  if (pending.kind === "add_title") {
    return (
      TP_LINE_POSTBACK_PREFIX +
      buildLinePostbackData("add_submit", { title: text })
    );
  }
  if (pending.kind === "edit_title") {
    return (
      TP_LINE_POSTBACK_PREFIX +
      buildLinePostbackData("edit_submit", { id: pending.id, title: text })
    );
  }
  if (pending.kind === "delete_reason") {
    return (
      TP_LINE_POSTBACK_PREFIX +
      buildLinePostbackData("delete_reason", { id: pending.id, reason: text })
    );
  }
  if (pending.kind === "reschedule_reason") {
    return (
      TP_LINE_POSTBACK_PREFIX +
      buildLinePostbackData("reschedule_reason", {
        id: pending.id,
        cycle: pending.cycle,
        week: pending.week,
        reason: text,
      })
    );
  }
  return text;
}

function consumeLinePendingText(userId, text) {
  const raw = String(text || "").trim();
  if (
    [
      "清單",
      "全部清單",
      "本週",
      "本週清單",
      "看本週",
      "抽一件",
      "抽任務",
      "足跡",
      "本週足跡",
      "週一",
      "新增",
      "取消",
      "取消修改",
      "說明",
      "help",
      "攻略",
    ].indexOf(raw) >= 0
  ) {
    clearLinePendingState(userId);
    return { ok: true, consumed: false, messageText: raw };
  }
  const pending = getLinePendingState(userId);
  if (!pending)
    return {
      ok: true,
      consumed: false,
      messageText: String(text || "").trim(),
    };
  const messageText = buildPendingSubmissionMessage(pending, text);
  clearLinePendingState(userId);
  return {
    ok: true,
    consumed: true,
    pending: pending,
    messageText: messageText,
  };
}

function isLineWebhookBody(body) {
  return body && Array.isArray(body.events);
}

function handleLineWebhookToQueue(body) {
  const events = body.events || [];
  const results = [];

  events.forEach(function (event) {
    if (!event.source || !event.source.userId) return;
    if (!event.replyToken) return;

    const userId = String(event.source.userId || "").trim();
    let messageText = "";

    if (event.type === "postback") {
      const rawData = String((event.postback || {}).data || "").trim();
      if (!rawData) return;
      prepareLinePendingFromPostback(userId, rawData);
      messageText = TP_LINE_POSTBACK_PREFIX + rawData;
    } else if (
      event.type === "message" &&
      event.message &&
      event.message.type === "text"
    ) {
      const rawText = String(event.message.text || "").trim();
      if (!rawText) return;
      messageText = consumeLinePendingText(userId, rawText).messageText;
    } else {
      return;
    }

    const admissionResult = createQueueMessageForImmediateProcessing({
      id:
        "line-" +
        tpDigest(event.webhookEventId || event.replyToken).slice(0, 40),
      userId: userId,
      messageText: messageText,
      replyToken: event.replyToken,
    });

    if (admissionResult.duplicate) {
      const duplicate = admissionResult.duplicate;
      let replyText = DUPLICATE_PENDING_MESSAGE_REPLY;
      if (duplicate.reason === "processing")
        replyText = DUPLICATE_PROCESSING_MESSAGE_REPLY;
      if (duplicate.reason === "recent_done_write")
        replyText = DUPLICATE_RECENT_WRITE_MESSAGE_REPLY;

      try {
        const replyResult = replyLineMessage(event.replyToken, replyText);
        results.push({
          duplicate: true,
          duplicateReason: duplicate.reason,
          reusedQueueId: duplicate.item.id,
          dedupeKey: duplicate.meta.key,
          replyResult: replyResult,
        });
      } catch (error) {
        results.push({
          duplicate: true,
          duplicateReason: duplicate.reason,
          reusedQueueId: duplicate.item.id,
          dedupeKey: duplicate.meta.key,
          error: error.message,
        });
      }
      return;
    }

    const queueMessage = admissionResult.queueMessage;
    const processResult = tryImmediateReplyByRender(queueMessage);
    results.push({
      duplicate: false,
      queueMessage: queueMessage,
      processResult: processResult,
    });
  });

  return { processedCount: results.length, results: results };
}

function tryImmediateReplyByRender(queueMessage) {
  try {
    if (!isValidLineUserId(queueMessage.userId)) {
      updateQueueMessage(queueMessage.id, {
        status: "failed",
        updatedAt: new Date().toISOString(),
        lastError: "無效 LINE userId，已標記 failed：" + queueMessage.userId,
      });
      return { ok: false, skipped: true, error: "invalid userId" };
    }

    updateQueueMessage(queueMessage.id, {
      updatedAt: new Date().toISOString(),
      lastError: "開始呼叫 Render，嘗試直接 reply 真正內容",
    });
    const renderResult = sendQueueMessageToRender(queueMessage);
    const replyMessages = renderResult.replyMessages;

    try {
      const lineReplyResult = replyLineMessage(
        queueMessage.replyToken,
        replyMessages,
      );
      updateQueueMessage(queueMessage.id, {
        status: "done",
        updatedAt: new Date().toISOString(),
        lastError: "Render OK，LINE reply OK",
      });
      return { ok: true, mode: "reply", renderResult, lineReplyResult };
    } catch (replyError) {
      const pushResult = pushLineMessage(queueMessage.userId, replyMessages);
      updateQueueMessage(queueMessage.id, {
        status: "done",
        updatedAt: new Date().toISOString(),
        lastError:
          "Render OK，但 LINE reply 失敗，已改用 push 補發：" +
          replyError.message,
      });
      return {
        ok: true,
        mode: "push_after_reply_failed",
        renderResult,
        pushResult,
        replyError: replyError.message,
      };
    }
  } catch (error) {
    const retryCount = Number(queueMessage.retryCount || 0) + 1;
    const newStatus = retryCount >= MAX_RETRY_COUNT ? "failed" : "pending";
    let fallbackReplyResult = null;
    let fallbackReplyError = "";

    try {
      fallbackReplyResult = replyLineMessage(
        queueMessage.replyToken,
        FALLBACK_RECEIVED_MESSAGE,
      );
    } catch (lineError) {
      fallbackReplyError = lineError.message;
    }

    updateQueueMessage(queueMessage.id, {
      status: newStatus,
      retryCount,
      updatedAt: new Date().toISOString(),
      lastError:
        "立即處理失敗：" +
        error.message +
        (fallbackReplyError
          ? "；fallback reply 也失敗：" + fallbackReplyError
          : "；已 reply fallback"),
    });

    return {
      ok: false,
      mode: "fallback_received",
      error: error.message,
      retryCount,
      status: newStatus,
      fallbackReplyResult,
      fallbackReplyError,
    };
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

  sheet.appendRow(
    QUEUE_HEADERS.map(function (header) {
      return queueMessage[header];
    }),
  );
  return queueMessage;
}

function getQueueSheet() {
  const sheet = tpSpreadsheet().getSheetByName(QUEUE_SHEET_NAME);
  if (!sheet) throw new Error("找不到工作表：" + QUEUE_SHEET_NAME);
  return sheet;
}

function ensureQueueHeaders(sheet) {
  const firstRow = sheet.getRange(1, 1, 1, QUEUE_HEADERS.length).getValues()[0];
  const isEmpty = firstRow.every(function (cell) {
    return String(cell).trim() === "";
  });
  if (isEmpty) {
    sheet.getRange(1, 1, 1, QUEUE_HEADERS.length).setValues([QUEUE_HEADERS]);
    return;
  }

  const isCorrect = QUEUE_HEADERS.every(function (header, index) {
    return String(firstRow[index]).trim() === header;
  });
  if (!isCorrect)
    throw new Error("queue 工作表欄位不正確，請確認第一列欄位名稱");
}

function updateQueueMessage(id, updates) {
  updates = updates || {};
  const sheet = getQueueSheet();
  ensureQueueHeaders(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) throw new Error("queue 工作表沒有資料可以更新");

  const headers = values[0].map(function (header) {
    return String(header).trim();
  });
  const idIndex = headers.indexOf("id");
  if (idIndex === -1) throw new Error("queue 工作表缺少 id 欄位");

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIndex]) === String(id)) {
      const rowNumber = i + 1;
      Object.keys(updates).forEach(function (key) {
        const columnIndex = headers.indexOf(key);
        if (columnIndex !== -1)
          sheet.getRange(rowNumber, columnIndex + 1).setValue(updates[key]);
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

  const headers = values[0].map(function (header) {
    return String(header).trim();
  });
  const messages = [];

  for (let i = 1; i < values.length; i++) {
    const item = rowToObject(headers, values[i]);
    if (item.status !== "pending") continue;

    if (!isValidLineUserId(String(item.userId || ""))) {
      updateQueueMessage(item.id, {
        status: "failed",
        updatedAt: new Date().toISOString(),
        lastError: "無效 LINE userId，已標記 failed：" + item.userId,
      });
      continue;
    }

    if (Number(item.retryCount || 0) >= MAX_RETRY_COUNT) {
      updateQueueMessage(item.id, {
        status: "failed",
        updatedAt: new Date().toISOString(),
        lastError: "超過最大重試次數：" + MAX_RETRY_COUNT,
      });
      continue;
    }

    messages.push(item);
    if (messages.length >= limit) break;
  }

  return messages;
}

function rowToObject(headers, row) {
  const item = {};
  headers.forEach(function (header, index) {
    if (header) item[header] = row[index];
  });
  return item;
}

function isValidLineUserId(userId) {
  return (
    typeof userId === "string" && userId.startsWith("U") && userId.length >= 20
  );
}

function withQueueLock(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30 * 1000);
  try {
    return callback();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function getQueueMessageById(id) {
  const sheet = getQueueSheet();
  ensureQueueHeaders(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return null;

  const headers = values[0].map(function (header) {
    return String(header).trim();
  });
  const idIndex = headers.indexOf("id");
  if (idIndex === -1) throw new Error("queue 工作表缺少 id 欄位");

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIndex]) === String(id))
      return rowToObject(headers, values[i]);
  }
  return null;
}

function createQueueMessageForImmediateProcessing(input) {
  return withQueueLock(function () {
    recoverStaleProcessingQueueMessagesUnlocked();
    const existingEvent = input.id ? getQueueMessageById(input.id) : null;
    if (existingEvent)
      return {
        duplicate: {
          item: existingEvent,
          reason: "same_event",
          meta: buildQueueDedupeMeta(input.messageText),
        },
      };
    const duplicate = findDuplicateQueueMessage(
      input.userId,
      input.messageText,
    );
    if (duplicate) return { duplicate };

    const queueMessage = createQueueMessage({
      id: input.id,
      userId: input.userId,
      messageText: input.messageText,
      replyToken: input.replyToken,
      status: "processing",
      lastError: "已由立即處理流程鎖定",
    });
    return { duplicate: null, queueMessage };
  });
}

function claimQueueMessageForRetry(id) {
  return withQueueLock(function () {
    const current = getQueueMessageById(id);
    if (!current) return null;
    if (String(current.status || "").trim() !== "pending") return null;

    const nowIso = new Date().toISOString();
    updateQueueMessage(id, {
      status: "processing",
      updatedAt: nowIso,
      lastError: "已由 retry 流程鎖定",
    });
    current.status = "processing";
    current.updatedAt = nowIso;
    current.lastError = "已由 retry 流程鎖定";
    return current;
  });
}

function recoverStaleProcessingQueueMessages() {
  return withQueueLock(function () {
    return recoverStaleProcessingQueueMessagesUnlocked();
  });
}

function recoverStaleProcessingQueueMessagesUnlocked() {
  const sheet = getQueueSheet();
  ensureQueueHeaders(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0].map(function (header) {
    return String(header).trim();
  });
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
    const updatedAtTime =
      updatedAtValue instanceof Date
        ? updatedAtValue.getTime()
        : new Date(updatedAtValue).getTime();
    if (Number.isNaN(updatedAtTime)) continue;
    if (now - updatedAtTime <= PROCESSING_STALE_AFTER_MS) continue;

    const rowNumber = i + 1;
    const nowIso = new Date().toISOString();
    sheet.getRange(rowNumber, statusIndex + 1).setValue("pending");
    sheet.getRange(rowNumber, updatedAtIndex + 1).setValue(nowIso);
    sheet
      .getRange(rowNumber, lastErrorIndex + 1)
      .setValue("processing 超過 10 分鐘，已恢復為 pending 等待重試");
    recoveredIds.push(values[i][idIndex]);
  }

  return recoveredIds;
}

function normalizeQueueTextForDedupe(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ");
}

function parseQueueFlexibleNumber(numberText) {
  const text = String(numberText || "")
    .trim()
    .replace(/兩/g, "二");
  if (/^\d+$/.test(text)) return Number(text);

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

  const actionMap = {
    完成: "done",
    已完成: "done",
    取消: "cancel",
    修改: "edit",
    刪除: "delete",
  };
  const action = actionMap[actionText];
  if (!action) return null;

  const type = targetText.includes("任務") ? "task" : "standard";
  const normalizedNewTitle = normalizeQueueTextForDedupe(newTitle || "");

  return {
    kind: "write",
    key: normalizedNewTitle
      ? `${action}|${type}|${number}|${normalizedNewTitle}`
      : `${action}|${type}|${number}`,
  };
}

function parseQueueOperationDedupeMeta(userText) {
  const text = normalizeQueueTextForDedupe(userText);
  let match = text.match(
    /^(完成|已完成|取消|修改|刪除)\s*(任務|完成標準|標準)\s*(\d+|[零一二三四五六七八九十兩]+)(?:\s+(.+))?$/,
  );
  if (match)
    return buildQueueOperationMeta(match[1], match[2], match[3], match[4]);

  match = text.match(
    /^(完成|已完成|取消|修改|刪除)\s*第?\s*(\d+|[零一二三四五六七八九十兩]+)\s*個?\s*(任務|完成標準|標準)(?:\s+(.+))?$/,
  );
  if (match)
    return buildQueueOperationMeta(match[1], match[3], match[2], match[4]);
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

    const parts = rawText
      .split(/\s*[\/｜|，,、]\s*/)
      .map(function (part) {
        return part.trim();
      })
      .filter(Boolean);
    const title = parts[0] || "";
    if (!title) return null;

    try {
      const category = normalizeCategory(parts[1]);
      let subCategory = EMPTY_SUBCATEGORY;

      if (category === "程式學習") {
        subCategory = normalizeSubCategory(parts[2], category);
      }

      return {
        kind: "write",
        key: `create|${item.type}|${title}|${category}|${subCategory}`,
      };
    } catch (error) {
      return null;
    }
  }

  return null;
}

function buildQueueDedupeMeta(messageText) {
  const text = normalizeQueueTextForDedupe(messageText);

  if (text.indexOf(TP_LINE_POSTBACK_PREFIX) === 0) {
    const data = parseLinePostbackData(
      text.slice(TP_LINE_POSTBACK_PREFIX.length),
    );
    const action = String(data.action || "unknown");
    const id = String(data.id || "");
    const readActions = [
      "list",
      "draw",
      "task_action",
      "delete_preview",
      "delete_reason_prompt",
      "reschedule_choose",
      "reschedule_preview",
      "reschedule_reason_prompt",
      "reason_custom",
      "pending_cancel",
    ];
    if (readActions.indexOf(action) >= 0)
      return {
        kind: "read",
        key: "postback|" + action + "|" + id + "|" + String(data.week || ""),
      };
    // postback 寫入不套 30 秒 recent-write 擋重複，避免「完成 → 改回未完成 → 再完成」被誤擋。
    return {
      kind: "interaction",
      key: "postback|" + text.slice(TP_LINE_POSTBACK_PREFIX.length),
    };
  }

  if (text === "攻略" || text === "說明" || text === "help" || text === "Help")
    return { kind: "read", key: "read|guide" };
  if (text === "清單" || text === "全部清單")
    return { kind: "read", key: "read|list" };
  if (
    text === "抽一件" ||
    text === "抽任務" ||
    text === "隨機任務" ||
    text === "今天做什麼"
  )
    return { kind: "read", key: "read|draw_one" };
  if (
    text === "簡單任務" ||
    text === "簡單" ||
    text === "適中任務" ||
    text === "適中" ||
    text === "困難任務" ||
    text === "困難"
  )
    return { kind: "read", key: "read|list" };
  if (text === "取消修改") return { kind: "write", key: "edit|cancel_pending" };

  let clickMatch = text.match(/^操作任務\s*(\d+)$/);
  if (clickMatch)
    return { kind: "read", key: "read|task_action|" + clickMatch[1] };

  clickMatch = text.match(/^改回未完成任務\s*(\d+)$/);
  if (clickMatch) return { kind: "write", key: "undo|task|" + clickMatch[1] };

  const createMeta = parseQueueCreateDedupeMeta(text);
  if (createMeta) return createMeta;

  const operationMeta = parseQueueOperationDedupeMeta(text);
  if (operationMeta) return operationMeta;

  return { kind: "raw", key: "raw|" + text };
}

function isWithinRecentWriteDedupeWindow(dateValue) {
  const time =
    dateValue instanceof Date
      ? dateValue.getTime()
      : new Date(dateValue).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time <= RECENT_WRITE_DEDUPE_WINDOW_MS;
}

function findDuplicateQueueMessage(userId, messageText) {
  const sheet = getQueueSheet();
  ensureQueueHeaders(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return null;

  const headers = values[0].map(function (header) {
    return String(header).trim();
  });
  const targetUserId = String(userId || "").trim();
  const targetMeta = buildQueueDedupeMeta(messageText);

  for (let i = values.length - 1; i >= 1; i--) {
    const item = rowToObject(headers, values[i]);
    if (String(item.userId || "").trim() !== targetUserId) continue;

    const itemMeta = buildQueueDedupeMeta(item.messageText);
    if (itemMeta.key !== targetMeta.key) continue;

    const status = String(item.status || "").trim();

    if (status === "pending")
      return { item, reason: "pending", meta: targetMeta };
    if (status === "processing")
      return { item, reason: "processing", meta: targetMeta };
    if (
      targetMeta.kind === "write" &&
      status === "done" &&
      isWithinRecentWriteDedupeWindow(item.updatedAt)
    )
      return { item, reason: "recent_done_write", meta: targetMeta };
  }

  return null;
}

function disableRetryPendingQueueTimeTriggers() {
  const removed = [];

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() !== "retryPendingQueue") return;

    const triggerId =
      typeof trigger.getUniqueId === "function" ? trigger.getUniqueId() : "";
    ScriptApp.deleteTrigger(trigger);
    removed.push(triggerId || "retryPendingQueue");
  });

  Logger.log("已移除 retryPendingQueue time trigger 數量：" + removed.length);
  return { ok: true, removedCount: removed.length, removedTriggerIds: removed };
}

// 保留 retry 核心邏輯；排程責任改由 Render 負責。
// 這個函式仍可手動執行，也可由 Render 經過 secret-protected doPost 呼叫。
function retryPendingQueue() {
  try {
    const recoveredIds = recoverStaleProcessingQueueMessages();
    const pendingMessages = getPendingQueueMessages(RETRY_BATCH_SIZE);
    const results = [];

    pendingMessages.forEach(function (queueMessage) {
      try {
        // 單筆補送失敗，不要讓整個排程一起失敗
        results.push(tryPushPendingQueueMessage(queueMessage));
      } catch (error) {
        results.push({
          ok: false,
          queueId: queueMessage && queueMessage.id,
          error: error.message,
        });

        Logger.log(
          "retryPendingQueue 單筆補送失敗 queueId = " +
            (queueMessage && queueMessage.id) +
            "；error = " +
            error.message,
        );
      }
    });

    Logger.log(
      "retryPendingQueue recovered = " +
        JSON.stringify(recoveredIds) +
        "；results = " +
        JSON.stringify(results),
    );

    return {
      ok: true,
      recoveredIds,
      results,
    };
  } catch (error) {
    // 避免 Google 偶發錯誤讓 time-based trigger 被判定失敗並寄信
    Logger.log("retryPendingQueue skipped by safe guard： " + error.message);

    return {
      ok: false,
      skipped: true,
      message: error.message,
    };
  }
}

function tryPushPendingQueueMessage(queueMessage) {
  const claimedMessage = claimQueueMessageForRetry(queueMessage.id);
  if (!claimedMessage)
    return {
      ok: false,
      skipped: true,
      reason: "already_claimed_or_not_pending",
      queueId: queueMessage.id,
    };

  try {
    if (!isValidLineUserId(String(claimedMessage.userId || ""))) {
      updateQueueMessage(claimedMessage.id, {
        status: "failed",
        updatedAt: new Date().toISOString(),
        lastError: "無效 LINE userId，已標記 failed：" + claimedMessage.userId,
      });
      return { ok: false, skipped: true, error: "invalid userId" };
    }

    updateQueueMessage(claimedMessage.id, {
      updatedAt: new Date().toISOString(),
      lastError: "retry 已鎖定，開始呼叫 Render",
    });
    const renderResult = sendQueueMessageToRender(claimedMessage);
    const pushResult = pushLineMessage(
      claimedMessage.userId,
      renderResult.replyMessages,
    );

    updateQueueMessage(claimedMessage.id, {
      status: "done",
      updatedAt: new Date().toISOString(),
      lastError: "retry Render OK，LINE push OK",
    });
    return { ok: true, mode: "retry_push", renderResult, pushResult };
  } catch (error) {
    const retryCount = Number(claimedMessage.retryCount || 0) + 1;
    const newStatus = retryCount >= MAX_RETRY_COUNT ? "failed" : "pending";
    updateQueueMessage(claimedMessage.id, {
      status: newStatus,
      retryCount,
      updatedAt: new Date().toISOString(),
      lastError: "retry 失敗：" + error.message,
    });
    return { ok: false, error: error.message, retryCount, status: newStatus };
  }
}

function sendQueueMessageToRender(queueMessage) {
  if (!queueMessage) throw new Error("轉送 Render 時缺少 queueMessage");

  const payload = {
    source: "gas_queue",
    queueId: queueMessage.id,
    userId: queueMessage.userId,
    messageText: queueMessage.messageText,
    createdAt: queueMessage.createdAt,
  };
  const response = UrlFetchApp.fetch(getRenderLineWebhookUrl(), {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + getApiSecret() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (statusCode < 200 || statusCode >= 300)
    throw new Error("Render 呼叫失敗：" + statusCode + " " + responseText);

  let data = null;
  try {
    data = JSON.parse(responseText);
  } catch (error) {
    throw new Error("Render 回傳不是 JSON，目前回傳：" + responseText);
  }

  if (!data || data.ok !== true)
    throw new Error("Render 回傳 ok 不是 true：" + responseText);

  let replyMessages = null;
  if (Array.isArray(data.replyMessages)) {
    replyMessages = normalizeLineMessages(data.replyMessages);
  } else {
    const replyTextOnly = String(data.replyText || "").trim();
    if (!replyTextOnly)
      throw new Error(
        "Render 沒有回傳有效 replyText 或 replyMessages：" + responseText,
      );
    replyMessages = normalizeLineMessages(replyTextOnly);
  }

  const replyText = String(
    data.replyText || getFallbackTextFromLineMessages(replyMessages) || "",
  ).trim();
  if (!replyText)
    throw new Error("Render 回覆內容缺少可記錄的 replyText：" + responseText);

  return { ok: true, statusCode, replyText, replyMessages, renderBody: data };
}

function buildLineTextMessage(text) {
  return { type: "text", text: String(text || "目前沒有可回覆的內容。") };
}

function isValidLineMessageObject(message) {
  return (
    message &&
    typeof message === "object" &&
    typeof message.type === "string" &&
    String(message.type).trim() !== ""
  );
}

function normalizeLineMessages(input) {
  if (Array.isArray(input)) {
    const messages = input.filter(function (message) {
      return isValidLineMessageObject(message);
    });
    if (messages.length === 0) throw new Error("LINE messages 陣列不可為空");
    if (messages.length > 5)
      throw new Error("LINE 一次最多只能回覆 5 則 messages");
    return messages;
  }

  const text = String(input || "").trim();
  if (!text) throw new Error("LINE text 不可為空");
  return [buildLineTextMessage(text)];
}

function getFallbackTextFromLineMessages(messages) {
  if (!Array.isArray(messages)) return "";
  const textMessage = messages.find(function (message) {
    return message && message.type === "text" && message.text;
  });
  if (textMessage) return String(textMessage.text);
  const flexMessage = messages.find(function (message) {
    return message && message.type === "flex" && message.altText;
  });
  if (flexMessage) return String(flexMessage.altText);
  return "Tiny Progress 已回覆。";
}

function replyLineMessage(replyToken, messageInput) {
  if (!replyToken) throw new Error("LINE reply 缺少 replyToken");
  return callLineApi("https://api.line.me/v2/bot/message/reply", {
    replyToken,
    messages: normalizeLineMessages(messageInput),
  });
}

function pushLineMessage(userId, messageInput) {
  if (!isValidLineUserId(String(userId || "")))
    throw new Error("LINE push 缺少有效 userId：" + userId);
  return callLineApi("https://api.line.me/v2/bot/message/push", {
    to: userId,
    messages: normalizeLineMessages(messageInput),
  });
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
  if (statusCode < 200 || statusCode >= 300)
    throw new Error("LINE API 呼叫失敗：" + statusCode + " " + responseText);
  return {
    ok: true,
    statusCode,
    body: safeParseJson(responseText),
    raw: responseText,
  };
}

function parseJsonBody(e) {
  if (!e || !e.postData || !e.postData.contents)
    throw new Error("缺少 POST body");
  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    throw new Error("POST body 不是有效 JSON：" + error.message);
  }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function safeParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

// 不讀寫 Sheets 的安全 smoke test。貼上新版 Code.gs 後可先手動執行。
function runTinyProgressSmokeTest() {
  return {
    ok: true,
    schemaVersion: TP_SCHEMA_VERSION,
    today: getTodayYmd(),
    dailyTarget: recurrenceTargetCount("daily", 1),
    weeklyTarget: recurrenceTargetCount("weekly", 2),
  };
}

function getLinePushUserId() {
  const userId =
    PropertiesService.getScriptProperties().getProperty("LINE_PUSH_USER_ID");

  if (!isValidLineUserId(String(userId || ""))) {
    throw new Error("缺少或無效的 Script Property：LINE_PUSH_USER_ID");
  }

  return userId;
}

function sortWeeklyMondayTasks(tasks) {
  return tasks.slice().sort(function (a, b) {
    const categoryA = normalizeCategory(a.category);
    const categoryB = normalizeCategory(b.category);

    const categoryDiff =
      CATEGORY_OPTIONS.indexOf(categoryA) - CATEGORY_OPTIONS.indexOf(categoryB);

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

// ---------- LINE entry points / scheduled review ----------

// Week 1 會在每個 Cycle 重複，因此同時比對 cycleNumber + weekNumber。
function sendWeeklyMondayTaskCard() {
  ensureSchema();
  syncTimelineAndOverdueIfNeeded(true);
  const context = getWeekContextFromSheet();
  const currentWeek = context.currentWeek;
  if (!currentWeek) {
    Logger.log("目前為 Cycle 休息期或尚未開始，不推送週一小卡。");
    return { ok: true, skipped: true, reason: "沒有進行中的 Week" };
  }

  const items = getItemsFromSheetRaw();
  const weeklyItems = items.filter(function (item) {
    return (
      Number(item.scheduledCycleNumber || item.cycleNumber) ===
        Number(currentWeek.cycleNumber) &&
      Number(item.scheduledWeekNumber || item.weekNumber) ===
        Number(currentWeek.weekNumber) &&
      item.status !== "cancelled" &&
      item.status !== "replanned"
    );
  });

  const tasks = sortWeeklyMondayTasks(
    weeklyItems.filter(function (item) {
      return item.type === "task";
    }),
  );
  if (tasks.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: "本週沒有任務",
      cycleNumber: currentWeek.cycleNumber,
      weekNumber: currentWeek.weekNumber,
    };
  }
  const standards = weeklyItems.filter(function (item) {
    return item.type === "standard";
  });
  const flexMessage = buildWeeklyMondayFlexMessage({
    currentWeek: currentWeek,
    tasks: tasks,
    standards: standards,
  });
  return pushLineMessage(getLinePushUserId(), [flexMessage]);
}

// 執行一次即可建立週日 16 點附近的提醒 trigger。
// Apps Script 的 time-based trigger 不是秒級排程，通常會在指定時段附近執行。
function setupTinyProgressSundayReviewTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "sendWeeklySundayReview")
      ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("sendWeeklySundayReview")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(16)
    .create();
  return "已建立每週日 16 點時段的 Tiny Progress 提醒";
}

// 手動執行一次，補齊並正規化目前 schema。
// 這個函式使用較長等待時間；日常 Web 請求不走這條 schema 更新路徑。
function runTinyProgressSchemaUpdate() {
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    performSchemaUpdateUnlocked();
    PropertiesService.getScriptProperties().setProperty(
      TP_SCHEMA_VERSION_PROPERTY,
      TP_SCHEMA_VERSION,
    );
  } finally {
    lock.releaseLock();
  }

  syncTimelineAndOverdueIfNeeded(true);
  return {
    ok: true,
    schemaVersion: TP_SCHEMA_VERSION,
    items: getItemsFromSheetRaw().length,
    weeks: getWeeksFromSheetRaw().length,
    cycles: getCyclesFromSheetRaw().length,
    categories: getCategoriesFromSheetRaw().length,
    context: getWeekContextFromSheet(),
  };
}

// =========================================================
// Tiny Progress LINE cards
// Morandi frames + progress bars + sparse Möbius branding
// =========================================================

const TP_LINE_THEME = {
  cream: "#F8F4EA",
  card: "#FFFAF1",
  paper: "#FFFDF7",
  text: "#4F5947",
  muted: "#7F8777",
  line: "#E8E1D5",
  brand: "#769275",
  brandSoft: "#EEF3EA",
  brandBorder: "#C9D5C3",
  brandText: "#566A55",
  progress: "#769275",
};

// 固定 5 張主卡中的兩張主動推播：週一安排、週日回顧。
// 另外三張日常操作卡由 Render/server.js 產生。
const TP_LINE_CARD_ACCENTS = {
  monday: "#7F93C8", // ④ 週一安排
  sunday: "#C9A35F", // ⑤ 週日回顧
};

const TP_LINE_TAGS = [
  { bg: "#E6F0E4", text: "#56705A", border: "#BDD5BC", accent: "#87AA88" },
  { bg: "#F6E5E7", text: "#805D67", border: "#E5BEC6", accent: "#C88998" },
  { bg: "#E5EEF7", text: "#526B84", border: "#BDD1E5", accent: "#83A9CB" },
  { bg: "#F7E9D8", text: "#806349", border: "#E7C9A8", accent: "#CFA276" },
  { bg: "#EEE6F5", text: "#6C5B7C", border: "#D5C3E5", accent: "#AA90C0" },
  { bg: "#E1F0EF", text: "#4F7272", border: "#B9D9D6", accent: "#72AAA8" },
  { bg: "#F4EBCF", text: "#7A693D", border: "#E2D095", accent: "#C7AE5F" },
  { bg: "#E8EEE0", text: "#607052", border: "#C7D4B9", accent: "#92A97B" },
  { bg: "#F5E4DD", text: "#7D5F54", border: "#E4C0B2", accent: "#C48E79" },
  { bg: "#E6EAF5", text: "#5B647D", border: "#C7CFE5", accent: "#8E9ABD" },
  { bg: "#E5F0E8", text: "#58705F", border: "#C0D9C6", accent: "#82A991" },
  { bg: "#F2E4EF", text: "#755E72", border: "#DFC0D7", accent: "#B98EAE" },
];

function tpLineHash(value, salt) {
  const text = String(salt || "") + "|" + String(value || "未分類");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % TP_LINE_TAGS.length;
}

function tpLineTagStyle(value) {
  return TP_LINE_TAGS[tpLineHash(value, "category")];
}

function tpLineShortDate(value) {
  const s = cleanText(value);
  const m = s.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? m[1] + "/" + m[2] : s;
}

function tpLineTag(label, style, options) {
  const opts = options || {};
  const primary = opts.primary === true;
  const box = {
    type: "box",
    layout: "vertical",
    flex: 0,
    backgroundColor: style.bg,
    cornerRadius: "999px",
    paddingTop: primary ? "4px" : "3px",
    paddingBottom: primary ? "4px" : "3px",
    paddingStart: "8px",
    paddingEnd: "8px",
    contents: [
      {
        type: "text",
        text: label,
        size: "xxs",
        weight: primary ? "bold" : "regular",
        color: style.text,
        align: "center",
        maxLines: 1,
      },
    ],
  };

  // 次分類用細框、紙色底；主分類用實心柔色，不再三顆標籤長一樣。
  if (!primary) {
    box.borderColor = style.border;
    box.borderWidth = "1px";
  }
  return box;
}

function tpLineTaskTags(task) {
  const category = cleanText(task.category) || "未分類";
  const categoryKey = cleanText(task.categoryId) || category;
  return {
    type: "box",
    layout: "horizontal",
    spacing: "lg",
    margin: "xs",
    contents: [
      tpLineTag(category, tpLineTagStyle(categoryKey), { primary: true }),
    ],
  };
}

function tpLineProgress(doneCount, totalCount, color) {
  // 一件任務 = 一格。完成幾件，就亮幾格。
  const segments = Math.max(1, Number(totalCount) || 0);
  const filled = Math.max(0, Math.min(Number(doneCount) || 0, segments));

  return {
    type: "box",
    layout: "horizontal",
    spacing: "xs",
    margin: "sm",
    contents: Array.from({ length: segments }, function (_, index) {
      return {
        type: "box",
        layout: "vertical",
        height: "8px",
        flex: 1,
        backgroundColor:
          index < filled ? color || TP_LINE_THEME.progress : "#E8E7E2",
        cornerRadius: "999px",
        contents: [],
      };
    }),
  };
}

function tpLineProgressBlock(label, doneCount, totalCount, color) {
  const headerContents = [];

  if (label) {
    headerContents.push({
      type: "text",
      text: label,
      size: "sm",
      color: TP_LINE_THEME.muted,
      flex: 1,
    });
  } else {
    headerContents.push({
      type: "box",
      layout: "vertical",
      flex: 1,
      contents: [],
    });
  }

  headerContents.push({
    type: "text",
    text: doneCount + " / " + totalCount,
    size: "sm",
    weight: "bold",
    color: TP_LINE_THEME.text,
    flex: 0,
    align: "end",
  });

  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: headerContents,
      },
      tpLineProgress(doneCount, totalCount, color),
    ],
  };
}

function tpLineTaskRow(task) {
  const done = isWeeklyMondayDone(task);
  const title = cleanText(task.title) || "未命名任務";
  const contents = [
    {
      type: "text",
      text: (done ? "✓ " : "") + title,
      size: "md",
      weight: "regular",
      color: done ? "#8D9589" : TP_LINE_THEME.text,
      wrap: false,
      maxLines: 1,
    },
    tpLineTaskTags(task),
  ];
  if (cleanText(task.frequency)) {
    const target = recurrenceTargetCount(task.frequency, task.timesPerWeek);
    const completed = (task.occurrences || []).filter(function (o) {
      return o && o.done;
    }).length;
    contents.push({
      type: "text",
      text:
        (task.frequency === "daily" ? "每天" : "每週 " + target + " 次") +
        " · " +
        completed +
        "/" +
        target,
      size: "xs",
      color: TP_LINE_THEME.muted,
      wrap: false,
      maxLines: 1,
    });
  }
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    paddingTop: "6px",
    paddingBottom: "6px",
    contents: contents,
  };
}

function tpLineFrame(frameColor, contents) {
  return {
    type: "bubble",
    size: "mega",
    styles: { body: { backgroundColor: TP_LINE_THEME.cream } },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "6px",
      contents: [
        {
          type: "box",
          layout: "vertical",
          spacing: "md",
          paddingAll: "15px",
          backgroundColor: TP_LINE_THEME.card,
          borderColor: frameColor || TP_LINE_THEME.brand,
          borderWidth: "2px",
          cornerRadius: "22px",
          contents: contents,
        },
      ],
    },
  };
}

function tpLinePostbackData(action, params) {
  return buildLinePostbackData(action, params || {});
}

function tpLinePostbackAction(label, action, params, options) {
  const opts = options || {};
  const out = {
    type: "postback",
    label: label,
    data: tpLinePostbackData(action, params || {}),
  };
  if (opts.displayText) out.displayText = opts.displayText;
  if (opts.inputOption) out.inputOption = opts.inputOption;
  if (opts.fillInText) out.fillInText = opts.fillInText;
  return out;
}

function tpLineActionPill(label, action, options) {
  const opts = options || {};
  return {
    type: "box",
    layout: "vertical",
    flex: opts.flex === undefined ? 1 : opts.flex,
    backgroundColor: opts.backgroundColor || TP_LINE_THEME.brandSoft,
    borderColor: opts.borderColor || TP_LINE_THEME.brandBorder,
    borderWidth: "1px",
    cornerRadius: "999px",
    paddingTop: "8px",
    paddingBottom: "8px",
    paddingStart: "10px",
    paddingEnd: "10px",
    justifyContent: "center",
    contents: [
      {
        type: "text",
        text: label,
        size: "xs",
        weight: opts.weight || "bold",
        color: opts.textColor || TP_LINE_THEME.brandText,
        align: "center",
        wrap: false,
        maxLines: 1,
      },
    ],
    action: action,
  };
}

function tpLineActionRow(items) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    contents: items,
  };
}

function tpLineAppendQuickActions(contents, kind) {
  const buttons = [];
  buttons.push(
    tpLineActionPill("看清單", tpLinePostbackAction("看清單", "list", {})),
  );

  if (kind === "monday") {
    buttons.push(
      tpLineActionPill("抽一件", tpLinePostbackAction("抽一件", "draw", {}), {
        backgroundColor: TP_LINE_THEME.paper,
      }),
    );
    buttons.push(
      tpLineActionPill(
        "＋ 新增",
        tpLinePostbackAction(
          "新增",
          "add_prompt",
          {},
          { inputOption: "openKeyboard" },
        ),
        {
          backgroundColor: TP_LINE_THEME.paper,
          weight: "regular",
        },
      ),
    );
  }

  if (!buttons.length) return;
  contents.push({ type: "separator", color: TP_LINE_THEME.line, margin: "sm" });
  contents.push(tpLineActionRow(buttons));
}

function tpLineBrandRow(cycleNumber) {
  const cycle = Number(cycleNumber || 0);
  const label = cycle > 0 ? "Tiny Progress · Cycle " + cycle : "Tiny Progress";
  return {
    type: "box",
    layout: "horizontal",
    justifyContent: "space-between",
    alignItems: "center",
    contents: [
      {
        type: "text",
        text: label,
        size: "xs",
        weight: "bold",
        color: TP_LINE_THEME.brandText,
        flex: 1,
        wrap: false,
      },
      {
        type: "text",
        text: "∞",
        size: "lg",
        weight: "bold",
        color: TP_LINE_THEME.brand,
        flex: 0,
      },
    ],
  };
}

function tpLineSectionLabel(label, mark) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    alignItems: "center",
    contents: [
      {
        type: "text",
        text: mark || "•",
        size: "sm",
        weight: "bold",
        color: TP_LINE_THEME.brand,
        flex: 0,
      },
      {
        type: "text",
        text: label,
        size: "sm",
        weight: "bold",
        color: TP_LINE_THEME.text,
        flex: 1,
      },
    ],
  };
}

function tpLineInfoCard(label, mark, contents) {
  const cardContents = [];

  // label / mark 都空白時，只保留卡片內容。
  // 用在週一與週日的純進度卡，避免出現空標題或多餘圓點。
  if (label || mark) {
    cardContents.push(tpLineSectionLabel(label, mark));
  }

  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    backgroundColor: TP_LINE_THEME.paper,
    cornerRadius: "16px",
    paddingAll: "13px",
    contents: cardContents.concat(contents || []),
  };
}

function tpLineCircleWeekMeta(currentWeek, includeDate) {
  if (!currentWeek) return null;
  const weekNumber = Number(currentWeek.weekNumber || 1);
  const contents = [
    {
      type: "text",
      text: "Week " + weekNumber,
      size: "sm",
      weight: "bold",
      color: TP_LINE_THEME.text,
      wrap: false,
      maxLines: 1,
      flex: 0,
    },
  ];

  // 只有週日回顧（與 server.js 的清單卡）顯示日期；週一小卡不顯示。
  if (includeDate) {
    const dateRange =
      tpLineShortDate(currentWeek.weekStart) +
      " ～ " +
      tpLineShortDate(currentWeek.weekEnd);
    contents.push({
      type: "text",
      text: dateRange,
      size: "sm",
      weight: "bold",
      color: TP_LINE_THEME.text,
      wrap: false,
      maxLines: 1,
      flex: 0,
    });
  }

  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    alignItems: "center",
    contents: contents,
  };
}

// 週一主動推播卡片。
function buildWeeklyMondayFlexMessage(data) {
  return tpRenderCard(
    "monday",
    data.currentWeek.cycleNumber,
    data.currentWeek.weekNumber,
  );
}

// 週日回顧主動推播卡片。
function sendWeeklySundayReview() {
  ensureSchema();
  const data = tpWebRead();
  if (!data.context.currentWeek)
    return { ok: true, skipped: true, reason: "沒有進行中的 Week" };
  return pushLineMessage(getLinePushUserId(), [
    tpRenderCard(
      "footprint",
      data.context.currentWeek.cycleNumber,
      data.context.currentWeek.weekNumber,
    ),
  ]);
}

function checkTinyProgressCycleDates() {
  const record = tpStateLoad();
  if (!record) throw new Error("找不到 web_state 資料");

  const webCycle = record.state.cycle;
  const cycleNumber = 2;

  const cycles = sheetRowsAsObjects(
    tpSpreadsheet().getSheetByName("cycles")
  );
  const weeks = sheetRowsAsObjects(
    tpSpreadsheet().getSheetByName("weeks")
  )
    .filter(w => Number(w.cycleNumber) === cycleNumber)
    .sort((a, b) => Number(a.weekNumber) - Number(b.weekNumber));

  const cycle = cycles.find(
    c => Number(c.cycleNumber) === cycleNumber
  );

  const result = {
    webStateCycle: webCycle.number,
    webStateStart: webCycle.startDate,
    webStateWeek1:
      webCycle.weekRanges?.[0]?.start ||
      webCycle.weekStarts?.[0] || "",
    webStateWeek2:
      webCycle.weekRanges?.[1]?.start ||
      webCycle.weekStarts?.[1] || "",
    sheetsCycleStart: formatCellDate(cycle?.startDate),
    sheetsWeek1: formatCellDate(weeks[0]?.weekStart),
    sheetsWeek2: formatCellDate(weeks[1]?.weekStart)
  };

  Logger.log(JSON.stringify(result, null, 2));
}
function tpFixCycle2DateOnce() {
  const cycleNumber = 2;
  const oldStart = '2026-10-19';
  const newStart = '2026-10-26';
  const ss = tpSpreadsheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const stateSheet = ss.getSheetByName('web_state');
    const cyclesSheet = ss.getSheetByName('cycles');
    const weeksSheet = ss.getSheetByName('weeks');
    if (!stateSheet || !cyclesSheet || !weeksSheet) {
      throw new Error('缺少 web_state、cycles 或 weeks 工作表；尚未修改資料');
    }

    const record = tpStateLoad();
    if (!record || !record.state || !record.state.cycle) {
      throw new Error('無法讀取 web_state；尚未修改資料');
    }
    const state = record.state;
    if (Number(state.cycle.number) !== cycleNumber) {
      throw new Error('web_state 不是 Cycle 2；為安全起見已停止');
    }
    if (state.cycle.startDate === newStart) {
      Logger.log('已經是 2026-10-26，無需修改、沒有建立備份');
      return { ok: true, skipped: true, startDate: newStart };
    }
    if (state.cycle.startDate !== oldStart) {
      throw new Error('web_state 起點不是預期的 2026-10-19；為安全起見已停止');
    }
    if (!Array.isArray(state.tasks) || state.tasks.length !== 0) {
      throw new Error('web_state 存在任務，必須先逐筆核對排程；尚未修改資料');
    }
    if ((state.cycle.weekStarts && state.cycle.weekStarts.length) ||
        (state.cycle.weekRanges && state.cycle.weekRanges.length)) {
      throw new Error('web_state 存有個別週日期，需要另外檢查；尚未修改資料');
    }

    const matchingCycles = sheetRowsAsObjects(cyclesSheet).filter(
      row => Number(row.cycleNumber) === cycleNumber
    );
    if (matchingCycles.length !== 1 ||
        formatCellDate(matchingCycles[0].startDate) !== newStart) {
      throw new Error('cycles 的 Cycle 2 開始日期不是 2026-10-26；尚未修改資料');
    }
    const weeks = sheetRowsAsObjects(weeksSheet)
      .filter(row => Number(row.cycleNumber) === cycleNumber)
      .sort((a, b) => Number(a.weekNumber) - Number(b.weekNumber));
    if (weeks.length !== 12 || !weeks.every((week, i) =>
      Number(week.weekNumber) === i + 1 &&
      formatCellDate(week.weekStart) === addDaysToYmd(newStart, i * 7) &&
      formatCellDate(week.weekEnd) === addDaysToYmd(newStart, i * 7 + 6))) {
      throw new Error('weeks 的 12 週日期尚未完全吻合，已停止避免修改錯誤資料');
    }

    const next = JSON.parse(JSON.stringify(state));
    next.cycle.startDate = newStart;
    next.simulationWeekStart = newStart;
    next.selectedWeek = 1;
    next.selectedDate = newStart;
    TPDomain.validate(next);

    const backupName = 'web_state_backup_' + Utilities.formatDate(
      new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss'
    );
    stateSheet.copyTo(ss).setName(backupName);
    SpreadsheetApp.flush();

    const revision = Number(record.revision) + 1;
    tpStateStore(next, revision, 'cycle2-date-fix-once');
    const verified = tpStateLoad();
    if (!verified || verified.revision !== revision ||
        verified.state.cycle.startDate !== newStart ||
        verified.state.selectedWeek !== 1) {
      throw new Error('寫入後驗證失敗；備份保留在 ' + backupName + '，請暫停操作並聯絡我');
    }
    const outcome = {
      ok: true,
      from: oldStart,
      to: newStart,
      selectedWeek: verified.state.selectedWeek,
      revision: revision,
      backupSheet: backupName
    };
    Logger.log(JSON.stringify(outcome, null, 2));
    return outcome;
  } finally {
    lock.releaseLock();
  }
}


