require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("node:crypto"),
  D = require("./domain"),
  Cards = require("./line-cards"),
  Bot = require("./line-bot"),
  Access = require("./access");
const ACCESS = Access.config();
const { AsyncLocalStorage } = require("node:async_hooks");
const LINE_CONTEXT = new AsyncLocalStorage();
const LEGACY_MUTATIONS = new Set([
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
  "archive-week",
  "postpone-current-week",
  "update-current-week-plan",
  "update-week-plan",
  "create-cycle",
  "update-cycle-theme",
  "change-cycle-start",
  "create-category",
  "update-category",
  "save-retrospective",
  "submit-retrospective",
]);

const app = express();
const PORT = process.env.PORT || 3000;

const GOOGLE_SHEETS_API_URL = process.env.GOOGLE_SHEETS_API_URL;
const GOOGLE_SHEETS_API_SECRET = process.env.GOOGLE_SHEETS_API_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// 把你自己的 Tiny Progress 網頁網址貼在下面。
// 例如：https://你的網站網址
const TINY_PROGRESS_WEB_URL = ACCESS.webUrl;

// Queue retry 改由 Render 排程，避免 Google Apps Script time trigger 偶發失敗寄信。
// 正常 LINE 即時流程完全不走這個 timer，所以不會拖慢一般回覆。
const QUEUE_RETRY_INTERVAL_MS = Math.max(
  60 * 1000,
  Number(process.env.QUEUE_RETRY_INTERVAL_MS || 5 * 60 * 1000),
);
const QUEUE_RETRY_START_DELAY_MS = Math.max(
  5 * 1000,
  Number(process.env.QUEUE_RETRY_START_DELAY_MS || 30 * 1000),
);
const QUEUE_RETRY_TIMEOUT_MS = Math.max(
  10 * 1000,
  Number(process.env.QUEUE_RETRY_TIMEOUT_MS || 45 * 1000),
);
let queueRetryInFlight = false;
let legacyGasRetryTriggerDisabled = false;

// 保留做 LINE 卡片排序與預設顯示，不再當成分類白名單。
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

if (require.main === module) Access.validate(ACCESS);

app.use((req, res, next) => {
  if (req.headers.origin && !ACCESS.origins.includes(req.headers.origin))
    return res.status(403).json({ message: "不允許的網站來源" });
  next();
});
app.use(
  cors({
    origin: ACCESS.origins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(
  express.json({
    limit: "2mb",
    verify: (req, res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
  }),
);
Access.install(app, ACCESS);
app.get("/api/state", async (req, res) => {
  try {
    res.json(await loadWebState(req.query.cycle));
  } catch (e) {
    res.status(e.status || 400).json({ message: e.message });
  }
});
app.put("/api/state", async (req, res) => {
  try {
    res.json(await gasPost("web-save", req.body));
  } catch (e) {
    res.status(e.status || 400).json({ message: e.message });
  }
});
app.post("/internal/reminders", async (req, res) => {
  try {
    const due = await gasPost("reminder-claim");
    if (due.skipped) return res.json({ ok: true, skipped: due.skipped });
    const message = scopeMessages(
      [
        Cards[due.kind](due.state, {
          week: due.week,
          webUrl: TINY_PROGRESS_WEB_URL,
        }),
      ],
      due.state.cycle.number,
    )[0];
    const hash = crypto
      .createHash("sha256")
      .update("v28-reminder:" + due.key)
      .digest("hex");
    const retryKey =
      hash.slice(0, 8) +
      "-" +
      hash.slice(8, 12) +
      "-4" +
      hash.slice(13, 16) +
      "-a" +
      hash.slice(17, 20) +
      "-" +
      hash.slice(20, 32);
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + LINE_CHANNEL_ACCESS_TOKEN,
        "Content-Type": "application/json",
        "X-Line-Retry-Key": retryKey,
      },
      body: JSON.stringify({ to: ACCESS.owner, messages: [message] }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok && response.status !== 409)
      throw new Error("LINE 傳送暫時失敗");
    await gasPost("reminder-sent", {
      cycle: due.state.cycle.number,
      key: due.key,
    });
    res.json({ ok: true, sent: true });
  } catch (e) {
    res.status(503).json({ message: e.message });
  }
});
app.post("/internal/card", async (req, res) => {
  try {
    if (!["list", "draw", "monday", "footprint"].includes(req.body.kind))
      return res.status(400).json({ message: "卡片類型不正確" });
    const data = await loadWebState(req.body.cycle);
    res.json({
      message: scopeMessages(
        [
          Cards[req.body.kind](data.state, {
            week: Number(req.body.week) || D.currentWeek(data.state),
            webUrl: TINY_PROGRESS_WEB_URL,
          }),
        ],
        data.state.cycle.number,
      )[0],
    });
  } catch (e) {
    res.status(e.status || 400).json({ message: e.message });
  }
});

const TP_POSTBACK_PREFIX = "__TP_POSTBACK__:";
const TP_LINE_PENDING_TTL_SECONDS = 10 * 60;

function getDisplayLabel(label) {
  if (label === "任務") return "任務";
  if (label === "完成標準" || label === "標準") return "完成標準";
  return String(label || "內容");
}

async function getCurrentWeekNumberFromGoogleSheets() {
  const context = await fetchWeekContextFromGoogleSheets();
  if (!context.currentWeek) throw new Error("目前不在進行中的 Week");
  return Number(context.currentWeek.weekNumber);
}

function getLineSourceKey(event) {
  const source = (event && event.source) || {};
  return String(
    source.userId || source.groupId || source.roomId || "line-unknown",
  ).trim();
}

function buildTpPostbackData(action, params = {}) {
  const query = new URLSearchParams();
  query.set("action", action);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "")
      query.set(key, String(value));
  }
  return query.toString();
}

function parseTpPostbackData(raw) {
  const query = new URLSearchParams(String(raw || ""));
  const data = {};
  for (const [key, value] of query.entries()) data[key] = value;
  return data;
}

function normalizeCategory(value) {
  return String(value || "").trim() || DEFAULT_CATEGORY;
}

function normalizeSubCategory(value, category = DEFAULT_CATEGORY) {
  const sub = String(value || "").trim();
  if (sub) return sub;
  return normalizeCategory(category) === DEFAULT_CATEGORY
    ? DEFAULT_SUBCATEGORY
    : EMPTY_SUBCATEGORY;
}

function normalizeDone(value) {
  return value === true || String(value).toUpperCase() === "TRUE";
}

function getApiErrorStatus(error) {
  if (error && error.status) return error.status;
  const message = String((error && error.message) || "");
  if (/必填|只能是|不存在|找不到|無效|不能|已經/.test(message)) return 400;
  if (/已封存|已完成/.test(message)) return 409;
  return 500;
}

function normalizeItem(item) {
  const safe = item || {};
  const status = String(
    safe.status || (normalizeDone(safe.done) ? "completed" : "active"),
  );
  return {
    ...safe,
    id: String(safe.id || "").trim(),
    type: String(safe.type || "task").trim(),
    title: String(safe.title || "").trim(),
    categoryId: String(safe.categoryId || "").trim(),
    subCategoryId: String(safe.subCategoryId || "").trim(),
    category: normalizeCategory(safe.category),
    subCategory: normalizeSubCategory(safe.subCategory, safe.category),
    status,
    done: status === "completed" || normalizeDone(safe.done),
    cycleNumber: Number(safe.cycleNumber || safe.scheduledCycleNumber || 1),
    weekNumber: Number(safe.weekNumber || safe.scheduledWeekNumber || 1),
    originalCycleNumber: Number(
      safe.originalCycleNumber || safe.cycleNumber || 1,
    ),
    originalWeekNumber: Number(safe.originalWeekNumber || safe.weekNumber || 1),
    scheduledCycleNumber: Number(
      safe.scheduledCycleNumber || safe.cycleNumber || 1,
    ),
    scheduledWeekNumber: Number(
      safe.scheduledWeekNumber || safe.weekNumber || 1,
    ),
    weekStart: safe.weekStart || "",
    weekEnd: safe.weekEnd || "",
    completedAt: safe.completedAt || "",
    cancelledAt: safe.cancelledAt || "",
    cancelReason: safe.cancelReason || "",
    cancelNote: safe.cancelNote || "",
    replannedAt: safe.replannedAt || "",
    recurringRuleId: String(safe.recurringRuleId || "").trim(),
    frequency: String(safe.frequency || "").trim(),
    timesPerWeek: Number(safe.timesPerWeek || 0),
    occurrences: Array.isArray(safe.occurrences) ? safe.occurrences : [],
    completionNote: String(safe.completionNote || "").trim(),
    createdAt: safe.createdAt || "",
    updatedAt: safe.updatedAt || "",
  };
}

function getSubCategorySortIndex(subCategory) {
  const index = SUBCATEGORY_OPTIONS.indexOf(subCategory);
  return index === -1 ? SUBCATEGORY_OPTIONS.length : index;
}

function sortTasksByCategory(tasks) {
  return [...tasks].sort((a, b) => {
    const categoryA = normalizeCategory(a.category);
    const categoryB = normalizeCategory(b.category);
    const knownA = CATEGORY_OPTIONS.indexOf(categoryA);
    const knownB = CATEGORY_OPTIONS.indexOf(categoryB);
    const indexA = knownA === -1 ? CATEGORY_OPTIONS.length : knownA;
    const indexB = knownB === -1 ? CATEGORY_OPTIONS.length : knownB;
    if (indexA !== indexB) return indexA - indexB;
    if (categoryA !== categoryB)
      return categoryA.localeCompare(categoryB, "zh-Hant");
    return (
      getSubCategorySortIndex(a.subCategory) -
      getSubCategorySortIndex(b.subCategory)
    );
  });
}

function buildGoogleSheetsResourceUrl(resource, params = {}) {
  const url = new URL(GOOGLE_SHEETS_API_URL);
  url.searchParams.set("secret", GOOGLE_SHEETS_API_SECRET);
  url.searchParams.set("resource", resource);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "")
      url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function gasGet(resource, params = {}) {
  return gasPost("read-resource", { resource, params });
}

async function gasPost(action, payload = {}) {
  return gasPostWithTimeout(action, payload, 35000);
}

async function gasPostWithTimeout(
  action,
  payload = {},
  timeoutMs = QUEUE_RETRY_TIMEOUT_MS,
) {
  const context = LINE_CONTEXT.getStore();
  if (context && LEGACY_MUTATIONS.has(action))
    payload = { ...payload, requestId: context.id + ":" + ++context.seq };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(GOOGLE_SHEETS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        secret: GOOGLE_SHEETS_API_SECRET,
        action,
      }),
      signal: controller.signal,
    });

    if (!response.ok)
      throw new Error(
        `呼叫 Google Apps Script ${action} 失敗，狀態碼：${response.status}`,
      );
    const data = await response.json();
    if (!data.ok) {
      const error = new Error(
        data.message || `Google Apps Script ${action} 失敗`,
      );
      error.status = Number(data.status) || 400;
      throw error;
    }
    return data.result !== undefined ? data.result : data.item;
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(
        `Google Apps Script ${action} 超過 ${Math.round(timeoutMs / 1000)} 秒未回應`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function disableLegacyGasRetryTriggerIfReady() {
  if (legacyGasRetryTriggerDisabled) return;

  try {
    const result = await gasPostWithTimeout(
      "disable-retry-pending-queue-trigger",
      {},
      QUEUE_RETRY_TIMEOUT_MS,
    );
    legacyGasRetryTriggerDisabled = true;
    console.log(
      `[queue-retry] 舊 GAS retry trigger 已停用；移除 ${Number((result && result.removedCount) || 0)} 個`,
    );
  } catch (error) {
    // 停用失敗時保留舊 trigger，寧可暫時雙保險，也不讓 retry 功能出現空窗。
    console.warn(
      "[queue-retry] 暫時無法停用舊 GAS trigger，會在下次成功 retry 後再試：",
      error.message,
    );
  }
}

async function runQueueRetryTick() {
  if (queueRetryInFlight)
    return { ok: true, skipped: true, reason: "retry_in_flight" };
  queueRetryInFlight = true;

  try {
    const result = await gasPostWithTimeout(
      "retry-pending-queue",
      {},
      QUEUE_RETRY_TIMEOUT_MS,
    );
    const retryCount = Array.isArray(result && result.results)
      ? result.results.length
      : 0;
    console.log(
      `[queue-retry] Render 排程完成；本次處理 ${retryCount} 筆 pending queue`,
    );

    // 只有 Render -> GAS 的新 retry 路徑成功後，才自動刪掉舊的 GAS time trigger。
    await disableLegacyGasRetryTriggerIfReady();
    return result;
  } catch (error) {
    console.warn(
      "[queue-retry] 本次背景 retry 失敗，正常 LINE 即時功能不受影響：",
      error.message,
    );
    return { ok: false, error: error.message };
  } finally {
    queueRetryInFlight = false;
  }
}

function startQueueRetryScheduler() {
  const firstTimer = setTimeout(() => {
    runQueueRetryTick().catch((error) =>
      console.warn("[queue-retry] startup retry error：", error.message),
    );
  }, QUEUE_RETRY_START_DELAY_MS);

  const interval = setInterval(() => {
    runQueueRetryTick().catch((error) =>
      console.warn("[queue-retry] interval retry error：", error.message),
    );
  }, QUEUE_RETRY_INTERVAL_MS);

  if (typeof firstTimer.unref === "function") firstTimer.unref();
  if (typeof interval.unref === "function") interval.unref();

  console.log(
    `[queue-retry] Render scheduler 已啟動：${Math.round(QUEUE_RETRY_INTERVAL_MS / 1000)} 秒檢查一次`,
  );
}

function normalizeWeekContextPayload(data = {}) {
  return {
    previousWeek: data.previousWeek || null,
    currentWeek: data.currentWeek || null,
    nextWeek: data.nextWeek || null,
    maxPlannableWeek:
      Number(
        data.maxPlannableWeek || (data.currentWeek || {}).weekNumber || 0,
      ) || null,
    canPlanNextWeek: data.canPlanNextWeek === true,
    canPlanNextCycle: data.canPlanNextCycle === true,
    restPeriod: data.restPeriod === true,
    nextCycle: data.nextCycle || null,
    cycleComplete: data.cycleComplete === true,
    completedCycleNumber: data.completedCycleNumber || null,
  };
}

async function fetchWeekContextFromGoogleSheets() {
  const data = await gasGet("week-context");
  return normalizeWeekContextPayload(data);
}

async function fetchCoreFromGoogleSheets() {
  const data = await gasGet("core");
  return {
    context: normalizeWeekContextPayload(data.context || {}),
    items: (data.items || []).map(normalizeItem),
    weeks: data.weeks || [],
    cycles: data.cycles || [],
    categories: data.categories || [],
    retrospectives: data.retrospectives || [],
  };
}

async function fetchItemsFromGoogleSheets() {
  const data = await gasGet("items");
  return (data.items || []).map(normalizeItem);
}

async function fetchCurrentWeekItemsFromGoogleSheets() {
  const core = await fetchCoreFromGoogleSheets();
  const context = core.context;
  if (!context.currentWeek) return [];
  const c = Number(context.currentWeek.cycleNumber);
  const w = Number(context.currentWeek.weekNumber);
  return core.items.filter(
    (item) =>
      Number(item.scheduledCycleNumber) === c &&
      Number(item.scheduledWeekNumber) === w &&
      !["cancelled", "replanned"].includes(item.status),
  );
}

async function createItemToGoogleSheets({
  type,
  title,
  category,
  subCategory,
  categoryId,
  subCategoryId,
  done,
  cycleNumber,
  weekNumber,
  scheduledCycleNumber,
  scheduledWeekNumber,
  weekStart,
  weekEnd,
  createdAt,
  updatedAt,
}) {
  const item = {
    type,
    title,
    category: normalizeCategory(category),
    subCategory: normalizeSubCategory(subCategory, category),
    categoryId,
    subCategoryId,
    done: done === true,
    cycleNumber,
    weekNumber,
    scheduledCycleNumber,
    scheduledWeekNumber,
    weekStart,
    weekEnd,
    createdAt,
    updatedAt,
  };
  const result = await gasPost("create", { item });
  return normalizeItem(result);
}

async function updateItemToGoogleSheets(id, updates) {
  const safe = { ...updates };
  delete safe.difficulty;
  const result = await gasPost("update", { id, updates: safe });
  return normalizeItem(result);
}

async function deleteItemFromGoogleSheets(id) {
  const result = await gasPost("delete", { id });
  return normalizeItem(result);
}

async function getItemsByType(type) {
  const items = await fetchCurrentWeekItemsFromGoogleSheets();
  const filteredItems = items.filter((item) => item.type === type);
  return type === "task" ? sortTasksByCategory(filteredItems) : filteredItems;
}

async function getTaskBoardForLine() {
  // v24: 一張 LINE 任務卡只打一個 core snapshot，不再重複抓 context。
  const core = await fetchCoreFromGoogleSheets();
  const currentWeek = core.context.currentWeek;
  if (!currentWeek) return { currentWeek: null, tasks: [], standards: [] };

  const c = Number(currentWeek.cycleNumber);
  const w = Number(currentWeek.weekNumber);
  const items = core.items.filter(
    (item) =>
      Number(item.scheduledCycleNumber) === c &&
      Number(item.scheduledWeekNumber) === w &&
      !["cancelled", "replanned"].includes(item.status),
  );

  return {
    currentWeek,
    tasks: sortTasksByCategory(items.filter((item) => item.type === "task")),
    standards: items.filter((item) => item.type === "standard"),
  };
}

async function getTaskContextById(id) {
  const core = await fetchCoreFromGoogleSheets();
  const task =
    core.items.find(
      (item) => item.type === "task" && item.id === String(id || ""),
    ) || null;
  return { core, task, currentWeek: core.context.currentWeek || null };
}

function getTaskDoneCount(task) {
  if (!task) return 0;
  if (task.frequency)
    return (task.occurrences || []).filter((o) => o && o.done).length;
  return task.done ? 1 : 0;
}

function getTaskTargetCount(task) {
  if (!task) return 1;
  if (task.frequency === "daily") return 7;
  if (task.frequency === "weekly")
    return Math.max(1, Number(task.timesPerWeek || 1));
  return 1;
}

function getRecurringMetaText(task) {
  if (!task || !task.frequency) return "";
  const done = getTaskDoneCount(task);
  const target = getTaskTargetCount(task);
  return task.frequency === "daily"
    ? `每天 · ${done}/${target}`
    : `每週 ${target} 次 · ${done}/${target}`;
}

function getLineCommandHintText() {
  return "主要操作請直接點卡片按鈕";
}

function getTaskMetaText(task) {
  const parts = [normalizeCategory(task.category)];

  if (normalizeCategory(task.category) === "程式學習") {
    parts.push(normalizeSubCategory(task.subCategory, task.category));
  }

  return parts.join("｜");
}

// ── 子分類標籤顯示名稱；未分類回傳空字串，呼叫端再決定是否渲染 ──
function getLineSubCategoryLabel(subCategory) {
  // LINE 與前端 script.js 顯示同一個子分類名稱，不再另外縮寫。
  const value = String(subCategory || "").trim();
  if (!value || value === EMPTY_SUBCATEGORY) return "";
  return value;
}

// ── LINE 任務名稱只做清理，不先用固定字數截斷。
// 真正的單行省略交給 Flex 的版面寬度處理，避免不同手機被過早截字。 ──
function getLineTaskTitle(title) {
  const text = String(title || "")
    .trim()
    .replace(/\s+/g, " ");
  return text || "未命名任務";
}

function formatTaskSectionByCategory(tasks) {
  if (tasks.length === 0)
    return ["【本週任務】", "本週還沒有任務。加入一件想做的事就好。"].join(
      "\n",
    );

  const lines = ["【本週任務】"];
  let taskNumber = 1;

  CATEGORY_OPTIONS.forEach(function (category) {
    const categoryTasks = tasks.filter(
      (task) => normalizeCategory(task.category) === category,
    );
    if (categoryTasks.length === 0) return;

    lines.push("", `《${category}》`);

    if (category === "程式學習") {
      [...SUBCATEGORY_OPTIONS, EMPTY_SUBCATEGORY].forEach(
        function (subCategory) {
          const groupTasks = categoryTasks.filter(function (task) {
            return (
              normalizeSubCategory(task.subCategory, category) === subCategory
            );
          });

          if (groupTasks.length === 0) return;

          // 純文字版也補上子分類小標題，和 Flex 版一致
          const subLabel = getLineSubCategoryLabel(subCategory);
          if (subLabel) lines.push(`  ［${subLabel}］`);

          groupTasks.forEach(function (task) {
            const checkbox = task.done ? "✓ " : "";
            lines.push(
              `${taskNumber}. ${checkbox}${task.title}｜${normalizeSubCategory(task.subCategory, category)}`,
            );
            taskNumber += 1;
          });
        },
      );
      return;
    }

    categoryTasks.forEach(function (task) {
      const checkbox = task.done ? "✓ " : "";
      lines.push(
        `${taskNumber}. ${checkbox}${task.title}`,
      );
      taskNumber += 1;
    });
  });

  return lines.join("\n").trim();
}

function formatLineSection(title, items, emptyText) {
  if (items.length === 0) return [title, emptyText].join("\n");
  return [
    title,
    ...items.map(
      (item, index) => `${index + 1}. ${item.done ? "☑" : "☐"} ${item.title}`,
    ),
  ].join("\n");
}

function formatTaskBoardForLine({ currentWeek, tasks, standards }) {
  const weekTitle = currentWeek
    ? `第 ${currentWeek.weekNumber} 週｜${currentWeek.title}`
    : "本週清單";

  return [
    "📋 Tiny Progress",
    weekTitle,
    "",
    `任務進度：${tasks.filter((task) => task.done).length} / ${tasks.length}`,
    `標準進度：${standards.filter((standard) => standard.done).length} / ${standards.length}`,
    "",
    formatTaskSectionByCategory(tasks),
    "",
    formatLineSection(
      "【本週驗收標準】",
      standards,
      "本週標準尚未成文。寫下一個方向，慢慢前進。",
    ),
    "",
    getLineCommandHintText(),
  ].join("\n");
}

const FLEX_COLORS = {
  cream: "#F8F4EA",
  card: "#FFFAF1",
  paper: "#FFFDF7",
  darkGreen: "#4F5947",
  mutedText: "#7F8777",
  beigeLine: "#E8E1D5",
  brand: "#769275",
  brandSoft: "#EEF3EA",
  brandBorder: "#C9D5C3",
  brandText: "#566A55",
};

// LINE 固定 5 張主卡：3 張日常操作卡由 server.js 產生，2 張主動推播由 Code.gs 產生。
// server.js 這裡只保留日常的 3 張，避免再為攻略額外長出新卡片。
const CARD_ACCENTS = {
  allList: "#93B9D1", // ① 本週清單
  draw: "#6EB7B0", // ② 抽一件
  action: "#9B806B", // ③ 事情操作
};

const LINE_TAG_PALETTE = [
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

function stableLineTagIndex(value, salt) {
  const text = String(salt || "") + "|" + String(value || "未分類");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % LINE_TAG_PALETTE.length;
}

function getCategoryFlexStyle(category, valueKey) {
  const normalizedCategory = normalizeCategory(category);
  const key = valueKey || normalizedCategory;
  const style = LINE_TAG_PALETTE[stableLineTagIndex(key, "category")];
  return {
    backgroundColor: style.bg,
    textColor: style.text,
    borderColor: style.border,
    accentColor: style.accent,
  };
}

const LINE_TAG_COLOR_FAMILIES = [
  "green",
  "rose",
  "blue",
  "orange",
  "purple",
  "teal",
  "yellow",
  "green",
  "orange",
  "blue",
  "green",
  "rose",
];

function buildCuteSectionLabel(emoji, text, color, iconColor) {
  const contents = [];

  if (emoji) {
    contents.push({
      type: "text",
      text: emoji,
      size: "sm",
      flex: 0,
      color: iconColor || color || FLEX_COLORS.mutedText,
      weight: "bold",
    });
  }

  contents.push({
    type: "text",
    text,
    size: "sm",
    weight: "bold",
    color: color || FLEX_COLORS.mutedText,
    flex: 1,
  });

  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    alignItems: "center",
    contents,
  };
}

function buildFlexTag(label, backgroundColor, textColor, options = {}) {
  return {
    type: "box",
    layout: "vertical",
    flex: 0,
    width: options.width,
    backgroundColor,
    cornerRadius: options.cornerRadius || "999px",
    paddingTop: options.paddingTop || "4px",
    paddingBottom: options.paddingBottom || "4px",
    paddingStart: options.paddingStart || "8px",
    paddingEnd: options.paddingEnd || "8px",
    borderColor: options.borderColor,
    borderWidth: options.borderColor ? "1px" : undefined,
    contents: [
      {
        type: "text",
        text: label,
        size: options.size || "xxs",
        weight: options.weight || "bold",
        color: textColor,
        align: "center",
        flex: 0,
        maxLines: 1,
      },
    ],
  };
}

function buildCategoryFlexTag(category, options = {}) {
  const style = getCategoryFlexStyle(category, options.valueKey);

  // 主分類 = 第一層資訊：保留 script.js 的色票底色，視覺權重最高。
  return buildFlexTag(category, style.backgroundColor, style.textColor, {
    width: options.width,
    cornerRadius: "999px",
    size: "xxs",
    weight: "bold",
    paddingTop: "4px",
    paddingBottom: "4px",
    paddingStart: "9px",
    paddingEnd: "9px",
  });
}

function formatLineShortDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^\d{4}-(\d{2})-(\d{2})/);
  return match ? `${match[1]}/${match[2]}` : text;
}

function buildCircleWeekMeta(currentWeek) {
  if (!currentWeek) return null;
  const weekNumber = Number(currentWeek.weekNumber || 1);

  return {
    type: "box",
    layout: "horizontal",
    alignItems: "center",
    contents: [
      {
        type: "text",
        text: `Week ${weekNumber}`,
        size: "sm",
        weight: "bold",
        color: FLEX_COLORS.darkGreen,
        wrap: false,
        maxLines: 1,
        flex: 0,
      },
    ],
  };
}

// 「本週清單」專用：Week 與日期放在同一列，日期和週次同色、同樣粗體。
// Cycle 已放到 Tiny Progress 品牌列；其他卡片只顯示 Week，不顯示日期。
function buildListCircleWeekMeta(currentWeek) {
  if (!currentWeek) return null;

  const weekNumber = Number(currentWeek.weekNumber || 1);
  const start = formatLineShortDate(currentWeek.weekStart);
  const end = formatLineShortDate(currentWeek.weekEnd);
  const dateRange = start && end ? `${start} ～ ${end}` : "";

  const contents = [
    {
      type: "text",
      text: `Week ${weekNumber}`,
      size: "sm",
      weight: "bold",
      color: FLEX_COLORS.darkGreen,
      wrap: false,
      maxLines: 1,
      flex: 0,
    },
  ];

  if (dateRange) {
    contents.push({
      type: "text",
      text: dateRange,
      size: "sm",
      weight: "bold",
      color: FLEX_COLORS.darkGreen,
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
    contents,
  };
}

function buildFlexHeader(
  title,
  subtitle,
  headerAccessory,
  headerBadge,
  options = {},
) {
  const cycleNumber = Number(options.cycleNumber || 0);
  const brandLabel =
    cycleNumber > 0 ? `Tiny Progress · Cycle ${cycleNumber}` : "Tiny Progress";
  const contents = [
    {
      type: "box",
      layout: "horizontal",
      alignItems: "center",
      contents: [
        {
          type: "text",
          text: brandLabel,
          size: "xs",
          weight: "bold",
          color: FLEX_COLORS.brandText,
          flex: 1,
          wrap: false,
        },
        {
          type: "text",
          text: "∞",
          size: "lg",
          weight: "bold",
          color: FLEX_COLORS.brand,
          flex: 0,
        },
      ],
    },
  ];

  if (headerBadge) {
    contents.push({
      type: "box",
      layout: "horizontal",
      margin: "xs",
      contents: [headerBadge],
    });
  }

  const titleContents = [
    {
      type: "text",
      text: title,
      size: options.titleSize || "lg",
      weight: "bold",
      color: FLEX_COLORS.darkGreen,
      wrap: true,
      flex: 1,
    },
  ];
  if (headerAccessory) titleContents.push(headerAccessory);

  contents.push({
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    alignItems: "center",
    margin: headerBadge ? "sm" : "md",
    contents: titleContents,
  });

  if (subtitle) {
    contents.push({
      type: "text",
      text: subtitle,
      size: "xs",
      color: FLEX_COLORS.mutedText,
      wrap: true,
    });
  }

  return { type: "box", layout: "vertical", spacing: "xs", contents };
}

function buildFlexInfoCard(contents, options = {}) {
  const cardContents = [];
  if (options.label || options.emoji) {
    cardContents.push(
      buildCuteSectionLabel(
        options.emoji === undefined ? "•" : options.emoji,
        options.label || "Tiny Progress",
        options.labelColor || FLEX_COLORS.darkGreen,
        options.iconColor || FLEX_COLORS.brand,
      ),
    );
  }
  const card = {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    backgroundColor: options.backgroundColor || FLEX_COLORS.paper,
    cornerRadius: "16px",
    paddingAll: "13px",
    contents: cardContents.concat(contents),
  };
  if (options.borderColor) {
    card.borderColor = options.borderColor;
    card.borderWidth = "1px";
  }
  return card;
}

function buildSegmentedProgressBar(doneCount, totalCount, color) {
  const segments = Math.max(0, Number(totalCount || 0));
  const filled = Math.max(0, Math.min(segments, Number(doneCount || 0)));

  // 沒有任務時仍保留一條淡灰底，避免 Flex contents 為空看起來像壞掉。
  if (segments === 0) {
    return {
      type: "box",
      layout: "vertical",
      height: "8px",
      margin: "sm",
      backgroundColor: "#E7E5DF",
      cornerRadius: "999px",
      contents: [],
    };
  }

  return {
    type: "box",
    layout: "horizontal",
    // 任務多時縮小格子間距，避免被擠得太碎。
    spacing: segments > 10 ? "none" : "xs",
    margin: "sm",
    contents: Array.from({ length: segments }, (_, index) => ({
      type: "box",
      layout: "vertical",
      height: "8px",
      flex: 1,
      // 一件任務 = 一格；完成一件就亮一格。
      backgroundColor:
        index < filled ? color || FLEX_COLORS.greenFresh : "#E7E5DF",
      cornerRadius: "999px",
      contents: [],
    })),
  };
}

function buildProgressBlock(label, doneCount, totalCount, color) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: [
          {
            type: "text",
            text: label,
            size: "sm",
            color: FLEX_COLORS.mutedText,
            flex: 1,
          },
          {
            type: "text",
            text: `${doneCount} / ${totalCount}`,
            size: "sm",
            color: FLEX_COLORS.darkGreen,
            weight: "bold",
            align: "end",
            flex: 0,
          },
        ],
      },
      buildSegmentedProgressBar(doneCount, totalCount, color),
    ],
  };
}

// 「本週清單」專用進度：移除灰色「本週進度」文字，只保留數字與進度條。
function buildListProgressBlock(doneCount, totalCount, color) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    contents: [
      {
        type: "text",
        text: `${doneCount} / ${totalCount}`,
        size: "sm",
        color: FLEX_COLORS.darkGreen,
        weight: "bold",
        align: "end",
        wrap: false,
        maxLines: 1,
      },
      buildSegmentedProgressBar(doneCount, totalCount, color),
    ],
  };
}

function buildTaskTitleLine({ task, prefix = "", size = "md" }) {
  const title = String(task.title || "").trim() || "未命名任務";
  return {
    type: "text",
    text: `${prefix}${title}`,
    size,
    color: task.done ? "#8D9589" : FLEX_COLORS.darkGreen,
    wrap: false,
    maxLines: 1,
    weight: "regular",
  };
}

function buildTaskFlexRow({ task, taskNumber }) {
  const checkbox = task.done ? "✓ " : "";
  const category = normalizeCategory(task.category);
  const rowContents = [
    buildTaskTitleLine({
      task,
      prefix: `${taskNumber === "" || taskNumber === undefined || taskNumber === null ? "" : `${taskNumber}. `}${checkbox}`,
      size: "md",
    }),
    {
      type: "box",
      layout: "horizontal",
      margin: "xs",
      contents: [
        buildCategoryFlexTag(category, {
          valueKey: task.categoryId || category,
        }),
      ],
    },
  ];

  const recurringMeta = getRecurringMetaText(task);
  if (recurringMeta) {
    rowContents.push({
      type: "text",
      text: recurringMeta,
      size: "xs",
      color: FLEX_COLORS.mutedText,
      margin: "xs",
      wrap: false,
      maxLines: 1,
    });
  }

  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    paddingTop: "5px",
    paddingBottom: "9px",
    contents: rowContents,
  };
}

// 「清單」卡專用任務列：
// 第一行 = 任務名稱；第二行 = 主題分類＋次分類。
function buildListTaskFlexRow({ task, taskNumber }) {
  const row = buildTaskFlexRow({ task, taskNumber });
  row.contents.push({
    type: "box",
    layout: "horizontal",
    justifyContent: "flex-end",
    margin: "xs",
    contents: [
      buildSoftActionPill(
        "操作",
        linePostbackAction(
          "操作",
          buildTpPostbackData("task_action", { id: task.id }),
        ),
        {
          flex: 0,
          width: "62px",
        },
      ),
    ],
  });
  return row;
}

function buildListTaskRows(tasks) {
  const rows = [];
  tasks.forEach((task, index) => {
    rows.push(buildListTaskFlexRow({ task, taskNumber: index + 1 }));
    if (index < tasks.length - 1) {
      rows.push({ type: "separator", color: FLEX_COLORS.beigeLine });
    }
  });
  return rows;
}

function linePostbackAction(label, data, options = {}) {
  const action = { type: "postback", label, data };
  if (options.displayText) action.displayText = options.displayText;
  if (options.inputOption) action.inputOption = options.inputOption;
  if (options.fillInText) action.fillInText = options.fillInText;
  return action;
}

function buildQuickReplyItem(action) {
  return { type: "action", action };
}

function buildSoftActionPill(label, action, options = {}) {
  const box = {
    type: "box",
    layout: "vertical",
    flex: options.flex === undefined ? 1 : options.flex,
    backgroundColor: options.backgroundColor || FLEX_COLORS.brandSoft,
    borderColor: options.borderColor || FLEX_COLORS.brandBorder,
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
        weight: options.weight || "bold",
        color: options.textColor || FLEX_COLORS.brandText,
        align: "center",
        wrap: false,
        maxLines: 1,
      },
    ],
    action,
  };
  if (options.width) box.width = options.width;
  return box;
}

function buildActionPillRow(items) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    contents: items,
  };
}

function buildListFooter() {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    contents: [
      buildActionPillRow([
        buildSoftActionPill(
          "抽一件",
          linePostbackAction("抽一件", buildTpPostbackData("draw")),
        ),
        buildSoftActionPill(
          "＋ 新增",
          linePostbackAction("新增", buildTpPostbackData("add_prompt"), {
            inputOption: "openKeyboard",
          }),
          {
            backgroundColor: FLEX_COLORS.paper,
          },
        ),
      ]),
    ],
  };
}

function buildTaskActionFooter(task, taskNumber) {
  const primaryText = task.done ? "改回未完成" : "完成";
  const primaryAction = task.done ? "task_undo" : "task_done";
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    contents: [
      buildActionPillRow([
        buildSoftActionPill(
          primaryText,
          linePostbackAction(
            primaryText,
            buildTpPostbackData(primaryAction, { id: task.id }),
          ),
          {
            backgroundColor: task.done ? "#F4F2ED" : FLEX_COLORS.brandSoft,
          },
        ),
        buildSoftActionPill(
          "編輯",
          linePostbackAction(
            "編輯",
            buildTpPostbackData("edit_prompt", { id: task.id }),
            { inputOption: "openKeyboard" },
          ),
          {
            backgroundColor: FLEX_COLORS.paper,
          },
        ),
        buildSoftActionPill(
          "移週",
          linePostbackAction(
            "移週",
            buildTpPostbackData("reschedule_choose", { id: task.id }),
          ),
          {
            backgroundColor: FLEX_COLORS.paper,
          },
        ),
      ]),
      buildActionPillRow([
        buildSoftActionPill(
          "刪除",
          linePostbackAction(
            "刪除",
            buildTpPostbackData("delete_preview", { id: task.id }),
          ),
          {
            backgroundColor: "#FBF3F1",
            borderColor: "#E7CFC9",
            textColor: "#8B5E57",
          },
        ),
        buildSoftActionPill(
          "回清單",
          linePostbackAction("回清單", buildTpPostbackData("list")),
          {
            backgroundColor: FLEX_COLORS.paper,
          },
        ),
      ]),
    ],
  };
}

function buildBaseFlexBubble({
  title,
  subtitle,
  bodyContents,
  footerContents,
  accentColor,
  headerAccessory,
  headerBadge,
  titleSize,
  cycleNumber,
}) {
  const innerContents = [
    buildFlexHeader(title, subtitle, headerAccessory, headerBadge, {
      titleSize,
      cycleNumber,
    }),
    { type: "separator", margin: "md", color: FLEX_COLORS.beigeLine },
    ...bodyContents,
  ];
  if (footerContents) {
    innerContents.push({
      type: "separator",
      margin: "md",
      color: FLEX_COLORS.beigeLine,
    });
    innerContents.push(footerContents);
  }
  return {
    type: "bubble",
    size: "mega",
    styles: { body: { backgroundColor: FLEX_COLORS.cream } },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "6px",
      contents: [
        {
          type: "box",
          layout: "vertical",
          paddingAll: "15px",
          spacing: "md",
          backgroundColor: FLEX_COLORS.card,
          borderColor: accentColor || FLEX_COLORS.brand,
          borderWidth: "2px",
          cornerRadius: "22px",
          contents: innerContents,
        },
      ],
    },
  };
}

function buildDrawOneTaskFallbackText({
  selectedTask,
  taskNumber,
  unfinishedCount,
}) {
  return [
    "Tiny Progress｜今天抽到",
    "",
    `第 ${taskNumber} 個任務`,
    `☐ ${selectedTask.title}`,
    "",
    `分類：${getTaskMetaText(selectedTask)}`,
    `目前還有 ${unfinishedCount} 件未完成。`,
    "",
    "可以直接點卡片上的完成、換一件或更多。",
  ].join("\n");
}

function buildDrawEmptyFlexMessage(currentWeek) {
  const footerButtons = [
    buildSoftActionPill(
      "看清單",
      linePostbackAction("看清單", buildTpPostbackData("list")),
    ),
    buildSoftActionPill(
      "＋ 新增",
      linePostbackAction("新增", buildTpPostbackData("add_prompt"), {
        inputOption: "openKeyboard",
      }),
      {
        backgroundColor: FLEX_COLORS.paper,
      },
    ),
  ];

  const bubble = buildBaseFlexBubble({
    title: "專注一件",
    subtitle: "目前沒有未完成任務",
    cycleNumber: currentWeek?.cycleNumber,
    headerBadge: buildCircleWeekMeta(currentWeek),
    accentColor: CARD_ACCENTS.draw,
    bodyContents: [
      buildFlexInfoCard(
        [
          {
            type: "text",
            text: "本週任務都完成了。",
            size: "md",
            color: FLEX_COLORS.darkGreen,
            weight: "regular",
            wrap: true,
          },
        ],
        { label: "今天做什麼", emoji: "○" },
      ),
    ],
    footerContents: buildActionPillRow(footerButtons),
  });
  return {
    type: "flex",
    altText: "Tiny Progress｜目前沒有任務可以抽，本週都完成了！",
    contents: bubble,
  };
}

function buildDrawOneTaskFlexMessage({
  currentWeek,
  selectedTask,
  taskNumber,
  unfinishedCount,
}) {
  const bubble = buildBaseFlexBubble({
    title: "專注一件",
    subtitle: `還有 ${unfinishedCount} 件未完成`,
    cycleNumber: currentWeek?.cycleNumber,
    headerBadge: buildCircleWeekMeta(currentWeek),
    accentColor: CARD_ACCENTS.draw,
    bodyContents: [
      buildFlexInfoCard(
        [buildTaskFlexRow({ task: selectedTask, taskNumber })],
        { label: "今天抽到", emoji: "•" },
      ),
    ],
    footerContents: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        buildActionPillRow([
          buildSoftActionPill(
            "完成",
            linePostbackAction(
              "完成",
              buildTpPostbackData("task_done", { id: selectedTask.id }),
            ),
          ),
          buildSoftActionPill(
            "換一件",
            linePostbackAction("換一件", buildTpPostbackData("draw")),
            {
              backgroundColor: FLEX_COLORS.paper,
            },
          ),
          buildSoftActionPill(
            "更多",
            linePostbackAction(
              "更多",
              buildTpPostbackData("task_action", { id: selectedTask.id }),
            ),
            {
              backgroundColor: FLEX_COLORS.paper,
            },
          ),
        ]),
      ],
    },
  });
  return {
    type: "flex",
    altText: `Tiny Progress｜今天抽到：${selectedTask.title}（還有 ${unfinishedCount} 件未完成）`,
    contents: bubble,
  };
}

async function handleDrawOneTaskCommand() {
  const data = await loadWebState();
  return scopeMessages(
    [Cards.draw(data.state, { webUrl: TINY_PROGRESS_WEB_URL })],
    data.state.cycle.number,
  )[0];
}

async function buildAllListFlexMessage({ currentWeek, tasks, standards }) {
  const data = await loadWebState(currentWeek?.cycleNumber);
  return scopeMessages(
    [
      Cards.list(data.state, {
        week: currentWeek?.weekNumber || D.currentWeek(data.state),
        webUrl: TINY_PROGRESS_WEB_URL,
      }),
    ],
    data.state.cycle.number,
  )[0];
}

async function handleAllListFlexCommand() {
  const data = await loadWebState();
  return scopeMessages(
    [Cards.list(data.state, { webUrl: TINY_PROGRESS_WEB_URL })],
    data.state.cycle.number,
  )[0];
}

function buildTaskActionFlexMessage({ currentWeek, task, taskNumber }) {
  return {
    type: "text",
    text: "「" + task.title + "」要做什麼？",
    quickReply: {
      items: [
        ...(!task.done && !task.frequency
          ? [
              buildQuickReplyItem(
                linePostbackAction(
                  "移到其他週",
                  buildTpPostbackData("reschedule_choose", { id: task.id }),
                ),
              ),
            ]
          : []),
        buildQuickReplyItem(
          linePostbackAction(
            task.done ? "復原完成" : "完成",
            buildTpPostbackData(task.done ? "task_undo" : "task_done", {
              id: task.id,
            }),
          ),
        ),
        buildQuickReplyItem(
          linePostbackAction(
            "改名稱",
            buildTpPostbackData("edit_prompt", { id: task.id }),
          ),
        ),
        buildQuickReplyItem(
          linePostbackAction(
            "刪除",
            buildTpPostbackData("delete_preview", { id: task.id }),
          ),
        ),
      ],
    },
  };
}

async function handleTaskActionCommand(numberText) {
  const taskNumber = Number(numberText);
  const board = await getTaskBoardForLine();
  if (
    !Number.isInteger(taskNumber) ||
    taskNumber <= 0 ||
    !board.tasks[taskNumber - 1]
  ) {
    return {
      replyText: "目前找不到這件事情，已重新開啟本週清單。",
      replyMessages: [await buildAllListFlexMessage(board)],
    };
  }

  const task = board.tasks[taskNumber - 1];
  return {
    replyText: `Tiny Progress｜${task.title}｜${task.done ? "已完成" : "未完成"}`,
    replyMessages: [
      buildTaskActionFlexMessage({
        currentWeek: board.currentWeek,
        task,
        taskNumber,
      }),
    ],
  };
}

async function handleTaskDoneClick(numberText, done) {
  const taskNumber = Number(numberText);
  const board = await getTaskBoardForLine();
  if (
    !Number.isInteger(taskNumber) ||
    taskNumber <= 0 ||
    !board.tasks[taskNumber - 1]
  ) {
    return {
      replyText: "目前找不到這件事情，已重新開啟本週清單。",
      replyMessages: [await buildAllListFlexMessage(board)],
    };
  }

  const original = board.tasks[taskNumber - 1];
  const updated = await updateItemToGoogleSheets(original.id, { done });
  return {
    replyText: `${updated.title || original.title}｜${done ? "已完成" : "已改回未完成"}`,
    replyMessages: [
      buildTaskActionFlexMessage({
        currentWeek: board.currentWeek,
        task: updated,
        taskNumber,
      }),
    ],
  };
}

function buildConfirmFlexMessage({
  title,
  subtitle,
  task,
  confirmLabel,
  confirmAction,
  cancelAction,
}) {
  return {
    type: "text",
    text: [title, subtitle, task?.title].filter(Boolean).join("\n"),
    quickReply: {
      items: [
        buildQuickReplyItem(confirmAction),
        buildQuickReplyItem(cancelAction),
      ],
    },
  };
}

function buildStatusMiniCard(title, subtitle, task, actionLabel, action) {
  return {
    type: "text",
    text: [title, subtitle, task?.title].filter(Boolean).join("\n"),
    ...(action ? { quickReply: { items: [buildQuickReplyItem(action)] } } : {}),
  };
}

function buildReasonPromptMessage({ kind, task, targetWeek }) {
  const isDelete = kind === "delete";
  const common = isDelete
    ? ["不需要了", "這週不適合", "改變安排"]
    : ["這週做不完", "優先順序改了", "等待其他事情"];
  const reasonActionName = isDelete ? "delete_reason" : "reschedule_reason";
  const baseParams = { id: task.id };
  if (!isDelete && targetWeek) {
    baseParams.cycle = targetWeek.cycleNumber;
    baseParams.week = targetWeek.weekNumber;
  }
  const items = common.map((reason) =>
    buildQuickReplyItem(
      linePostbackAction(
        reason,
        buildTpPostbackData(reasonActionName, { ...baseParams, reason }),
      ),
    ),
  );
  items.push(
    buildQuickReplyItem(
      linePostbackAction(
        "自己寫",
        buildTpPostbackData("reason_custom", baseParams),
        { inputOption: "openKeyboard" },
      ),
    ),
  );
  items.push(
    buildQuickReplyItem(
      linePostbackAction(
        "取消",
        buildTpPostbackData("pending_cancel", { id: task.id }),
      ),
    ),
  );
  return {
    type: "text",
    text: isDelete
      ? `為什麼要刪除「${task.title}」？\n可以點常用原因，也可以直接在輸入框打。`
      : `為什麼要把「${task.title}」移到 Week ${targetWeek.weekNumber}？\n可以點常用原因，也可以直接在輸入框打。`,
    quickReply: { items },
  };
}

function buildRescheduleChoicesMessage(task, core) {
  const current = core.context.currentWeek;
  const max = Number(
    core.context.maxPlannableWeek || (current && current.weekNumber) || 0,
  );
  const immediateNext = Number(task.scheduledWeekNumber || task.weekNumber) + 1;
  const cycleNumber = Number(task.scheduledCycleNumber || task.cycleNumber);
  const choices = (core.weeks || [])
    .filter((week) => {
      const w = Number(week.weekNumber);
      if (Number(week.cycleNumber) !== cycleNumber) return false;
      if (w === Number(task.scheduledWeekNumber || task.weekNumber))
        return false;
      if (week.archived) return false;
      if (current && w < Number(current.weekNumber)) return false;
      return w <= max || w === immediateNext;
    })
    .slice(0, 12);

  if (!choices.length) {
    return { type: "text", text: "目前沒有可以移動的 Week。" };
  }
  return {
    type: "text",
    text: `把「${task.title}」移到哪一週？`,
    quickReply: {
      items: choices
        .map((week) =>
          buildQuickReplyItem(
            linePostbackAction(
              `Week ${week.weekNumber}`,
              buildTpPostbackData("reschedule_preview", {
                id: task.id,
                cycle: week.cycleNumber,
                week: week.weekNumber,
              }),
            ),
          ),
        )
        .concat([
          buildQuickReplyItem(
            linePostbackAction(
              "取消",
              buildTpPostbackData("pending_cancel", { id: task.id }),
            ),
          ),
        ]),
    },
  };
}

async function createSimpleTaskFromLine(title) {
  const core = await fetchCoreFromGoogleSheets();
  const current = core.context.currentWeek;
  if (!current) throw new Error("目前不在進行中的 Week，不能新增事情");
  return createItemToGoogleSheets({
    type: "task",
    title: String(title || "").trim(),
    category: DEFAULT_CATEGORY,
    subCategory: DEFAULT_SUBCATEGORY,
    cycleNumber: current.cycleNumber,
    weekNumber: current.weekNumber,
    scheduledCycleNumber: current.cycleNumber,
    scheduledWeekNumber: current.weekNumber,
  });
}

async function handleTinyProgressPostback({ sourceKey, rawData }) {
  const data = parseTpPostbackData(rawData);
  const action = data.action || "";

  if (action === "list") return handleAllListFlexCommand();
  if (action === "draw") return handleDrawOneTaskCommand();

  if (action === "task_action") {
    const { task, currentWeek } = await getTaskContextById(data.id);
    if (!task) return handleAllListFlexCommand();
    return {
      replyText: `Tiny Progress｜${task.title}`,
      replyMessages: [
        buildTaskActionFlexMessage({ currentWeek, task, taskNumber: "" }),
      ],
    };
  }

  if (action === "task_done" || action === "task_undo") {
    const done = action === "task_done";
    const { task, currentWeek } = await getTaskContextById(data.id);
    if (!task) return handleAllListFlexCommand();
    let updated;
    if (task.frequency) {
      updated = await gasPost(
        done ? "complete-occurrence" : "correct-occurrence",
        { id: task.id },
      );
    } else {
      updated = await gasPost(done ? "complete-task" : "correct-completion", {
        id: task.id,
      });
    }
    const normalized = normalizeItem(updated);
    return {
      replyText: `${normalized.title}｜${done ? "已完成" : "已改回未完成"}`,
      replyMessages: [
        buildTaskActionFlexMessage({
          currentWeek,
          task: normalized,
          taskNumber: "",
        }),
      ],
    };
  }

  if (action === "add_prompt") {
    await gasPost("line-pending-set", {
      userId: sourceKey,
      pending: { kind: "add_title" },
      ttlSeconds: TP_LINE_PENDING_TTL_SECONDS,
    });
    return {
      type: "text",
      text: "要新增什麼事情？\n直接在輸入框打名稱即可，10 分鐘內有效。",
    };
  }
  if (action === "add_submit") {
    const title = String(data.title || "").trim();
    if (!title) return "事情名稱不能是空白。";
    const created = await createSimpleTaskFromLine(title);
    return {
      replyText: `已新增：${created.title}`,
      replyMessages: [
        buildTaskActionFlexMessage({
          currentWeek: (await fetchWeekContextFromGoogleSheets()).currentWeek,
          task: created,
          taskNumber: "",
        }),
      ],
    };
  }

  if (action === "edit_prompt") {
    const { task } = await getTaskContextById(data.id);
    if (!task) return "找不到這件事情。";
    await gasPost("line-pending-set", {
      userId: sourceKey,
      pending: { kind: "edit_title", id: task.id },
      ttlSeconds: TP_LINE_PENDING_TTL_SECONDS,
    });
    return {
      type: "text",
      text: `要把「${task.title}」改成什麼？\n直接輸入新的名稱，或輸入「取消」。`,
    };
  }
  if (action === "edit_submit") {
    const title = String(data.title || "").trim();
    const updated = await updateItemToGoogleSheets(data.id, { title });
    return {
      replyText: `已修改：${updated.title}`,
      replyMessages: [
        buildTaskActionFlexMessage({
          currentWeek: (await fetchWeekContextFromGoogleSheets()).currentWeek,
          task: updated,
          taskNumber: "",
        }),
      ],
    };
  }

  if (action === "delete_preview") {
    const { task } = await getTaskContextById(data.id);
    if (!task) return "找不到這件事情。";
    return {
      replyText: `確定刪除「${task.title}」？`,
      replyMessages: [
        buildConfirmFlexMessage({
          title: "確認刪除",
          subtitle: "刪除後會留下原因與紀錄",
          task,
          confirmLabel: "確定",
          confirmAction: linePostbackAction(
            "確定",
            buildTpPostbackData("delete_reason_prompt", { id: task.id }),
            { inputOption: "openKeyboard" },
          ),
          cancelAction: linePostbackAction(
            "取消",
            buildTpPostbackData("pending_cancel", { id: task.id }),
          ),
        }),
      ],
    };
  }
  if (action === "delete_reason_prompt") {
    const { task } = await getTaskContextById(data.id);
    if (!task) return "找不到這件事情。";
    await gasPost("line-pending-set", {
      userId: sourceKey,
      pending: { kind: "delete_reason", id: task.id },
      ttlSeconds: TP_LINE_PENDING_TTL_SECONDS,
    });
    return {
      replyText: "請選或輸入刪除原因",
      replyMessages: [buildReasonPromptMessage({ kind: "delete", task })],
    };
  }
  if (action === "delete_reason") {
    const reason = String(data.reason || "").trim();
    const deleted = normalizeItem(
      await gasPost("cancel-task", { id: data.id, reason }),
    );
    await gasPost("line-pending-clear", { userId: sourceKey });
    return {
      replyText: `已刪除：${deleted.title}`,
      replyMessages: [
        buildStatusMiniCard(
          "已刪除",
          `原因：${reason}`,
          deleted,
          "復原",
          linePostbackAction(
            "復原",
            buildTpPostbackData("task_restore", { id: deleted.id }),
          ),
        ),
      ],
    };
  }
  if (action === "task_restore") {
    const restored = normalizeItem(
      await gasPost("restore-cancelled-task", { id: data.id }),
    );
    return {
      replyText: `已復原：${restored.title}`,
      replyMessages: [
        buildStatusMiniCard("已復原", "事情已回到原本的 Week", restored),
      ],
    };
  }

  if (action === "reschedule_choose") {
    const { core, task } = await getTaskContextById(data.id);
    if (!task) return "找不到這件事情。";
    return {
      replyText: `選擇「${task.title}」要移到的 Week`,
      replyMessages: [buildRescheduleChoicesMessage(task, core)],
    };
  }
  if (action === "reschedule_preview") {
    const { core, task } = await getTaskContextById(data.id);
    if (!task) return "找不到這件事情。";
    const targetWeek = (core.weeks || []).find(
      (w) =>
        Number(w.cycleNumber) === Number(data.cycle) &&
        Number(w.weekNumber) === Number(data.week),
    );
    if (!targetWeek) return "找不到目標 Week。";
    return {
      replyText: `確定移到 Week ${targetWeek.weekNumber}？`,
      replyMessages: [
        buildConfirmFlexMessage({
          title: "確認移動",
          subtitle: `移到 Week ${targetWeek.weekNumber}`,
          task,
          confirmLabel: "確定",
          confirmAction: linePostbackAction(
            "確定",
            buildTpPostbackData("reschedule_reason_prompt", {
              id: task.id,
              cycle: targetWeek.cycleNumber,
              week: targetWeek.weekNumber,
            }),
            { inputOption: "openKeyboard" },
          ),
          cancelAction: linePostbackAction(
            "取消",
            buildTpPostbackData("pending_cancel", { id: task.id }),
          ),
        }),
      ],
    };
  }
  if (action === "reschedule_reason_prompt") {
    const { core, task } = await getTaskContextById(data.id);
    if (!task) return "找不到這件事情。";
    const targetWeek = (core.weeks || []).find(
      (w) =>
        Number(w.cycleNumber) === Number(data.cycle) &&
        Number(w.weekNumber) === Number(data.week),
    );
    if (!targetWeek) return "找不到目標 Week。";
    await gasPost("line-pending-set", {
      userId: sourceKey,
      pending: {
        kind: "reschedule_reason",
        id: task.id,
        cycle: targetWeek.cycleNumber,
        week: targetWeek.weekNumber,
      },
      ttlSeconds: TP_LINE_PENDING_TTL_SECONDS,
    });
    return {
      replyText: "請選或輸入調整原因",
      replyMessages: [
        buildReasonPromptMessage({ kind: "reschedule", task, targetWeek }),
      ],
    };
  }
  if (action === "reschedule_reason") {
    const reason = String(data.reason || "").trim();
    const moved = normalizeItem(
      await gasPost("reschedule-task", {
        id: data.id,
        target: {
          cycleNumber: Number(data.cycle),
          weekNumber: Number(data.week),
        },
        reason,
      }),
    );
    await gasPost("line-pending-clear", { userId: sourceKey });
    return {
      replyText: `已移到 Week ${moved.scheduledWeekNumber}`,
      replyMessages: [
        buildStatusMiniCard(
          "已移動",
          `Week ${moved.scheduledWeekNumber} · ${reason}`,
          moved,
        ),
      ],
    };
  }

  if (action === "reason_custom")
    return {
      type: "text",
      text: "直接在輸入框寫原因即可。輸入「取消」可以中止。",
    };
  if (action === "pending_cancel") {
    await gasPost("line-pending-clear", { userId: sourceKey });
    return { type: "text", text: "已取消，資料沒有變動。" };
  }

  return getUnknownCommandText();
}

function buildLineTextMessage(text) {
  return {
    type: "text",
    text: String(text || "目前沒有可回覆的內容。"),
  };
}

function getFallbackTextFromReplyMessages(replyMessages) {
  const textMessage = replyMessages.find(
    (message) => message && message.type === "text" && message.text,
  );
  if (textMessage) return textMessage.text;

  const flexMessage = replyMessages.find(
    (message) => message && message.type === "flex" && message.altText,
  );
  if (flexMessage) return flexMessage.altText;

  return "Tiny Progress 已回覆。";
}

function normalizeLineReplyResult(replyResult) {
  if (
    replyResult &&
    typeof replyResult === "object" &&
    typeof replyResult.type === "string"
  ) {
    return {
      replyText:
        replyResult.text || replyResult.altText || "Tiny Progress 已回覆。",
      replyMessages: [replyResult],
    };
  }

  if (
    replyResult &&
    typeof replyResult === "object" &&
    Array.isArray(replyResult.replyMessages)
  ) {
    const replyMessages = replyResult.replyMessages;
    return {
      replyText:
        replyResult.replyText ||
        getFallbackTextFromReplyMessages(replyMessages),
      replyMessages,
    };
  }

  if (Array.isArray(replyResult)) {
    return {
      replyText: getFallbackTextFromReplyMessages(replyResult),
      replyMessages: replyResult,
    };
  }

  const replyText = String(
    replyResult || "Tiny Progress 目前沒有可回覆的內容。",
  );
  return {
    replyText,
    replyMessages: [buildLineTextMessage(replyText)],
  };
}

async function replyToLine(replyToken, replyResult) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.error("缺少 LINE_CHANNEL_ACCESS_TOKEN，無法回覆 LINE 訊息");
    return;
  }

  const normalizedReply = normalizeLineReplyResult(replyResult);

  const lineResponse = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: normalizedReply.replyMessages,
    }),
  });

  if (!lineResponse.ok) {
    console.error(
      "LINE Reply API 回覆失敗：",
      lineResponse.status,
      await lineResponse.text(),
    );
  }
}

function getGuideText() {
  return [
    "Tiny Progress｜LINE 快速操作",
    "",
    "主要操作都直接點卡片：",
    "• 本週清單：看狀態、進入事情操作",
    "• 抽一件：完成、換一件、更多",
    "• 事情：完成／改回未完成",
    "",
    "新增、改內容、刪除原因會直接開 Tiny Progress 網頁處理。",
    "週一與週日會另外收到主動推播。",
    "",
    "如果卡片沒有顯示，也可以輸入「清單」或「抽一件」重新叫出來。",
  ].join("\\n");
}

async function handleGuideCommand() {
  return getGuideText();
}

function parseCreateText({ userText, command }) {
  let rawText = userText.replace(new RegExp(`^${command}\\s*`), "").trim();
  rawText = rawText.replace(/^[：:]/, "").trim();

  if (!rawText) {
    return {
      title: "",
      category: DEFAULT_CATEGORY,
      subCategory: DEFAULT_SUBCATEGORY,
    };
  }

  const parts = rawText
    .split(/\s*[\/｜|，,、]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  const title = parts[0] || "";
  const category = parts[1] || DEFAULT_CATEGORY;
  let subCategory = DEFAULT_SUBCATEGORY;

  if (normalizeCategory(category) === "程式學習") {
    subCategory = parts[2] || DEFAULT_SUBCATEGORY;
  } else {
    subCategory = EMPTY_SUBCATEGORY;
  }

  return { title, category, subCategory };
}

async function handleCreateCommand({
  userText,
  command,
  type,
  label,
  example,
}) {
  const parsed = parseCreateText({ userText, command });
  const displayLabel = getDisplayLabel(label);

  if (!parsed.title) {
    return [
      `這次加入還缺少${displayLabel}內容，資料沒有變動。`,
      "",
      `例：${command} ${example}`,
    ].join("\n");
  }

  let category;
  let subCategory;

  try {
    category = normalizeCategory(parsed.category);
    subCategory = normalizeSubCategory(parsed.subCategory, category);
  } catch (error) {
    return [
      "分類或子分類需要再確認，資料沒有變動。",
      "",
      error.message,
      "",
      "例：新增任務 練習 CSS｜程式學習｜練習",
    ].join("\n");
  }

  const currentWeekNumber = await getCurrentWeekNumberFromGoogleSheets();
  const createdItem = await createItemToGoogleSheets({
    type,
    title: parsed.title,
    category,
    subCategory,
    weekNumber: currentWeekNumber,
  });

  if (type === "task") {
    return [
      "Tiny Progress 已加入：",
      `☐ ${createdItem.title || parsed.title}`,
      `分類：${getTaskMetaText(createdItem)}`,
      "",
      "若要新增驗收標準，可輸入：",
      "新增標準 本週能說明一個學到的觀念",
      "",
      "可以輸入「清單」查看目前清單。",
    ].join("\n");
  }

  return [
    "Tiny Progress 已新增本週驗收標準：",
    `☐ ${createdItem.title || parsed.title}`,
    "",
    "可以輸入「清單」查看目前清單。",
  ].join("\n");
}

async function findItemByNumber({ type, numberText, label }) {
  const itemNumber = Number(numberText);
  const displayLabel = getDisplayLabel(label);

  if (!Number.isInteger(itemNumber) || itemNumber <= 0) {
    return {
      error: [
        `還缺少正確的${displayLabel}編號，資料沒有變動。`,
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
        `目前找不到第 ${itemNumber} 個${displayLabel}。`,
        "",
        "可以先輸入「清單」確認編號。",
      ].join("\n"),
    };
  }

  return { itemNumber, item: targetItem, items };
}

async function handleDoneCommand({ numberText, type, label, done }) {
  const result = await findItemByNumber({ type, numberText, label });
  if (result.error) return result.error;

  const updatedItem = await updateItemToGoogleSheets(result.item.id, { done });
  const checkbox = done ? "☑" : "☐";
  const actionText = done ? "已完成" : "已恢復未完成";
  const displayLabel = getDisplayLabel(label);

  return [
    `${actionText}第 ${result.itemNumber} 個${displayLabel}：`,
    `${checkbox} ${updatedItem.title || result.item.title}`,
    "",
    "Tiny Progress",
  ].join("\n");
}

async function handleDeleteCommand({ numberText, type, label }) {
  const result = await findItemByNumber({ type, numberText, label });
  if (result.error) return result.error;
  if (type !== "task") return "這個內容請到 Tiny Progress 網頁處理。";
  return {
    replyText: `確定刪除「${result.item.title}」？`,
    replyMessages: [
      buildConfirmFlexMessage({
        title: "確認刪除",
        subtitle: "刪除後會留下原因與紀錄",
        task: result.item,
        confirmLabel: "確定",
        confirmAction: linePostbackAction(
          "確定",
          buildTpPostbackData("delete_reason_prompt", { id: result.item.id }),
          { inputOption: "openKeyboard" },
        ),
        cancelAction: linePostbackAction(
          "取消",
          buildTpPostbackData("pending_cancel", { id: result.item.id }),
        ),
      }),
    ],
  };
}

async function handleEditCommand({ numberText, newTitle, type, label }) {
  const result = await findItemByNumber({ type, numberText, label });
  if (result.error) return result.error;

  const displayLabel = getDisplayLabel(label);

  if (newTitle && newTitle.trim()) {
    const updatedItem = await updateItemToGoogleSheets(result.item.id, {
      title: newTitle.trim(),
    });
    return [
      `已修改第 ${result.itemNumber} 個${displayLabel}：`,
      updatedItem.title || newTitle.trim(),
      "",
      "已更新內容。",
    ].join("\\n");
  }

  if (type === "task") {
    return handleTaskActionCommand(numberText);
  }

  return "這個內容請到 Tiny Progress 網頁調整。";
}

function parseFlexibleNumber(numberText) {
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

function buildLineOperationCommand(
  actionText,
  targetText,
  numberText,
  newTitle,
) {
  const number = parseFlexibleNumber(numberText);

  if (!Number.isInteger(number) || number <= 0) {
    return {
      error: "還缺少正確編號，資料沒有變動。可以這樣輸入：完成第 3 個任務",
    };
  }

  const isTask = targetText.includes("任務");
  const actionMap = {
    完成: "done",
    已完成: "done",
    取消: "cancel",
    修改: "edit",
    刪除: "delete",
  };

  return {
    action: actionMap[actionText],
    numberText: String(number),
    newTitle,
    type: isTask ? "task" : "standard",
    label: isTask ? "任務" : "完成標準",
  };
}

function parseLineOperationCommand(userText) {
  let match = userText.match(
    /^(完成|已完成|取消|修改|刪除)\s*(任務|完成標準|標準)\s*(\d+|[零一二三四五六七八九十兩]+)(?:\s+(.+))?$/,
  );
  if (match)
    return buildLineOperationCommand(match[1], match[2], match[3], match[4]);

  match = userText.match(
    /^(完成|已完成|取消|修改|刪除)\s*第?\s*(\d+|[零一二三四五六七八九十兩]+)\s*個?\s*(任務|完成標準|標準)(?:\s+(.+))?$/,
  );
  if (match)
    return buildLineOperationCommand(match[1], match[3], match[2], match[4]);

  return null;
}

function getFormatReminderText() {
  return [
    "這個操作可以直接用 LINE 卡片按鈕完成。",
    "",
    "輸入「清單」可以重新叫出本週清單，",
    "輸入「抽一件」可以重新抽一件。",
  ].join("\n");
}

function getUnknownCommandText() {
  return [
    "Tiny Progress 目前看不懂這個訊息，資料沒有變動。",
    "",
    "可以輸入「清單」或「抽一件」重新叫出卡片。",
  ].join("\n");
}

async function handleLineTextCommand({ sourceKey, userText }) {
  if (String(userText || "").startsWith(TP_POSTBACK_PREFIX)) {
    return handleTinyProgressPostback({
      sourceKey,
      rawData: String(userText).slice(TP_POSTBACK_PREFIX.length),
    });
  }
  if (["攻略", "說明", "help", "Help"].includes(userText))
    return handleGuideCommand();
  if (["抽一件", "抽任務", "隨機任務", "今天做什麼"].includes(userText))
    return handleDrawOneTaskCommand();
  if (userText === "清單" || userText === "全部清單")
    return handleAllListFlexCommand();

  // 舊的難度文字指令（簡單／適中／困難）已無難度分類，入口保留相容，一律回到同一張本週清單。
  if (
    ["簡單任務", "簡單", "適中任務", "適中", "困難任務", "困難"].includes(
      userText,
    )
  ) {
    return handleAllListFlexCommand();
  }

  let actionMatch = userText.match(/^操作任務\s*(\d+)$/);
  if (actionMatch) return handleTaskActionCommand(actionMatch[1]);

  actionMatch = userText.match(/^改回未完成任務\s*(\d+)$/);
  if (actionMatch) return handleTaskDoneClick(actionMatch[1], false);

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
    if (operation.error) return operation.error;
    if (operation.type === "task" && operation.action === "done")
      return handleTaskDoneClick(operation.numberText, true);
    if (operation.type === "task" && operation.action === "cancel")
      return handleTaskDoneClick(operation.numberText, false);
    if (operation.action === "done")
      return handleDoneCommand({
        numberText: operation.numberText,
        type: operation.type,
        label: operation.label,
        done: true,
      });
    if (operation.action === "cancel")
      return handleDoneCommand({
        numberText: operation.numberText,
        type: operation.type,
        label: operation.label,
        done: false,
      });
    if (operation.action === "edit")
      return handleEditCommand({
        sourceKey,
        numberText: operation.numberText,
        newTitle: operation.newTitle,
        type: operation.type,
        label: operation.label,
      });
    if (operation.action === "delete")
      return handleDeleteCommand({
        numberText: operation.numberText,
        type: operation.type,
        label: operation.label,
      });
  }

  if (
    [
      "完成",
      "已完成",
      "取消",
      "修改",
      "刪除",
      "新增",
      "操作",
      "改回未完成",
    ].some((prefix) => userText.startsWith(prefix))
  ) {
    return getFormatReminderText();
  }

  return getUnknownCommandText();
}

// ==================== HTTP API ====================

app.get("/", (req, res) => {
  res.send("Tiny Progress API is ready ⭐");
});

app.post("/gas-queue", async (req, res) => {
  try {
    const { source, queueId, userId, messageText } = req.body || {};
    if (source !== "gas_queue")
      return res
        .status(400)
        .json({ ok: false, message: "source 必須是 gas_queue" });
    if (!queueId || !userId)
      return res
        .status(400)
        .json({ ok: false, message: "缺少 queueId 或 userId" });
    if (String(userId).trim() !== ACCESS.owner)
      return res.status(403).json({ ok: false, message: "LINE 使用者未授權" });
    const userText = String(messageText || "").trim();
    if (!userText)
      return res.status(400).json({ ok: false, message: "缺少 messageText" });
    const replyResult = await routeLineCommand({
      sourceKey: String(userId).trim(),
      userText,
      eventId: String(queueId),
    });
    const normalizedReply = normalizeLineReplyResult(replyResult);
    res.json({
      ok: true,
      queueId,
      replyText: normalizedReply.replyText,
      replyMessages: normalizedReply.replyMessages,
    });
  } catch (error) {
    console.error("處理 /gas-queue 發生錯誤：", error);
    res.status(500).json({
      ok: false,
      message: "處理 GAS queue 訊息失敗",
      error: error.message,
    });
  }
});

// LINE Webhook 需要快速回應 200。既有的 GAS line-ingress 會建立持久 queue、
// 呼叫 /gas-queue 處理指令、最後向 LINE reply / push，因此不能讓 LINE 等它跑完。
// 這裡的記憶體暫存僅是「成功寫入 GAS queue 前」的短暫緩衝；Render 重新啟動時
// 可能遺失，正式要求零遺失時須再改為獨立持久佇列。
const LINE_INGRESS_RETRY_DELAYS_MS = [0, 2000, 5000, 15000];
const LINE_INGRESS_MAX_PENDING = 100;
const lineIngressPending = new Map();

function lineWebhookEventKey(event) {
  return String(event.webhookEventId || event.replyToken || "").trim() ||
    crypto.createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

function enqueueLineWebhookEvents(events) {
  const fresh = [];
  const inBatch = new Set();
  for (const event of events) {
    const key = lineWebhookEventKey(event);
    if (inBatch.has(key) || lineIngressPending.has(key)) continue;
    inBatch.add(key);
    fresh.push({ key, event });
  }
  // 先確認空間足夠再加入，以免一批事件只接受一半。
  if (lineIngressPending.size + fresh.length > LINE_INGRESS_MAX_PENDING)
    return false;
  for (const item of fresh) lineIngressPending.set(item.key, item.event);
  for (const item of fresh) {
    // 不 await：簽章已由 access.js 驗證，先讓 LINE 收到 HTTP 200。
    dispatchLineWebhookEvent(item.key, item.event).catch((error) => {
      console.error("[line-webhook] 背景處理異常：", error.message);
    });
  }
  return true;
}

async function dispatchLineWebhookEvent(key, event) {
  try {
    for (let attempt = 0; attempt < LINE_INGRESS_RETRY_DELAYS_MS.length; attempt++) {
      const delay = LINE_INGRESS_RETRY_DELAYS_MS[attempt];
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const result = await gasPostWithTimeout("line-ingress", { events: [event] }, 55000);
        console.log(
          `[line-webhook] 已交給 GAS；event=${key.slice(0, 12)}；處理=${Number(result?.processedCount || 0)}`,
        );
        return;
      } catch (error) {
        console.warn(
          `[line-webhook] GAS 轉送失敗 (${attempt + 1}/${LINE_INGRESS_RETRY_DELAYS_MS.length})；event=${key.slice(0, 12)}；${error.message}`,
        );
      }
    }
    console.error(
      `[line-webhook] 已達重試上限；event=${key.slice(0, 12)}。請檢查 GAS queue 與 Render Logs。`,
    );
  } finally {
    lineIngressPending.delete(key);
  }
}

app.post("/line/webhook", (req, res) => {
  if (!Array.isArray(req.body?.events))
    return res.status(400).json({ message: "events 格式不正確" });
  const events = req.body.events.filter(
    (e) => e && e.source?.type === "user" && e.source.userId === ACCESS.owner,
  );
  // LINE Developers 的 Verify 通常使用空 events，必須直接回應 200。
  if (!enqueueLineWebhookEvents(events)) {
    console.error("[line-webhook] 暫存已滿，要求 LINE 重送");
    return res.status(503).json({ message: "目前繁忙，請稍後重送" });
  }
  res.status(200).json({ ok: true });
});

app.get("/core", async (req, res) => {
  try {
    res.json(await fetchCoreFromGoogleSheets());
  } catch (error) {
    res.status(500).json({ message: "讀取核心資料失敗", error: error.message });
  }
});

app.get("/week-context", async (req, res) => {
  try {
    res.json(await fetchWeekContextFromGoogleSheets());
  } catch (error) {
    res.status(500).json({ message: "讀取週次資料失敗", error: error.message });
  }
});

app.get("/weeks", async (req, res) => {
  try {
    res.json((await gasGet("weeks")).weeks || []);
  } catch (error) {
    res.status(500).json({ message: "讀取 Weeks 失敗", error: error.message });
  }
});

app.get("/cycles", async (req, res) => {
  try {
    res.json((await gasGet("cycles")).cycles || []);
  } catch (error) {
    res.status(500).json({ message: "讀取 Cycles 失敗", error: error.message });
  }
});

app.patch("/weeks/current-plan", async (req, res) => {
  try {
    res.json(await gasPost("update-current-week-plan", req.body || {}));
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "更新本週主題失敗", error: error.message });
  }
});

app.patch("/weeks/:cycleNumber/:weekNumber/plan", async (req, res) => {
  try {
    res.json(
      await gasPost("update-week-plan", {
        cycleNumber: Number(req.params.cycleNumber),
        weekNumber: Number(req.params.weekNumber),
        ...(req.body || {}),
      }),
    );
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "儲存安排失敗", error: error.message });
  }
});

app.post("/weeks/postpone-current", async (req, res) => {
  try {
    res.json(await gasPost("postpone-current-week", req.body || {}));
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "本週順延失敗", error: error.message });
  }
});

// 舊前端相容入口：V2 不再手動結案。
app.post("/weeks/complete-current", (req, res) => {
  res
    .status(409)
    .json({ message: "Week 會依日期自動前進，不需要手動完成整週。" });
});

app.post("/cycles", async (req, res) => {
  try {
    res.status(201).json(await gasPost("create-cycle", req.body || {}));
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "建立 Cycle 失敗", error: error.message });
  }
});

app.patch("/cycles/:cycleNumber/theme", async (req, res) => {
  try {
    res.json(
      await gasPost("update-cycle-theme", {
        cycleNumber: Number(req.params.cycleNumber),
        theme: String(req.body?.theme || "").trim(),
      }),
    );
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "更新本輪主題失敗", error: error.message });
  }
});

app.patch("/cycles/:cycleNumber/start-date", async (req, res) => {
  try {
    res.json(
      await gasPost("change-cycle-start", {
        cycleNumber: Number(req.params.cycleNumber),
        ...(req.body || {}),
      }),
    );
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "修改 Cycle 開始日期失敗", error: error.message });
  }
});

app.get("/items", async (req, res) => {
  try {
    res.json(await fetchItemsFromGoogleSheets());
  } catch (error) {
    res.status(500).json({ message: "讀取任務失敗", error: error.message });
  }
});

app.post("/items", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title) return res.status(400).json({ message: "title 必填" });
    const created = await createItemToGoogleSheets({
      type: body.type || "task",
      ...body,
    });
    res.status(201).json(created);
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "新增任務失敗", error: error.message });
  }
});

app.patch("/items/:id", async (req, res) => {
  try {
    res.json(await updateItemToGoogleSheets(req.params.id, req.body || {}));
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "更新任務失敗", error: error.message });
  }
});

app.delete("/items/:id/draft", async (req, res) => {
  try {
    const result = await gasPost("remove-draft-task", { id: req.params.id });
    res.json({ message: "草稿任務已移除", ...(result || {}) });
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "移除草稿任務失敗", error: error.message });
  }
});

app.post("/items/:id/complete", async (req, res) => {
  try {
    res.json(
      normalizeItem(await gasPost("complete-task", { id: req.params.id })),
    );
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "完成任務失敗", error: error.message });
  }
});

app.post("/items/:id/correct-completion", async (req, res) => {
  try {
    res.json(
      normalizeItem(await gasPost("correct-completion", { id: req.params.id })),
    );
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "更正完成狀態失敗", error: error.message });
  }
});

app.post("/items/:id/cancel", async (req, res) => {
  try {
    res.json(
      normalizeItem(
        await gasPost("cancel-task", {
          id: req.params.id,
          ...(req.body || {}),
        }),
      ),
    );
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "刪除任務失敗", error: error.message });
  }
});

app.post("/items/:id/delete", async (req, res) => {
  try {
    res.json(
      normalizeItem(
        await gasPost("cancel-task", {
          id: req.params.id,
          ...(req.body || {}),
        }),
      ),
    );
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "刪除任務失敗", error: error.message });
  }
});

app.post("/items/:id/reschedule", async (req, res) => {
  try {
    res.json(
      normalizeItem(
        await gasPost("reschedule-task", {
          id: req.params.id,
          ...(req.body || {}),
        }),
      ),
    );
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "調整時間失敗", error: error.message });
  }
});

app.post("/items/:id/replan", async (req, res) => {
  try {
    const result = await gasPost("replan-task", {
      id: req.params.id,
      ...(req.body || {}),
    });
    res.json({
      original: normalizeItem(result?.original || {}),
      newTasks: (result?.newTasks || []).map(normalizeItem),
    });
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "重新整理失敗", error: error.message });
  }
});

app.delete("/items/:id", async (req, res) => {
  try {
    const item = await deleteItemFromGoogleSheets(req.params.id);
    res.json({ message: "任務已刪除並保留紀錄", id: item.id, item });
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "刪除任務失敗", error: error.message });
  }
});

app.get("/categories", async (req, res) => {
  try {
    res.json((await gasGet("categories")).categories || []);
  } catch (error) {
    res.status(500).json({ message: "讀取分類失敗", error: error.message });
  }
});

app.post("/categories", async (req, res) => {
  try {
    res
      .status(201)
      .json(await gasPost("create-category", { category: req.body || {} }));
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "新增分類失敗", error: error.message });
  }
});

app.patch("/categories/:id", async (req, res) => {
  try {
    res.json(
      await gasPost("update-category", {
        id: req.params.id,
        updates: req.body || {},
      }),
    );
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "更新分類失敗", error: error.message });
  }
});

app.get("/history", async (req, res) => {
  try {
    res.json((await gasGet("history")).history || []);
  } catch (error) {
    res
      .status(500)
      .json({ message: "讀取 History 失敗", error: error.message });
  }
});

app.get("/reviews/:cycleNumber", async (req, res) => {
  try {
    res.json(
      (await gasGet("review", { cycleNumber: Number(req.params.cycleNumber) }))
        .review,
    );
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "讀取 Cycle 總結失敗", error: error.message });
  }
});

app.get("/retrospectives", async (req, res) => {
  try {
    res.json((await gasGet("retrospectives")).retrospectives || []);
  } catch (error) {
    res
      .status(500)
      .json({ message: "讀取 Weekly Review 失敗", error: error.message });
  }
});

app.post("/retrospectives", async (req, res) => {
  try {
    res.json(await gasPost("submit-retrospective", { retro: req.body || {} }));
  } catch (error) {
    res
      .status(getApiErrorStatus(error))
      .json({ message: "送出 Weekly Review 失敗", error: error.message });
  }
});

if (require.main === module)
  app.listen(PORT, () => {
    console.log(`Tiny Progress V2 後端啟動：http://localhost:${PORT}`);
    startQueueRetryScheduler();
  });
module.exports = {
  app,
  gasPost,
  gasGet,
  loadWebState,
  routeLineCommand,
  scopeMessages,
};

async function loadWebState(cycle) {
  const data = await gasPost("web-read", { cycle });
  const before = JSON.stringify(data.state);
  D.advance(data.state);
  if (before !== JSON.stringify(data.state))
    return gasPost("web-save", {
      state: data.state,
      expectedRevision: data.revision,
      mutationId: crypto.randomUUID(),
    });
  return data;
}
function scopeMessages(messages, cycle) {
  for (const msg of messages) {
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "postback" && node.data) {
        const p = new URLSearchParams(node.data);
        if (p.has("a")) {
          p.set("cycle", cycle);
          node.data = p.toString();
        }
      }
      for (const v of Object.values(node))
        if (v && typeof v === "object")
          Array.isArray(v) ? v.forEach(walk) : walk(v);
    };
    walk(msg);
  }
  return messages;
}
async function routeLineCommand(input) {
  return LINE_CONTEXT.run({ id: input.eventId, seq: 0 }, () =>
    tpRouteLineCommand(input),
  );
}
async function tpRouteLineCommand({ sourceKey, userText, eventId }) {
  const postback = userText.startsWith(TP_POSTBACK_PREFIX)
    ? userText.slice(TP_POSTBACK_PREFIX.length)
    : null;
  const params = postback ? new URLSearchParams(postback) : null;
  if (params && !params.has("a"))
    return handleLineTextCommand({ sourceKey, userText });
  const commands = [
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
  ];
  const data = await gasPost("line-state-read", { eventId });
  if (data.cached) return data.cached;
  if (
    !params &&
    !commands.includes(userText) &&
    !data.state._pending?.[sourceKey]
  )
    return handleLineTextCommand({ sourceKey, userText });
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = attempt
      ? await gasPost("line-state-read", { eventId })
      : data;
    if (current.cached) return current.cached;
    let next = D.clone(current.state),
      messages;
    try {
      if (
        params?.has("cycle") &&
        Number(params.get("cycle")) !== next.cycle.number
      )
        D.fail("這是上一輪卡片，請重新輸入「清單」");
      messages = Bot.respond(
        next,
        {
          source: { type: "user", userId: sourceKey },
          ...(params
            ? { postback: { data: postback } }
            : {
                message: { text: userText === "全部清單" ? "清單" : userText },
              }),
        },
        { webUrl: TINY_PROGRESS_WEB_URL },
      );
      D.validate(next);
    } catch (e) {
      next = D.clone(current.state);
      messages = [
        Cards.quick(e.status ? e.message : "操作暫時失敗，請重新查看清單", [
          { label: "看本週", a: "list" },
        ]),
      ];
    }
    scopeMessages(messages, next.cycle.number);
    try {
      return await gasPost("line-state-save", {
        state: next,
        expectedRevision: current.revision,
        eventId,
        messages,
      });
    } catch (e) {
      if (e.status !== 409 || attempt === 2) throw e;
    }
  }
}
