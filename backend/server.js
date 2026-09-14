require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

const GOOGLE_SHEETS_API_URL = process.env.GOOGLE_SHEETS_API_URL;
const GOOGLE_SHEETS_API_SECRET = process.env.GOOGLE_SHEETS_API_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// 把你自己的 Tiny Progress 網頁網址貼在下面。
// 例如：https://你的網站網址
const TINY_PROGRESS_WEB_URL = "https://micole-hub.github.io/tiny-progress/";

const pendingActions = new Map();
const PENDING_ACTION_TTL_MS = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingActions.entries()) {
    if (now - val.createdAt > PENDING_ACTION_TTL_MS) pendingActions.delete(key);
  }
}, 5 * 60 * 1000);

// 保留做 LINE 卡片排序與預設顯示，不再當成分類白名單。
const CATEGORY_OPTIONS = ["程式學習", "身心穩定", "興趣探索"];
const SUBCATEGORY_OPTIONS = ["觀看課程影片", "練習", "寫筆記", "W3Schools", "freeCodeCamp", "Vibe Coding"];
const DIFFICULTY_OPTIONS = ["簡單", "適中", "困難"];
const DEFAULT_CATEGORY = "程式學習";
const DEFAULT_SUBCATEGORY = "觀看課程影片";
const EMPTY_SUBCATEGORY = "未分類";
const DEFAULT_DIFFICULTY = "適中";

if (!GOOGLE_SHEETS_API_URL) throw new Error("缺少環境變數 GOOGLE_SHEETS_API_URL");
if (!GOOGLE_SHEETS_API_SECRET) throw new Error("缺少環境變數 GOOGLE_SHEETS_API_SECRET");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function normalizeCategory(value) {
  return String(value || "").trim() || DEFAULT_CATEGORY;
}

function normalizeSubCategory(value, category = DEFAULT_CATEGORY) {
  const sub = String(value || "").trim();
  if (sub) return sub;
  return normalizeCategory(category) === DEFAULT_CATEGORY ? DEFAULT_SUBCATEGORY : EMPTY_SUBCATEGORY;
}

function normalizeDifficulty(value) {
  const difficulty = String(value || "").trim() || DEFAULT_DIFFICULTY;
  if (!DIFFICULTY_OPTIONS.includes(difficulty)) {
    throw new Error("difficulty 只能是：" + DIFFICULTY_OPTIONS.join("、"));
  }
  return difficulty;
}

function normalizeDone(value) {
  return value === true || String(value).toUpperCase() === "TRUE";
}

function getApiErrorStatus(error) {
  const message = String((error && error.message) || "");
  if (/必填|只能是|不存在|找不到|無效|不能|已經/.test(message)) return 400;
  if (/已封存|已完成/.test(message)) return 409;
  return 500;
}

function normalizeItem(item) {
  const safe = item || {};
  const status = String(safe.status || (normalizeDone(safe.done) ? "completed" : "active"));
  return {
    ...safe,
    id: String(safe.id || "").trim(),
    type: String(safe.type || "task").trim(),
    title: String(safe.title || "").trim(),
    categoryId: String(safe.categoryId || "").trim(),
    subCategoryId: String(safe.subCategoryId || "").trim(),
    category: normalizeCategory(safe.category),
    subCategory: normalizeSubCategory(safe.subCategory, safe.category),
    difficulty: normalizeDifficulty(safe.difficulty),
    status,
    done: status === "completed" || normalizeDone(safe.done),
    cycleNumber: Number(safe.cycleNumber || safe.scheduledCycleNumber || 1),
    weekNumber: Number(safe.weekNumber || safe.scheduledWeekNumber || 1),
    originalCycleNumber: Number(safe.originalCycleNumber || safe.cycleNumber || 1),
    originalWeekNumber: Number(safe.originalWeekNumber || safe.weekNumber || 1),
    scheduledCycleNumber: Number(safe.scheduledCycleNumber || safe.cycleNumber || 1),
    scheduledWeekNumber: Number(safe.scheduledWeekNumber || safe.weekNumber || 1),
    weekStart: safe.weekStart || "",
    weekEnd: safe.weekEnd || "",
    completedAt: safe.completedAt || "",
    cancelledAt: safe.cancelledAt || "",
    cancelReason: safe.cancelReason || "",
    cancelNote: safe.cancelNote || "",
    replannedAt: safe.replannedAt || "",
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
    if (categoryA !== categoryB) return categoryA.localeCompare(categoryB, "zh-Hant");
    return getSubCategorySortIndex(a.subCategory) - getSubCategorySortIndex(b.subCategory);
  });
}

function buildGoogleSheetsResourceUrl(resource, params = {}) {
  const url = new URL(GOOGLE_SHEETS_API_URL);
  url.searchParams.set("secret", GOOGLE_SHEETS_API_SECRET);
  url.searchParams.set("resource", resource);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function gasGet(resource, params = {}) {
  const response = await fetch(buildGoogleSheetsResourceUrl(resource, params));
  if (!response.ok) throw new Error(`呼叫 Google Apps Script ${resource} 失敗，狀態碼：${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.message || `Google Apps Script ${resource} 回傳失敗`);
  return data;
}

async function gasPost(action, payload = {}) {
  const response = await fetch(GOOGLE_SHEETS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: GOOGLE_SHEETS_API_SECRET, action, ...payload }),
  });
  if (!response.ok) throw new Error(`呼叫 Google Apps Script ${action} 失敗，狀態碼：${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.message || `Google Apps Script ${action} 失敗`);
  return data.result !== undefined ? data.result : data.item;
}

async function fetchWeekContextFromGoogleSheets() {
  const data = await gasGet("week-context");
  return {
    previousWeek: data.previousWeek || null,
    currentWeek: data.currentWeek || null,
    nextWeek: data.nextWeek || null,
    canPlanNextWeek: data.canPlanNextWeek === true,
    canPlanNextCycle: data.canPlanNextCycle === true,
    restPeriod: data.restPeriod === true,
    nextCycle: data.nextCycle || null,
    cycleComplete: data.cycleComplete === true,
    completedCycleNumber: data.completedCycleNumber || null,
  };
}

async function fetchItemsFromGoogleSheets() {
  const data = await gasGet("items");
  return (data.items || []).map(normalizeItem);
}

async function fetchCurrentWeekItemsFromGoogleSheets() {
  const [items, context] = await Promise.all([fetchItemsFromGoogleSheets(), fetchWeekContextFromGoogleSheets()]);
  if (!context.currentWeek) return [];
  const c = Number(context.currentWeek.cycleNumber);
  const w = Number(context.currentWeek.weekNumber);
  return items.filter((item) => Number(item.scheduledCycleNumber) === c && Number(item.scheduledWeekNumber) === w && !["cancelled", "replanned"].includes(item.status));
}

async function createItemToGoogleSheets({
  type,
  title,
  category,
  subCategory,
  categoryId,
  subCategoryId,
  difficulty,
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
    difficulty: normalizeDifficulty(difficulty),
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
  if (safe.difficulty !== undefined) safe.difficulty = normalizeDifficulty(safe.difficulty);
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
  const [items, weekContext] = await Promise.all([
    fetchCurrentWeekItemsFromGoogleSheets(),
    fetchWeekContextFromGoogleSheets(),
  ]);

  return {
    currentWeek: weekContext.currentWeek,
    tasks: sortTasksByCategory(items.filter((item) => item.type === "task")),
    standards: items.filter((item) => item.type === "standard"),
  };
}

function getLineCommandHintText() {
  return "需要操作說明請輸入：說明";
}

function getTaskMetaText(task, includeDifficulty = true) {
  const parts = [normalizeCategory(task.category)];

  if (normalizeCategory(task.category) === "程式學習") {
    parts.push(normalizeSubCategory(task.subCategory, task.category));
  }

  if (includeDifficulty) parts.push(normalizeDifficulty(task.difficulty));
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
  const text = String(title || "").trim().replace(/\s+/g, " ");
  return text || "未命名任務";
}

function formatTaskSectionByCategory(tasks) {
  if (tasks.length === 0) return ["【本週任務】", "本週還沒有任務。加入一件想做的事就好。"].join("\n");

  const lines = ["【本週任務】"];
  let taskNumber = 1;

  CATEGORY_OPTIONS.forEach(function (category) {
    const categoryTasks = tasks.filter((task) => normalizeCategory(task.category) === category);
    if (categoryTasks.length === 0) return;

    lines.push("", `《${category}》`);

    if (category === "程式學習") {
      [...SUBCATEGORY_OPTIONS, EMPTY_SUBCATEGORY].forEach(function (subCategory) {
        const groupTasks = categoryTasks.filter(function (task) {
          return normalizeSubCategory(task.subCategory, category) === subCategory;
        });

        if (groupTasks.length === 0) return;

        // 純文字版也補上子分類小標題，和 Flex 版一致
        const subLabel = getLineSubCategoryLabel(subCategory);
        if (subLabel) lines.push(`  ［${subLabel}］`);

        groupTasks.forEach(function (task) {
          const checkbox = task.done ? "✓" : "•";
          lines.push(
            `${taskNumber}. ${checkbox} ${task.title}｜${normalizeSubCategory(task.subCategory, category)}｜${normalizeDifficulty(task.difficulty)}`
          );
          taskNumber += 1;
        });
      });
      return;
    }

    categoryTasks.forEach(function (task) {
      const checkbox = task.done ? "✓" : "•";
      lines.push(`${taskNumber}. ${checkbox} ${task.title}｜${normalizeDifficulty(task.difficulty)}`);
      taskNumber += 1;
    });
  });

  return lines.join("\n").trim();
}

function formatLineSection(title, items, emptyText) {
  if (items.length === 0) return [title, emptyText].join("\n");
  return [title, ...items.map((item, index) => `${index + 1}. ${item.done ? "☑" : "☐"} ${item.title}`)].join("\n");
}

function formatTaskBoardForLine({ currentWeek, tasks, standards }) {
  const weekTitle = currentWeek ? `第 ${currentWeek.weekNumber} 週｜${currentWeek.title}` : "本週清單";

  return [
    "📋 Tiny Progress",
    weekTitle,
    "",
    `任務進度：${tasks.filter((task) => task.done).length} / ${tasks.length}`,
    `標準進度：${standards.filter((standard) => standard.done).length} / ${standards.length}`,
    "",
    formatTaskSectionByCategory(tasks),
    "",
    formatLineSection("【本週驗收標準】", standards, "本週標準尚未成文。寫下一個方向，慢慢前進。"),
    "",
    getLineCommandHintText(),
  ].join("\n");
}

function formatTasksByDifficultyForLine(tasks, difficulty) {
  const matchedTasks = tasks
    .map((task, index) => ({ task, originalNumber: index + 1 }))
    .filter((entry) => normalizeDifficulty(entry.task.difficulty) === difficulty);

  if (matchedTasks.length === 0) {
    return [
      `📌 本週${difficulty}任務`,
      "",
      `目前沒有${difficulty}任務。`,
      "",
      "需要完整清單請輸入：清單",
    ].join("\n");
  }

  const lines = matchedTasks.map(function (entry) {
    const checkbox = entry.task.done ? "☑" : "☐";
    return `${entry.originalNumber}. ${checkbox} ${entry.task.title}｜${getTaskMetaText(entry.task, false)}`;
  });

  const firstUnfinishedEntry = matchedTasks.find((entry) => !entry.task.done);
  const commandHint = firstUnfinishedEntry ? `可直接輸入：完成任務${firstUnfinishedEntry.originalNumber}` : "這一區都完成了";

  return [
    `📌 本週${difficulty}任務`,
    "",
    ...lines,
    "",
    "以上編號沿用完整清單。",
    commandHint,
    "",
    "需要完整清單請輸入：清單",
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

// 8 張主要 LINE 卡片各自的品牌框色。
// 只有外框／主要進度色依卡片功能不同；分類與子分類色仍由 LINE_TAG_PALETTE 決定。
const CARD_ACCENTS = {
  allList: "#93B9D1",    // ① 本週清單：柔霧藍
  draw: "#6EB7B0",       // ② 抽一件：青綠
  easy: "#D6C96F",       // ③ 簡單任務：奶油黃
  medium: "#E9A276",     // ④ 適中任務：杏桃橘
  hard: "#C97572",       // ⑤ 困難任務：柔霧磚紅
  guide: "#9B806B",      // ⑥ 攻略：奶茶棕
  monday: "#7F93C8",     // ⑦ 週一小卡：霧靛藍（server 保留對照，實際推播在 Code.gs）
  sunday: "#C9A35F",     // ⑧ 週日回顧：柔金（server 保留對照，實際推播在 Code.gs）
};

function getDifficultyCardAccent(difficulty) {
  const value = normalizeDifficulty(difficulty);
  if (value === "簡單") return CARD_ACCENTS.easy;
  if (value === "困難") return CARD_ACCENTS.hard;
  return CARD_ACCENTS.medium;
}

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
  return { backgroundColor: style.bg, textColor: style.text, borderColor: style.border, accentColor: style.accent };
}

const LINE_TAG_COLOR_FAMILIES = [
  "green", "rose", "blue", "orange", "purple", "teal",
  "yellow", "green", "orange", "blue", "green", "rose",
];

function getSubCategoryFlexStyle(subCategory, valueKey, parentKey) {
  const label = getLineSubCategoryLabel(subCategory) || "未分類";
  let index = stableLineTagIndex(valueKey || label, "subcategory");
  const parentIndex = stableLineTagIndex(parentKey || "parent", "category");

  // 主分類與次分類都沿用 script.js 的 12 色 palette，
  // 但 LINE 卡片額外避開「同色系」，避免兩顆標籤看起來像同一種顏色。
  let guard = 0;
  while (
    (index === parentIndex || LINE_TAG_COLOR_FAMILIES[index] === LINE_TAG_COLOR_FAMILIES[parentIndex]) &&
    guard < LINE_TAG_PALETTE.length
  ) {
    index = (index + 1) % LINE_TAG_PALETTE.length;
    guard += 1;
  }

  const style = LINE_TAG_PALETTE[index];
  return { backgroundColor: style.bg, textColor: style.text, borderColor: style.border, accentColor: style.accent };
}

function getDifficultyFlexStyle(difficulty) {
  const normalizedDifficulty = normalizeDifficulty(difficulty);

  if (normalizedDifficulty === "簡單") {
    return { backgroundColor: "#FBF5EA", textColor: "#6F7D62", borderColor: "#DED3C4", accentColor: "#7EAB67" };
  }

  if (normalizedDifficulty === "適中") {
    return { backgroundColor: "#FBF5EA", textColor: "#8A6B35", borderColor: "#DED3C4", accentColor: "#D5A751" };
  }

  return { backgroundColor: "#FBF5EA", textColor: "#9A5A55", borderColor: "#DED3C4", accentColor: "#C97769" };
}



function getDifficultyFooterCopy(difficulty, isCompleted) {
  const normalizedDifficulty = normalizeDifficulty(difficulty);

  if (normalizedDifficulty === "簡單") return isCompleted ? "這件完成了。" : "可以先從這件開始。";
  if (normalizedDifficulty === "適中") return isCompleted ? "這件完成了，已經留下進度。" : "照自己的速度往前就好。";
  return isCompleted ? "這件完成了，進度又往前一點。" : "需要的話，可以先拆成更小的步驟。";
}


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

// ── 子分類標籤：未分類回傳 null，呼叫端需判斷後才放入 contents ──
function buildSubCategoryFlexTag(subCategory, options = {}) {
  const label = String(subCategory || "").trim();
  if (!label || label === EMPTY_SUBCATEGORY) return null;

  const style = getSubCategoryFlexStyle(subCategory, options.valueKey, options.parentKey);

  // 次分類保留較輕字重，但使用自己 palette 的柔色底，
  // 讓它和主分類一眼看得出是兩種不同標籤。
  return buildFlexTag(label, style.backgroundColor, style.textColor, {
    width: options.width,
    cornerRadius: "999px",
    size: "xxs",
    weight: "regular",
    borderColor: style.borderColor,
    paddingTop: "3px",
    paddingBottom: "3px",
    paddingStart: "8px",
    paddingEnd: "8px",
  });
}

function getSubCategoryFlexTagWidth(subCategory) {
  if (subCategory === "W3Schools") return "76px";
  if (subCategory === "freeCodeCamp") return "86px";
  if (subCategory === "Vibe Coding") return "80px";
  return "66px";
}

function buildDifficultyFlexTag(difficulty, options = {}) {
  const style = getDifficultyFlexStyle(difficulty);

  // 難度 = 第三層資訊：只留色點 + 文字，不再做成第三顆膠囊標籤。
  return {
    type: "box",
    layout: "horizontal",
    flex: 0,
    width: options.width || "52px",
    spacing: "xs",
    alignItems: "center",
    justifyContent: "flex-end",
    contents: [
      {
        type: "box",
        layout: "vertical",
        width: "6px",
        height: "6px",
        backgroundColor: style.accentColor,
        cornerRadius: "999px",
        contents: [],
      },
      {
        type: "text",
        text: difficulty,
        size: "xxs",
        weight: "bold",
        color: style.textColor,
        align: "end",
        flex: 0,
        maxLines: 1,
      },
    ],
  };
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

function buildFlexHeader(title, subtitle, headerAccessory, headerBadge, options = {}) {
  const cycleNumber = Number(options.cycleNumber || 0);
  const brandLabel = cycleNumber > 0 ? `Tiny Progress · Cycle ${cycleNumber}` : "Tiny Progress";
  const contents = [
    {
      type: "box",
      layout: "horizontal",
      alignItems: "center",
      contents: [
        { type: "text", text: brandLabel, size: "xs", weight: "bold", color: FLEX_COLORS.brandText, flex: 1, wrap: false },
        { type: "text", text: "∞", size: "lg", weight: "bold", color: FLEX_COLORS.brand, flex: 0 },
      ],
    },
  ];

  if (headerBadge) {
    contents.push({ type: "box", layout: "horizontal", margin: "xs", contents: [headerBadge] });
  }

  const titleContents = [
    { type: "text", text: title, size: options.titleSize || "lg", weight: "bold", color: FLEX_COLORS.darkGreen, wrap: true, flex: 1 },
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
    contents.push({ type: "text", text: subtitle, size: "xs", color: FLEX_COLORS.mutedText, wrap: true });
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
        options.iconColor || FLEX_COLORS.brand
      )
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
      backgroundColor: index < filled ? (color || FLEX_COLORS.greenFresh) : "#E7E5DF",
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
          { type: "text", text: label, size: "sm", color: FLEX_COLORS.mutedText, flex: 1 },
          { type: "text", text: `${doneCount} / ${totalCount}`, size: "sm", color: FLEX_COLORS.darkGreen, weight: "bold", align: "end", flex: 0 },
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

function buildTaskTitleLine({ task, prefix = "", showDifficulty = true, size = "md", difficultyWidth = "58px" }) {
  const difficulty = normalizeDifficulty(task.difficulty);
  const title = String(task.title || "").trim() || "未命名任務";
  return {
    type: "box",
    layout: "horizontal",
    spacing: "xs",
    alignItems: "center",
    contents: [
      {
        type: "text",
        text: `${prefix}${title}`,
        size,
        color: task.done ? "#8D9589" : FLEX_COLORS.darkGreen,
        wrap: false,
        maxLines: 1,
        weight: "regular",
        flex: 1,
      },
      ...(showDifficulty ? [buildDifficultyFlexTag(difficulty, { width: difficultyWidth })] : []),
    ],
  };
}


function buildTaskFlexRow({ task, taskNumber, showDifficulty, showCategory, showSubCategory = true }) {
  const checkbox = task.done ? "✓" : "•";
  const category = normalizeCategory(task.category);
  const tagContents = [];

  // 第一個標籤：主題分類。完整保留，例如「前端」或「程式學習」。
  if (showCategory) {
    tagContents.push(
      buildCategoryFlexTag(category, {
        // 不固定寬度，讓分類名稱完整顯示。
        valueKey: task.categoryId || category,
      })
    );
  }

  // 第二個標籤：次分類。所有主分類都可以有次分類，不能只限制「程式學習」。
  // 這正是前端 script.js 會顯示「前端 / 練習 / 簡單」三層資訊的原因。
  if (showSubCategory) {
    const subCategory = normalizeSubCategory(task.subCategory, category);
    const subTag = buildSubCategoryFlexTag(subCategory, {
      valueKey: task.subCategoryId || subCategory,
      parentKey: task.categoryId || category,
    });
    if (subTag) tagContents.push(subTag);
  }

  const rowContents = [
    buildTaskTitleLine({
      task,
      prefix: `${taskNumber}. ${checkbox} `,
      showDifficulty,
      size: "md",
      difficultyWidth: "52px",
    }),
  ];

  if (tagContents.length > 0) {
    // 任務第二行：分類＋子分類。不要和難度擠在第一行。
    rowContents.push({
      type: "box",
      layout: "horizontal",
      spacing: "md",
      margin: "xs",
      contents: tagContents,
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
// 第一行 = 任務名稱＋難度；第二行 = 主題分類＋次分類。
// 難度雖在第一行，但整張任務仍完整保留三層資訊。
function buildListTaskFlexRow({ task, taskNumber }) {
  return buildTaskFlexRow({ task, taskNumber, showDifficulty: true, showCategory: true, showSubCategory: true });
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

function getTinyProgressWebUrl() {
  const url = String(TINY_PROGRESS_WEB_URL || "").trim();
  if (!/^https?:\/\//i.test(url)) return "";
  return url;
}

function buildTinyProgressWebButton() {
  const url = getTinyProgressWebUrl();
  if (!url) return null;

  return {
    type: "button",
    style: "primary",
    height: "sm",
    color: "#769275",
    action: {
      type: "uri",
      label: "查看完整任務",
      uri: url,
    },
  };
}

function buildListFooter() {
  const contents = [];
  const button = buildTinyProgressWebButton();

  if (button) contents.push(button);

  contents.push({
    type: "text",
    text: "需要操作說明請輸入：說明",
    size: "xxs",
    color: "#92867B",
    wrap: true,
    margin: button ? "sm" : "none",
  });

  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    contents,
  };
}

function buildFlexFooterHint(lines) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    margin: "sm",
    contents: lines.map((line, index) => ({
      type: "text",
      text: line,
      size: index === 0 ? "sm" : "xxs",
      color: index === 0 ? FLEX_COLORS.darkGreen : "#92867B",
      weight: index === 0 ? "bold" : "regular",
      wrap: index === 0,
      maxLines: 1,
    })),
  };
}

function buildBaseFlexBubble({ title, subtitle, bodyContents, footerContents, accentColor, headerAccessory, headerBadge, titleSize, cycleNumber }) {
  const innerContents = [
    buildFlexHeader(title, subtitle, headerAccessory, headerBadge, { titleSize, cycleNumber }),
    { type: "separator", margin: "md", color: FLEX_COLORS.beigeLine },
    ...bodyContents,
  ];
  if (footerContents) {
    innerContents.push({ type: "separator", margin: "md", color: FLEX_COLORS.beigeLine });
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


function buildDrawOneTaskFallbackText({ selectedTask, taskNumber, unfinishedCount }) {
  return [
    "Tiny Progress｜今天抽到",
    "",
    `第 ${taskNumber} 個任務`,
    `☐ ${selectedTask.title}`,
    "",
    `分類：${getTaskMetaText(selectedTask)}`,
    `目前還有 ${unfinishedCount} 件未完成。`,
    "",
    "完成後可以輸入：",
    `完成任務${taskNumber}`,
    "",
    
  ].join("\n");
}


function buildDrawEmptyFlexMessage(currentWeek) {
  const bubble = buildBaseFlexBubble({
    title: "抽一件",
    subtitle: "目前沒有未完成任務",
    cycleNumber: currentWeek?.cycleNumber,
    headerBadge: buildCircleWeekMeta(currentWeek),
    accentColor: CARD_ACCENTS.draw,
    bodyContents: [
      buildFlexInfoCard(
        [{ type: "text", text: "本週任務都完成了。", size: "md", color: FLEX_COLORS.darkGreen, weight: "regular", wrap: true }],
        { label: "今天做什麼", emoji: "○" }
      ),
    ],
  });
  return { type: "flex", altText: "Tiny Progress｜目前沒有任務可以抽，本週都完成了！", contents: bubble };
}


function buildDrawOneTaskFlexMessage({ currentWeek, selectedTask, taskNumber, unfinishedCount }) {
  const bubble = buildBaseFlexBubble({
    title: "抽一件",
    subtitle: `還有 ${unfinishedCount} 件未完成`,
    cycleNumber: currentWeek?.cycleNumber,
    headerBadge: buildCircleWeekMeta(currentWeek),
    accentColor: CARD_ACCENTS.draw,
    bodyContents: [
      buildFlexInfoCard(
        [buildTaskFlexRow({ task: selectedTask, taskNumber, showDifficulty: true, showCategory: true, showSubCategory: true })],
        { label: "今天抽到", emoji: "•" }
      ),
    ],
    footerContents: buildFlexFooterHint([`完成後可輸入：完成任務${taskNumber}`]),
  });
  return {
    type: "flex",
    altText: `Tiny Progress｜今天抽到：${selectedTask.title}（還有 ${unfinishedCount} 件未完成）`,
    contents: bubble,
  };
}


async function handleDrawOneTaskCommand() {
  const board = await getTaskBoardForLine();
  const unfinishedTasks = board.tasks.filter((task) => !task.done);
  if (unfinishedTasks.length === 0) {
    return {
      replyText: ["Tiny Progress｜今天抽一件", "", "目前沒有任務可以抽。"].join("\n"),
      replyMessages: [buildDrawEmptyFlexMessage(board.currentWeek)],
    };
  }
  const selectedTask = unfinishedTasks[Math.floor(Math.random() * unfinishedTasks.length)];
  const taskNumber = board.tasks.findIndex((task) => task.id === selectedTask.id) + 1;
  const unfinishedCount = unfinishedTasks.length;
  return {
    replyText: buildDrawOneTaskFallbackText({ selectedTask, taskNumber, unfinishedCount }),
    replyMessages: [buildDrawOneTaskFlexMessage({ currentWeek: board.currentWeek, selectedTask, taskNumber, unfinishedCount })],
  };
}


function buildDifficultyTaskFooterLines(matchedTasks, difficulty) {
  const firstUnfinishedEntry = matchedTasks.find((entry) => !entry.task.done);
  if (!firstUnfinishedEntry) return ["這一區都完成了", getDifficultyFooterCopy(difficulty, true)];
  return [`可直接輸入：完成任務${firstUnfinishedEntry.originalNumber}`, getDifficultyFooterCopy(difficulty, false)];
}

function buildDifficultyTaskListFlexMessage({ currentWeek, tasks, difficulty }) {
  const matchedTasks = tasks
    .map((task, index) => ({ task, originalNumber: index + 1 }))
    .filter((entry) => normalizeDifficulty(entry.task.difficulty) === difficulty);
  const unfinishedCount = matchedTasks.filter((entry) => !entry.task.done).length;
  let bodyContents;
  if (matchedTasks.length === 0) {
    bodyContents = [
      buildFlexInfoCard(
        [{ type: "text", text: `目前沒有${difficulty}任務。`, size: "md", color: FLEX_COLORS.darkGreen, weight: "regular", wrap: true }],
        { label: `本週${difficulty}任務`, emoji: "•" }
      ),
    ];
  } else {
    const rows = [];
    matchedTasks.forEach((entry, index) => {
      rows.push(buildTaskFlexRow({ task: entry.task, taskNumber: entry.originalNumber, showDifficulty: true, showCategory: true, showSubCategory: true }));
      if (index < matchedTasks.length - 1) rows.push({ type: "separator", color: FLEX_COLORS.beigeLine });
    });
    bodyContents = [buildFlexInfoCard(rows, { label: `本週${difficulty}任務 · 未完成 ${unfinishedCount} 件`, emoji: "•" })];
  }
  const bubble = buildBaseFlexBubble({
    title: `本週${difficulty}任務`,
    subtitle: `共 ${matchedTasks.length} 件`,
    cycleNumber: currentWeek?.cycleNumber,
    headerBadge: buildCircleWeekMeta(currentWeek),
    accentColor: getDifficultyCardAccent(difficulty),
    bodyContents,
    footerContents: buildFlexFooterHint(matchedTasks.length === 0 ? ["需要完整清單請輸入：清單"] : buildDifficultyTaskFooterLines(matchedTasks, difficulty)),
  });
  return { type: "flex", altText: `Tiny Progress｜本週${difficulty}任務，未完成 ${unfinishedCount} 件`, contents: bubble };
}


async function handleDifficultyTaskFlexCommand(difficulty) {
  const board = await getTaskBoardForLine();
  return {
    replyText: formatTasksByDifficultyForLine(board.tasks, difficulty),
    replyMessages: [buildDifficultyTaskListFlexMessage({ currentWeek: board.currentWeek, tasks: board.tasks, difficulty })],
  };
}


function buildAllListFlexMessage({ currentWeek, tasks, standards }) {
  const taskDoneCount = tasks.filter((task) => task.done).length;
  const taskRows = buildListTaskRows(tasks);
  const bodyContents = [
    buildFlexInfoCard([buildListProgressBlock(taskDoneCount, tasks.length, CARD_ACCENTS.allList)], { label: "本週概況", emoji: "○" }),
  ];
  if (tasks.length === 0) {
    bodyContents.push(
      buildFlexInfoCard(
        [{ type: "text", text: "本週還沒有任務。", size: "md", color: FLEX_COLORS.darkGreen, weight: "regular", wrap: true }],
        { label: "本週任務", emoji: "•" }
      )
    );
  } else {
    bodyContents.push(buildFlexInfoCard(taskRows, { label: "本週任務", emoji: "•" }));
  }
  const bubble = buildBaseFlexBubble({
    title: "本週清單",
    subtitle: currentWeek?.title ? currentWeek.title : "完整查看本週任務",
    cycleNumber: currentWeek?.cycleNumber,
    headerBadge: buildListCircleWeekMeta(currentWeek),
    titleSize: "lg",
    accentColor: CARD_ACCENTS.allList,
    bodyContents,
    footerContents: buildListFooter(),
  });
  return {
    type: "flex",
    altText: currentWeek ? `Tiny Progress · Cycle ${currentWeek.cycleNumber}｜Week ${currentWeek.weekNumber}｜任務 ${taskDoneCount}/${tasks.length}` : "Tiny Progress｜本週清單",
    contents: bubble,
  };
}


async function handleAllListFlexCommand() {
  const board = await getTaskBoardForLine();

  return {
    replyText: formatTaskBoardForLine(board),
    replyMessages: [buildAllListFlexMessage(board)],
  };
}

function buildLineTextMessage(text) {
  return {
    type: "text",
    text: String(text || "目前沒有可回覆的內容。"),
  };
}

function getFallbackTextFromReplyMessages(replyMessages) {
  const textMessage = replyMessages.find((message) => message && message.type === "text" && message.text);
  if (textMessage) return textMessage.text;

  const flexMessage = replyMessages.find((message) => message && message.type === "flex" && message.altText);
  if (flexMessage) return flexMessage.altText;

  return "Tiny Progress 已回覆。";
}

function normalizeLineReplyResult(replyResult) {
  if (replyResult && typeof replyResult === "object" && Array.isArray(replyResult.replyMessages)) {
    const replyMessages = replyResult.replyMessages;
    return {
      replyText: replyResult.replyText || getFallbackTextFromReplyMessages(replyMessages),
      replyMessages,
    };
  }

  if (Array.isArray(replyResult)) {
    return {
      replyText: getFallbackTextFromReplyMessages(replyResult),
      replyMessages: replyResult,
    };
  }

  const replyText = String(replyResult || "Tiny Progress 目前沒有可回覆的內容。");
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
    console.error("LINE Reply API 回覆失敗：", lineResponse.status, await lineResponse.text());
  }
}

function getGuideText() {
  return [
    "📋 Tiny Progress｜攻略",
    "",
    "【查看】",
    "清單：查看本週任務",
    "抽一件：從未完成任務中抽一件",
    "簡單任務 / 適中任務 / 困難任務：依難度查看",
    "",
    "【加入】",
    "新增任務 練習 CSS",
    "新增任務 練習 CSS｜程式學習｜練習｜適中",
    "新增標準 本週能說明一個學到的觀念",
    "",
    "【任務操作】",
    "完成任務3 / 取消任務3",
    "修改任務3 / 刪除任務3",
    "取消修改：中止正在等待輸入的新內容",
    "",
    "需要查看目前編號時，先輸入：清單",
  ].join("\n");
}

// ── 攻略 Flex Message：常用指令集中顯示，維持柔和標籤視覺 ──
function buildGuideFlexMessage(currentWeek) {
  function buildGuideRow(command, desc) {
    return {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      alignItems: "center",
      paddingBottom: "8px",
      contents: [
        buildFlexTag(command, FLEX_COLORS.brandSoft, FLEX_COLORS.brandText, {
          width: "100px",
          borderColor: FLEX_COLORS.brandBorder,
          weight: "regular",
          paddingTop: "4px",
          paddingBottom: "4px",
        }),
        { type: "text", text: desc, size: "xs", color: FLEX_COLORS.mutedText, wrap: true, flex: 1 },
      ],
    };
  }
  const viewCard = buildFlexInfoCard([
    buildGuideRow("清單", "查看本週完整任務"),
    buildGuideRow("抽一件", "從未完成任務中隨機抽一件"),
    buildGuideRow("簡單任務", "只看簡單任務"),
    buildGuideRow("適中任務", "只看適中任務"),
    buildGuideRow("困難任務", "只看困難任務"),
  ], { label: "查看", emoji: "○" });
  const createCard = buildFlexInfoCard([
    buildGuideRow("新增任務", "例：新增任務 練習 CSS"),
    buildGuideRow("完整格式", "新增任務 xxx｜分類｜子分類｜難度"),
    buildGuideRow("新增標準", "例：新增標準 本週能說明一個學到的觀念"),
  ], { label: "加入", emoji: "＋" });
  const actionCard = buildFlexInfoCard([
    buildGuideRow("完成任務3", "完成第 3 個任務"),
    buildGuideRow("取消任務3", "恢復成未完成"),
    buildGuideRow("修改任務3", "等待你輸入新的任務內容"),
    buildGuideRow("刪除任務3", "取消第 3 個任務"),
    buildGuideRow("取消修改", "中止等待輸入的修改流程"),
  ], { label: "任務操作", emoji: "✓" });
  const bubble = buildBaseFlexBubble({
    title: "攻略",
    subtitle: "常用指令",
    cycleNumber: currentWeek?.cycleNumber,
    headerBadge: buildCircleWeekMeta(currentWeek),
    accentColor: CARD_ACCENTS.guide,
    bodyContents: [viewCard, createCard, actionCard],
    footerContents: buildFlexFooterHint(["不知道任務編號時，先輸入：清單", "Tiny Progress"]),
  });
  return { type: "flex", altText: "Tiny Progress｜攻略：查看、加入、任務操作", contents: bubble };
}


async function handleGuideCommand() {
  const context = await fetchWeekContextFromGoogleSheets();
  return { replyText: getGuideText(), replyMessages: [buildGuideFlexMessage(context.currentWeek)] };
}


async function handlePendingActionIfNeeded(sourceKey, userText) {
  const pending = pendingActions.get(sourceKey);
  if (!pending) return null;

  const displayLabel = getDisplayLabel(pending.label);

  if (userText === "取消修改") {
    pendingActions.delete(sourceKey);
    return "已取消這次修改，原本內容保持不變。";
  }

  if (Date.now() - pending.createdAt > PENDING_ACTION_TTL_MS) {
    pendingActions.delete(sourceKey);
    return ["這次修改已經逾時，資料沒有變動。", "", `可以重新輸入：修改${pending.label} 數字`].join("\n");
  }

  const newTitle = userText.trim();
  if (!newTitle) return `請輸入新的${displayLabel}文字，或輸入「取消修改」。`;

  const updatedItem = await updateItemToGoogleSheets(pending.itemId, { title: newTitle });
  pendingActions.delete(sourceKey);

  return [`已修改第 ${pending.itemNumber} 個${displayLabel}：`, updatedItem.title || newTitle, "", "已更新內容。"].join("\n");
}

function parseCreateText({ userText, command }) {
  let rawText = userText.replace(new RegExp(`^${command}\\s*`), "").trim();
  rawText = rawText.replace(/^[：:]/, "").trim();

  if (!rawText) {
    return {
      title: "",
      category: DEFAULT_CATEGORY,
      subCategory: DEFAULT_SUBCATEGORY,
      difficulty: DEFAULT_DIFFICULTY,
    };
  }

  const parts = rawText
    .split(/\s*[\/｜|，,、]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  const title = parts[0] || "";
  const category = parts[1] || DEFAULT_CATEGORY;
  let subCategory = DEFAULT_SUBCATEGORY;
  let difficulty = DEFAULT_DIFFICULTY;

  if (normalizeCategory(category) === "程式學習") {
    if (DIFFICULTY_OPTIONS.includes(parts[2])) {
      difficulty = parts[2];
    } else {
      subCategory = parts[2] || DEFAULT_SUBCATEGORY;
      difficulty = parts[3] || DEFAULT_DIFFICULTY;
    }
  } else {
    subCategory = EMPTY_SUBCATEGORY;
    difficulty = parts[2] || DEFAULT_DIFFICULTY;
  }

  return { title, category, subCategory, difficulty };
}

async function handleCreateCommand({ userText, command, type, label, example }) {
  const parsed = parseCreateText({ userText, command });
  const displayLabel = getDisplayLabel(label);

  if (!parsed.title) {
    return [`這次加入還缺少${displayLabel}內容，資料沒有變動。`, "", `例：${command} ${example}`].join("\n");
  }

  let category;
  let subCategory;
  let difficulty;

  try {
    category = normalizeCategory(parsed.category);
    subCategory = normalizeSubCategory(parsed.subCategory, category);
    difficulty = normalizeDifficulty(parsed.difficulty);
  } catch (error) {
    return ["分類、子分類或難度需要再確認，資料沒有變動。", "", error.message, "", "例：新增任務 練習 CSS｜程式學習｜練習｜適中"].join("\n");
  }

  const currentWeekNumber = await getCurrentWeekNumberFromGoogleSheets();
  const createdItem = await createItemToGoogleSheets({
    type,
    title: parsed.title,
    category,
    subCategory,
    difficulty,
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

  return ["Tiny Progress 已新增本週驗收標準：", `☐ ${createdItem.title || parsed.title}`, "", "可以輸入「清單」查看目前清單。"].join("\n");
}

async function findItemByNumber({ type, numberText, label }) {
  const itemNumber = Number(numberText);
  const displayLabel = getDisplayLabel(label);

  if (!Number.isInteger(itemNumber) || itemNumber <= 0) {
    return {
      error: [`還缺少正確的${displayLabel}編號，資料沒有變動。`, "", "可以這樣輸入：", `完成${label}3`, `完成第三個${label}`].join("\n"),
    };
  }

  const items = await getItemsByType(type);
  const targetItem = items[itemNumber - 1];

  if (!targetItem) {
    return {
      error: [`目前找不到第 ${itemNumber} 個${displayLabel}。`, "", "可以先輸入「清單」確認編號。"].join("\n"),
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

  return [`${actionText}第 ${result.itemNumber} 個${displayLabel}：`, `${checkbox} ${updatedItem.title || result.item.title}`, "", "Tiny Progress"].join("\n");
}

async function handleDeleteCommand({ numberText, type, label }) {
  const result = await findItemByNumber({ type, numberText, label });
  if (result.error) return result.error;

  const deletedItem = await deleteItemFromGoogleSheets(result.item.id);
  const displayLabel = getDisplayLabel(label);

  return [`已取消第 ${result.itemNumber} 個${displayLabel}：`, deletedItem.title || result.item.title, "", "已更新任務。"].join("\n");
}

async function handleEditCommand({ sourceKey, numberText, newTitle, type, label }) {
  const result = await findItemByNumber({ type, numberText, label });
  if (result.error) return result.error;

  const displayLabel = getDisplayLabel(label);

  if (newTitle && newTitle.trim()) {
    const updatedItem = await updateItemToGoogleSheets(result.item.id, { title: newTitle.trim() });
    return [`已修改第 ${result.itemNumber} 個${displayLabel}：`, updatedItem.title || newTitle.trim(), "", "已更新內容。"].join("\n");
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

  return [`請輸入第 ${result.itemNumber} 個${displayLabel}的新文字：`, "", `目前內容：${result.item.title}`, "", "若不想修改，請輸入：取消修改"].join("\n");
}

function parseFlexibleNumber(numberText) {
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

function buildLineOperationCommand(actionText, targetText, numberText, newTitle) {
  const number = parseFlexibleNumber(numberText);

  if (!Number.isInteger(number) || number <= 0) {
    return { error: "還缺少正確編號，資料沒有變動。可以這樣輸入：完成第 3 個任務" };
  }

  const isTask = targetText.includes("任務");
  const actionMap = { 完成: "done", 已完成: "done", 取消: "cancel", 修改: "edit", 刪除: "delete" };

  return {
    action: actionMap[actionText],
    numberText: String(number),
    newTitle,
    type: isTask ? "task" : "standard",
    label: isTask ? "任務" : "完成標準",
  };
}

function parseLineOperationCommand(userText) {
  let match = userText.match(/^(完成|已完成|取消|修改|刪除)\s*(任務|完成標準|標準)\s*(\d+|[零一二三四五六七八九十兩]+)(?:\s+(.+))?$/);
  if (match) return buildLineOperationCommand(match[1], match[2], match[3], match[4]);

  match = userText.match(/^(完成|已完成|取消|修改|刪除)\s*第?\s*(\d+|[零一二三四五六七八九十兩]+)\s*個?\s*(任務|完成標準|標準)(?:\s+(.+))?$/);
  if (match) return buildLineOperationCommand(match[1], match[3], match[2], match[4]);

  return null;
}

function getFormatReminderText() {
  return [
    "格式需要再確認，資料沒有變動。",
    "",
    "常用格式：",
    "新增任務 練習 CSS｜程式學習｜練習｜適中",
    "完成任務3",
    "取消任務3",
    "修改任務3",
    "刪除任務3",
    "完成標準2",
    "",
    "需要完整說明請輸入：說明",
  ].join("\n");
}

function getUnknownCommandText() {
  return [
    "Tiny Progress 目前看不懂這個指令，所以資料沒有變動。",
    "",
    "可以輸入：",
    "清單",
    "抽一件",
    "攻略",
    "",
    getLineCommandHintText(),
  ].join("\n");
}

async function handleLineTextCommand({ sourceKey, userText }) {
  const pendingReply = await handlePendingActionIfNeeded(sourceKey, userText);
  if (pendingReply) return pendingReply;

  if (["攻略", "說明", "help", "Help"].includes(userText)) return handleGuideCommand();
  if (["抽一件", "抽任務", "隨機任務", "今天做什麼"].includes(userText)) return handleDrawOneTaskCommand();

  if (userText === "清單" || userText === "全部清單") return handleAllListFlexCommand();
  if (userText === "簡單任務" || userText === "簡單") return handleDifficultyTaskFlexCommand("簡單");
  if (userText === "適中任務" || userText === "適中") return handleDifficultyTaskFlexCommand("適中");
  if (userText === "困難任務" || userText === "困難") return handleDifficultyTaskFlexCommand("困難");

  if (userText.startsWith("新增一個任務")) {
    return handleCreateCommand({ userText, command: "新增一個任務", type: "task", label: "任務", example: "練習 LINE Bot" });
  }

  if (userText.startsWith("新增任務")) {
    return handleCreateCommand({ userText, command: "新增任務", type: "task", label: "任務", example: "練習 LINE Bot" });
  }

  if (userText.startsWith("新增一個完成標準")) {
    return handleCreateCommand({ userText, command: "新增一個完成標準", type: "standard", label: "完成標準", example: "本週能說明一個學到的觀念" });
  }

  if (userText.startsWith("新增一個標準")) {
    return handleCreateCommand({ userText, command: "新增一個標準", type: "standard", label: "完成標準", example: "本週能說明一個學到的觀念" });
  }

  if (userText.startsWith("新增標準")) {
    return handleCreateCommand({ userText, command: "新增標準", type: "standard", label: "完成標準", example: "本週能說明一個學到的觀念" });
  }

  const operation = parseLineOperationCommand(userText);

  if (operation) {
    if (operation.error) return operation.error;
    if (operation.action === "done") return handleDoneCommand({ numberText: operation.numberText, type: operation.type, label: operation.label, done: true });
    if (operation.action === "cancel") return handleDoneCommand({ numberText: operation.numberText, type: operation.type, label: operation.label, done: false });
    if (operation.action === "edit") return handleEditCommand({ sourceKey, numberText: operation.numberText, newTitle: operation.newTitle, type: operation.type, label: operation.label });
    if (operation.action === "delete") return handleDeleteCommand({ numberText: operation.numberText, type: operation.type, label: operation.label });
  }

  if (["完成", "已完成", "取消", "修改", "刪除", "新增"].some((prefix) => userText.startsWith(prefix))) {
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
    if (source !== "gas_queue") return res.status(400).json({ ok: false, message: "source 必須是 gas_queue" });
    if (!queueId || !userId) return res.status(400).json({ ok: false, message: "缺少 queueId 或 userId" });
    const userText = String(messageText || "").trim();
    if (!userText) return res.status(400).json({ ok: false, message: "缺少 messageText" });
    const replyResult = await handleLineTextCommand({ sourceKey: String(userId).trim(), userText });
    const normalizedReply = normalizeLineReplyResult(replyResult);
    res.json({ ok: true, queueId, replyText: normalizedReply.replyText, replyMessages: normalizedReply.replyMessages });
  } catch (error) {
    console.error("處理 /gas-queue 發生錯誤：", error);
    res.status(500).json({ ok: false, message: "處理 GAS queue 訊息失敗", error: error.message });
  }
});

app.post("/line/webhook", async (req, res) => {
  const events = req.body.events || [];
  for (const event of events) {
    try {
      if (event.type !== "message" || event.message.type !== "text") continue;
      const sourceKey = getLineSourceKey(event);
      const userText = event.message.text.trim();
      const replyResult = await handleLineTextCommand({ sourceKey, userText });
      await replyToLine(event.replyToken, replyResult);
    } catch (error) {
      console.error("處理 LINE Webhook 發生錯誤：", error);
      if (event.replyToken) await replyToLine(event.replyToken, "Tiny Progress 剛剛卡住了，資料沒有變動。請稍後再試一次。");
    }
  }
  res.status(200).send("OK");
});

app.get("/week-context", async (req, res) => {
  try { res.json(await fetchWeekContextFromGoogleSheets()); }
  catch (error) { res.status(500).json({ message: "讀取週次資料失敗", error: error.message }); }
});

app.get("/weeks", async (req, res) => {
  try { res.json((await gasGet("weeks")).weeks || []); }
  catch (error) { res.status(500).json({ message: "讀取 Weeks 失敗", error: error.message }); }
});

app.get("/cycles", async (req, res) => {
  try { res.json((await gasGet("cycles")).cycles || []); }
  catch (error) { res.status(500).json({ message: "讀取 Cycles 失敗", error: error.message }); }
});

app.patch("/weeks/current-plan", async (req, res) => {
  try { res.json(await gasPost("update-current-week-plan", req.body || {})); }
  catch (error) { res.status(getApiErrorStatus(error)).json({ message: "更新本週主題失敗", error: error.message }); }
});

app.patch("/weeks/:cycleNumber/:weekNumber/plan", async (req, res) => {
  try {
    res.json(await gasPost("update-week-plan", {
      cycleNumber: Number(req.params.cycleNumber),
      weekNumber: Number(req.params.weekNumber),
      ...(req.body || {}),
    }));
  } catch (error) {
    res.status(getApiErrorStatus(error)).json({ message: "儲存安排失敗", error: error.message });
  }
});

app.post("/weeks/postpone-current", async (req, res) => {
  try { res.json(await gasPost("postpone-current-week", req.body || {})); }
  catch (error) { res.status(getApiErrorStatus(error)).json({ message: "本週順延失敗", error: error.message }); }
});

// 舊前端相容入口：V2 不再手動結案。
app.post("/weeks/complete-current", (req, res) => {
  res.status(409).json({ message: "Week 會依日期自動前進，不需要手動完成整週。" });
});

app.post("/cycles", async (req, res) => {
  try { res.status(201).json(await gasPost("create-cycle", req.body || {})); }
  catch (error) { res.status(getApiErrorStatus(error)).json({ message: "建立 Cycle 失敗", error: error.message }); }
});

app.patch("/cycles/:cycleNumber/theme", async (req, res) => {
  try {
    res.json(await gasPost("update-cycle-theme", {
      cycleNumber: Number(req.params.cycleNumber),
      theme: String(req.body?.theme || "").trim(),
    }));
  } catch (error) {
    res.status(getApiErrorStatus(error)).json({ message: "更新本輪主題失敗", error: error.message });
  }
});

app.patch("/cycles/:cycleNumber/start-date", async (req, res) => {
  try {
    res.json(await gasPost("change-cycle-start", { cycleNumber: Number(req.params.cycleNumber), ...(req.body || {}) }));
  } catch (error) {
    res.status(getApiErrorStatus(error)).json({ message: "修改 Cycle 開始日期失敗", error: error.message });
  }
});

app.get("/items", async (req, res) => {
  try { res.json(await fetchItemsFromGoogleSheets()); }
  catch (error) { res.status(500).json({ message: "讀取任務失敗", error: error.message }); }
});

app.post("/items", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title) return res.status(400).json({ message: "title 必填" });
    const created = await createItemToGoogleSheets({ type: body.type || "task", ...body });
    res.status(201).json(created);
  } catch (error) {
    res.status(getApiErrorStatus(error)).json({ message: "新增任務失敗", error: error.message });
  }
});

app.patch("/items/:id", async (req, res) => {
  try { res.json(await updateItemToGoogleSheets(req.params.id, req.body || {})); }
  catch (error) { res.status(getApiErrorStatus(error)).json({ message: "更新任務失敗", error: error.message }); }
});

app.delete("/items/:id/draft", async (req, res) => {
  try {
    const result = await gasPost("remove-draft-task", { id: req.params.id });
    res.json({ message: "草稿任務已移除", ...(result || {}) });
  } catch (error) {
    res.status(getApiErrorStatus(error)).json({ message: "移除草稿任務失敗", error: error.message });
  }
});

app.post("/items/:id/complete", async (req, res) => {
  try { res.json(normalizeItem(await gasPost("complete-task", { id: req.params.id }))); }
  catch (error) { res.status(getApiErrorStatus(error)).json({ message: "完成任務失敗", error: error.message }); }
});

app.post("/items/:id/correct-completion", async (req, res) => {
  try { res.json(normalizeItem(await gasPost("correct-completion", { id: req.params.id }))); }
  catch (error) { res.status(getApiErrorStatus(error)).json({ message: "更正完成狀態失敗", error: error.message }); }
});

app.post("/items/:id/cancel", async (req, res) => {
  try { res.json(normalizeItem(await gasPost("cancel-task", { id: req.params.id, ...(req.body || {}) }))); }
  catch (error) { res.status(getApiErrorStatus(error)).json({ message: "刪除任務失敗", error: error.message }); }
});

app.post("/items/:id/delete", async (req, res) => {
  try { res.json(normalizeItem(await gasPost("cancel-task", { id: req.params.id, ...(req.body || {}) }))); }
  catch (error) { res.status(getApiErrorStatus(error)).json({ message: "刪除任務失敗", error: error.message }); }
});

app.post("/items/:id/reschedule", async (req, res) => {
  try { res.json(normalizeItem(await gasPost("reschedule-task", { id: req.params.id, ...(req.body || {}) }))); }
  catch (error) { res.status(getApiErrorStatus(error)).json({ message: "調整時間失敗", error: error.message }); }
});

app.post("/items/:id/replan", async (req, res) => {
  try { res.json(await gasPost("replan-task", { id: req.params.id, ...(req.body || {}) })); }
  catch (error) { res.status(getApiErrorStatus(error)).json({ message: "重新整理失敗", error: error.message }); }
});

app.delete("/items/:id", async (req, res) => {
  try {
    const item = await deleteItemFromGoogleSheets(req.params.id);
    res.json({ message: "任務已刪除並保留紀錄", id: item.id, item });
  } catch (error) {
    res.status(getApiErrorStatus(error)).json({ message: "刪除任務失敗", error: error.message });
  }
});

app.get("/categories", async (req, res) => {
  try { res.json((await gasGet("categories")).categories || []); }
  catch (error) { res.status(500).json({ message: "讀取分類失敗", error: error.message }); }
});

app.post("/categories", async (req, res) => {
  try { res.status(201).json(await gasPost("create-category", { category: req.body || {} })); }
  catch (error) { res.status(getApiErrorStatus(error)).json({ message: "新增分類失敗", error: error.message }); }
});

app.patch("/categories/:id", async (req, res) => {
  try { res.json(await gasPost("update-category", { id: req.params.id, updates: req.body || {} })); }
  catch (error) { res.status(getApiErrorStatus(error)).json({ message: "更新分類失敗", error: error.message }); }
});

app.get("/history", async (req, res) => {
  try { res.json((await gasGet("history")).history || []); }
  catch (error) { res.status(500).json({ message: "讀取 History 失敗", error: error.message }); }
});

app.get("/reviews/:cycleNumber", async (req, res) => {
  try { res.json((await gasGet("review", { cycleNumber: Number(req.params.cycleNumber) })).review); }
  catch (error) { res.status(getApiErrorStatus(error)).json({ message: "讀取 Cycle 總結失敗", error: error.message }); }
});

app.get("/retrospectives", async (req, res) => {
  try { res.json((await gasGet("retrospectives")).retrospectives || []); }
  catch (error) { res.status(500).json({ message: "讀取 Weekly Review 失敗", error: error.message }); }
});

app.post("/retrospectives", async (req, res) => {
  try { res.json(await gasPost("submit-retrospective", { retro: req.body || {} })); }
  catch (error) { res.status(getApiErrorStatus(error)).json({ message: "送出 Weekly Review 失敗", error: error.message }); }
});

app.listen(PORT, () => {
  console.log(`Tiny Progress V2 後端啟動：http://localhost:${PORT}`);
});