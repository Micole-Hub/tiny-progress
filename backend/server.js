require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

const GOOGLE_SHEETS_API_URL = process.env.GOOGLE_SHEETS_API_URL;
const GOOGLE_SHEETS_API_SECRET = process.env.GOOGLE_SHEETS_API_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

const pendingActions = new Map();
const PENDING_ACTION_TTL_MS = 10 * 60 * 1000;

const CATEGORY_OPTIONS = ["程式學習", "身心穩定", "興趣探索"];
const SUBCATEGORY_OPTIONS = ["觀看課程影片", "練習", "寫筆記", "W3Schools", "freeCodeCamp"];
const DIFFICULTY_OPTIONS = ["簡單", "適中", "困難"];

const DEFAULT_CATEGORY = "程式學習";
const DEFAULT_SUBCATEGORY = "觀看課程影片";
const EMPTY_SUBCATEGORY = "未分類";
const DEFAULT_DIFFICULTY = "簡單";

if (!GOOGLE_SHEETS_API_URL) {
  throw new Error("缺少環境變數 GOOGLE_SHEETS_API_URL");
}

if (!GOOGLE_SHEETS_API_SECRET) {
  throw new Error("缺少環境變數 GOOGLE_SHEETS_API_SECRET");
}

app.use(cors());
app.use(express.json());

function normalizeCategory(value) {
  const category = String(value || "").trim();
  if (!category) return DEFAULT_CATEGORY;
  if (!CATEGORY_OPTIONS.includes(category)) {
    throw new Error("category 只能是：" + CATEGORY_OPTIONS.join("、"));
  }
  return category;
}

function normalizeSubCategory(value, category = DEFAULT_CATEGORY) {
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
  if (message.includes("已結案封存")) return 409;
  return 500;
}

function normalizeItem(item) {
  const safeItem = item || {};
  const category = normalizeCategory(safeItem.category);

  return {
    ...safeItem,
    id: String(safeItem.id || "").trim(),
    type: String(safeItem.type || "").trim(),
    title: String(safeItem.title || "").trim(),
    category,
    subCategory: normalizeSubCategory(safeItem.subCategory, category),
    difficulty: normalizeDifficulty(safeItem.difficulty),
    done: normalizeDone(safeItem.done),
    weekNumber:
      safeItem.weekNumber === undefined || safeItem.weekNumber === ""
        ? ""
        : Number(safeItem.weekNumber),
    weekStart: safeItem.weekStart || "",
    weekEnd: safeItem.weekEnd || "",
    createdAt: safeItem.createdAt || "",
    updatedAt: safeItem.updatedAt || "",
  };
}

function getSubCategorySortIndex(subCategory) {
  const index = SUBCATEGORY_OPTIONS.indexOf(subCategory);
  return index === -1 ? SUBCATEGORY_OPTIONS.length : index;
}

function sortTasksByCategory(tasks) {
  return [...tasks].sort(function (a, b) {
    const categoryA = normalizeCategory(a.category);
    const categoryB = normalizeCategory(b.category);
    const categoryDiff = CATEGORY_OPTIONS.indexOf(categoryA) - CATEGORY_OPTIONS.indexOf(categoryB);

    if (categoryDiff !== 0) return categoryDiff;

    if (categoryA === "程式學習") {
      return (
        getSubCategorySortIndex(normalizeSubCategory(a.subCategory, categoryA)) -
        getSubCategorySortIndex(normalizeSubCategory(b.subCategory, categoryB))
      );
    }

    return 0;
  });
}

function getDisplayLabel(label) {
  return label === "完成標準" ? "本週驗收標準" : label;
}

function buildGoogleSheetsGetUrl() {
  const url = new URL(GOOGLE_SHEETS_API_URL);
  url.searchParams.set("secret", GOOGLE_SHEETS_API_SECRET);
  return url.toString();
}

function buildGoogleSheetsResourceUrl(resource) {
  const url = new URL(GOOGLE_SHEETS_API_URL);
  url.searchParams.set("secret", GOOGLE_SHEETS_API_SECRET);
  url.searchParams.set("resource", resource);
  return url.toString();
}

async function fetchWeekContextFromGoogleSheets() {
  const response = await fetch(buildGoogleSheetsResourceUrl("week-context"));
  if (!response.ok) {
    throw new Error("呼叫 Google Apps Script 週次資料失敗，狀態碼：" + response.status);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.message || "Google Apps Script 回傳週次資料失敗");
  }

  return {
    previousWeek: data.previousWeek || null,
    currentWeek: data.currentWeek || null,
    nextWeek: data.nextWeek || null,
    canPlanNextWeek: data.canPlanNextWeek === true,
  };
}

async function getCurrentWeekNumberFromGoogleSheets() {
  const context = await fetchWeekContextFromGoogleSheets();
  if (!context.currentWeek || !context.currentWeek.weekNumber) {
    throw new Error("找不到目前週，無法處理 LINE 指令");
  }
  return Number(context.currentWeek.weekNumber);
}

async function fetchItemsFromGoogleSheets() {
  const response = await fetch(buildGoogleSheetsGetUrl());
  if (!response.ok) throw new Error("呼叫 Google Apps Script 失敗，狀態碼：" + response.status);

  const data = await response.json();
  if (!data.ok) throw new Error(data.message || "Google Apps Script 回傳失敗");

  return data.items.map(normalizeItem);
}

async function fetchCurrentWeekItemsFromGoogleSheets() {
  const [items, currentWeekNumber] = await Promise.all([
    fetchItemsFromGoogleSheets(),
    getCurrentWeekNumberFromGoogleSheets(),
  ]);

  return items.filter(function (item) {
    return Number(item.weekNumber) === currentWeekNumber;
  });
}

async function completeCurrentWeekInGoogleSheets() {
  const response = await fetch(GOOGLE_SHEETS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: GOOGLE_SHEETS_API_SECRET,
      action: "complete-current-week",
    }),
  });

  if (!response.ok) throw new Error("呼叫 Google Apps Script 結案失敗，狀態碼：" + response.status);

  const data = await response.json();
  if (!data.ok) throw new Error(data.message || "Google Apps Script 結案失敗");

  return data.result;
}

async function createItemToGoogleSheets({
  type,
  title,
  category,
  subCategory,
  difficulty,
  done,
  weekNumber,
  weekStart,
  weekEnd,
  createdAt,
  updatedAt,
}) {
  const normalizedCategory = normalizeCategory(category);

  const itemPayload = {
    type,
    title,
    category: normalizedCategory,
    subCategory: normalizeSubCategory(subCategory, normalizedCategory),
    difficulty: normalizeDifficulty(difficulty),
    done: done === true,
  };

  if (weekNumber !== undefined && weekNumber !== null && weekNumber !== "") itemPayload.weekNumber = Number(weekNumber);
  if (weekStart !== undefined) itemPayload.weekStart = weekStart;
  if (weekEnd !== undefined) itemPayload.weekEnd = weekEnd;
  if (createdAt !== undefined) itemPayload.createdAt = createdAt;
  if (updatedAt !== undefined) itemPayload.updatedAt = updatedAt;

  const response = await fetch(GOOGLE_SHEETS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: GOOGLE_SHEETS_API_SECRET,
      action: "create",
      item: itemPayload,
    }),
  });

  if (!response.ok) throw new Error("呼叫 Google Apps Script 新增失敗，狀態碼：" + response.status);

  const data = await response.json();
  if (!data.ok) throw new Error(data.message || "Google Apps Script 新增資料失敗");

  return normalizeItem(data.item);
}

async function updateItemToGoogleSheets(id, updates) {
  const safeUpdates = { ...updates };

  if (safeUpdates.category !== undefined) safeUpdates.category = normalizeCategory(safeUpdates.category);
  if (safeUpdates.subCategory !== undefined) {
    safeUpdates.subCategory = normalizeSubCategory(safeUpdates.subCategory, safeUpdates.category || DEFAULT_CATEGORY);
  }
  if (safeUpdates.difficulty !== undefined) safeUpdates.difficulty = normalizeDifficulty(safeUpdates.difficulty);
  if (safeUpdates.weekNumber !== undefined && safeUpdates.weekNumber !== null && safeUpdates.weekNumber !== "") {
    safeUpdates.weekNumber = Number(safeUpdates.weekNumber);
  }

  const response = await fetch(GOOGLE_SHEETS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: GOOGLE_SHEETS_API_SECRET,
      action: "update",
      id,
      updates: safeUpdates,
    }),
  });

  if (!response.ok) throw new Error("呼叫 Google Apps Script 更新失敗，狀態碼：" + response.status);

  const data = await response.json();
  if (!data.ok) throw new Error(data.message || "Google Apps Script 更新資料失敗");

  return normalizeItem(data.item);
}

async function deleteItemFromGoogleSheets(id) {
  const response = await fetch(GOOGLE_SHEETS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: GOOGLE_SHEETS_API_SECRET,
      action: "delete",
      id,
    }),
  });

  if (!response.ok) throw new Error("呼叫 Google Apps Script 刪除失敗，狀態碼：" + response.status);

  const data = await response.json();
  if (!data.ok) throw new Error(data.message || "Google Apps Script 刪除資料失敗");

  return normalizeItem(data.item);
}

function getLineSourceKey(event) {
  return event.source?.userId || event.source?.groupId || event.source?.roomId || "unknown-source";
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
  return ["需要操作說明請輸入：攻略", "想看用量請輸入：用量小抄"].join("\n");
}

function getTaskMetaText(task, includeDifficulty = true) {
  const parts = [normalizeCategory(task.category)];

  if (normalizeCategory(task.category) === "程式學習") {
    parts.push(normalizeSubCategory(task.subCategory, task.category));
  }

  if (includeDifficulty) parts.push(normalizeDifficulty(task.difficulty));
  return parts.join("｜");
}

function getLineSubCategoryLabel(subCategory) {
  if (subCategory === "觀看課程影片") return "看課程";
  if (subCategory === "寫筆記") return "筆記";
  if (subCategory === "W3Schools") return "W3Schools";
  if (subCategory === "freeCodeCamp") return "freeCodeCamp";
  return subCategory;
}

function getLineTaskTitle(title, maxLength = 14) {
  const text = String(title || "").trim().replace(/\s+/g, " ");

  if (!text) return "未命名任務";

  // LINE 卡片空間窄：所有任務名稱都先做短版，完整內容仍保留在資料裡
  if (text.length > maxLength) return text.slice(0, maxLength) + "…";

  return text;
}


function formatTaskSectionByCategory(tasks) {
  if (tasks.length === 0) return ["【本週任務】", "本週尚未立案。放一個小任務，就是好的開始。"].join("\n");

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

        groupTasks.forEach(function (task) {
          const checkbox = task.done ? "☑" : "☐";
          lines.push(
            `${taskNumber}. ${checkbox} ${task.title}｜${normalizeSubCategory(task.subCategory, category)}｜${normalizeDifficulty(task.difficulty)}`
          );
          taskNumber += 1;
        });
      });
      return;
    }

    categoryTasks.forEach(function (task) {
      const checkbox = task.done ? "☑" : "☐";
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
  const weekTitle = currentWeek ? `第 ${currentWeek.weekNumber} 週｜${currentWeek.title}` : "本週案件板";

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
      "沒有案件也無妨，先喝水，本局不追殺。",
      "",
      "需要完整清單請輸入：清單",
    ].join("\n");
  }

  const lines = matchedTasks.map(function (entry) {
    const checkbox = entry.task.done ? "☑" : "☐";
    return `${entry.originalNumber}. ${checkbox} ${entry.task.title}｜${getTaskMetaText(entry.task, false)}`;
  });

  const firstUnfinishedEntry = matchedTasks.find((entry) => !entry.task.done);
  const commandHint = firstUnfinishedEntry ? `可直接輸入：完成任務${firstUnfinishedEntry.originalNumber}` : "本區案件已辦理完畢";

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

const FLEX_BRAND_NAME = "Tiny Progress";
const FLEX_FIXED_LINE = "小小前進，也算數。今天慢慢辦也可以。";

const FLEX_COLORS = {
  // 柔亮奶油公文封：亮一點，但不白到刺眼
  cream: "#FBF1E3",
  card: "#FFF8ED",
  paper: "#FFFDF7",
  cardSoft: "#FFF3E4",

  darkGreen: "#263D35",
  greenFresh: "#91B980",
  beigeLine: "#E5D2BA",
  mutedText: "#75695F",
  softText: "#93867A",

  red: "#C97461",
  gold: "#DDB36A",
  peach: "#F2C6B6",
  mint: "#EAF3E3",

  stampBg: "#F8DDD2",
  stampText: "#A75D4B",
  stickerBg: "#FFF6D8",
  stickerText: "#95662B",

  // 大分類：淺底深字，保留公文標籤感
  programming: "#E2ECF6",
  programmingText: "#3F6380",
  wellness: "#F0E2E9",
  wellnessText: "#77576B",
  interest: "#F4E0C3",
  interestText: "#8A5A25",

  // 子分類：小書籤造型，和難度小印章分開
  video: "#D9E1F2",
  videoText: "#405989",
  videoAccent: "#6F7FA8",
  practice: "#DDEBD8",
  practiceText: "#466F48",
  practiceAccent: "#6E9B72",
  note: "#F1DAC0",
  noteText: "#815426",
  noteAccent: "#C28A5A",
  w3schools: "#F1DDE0",
  w3schoolsText: "#7A4B52",
  w3schoolsAccent: "#C47F88",
  freecodecamp: "#E6DDF1",
  freecodecampText: "#604A78",
  freecodecampAccent: "#9A80BF",

  uncategorized: "#EFE4D8",
  uncategorizedText: "#7A6E5F",
};

const FLEX_ACCENTS = {
  all: FLEX_COLORS.red,
  draw: FLEX_COLORS.gold,
  easy: FLEX_COLORS.greenFresh,
  medium: FLEX_COLORS.gold,
  hard: FLEX_COLORS.red,
};

function getCategoryFlexStyle(category) {
  const normalizedCategory = normalizeCategory(category);

  if (normalizedCategory === "程式學習") {
    return { backgroundColor: FLEX_COLORS.programming, textColor: FLEX_COLORS.programmingText, borderColor: "#C7D7E6" };
  }

  if (normalizedCategory === "身心穩定") {
    return { backgroundColor: FLEX_COLORS.wellness, textColor: FLEX_COLORS.wellnessText, borderColor: "#DEC9D3" };
  }

  if (normalizedCategory === "興趣探索") {
    return { backgroundColor: FLEX_COLORS.interest, textColor: FLEX_COLORS.interestText, borderColor: "#E3C79F" };
  }

  return { backgroundColor: "#EAF2E6", textColor: "#4F6F4D", borderColor: "#D1DEC9" };
}

function getSubCategoryFlexStyle(subCategory) {
  if (subCategory === "觀看課程影片") {
    return {
      backgroundColor: FLEX_COLORS.video,
      textColor: FLEX_COLORS.videoText,
      borderColor: "#BBC7E7",
      accentColor: FLEX_COLORS.videoAccent,
    };
  }
  if (subCategory === "練習") {
    return {
      backgroundColor: FLEX_COLORS.practice,
      textColor: FLEX_COLORS.practiceText,
      borderColor: "#B9D9BC",
      accentColor: FLEX_COLORS.practiceAccent,
    };
  }
  if (subCategory === "寫筆記") {
    return {
      backgroundColor: FLEX_COLORS.note,
      textColor: FLEX_COLORS.noteText,
      borderColor: "#DEBA8D",
      accentColor: FLEX_COLORS.noteAccent,
    };
  }
  if (subCategory === "W3Schools") {
    return {
      backgroundColor: FLEX_COLORS.w3schools,
      textColor: FLEX_COLORS.w3schoolsText,
      borderColor: "#D9B7BE",
      accentColor: FLEX_COLORS.w3schoolsAccent,
    };
  }
  if (subCategory === "freeCodeCamp") {
    return {
      backgroundColor: FLEX_COLORS.freecodecamp,
      textColor: FLEX_COLORS.freecodecampText,
      borderColor: "#CABADD",
      accentColor: FLEX_COLORS.freecodecampAccent,
    };
  }
  return {
    backgroundColor: FLEX_COLORS.uncategorized,
    textColor: FLEX_COLORS.uncategorizedText,
    borderColor: "#D9CCBC",
    accentColor: "#B6A999",
  };
}

function getDifficultyFlexStyle(difficulty) {
  const normalizedDifficulty = normalizeDifficulty(difficulty);

  // 難度不再使用大面積彩色底，改成米白底 + 小色點，避免跟子分類混在一起
  if (normalizedDifficulty === "簡單") {
    return {
      backgroundColor: "#FBF5EA",
      textColor: "#6F7D62",
      borderColor: "#DED3C4",
      accentColor: "#7EAB67",
    };
  }

  if (normalizedDifficulty === "適中") {
    return {
      backgroundColor: "#FBF5EA",
      textColor: "#8A6B35",
      borderColor: "#DED3C4",
      accentColor: "#D5A751",
    };
  }

  return {
    backgroundColor: "#FBF5EA",
    textColor: "#9A5A55",
    borderColor: "#DED3C4",
    accentColor: "#C97769",
  };
}

function getDifficultyAccentColor(difficulty) {
  const normalizedDifficulty = normalizeDifficulty(difficulty);
  if (normalizedDifficulty === "簡單") return FLEX_ACCENTS.easy;
  if (normalizedDifficulty === "適中") return FLEX_ACCENTS.medium;
  return FLEX_ACCENTS.hard;
}

function getDifficultyFooterCopy(difficulty, isCompleted) {
  const normalizedDifficulty = normalizeDifficulty(difficulty);

  if (normalizedDifficulty === "簡單") return isCompleted ? "熱身完成，今天已經有動起來。" : "先熱身一下，本局不催跑。";
  if (normalizedDifficulty === "適中") return isCompleted ? "穩穩辦完，本局予以記錄。" : "穩穩推進，不用開倍速。";
  return isCompleted ? "大案收妥，今天可以蓋一枚章。" : "大案也能小辦，不必硬闖。";
}

function buildTinyStamp(text, options = {}) {
  return {
    type: "box",
    layout: "vertical",
    flex: 0,
    backgroundColor: options.backgroundColor || FLEX_COLORS.stampBg,
    cornerRadius: "999px",
    paddingTop: "3px",
    paddingBottom: "3px",
    paddingStart: "8px",
    paddingEnd: "8px",
    contents: [
      {
        type: "text",
        text,
        size: "xxs",
        weight: "bold",
        color: options.color || FLEX_COLORS.stampText,
        align: "center",
        flex: 0,
      },
    ],
  };
}

function buildCuteSectionLabel(emoji, text, color) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    alignItems: "center",
    contents: [
      { type: "text", text: emoji, size: "sm", flex: 0 },
      {
        type: "text",
        text,
        size: "sm",
        weight: "bold",
        color: color || FLEX_COLORS.mutedText,
        flex: 1,
      },
    ],
  };
}

function buildCuteEmptyNote(title, note, emoji) {
  return [
    { type: "text", text: emoji || "🐣", size: "lg", align: "center" },
    { type: "text", text: title, size: "md", color: FLEX_COLORS.darkGreen, weight: "bold", wrap: true, align: "center" },
    { type: "text", text: note, size: "sm", color: FLEX_COLORS.mutedText, wrap: true, align: "center" },
  ];
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
  const style = getCategoryFlexStyle(category);

  return buildFlexTag(category, style.backgroundColor, style.textColor, {
    width: options.width || "100px",
    cornerRadius: "999px",
    size: "xs",
    weight: "bold",
    borderColor: style.borderColor,
    paddingTop: "5px",
    paddingBottom: "5px",
    paddingStart: "7px",
    paddingEnd: "7px",
  });
}

function buildSubCategoryFlexTag(subCategory, options = {}) {
  const style = getSubCategoryFlexStyle(subCategory);
  const displayLabel = getLineSubCategoryLabel(subCategory);

  return {
    type: "box",
    layout: "horizontal",
    flex: 0,
    width: options.width || "70px",
    backgroundColor: style.backgroundColor,
    cornerRadius: "10px",
    borderColor: style.borderColor,
    borderWidth: "1px",
    paddingTop: "4px",
    paddingBottom: "4px",
    paddingStart: "0px",
    paddingEnd: "6px",
    spacing: "xs",
    contents: [
      {
        // 子分類左側色條：像小書籤，和難度的圓點造型分開
        type: "box",
        layout: "vertical",
        width: "4px",
        backgroundColor: style.accentColor,
        cornerRadius: "999px",
        contents: [],
      },
      {
        type: "text",
        text: displayLabel,
        size: "xxs",
        weight: "bold",
        color: style.textColor,
        align: "center",
        flex: 1,
        maxLines: 1,
      },
    ],
  };
}

function getSubCategoryFlexTagWidth(subCategory) {
  if (subCategory === "W3Schools") return "86px";
  if (subCategory === "freeCodeCamp") return "96px";
  return "70px";
}


function buildDifficultyFlexTag(difficulty, options = {}) {
  const style = getDifficultyFlexStyle(difficulty);

  return {
    type: "box",
    layout: "horizontal",
    flex: 0,
    width: options.width || "56px",
    backgroundColor: style.backgroundColor,
    cornerRadius: "7px",
    borderColor: style.borderColor,
    borderWidth: "1px",
    paddingTop: "3px",
    paddingBottom: "3px",
    paddingStart: "6px",
    paddingEnd: "6px",
    spacing: "xs",
    contents: [
      {
        // 難度用小圓點，不用大面積色塊，避免跟子分類長太像
        type: "box",
        layout: "vertical",
        width: "6px",
        height: "6px",
        backgroundColor: style.accentColor,
        cornerRadius: "999px",
        margin: "sm",
        contents: [],
      },
      {
        type: "text",
        text: difficulty,
        size: "xxs",
        weight: "bold",
        color: style.textColor,
        align: "center",
        flex: 1,
        maxLines: 1,
      },
    ],
  };
}

function buildAccentBar(accentColor) {
  return {
    type: "box",
    layout: "vertical",
    height: "6px",
    backgroundColor: accentColor || FLEX_COLORS.greenFresh,
    cornerRadius: "999px",
    contents: [],
  };
}

function buildFlexHeader(title, subtitle) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
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
              { type: "text", text: FLEX_BRAND_NAME, size: "sm", color: FLEX_COLORS.darkGreen, weight: "bold", flex: 0 },
            ],
          },
          buildTinyStamp("小小前進", { backgroundColor: FLEX_COLORS.stampBg, color: FLEX_COLORS.stampText }),
        ],
      },
      { type: "text", text: title, size: "xl", weight: "bold", color: FLEX_COLORS.darkGreen, wrap: true },
      { type: "text", text: subtitle || FLEX_FIXED_LINE, size: "sm", color: FLEX_COLORS.mutedText, wrap: true },
    ],
  };
}

function buildFlexInfoCard(contents, options = {}) {
  const cardContents = [];

  if (options.label || options.emoji) {
    cardContents.push(buildCuteSectionLabel(options.emoji || "📎", options.label || "小櫃台", options.labelColor || FLEX_COLORS.mutedText));
  }

  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    backgroundColor: options.backgroundColor || FLEX_COLORS.card,
    cornerRadius: "18px",
    paddingAll: "16px",
    borderColor: options.borderColor || "#E6D4BD",
    borderWidth: "1px",
    contents: cardContents.concat(contents),
  };
}

function buildProgressLine(label, doneCount, totalCount) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    contents: [
      { type: "text", text: label, size: "sm", color: FLEX_COLORS.mutedText, flex: 0 },
      { type: "text", text: `${doneCount} / ${totalCount}`, size: "sm", color: FLEX_COLORS.darkGreen, weight: "bold", align: "end" },
    ],
  };
}

function buildTaskFlexRow({ task, taskNumber, showDifficulty, showCategory, showSubCategory = true }) {
  const checkbox = task.done ? "☑" : "☐";
  const difficulty = normalizeDifficulty(task.difficulty);
  const category = normalizeCategory(task.category);
  const isProgrammingTask = category === "程式學習";
  const tagContents = [];

  if (showCategory) {
    tagContents.push(
      buildCategoryFlexTag(category, {
        width: isProgrammingTask ? "100px" : "128px",
      })
    );
  }

  if (showSubCategory && isProgrammingTask) {
    const subCategory = normalizeSubCategory(task.subCategory, category);

    tagContents.push(
      buildSubCategoryFlexTag(subCategory, {
        width: getSubCategoryFlexTagWidth(subCategory),
      })
    );
  }

  const rowContents = [
    {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      alignItems: "center",
      contents: [
        {
          type: "text",
          text: `${taskNumber}. ${checkbox} ${getLineTaskTitle(task.title, 14)}`,
          size: task.done ? "sm" : "md",
          color: task.done ? "#92867B" : FLEX_COLORS.darkGreen,
          wrap: false,
          maxLines: 1,
          weight: task.done ? "regular" : "bold",
          flex: 1,
        },
        ...(showDifficulty
          ? [
              buildDifficultyFlexTag(difficulty, {
                width: isProgrammingTask ? "54px" : "62px",
              }),
            ]
          : []),
      ],
    },
  ];

  if (tagContents.length > 0) {
    rowContents.push({
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      margin: "sm",
      contents: tagContents,
    });
  }

  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    paddingBottom: "12px",
    contents: rowContents,
  };
}


function buildStandardFlexRow({ standard, standardNumber }) {
  const checkbox = standard.done ? "☑" : "☐";

  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    paddingBottom: "10px",
    contents: [
      {
        type: "text",
        text: `${standardNumber}. ${checkbox} ${getLineTaskTitle(standard.title, 16)}`,
        size: "sm",
        color: standard.done ? "#92867B" : FLEX_COLORS.darkGreen,
        wrap: false,
        maxLines: 1,
        weight: standard.done ? "regular" : "bold",
      },
    ],
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

function buildBaseFlexBubble({ title, subtitle, bodyContents, footerContents, accentColor }) {
  const contents = [
    {
      type: "box",
      layout: "horizontal",
      spacing: "xs",
      contents: [
        buildAccentBar(accentColor),
        {
          type: "box",
          layout: "vertical",
          width: "12px",
          height: "6px",
          backgroundColor: "#F2D8C4",
          cornerRadius: "999px",
          contents: [],
        },
      ],
    },
    buildFlexHeader(title, subtitle),
    { type: "separator", margin: "md", color: FLEX_COLORS.beigeLine },
    ...bodyContents,
  ];

  if (footerContents) {
    contents.push({ type: "separator", margin: "md", color: FLEX_COLORS.beigeLine });
    contents.push(footerContents);
  }

  return {
    type: "bubble",
    size: "mega",
    styles: {
      body: { backgroundColor: FLEX_COLORS.cream },
      footer: { backgroundColor: FLEX_COLORS.cream },
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "22px",
      spacing: "md",
      contents,
    },
  };
}

function buildDrawOneTaskFallbackText({ selectedTask, taskNumber }) {
  return [
    "🎲 Tiny Progress｜今日抽到一件小案子",
    "",
    `第 ${taskNumber} 個任務`,
    `☐ ${selectedTask.title}`,
    "",
    `分類：${getTaskMetaText(selectedTask)}`,
    "",
    "完成後可以輸入：",
    `完成任務${taskNumber}`,
    "",
    "先辦這件就好，其他公文先排隊。",
  ].join("\n");
}

function buildTaskTagBox(task, showDifficulty) {
  const category = normalizeCategory(task.category);
  const isProgrammingTask = category === "程式學習";
  const tags = [];

  tags.push(
    buildCategoryFlexTag(category, {
      width: isProgrammingTask ? "100px" : "128px",
    })
  );

  if (isProgrammingTask) {
    const subCategory = normalizeSubCategory(task.subCategory, category);
    tags.push(
      buildSubCategoryFlexTag(subCategory, {
        width: getSubCategoryFlexTagWidth(subCategory),
      })
    );
  }

  if (showDifficulty) {
    const difficulty = normalizeDifficulty(task.difficulty);
    tags.push(
      buildDifficultyFlexTag(difficulty, {
        width: isProgrammingTask ? "56px" : "84px",
      })
    );
  }

  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    margin: "sm",
    contents: tags,
  };
}

function buildDrawTaskTagBox(task) {
  const category = normalizeCategory(task.category);
  const isProgrammingTask = category === "程式學習";
  const tags = [];

  tags.push(
    buildCategoryFlexTag(category, {
      width: isProgrammingTask ? "92px" : "120px",
    })
  );

  if (isProgrammingTask) {
    const subCategory = normalizeSubCategory(task.subCategory, category);

    tags.push(
      buildSubCategoryFlexTag(subCategory, {
        width: getSubCategoryFlexTagWidth(subCategory),
      })
    );
  }

  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    margin: "sm",
    contents: tags,
  };
}

function buildDrawEmptyFlexMessage() {
  const bubble = buildBaseFlexBubble({
    title: "今日抽到空抽屜",
    subtitle: "本週暫時沒有未完成任務，可以先整理一下小櫃台。",
    accentColor: FLEX_ACCENTS.draw,
    bodyContents: [
      buildFlexInfoCard(
        [
          {
            type: "text",
            text: "🐣",
            size: "xxl",
            align: "center",
          },
          {
            type: "text",
            text: "目前沒有任務可以抽。",
            size: "md",
            color: FLEX_COLORS.darkGreen,
            weight: "bold",
            wrap: true,
            align: "center",
          },
          {
            type: "text",
            text: "先放一個小任務，抽籤櫃就能開張。",
            size: "sm",
            color: FLEX_COLORS.mutedText,
            wrap: true,
            align: "center",
          },
        ],
        {
          label: "抽籤小櫃台",
          emoji: "🥚",
          borderColor: "#E5C98F",
          backgroundColor: "#FFF6E3",
          labelColor: "#9A6B2E",
        }
      ),
    ],
    footerContents: buildFlexFooterHint([
      "可以輸入：清單",
      "先確認案件板，再決定要不要立案。",
    ]),
  });

  return {
    type: "flex",
    altText: "Tiny Progress｜目前沒有任務可以抽",
    contents: bubble,
  };
}


function buildDrawOneTaskFlexMessage({ selectedTask, taskNumber }) {
  const difficulty = normalizeDifficulty(selectedTask.difficulty);

  const bubble = buildBaseFlexBubble({
    title: "抽到一件小案子",
    subtitle: "本局已搖出今日小籤，先辦它就好。",
    accentColor: FLEX_ACCENTS.draw,
    bodyContents: [
      buildFlexInfoCard(
        [
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            alignItems: "center",
            contents: [
              {
                type: "box",
                layout: "vertical",
                width: "24px",
                height: "24px",
                backgroundColor: FLEX_COLORS.stickerBg,
                cornerRadius: "999px",
                justifyContent: "center",
                alignItems: "center",
                contents: [
                  {
                    type: "text",
                    text: "🎲",
                    size: "xs",
                    align: "center",
                  },
                ],
              },
              {
                type: "text",
                text: `第 ${taskNumber} 個任務`,
                size: "sm",
                color: FLEX_COLORS.darkGreen,
                weight: "bold",
                flex: 1,
                wrap: false,
                maxLines: 1,
              },
              buildDifficultyFlexTag(difficulty, {
                width: "54px",
              }),
            ],
          },
          {
            type: "text",
            text: getLineTaskTitle(selectedTask.title, 14),
            size: "md",
            weight: "bold",
            color: FLEX_COLORS.darkGreen,
            margin: "xs",
            wrap: false,
            maxLines: 1,
          },
          buildDrawTaskTagBox(selectedTask),
          {
            type: "text",
            text: "先辦這件就好，其他公文先排隊。",
            size: "xs",
            color: FLEX_COLORS.mutedText,
            wrap: true,
            margin: "sm",
          },
        ],
        {
          borderColor: "#E5C98F",
          backgroundColor: "#FFF6E3",
        }
      ),
    ],
    footerContents: buildFlexFooterHint([
      `完成後輸入：完成任務${taskNumber}`,
      "不用想整週，先過這一關。",
    ]),
  });

  return {
    type: "flex",
    altText: `Tiny Progress｜今日抽到一件小案子：${getLineTaskTitle(selectedTask.title, 20)}`,
    contents: bubble,
  };
}


async function handleDrawOneTaskCommand() {
  const board = await getTaskBoardForLine();
  const unfinishedTasks = board.tasks.filter((task) => !task.done);

  if (unfinishedTasks.length === 0) {
    return {
      replyText: [
        "🎲 Tiny Progress｜抽籤小櫃台",
        "",
        "目前沒有未完成任務可以抽。",
        "先放一個小任務，抽籤櫃就能開張。",
        "",
        "可以輸入「清單」確認目前案件板。",
      ].join("\n"),
      replyMessages: [buildDrawEmptyFlexMessage()],
    };
  }

  const selectedTask = unfinishedTasks[Math.floor(Math.random() * unfinishedTasks.length)];
  const taskNumber = board.tasks.findIndex((task) => task.id === selectedTask.id) + 1;

  return {
    replyText: buildDrawOneTaskFallbackText({ selectedTask, taskNumber }),
    replyMessages: [buildDrawOneTaskFlexMessage({ selectedTask, taskNumber })],
  };
}


function buildDifficultyTaskFooterLines(matchedTasks, difficulty) {
  const firstUnfinishedEntry = matchedTasks.find((entry) => !entry.task.done);
  if (!firstUnfinishedEntry) return ["本區案件已辦理完畢", getDifficultyFooterCopy(difficulty, true)];
  return [`可直接輸入：完成任務${firstUnfinishedEntry.originalNumber}`, getDifficultyFooterCopy(difficulty, false)];
}

function buildDifficultyTaskListFlexMessage({ tasks, difficulty }) {
  const matchedTasks = tasks
    .map((task, index) => ({ task, originalNumber: index + 1 }))
    .filter((entry) => normalizeDifficulty(entry.task.difficulty) === difficulty);

  const unfinishedCount = matchedTasks.filter((entry) => !entry.task.done).length;
  let bodyContents = [];

  if (matchedTasks.length === 0) {
    bodyContents = [
      buildFlexInfoCard(
        buildCuteEmptyNote(
          `目前沒有${difficulty}任務。`,
          "抽屜是空的，先喝水，本局不追殺。",
          "🫧"
        ),
        { label: `${difficulty}任務小抽屜`, emoji: "🗂️", backgroundColor: FLEX_COLORS.paper }
      ),
    ];
  } else {
    const limitedEntries = matchedTasks.slice(0, 8);

    bodyContents = [
      buildFlexInfoCard(
        [
          { type: "text", text: `未完成：${unfinishedCount} 件`, size: "sm", color: FLEX_COLORS.mutedText, weight: "bold" },
          ...limitedEntries.map((entry) =>
            buildTaskFlexRow({
              task: entry.task,
              taskNumber: entry.originalNumber,
              showDifficulty: false,
              showCategory: true,
            })
          ),
          ...(matchedTasks.length > limitedEntries.length
            ? [
                {
                  type: "text",
                  text: `還有 ${matchedTasks.length - limitedEntries.length} 件躲在完整清單裡，可輸入「清單」查看。`,
                  size: "xs",
                  color: FLEX_COLORS.mutedText,
                  wrap: true,
                },
              ]
            : []),
        ],
        { label: `${difficulty}任務小抽屜`, emoji: "🗂️", backgroundColor: FLEX_COLORS.paper }
      ),
    ];
  }

  const bubble = buildBaseFlexBubble({
    title: `本週${difficulty}任務`,
    subtitle: "同一個案件板，打開比較剛好的小抽屜。",
    accentColor: getDifficultyAccentColor(difficulty),
    bodyContents,
    footerContents: buildFlexFooterHint(
      matchedTasks.length === 0
        ? ["需要完整清單請輸入：清單", "沒有案件也算一種清爽，抽屜今天很乖。"]
        : buildDifficultyTaskFooterLines(matchedTasks, difficulty)
    ),
  });

  return {
    type: "flex",
    altText: `Tiny Progress｜本週${difficulty}任務`,
    contents: bubble,
  };
}

async function handleDifficultyTaskFlexCommand(difficulty) {
  const tasks = await getItemsByType("task");

  return {
    replyText: formatTasksByDifficultyForLine(tasks, difficulty),
    replyMessages: [buildDifficultyTaskListFlexMessage({ tasks, difficulty })],
  };
}

function buildAllListFlexMessage({ currentWeek, tasks, standards }) {
  const taskDoneCount = tasks.filter((task) => task.done).length;
  const standardDoneCount = standards.filter((standard) => standard.done).length;
  const weekTitle = currentWeek ? `第${currentWeek.weekNumber}週｜${currentWeek.title}` : "本週案件板";

  const taskRows = tasks.slice(0, 8).map((task, index) =>
    buildTaskFlexRow({
      task,
      taskNumber: index + 1,
      showDifficulty: true,
      showCategory: true,
    })
  );

  const standardRows = standards.slice(0, 5).map((standard, index) =>
    buildStandardFlexRow({
      standard,
      standardNumber: index + 1,
    })
  );

  const bodyContents = [
    buildFlexInfoCard(
      [
        { type: "text", text: weekTitle, size: "xs", color: FLEX_COLORS.mutedText, weight: "bold", wrap: false, maxLines: 1 },
        buildProgressLine("任務進度", taskDoneCount, tasks.length),
        buildProgressLine("標準進度", standardDoneCount, standards.length),
      ],
      { label: "本週小章", emoji: "🐾", backgroundColor: "#FFF6E3", borderColor: "#E5C98F", labelColor: "#9A6B2E" }
    ),
  ];

  if (tasks.length === 0) {
    bodyContents.push(
      buildFlexInfoCard(
        [
          {
            type: "text",
            text: "本週任務尚未立案。",
            size: "md",
            color: FLEX_COLORS.darkGreen,
            weight: "bold",
            wrap: true,
            align: "center",
          },
          {
            type: "text",
            text: "先放一個小任務，就能開張。",
            size: "sm",
            color: FLEX_COLORS.mutedText,
            wrap: true,
            align: "center",
          },
        ],
        { label: "本週任務櫃", emoji: "🐣", backgroundColor: FLEX_COLORS.paper }
      )
    );
  } else {
    bodyContents.push(
      buildFlexInfoCard(
        [
          ...taskRows,
          ...(tasks.length > taskRows.length
            ? [
                {
                  type: "text",
                  text: `還有 ${tasks.length - taskRows.length} 件任務在完整任務板裡，先不用把整櫃搬出來。`,
                  size: "xs",
                  color: FLEX_COLORS.mutedText,
                  wrap: true,
                },
              ]
            : []),
        ],
        { label: "本週任務櫃", emoji: "🐣", backgroundColor: FLEX_COLORS.paper }
      )
    );
  }

  if (standards.length === 0) {
    bodyContents.push(
      buildFlexInfoCard(
        [
          {
            type: "text",
            text: "本週驗收標準尚未成文。",
            size: "md",
            color: FLEX_COLORS.darkGreen,
            weight: "bold",
            wrap: true,
            align: "center",
          },
          {
            type: "text",
            text: "先寫一個方向，慢慢孵出成果。",
            size: "sm",
            color: FLEX_COLORS.mutedText,
            wrap: true,
            align: "center",
          },
        ],
        { label: "驗收小紙條", emoji: "🥚", backgroundColor: "#FFF8EF" }
      )
    );
  } else {
    bodyContents.push(
      buildFlexInfoCard(
        [
          ...standardRows,
          ...(standards.length > standardRows.length
            ? [
                {
                  type: "text",
                  text: `還有 ${standards.length - standardRows.length} 則標準在任務板裡安靜排隊。`,
                  size: "xs",
                  color: FLEX_COLORS.mutedText,
                  wrap: true,
                },
              ]
            : []),
        ],
        { label: "驗收小紙條", emoji: "🥚", backgroundColor: "#FFF8EF" }
      )
    );
  }

  const bubble = buildBaseFlexBubble({
    title: "本週案件板",
    subtitle: "案件都在這裡，今天先辦一小件。",
    accentColor: FLEX_ACCENTS.all,
    bodyContents,
    footerContents: buildFlexFooterHint([
      "今天不用清空整櫃，先辦一件。",
      "需要操作說明請輸入：攻略",
    ]),
  });

  return {
    type: "flex",
    altText: "Tiny Progress｜本週案件板",
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
    text: String(text || "本局目前沒有可回覆的內容。"),
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
    "📋 Tiny Progress｜辦事攻略",
    "",
    "【查看】",
    "清單：看本週任務與驗收標準",
    "簡單任務：看簡單任務",
    "適中任務：看適中任務",
    "困難任務：看困難任務",
    "抽一件：從未完成任務裡抽一件",
    "",
    "【新增】",
    "新增任務 練習 CSS",
    "新增任務 練習 CSS Flex｜程式學習｜練習｜適中",
    "新增任務 看完 HTML 課程｜程式學習｜觀看課程影片｜簡單",
    "新增任務 解 freeCodeCamp 表單題｜程式學習｜freeCodeCamp｜適中",
    "新增標準 本週能說明一個學到的觀念",
    "",
    "分類可用：程式學習、身心穩定、興趣探索",
    "程式學習子分類：觀看課程影片、練習、寫筆記、W3Schools、freeCodeCamp",
    "難度可用：簡單、適中、困難",
    "",
    "【辦理】",
    "完成任務3 / 取消任務3 / 修改任務3 / 刪除任務3",
    "完成標準2 / 取消標準2 / 修改標準2 / 刪除標準2",
    "",
    "【修訂中止】",
    "取消修改",
    "",
    "小小前進，也算數。",
  ].join("\n");
}

function getUsageText() {
  return [
    "📮 Tiny Progress｜LINE 用量小抄",
    "",
    "你主動傳訊息，Bot 立刻回覆：",
    "清單、攻略、抽一件、新增、完成、修改、刪除",
    "",
    "Bot 主動傳給你：",
    "每日提醒、主動補提醒、主動通知",
    "",
    "目前建議：",
    "每天主動提醒最多 1 則。",
    "你主動問，本局再回。",
  ].join("\n");
}

async function handlePendingActionIfNeeded(sourceKey, userText) {
  const pending = pendingActions.get(sourceKey);
  if (!pending) return null;

  const displayLabel = getDisplayLabel(pending.label);

  if (userText === "取消修改") {
    pendingActions.delete(sourceKey);
    return "已取消這次修訂。本局把待辦公文收回抽屜了。";
  }

  if (Date.now() - pending.createdAt > PENDING_ACTION_TTL_MS) {
    pendingActions.delete(sourceKey);
    return ["這次修訂已經逾時，本局未更動資料。", "", `可以重新輸入：修改${pending.label} 數字`].join("\n");
  }

  const newTitle = userText.trim();
  if (!newTitle) return `請輸入新的${displayLabel}文字，或輸入「取消修改」。`;

  const updatedItem = await updateItemToGoogleSheets(pending.itemId, { title: newTitle });
  pendingActions.delete(sourceKey);

  return [`已修訂第 ${pending.itemNumber} 個${displayLabel}：`, updatedItem.title || newTitle, "", "本局已更新公文內容。"].join("\n");
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
    return [`這份立案公文還缺少${displayLabel}內容，本局未更動資料。`, "", `例：${command} ${example}`].join("\n");
  }

  let category;
  let subCategory;
  let difficulty;

  try {
    category = normalizeCategory(parsed.category);
    subCategory = normalizeSubCategory(parsed.subCategory, category);
    difficulty = normalizeDifficulty(parsed.difficulty);
  } catch (error) {
    return ["分類、子分類或難度需要補正，本局未更動資料。", "", error.message, "", "例：新增任務 練習 CSS｜程式學習｜練習｜適中"].join("\n");
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
      "Tiny Progress 已立案：",
      `☐ ${createdItem.title || parsed.title}`,
      `分類：${getTaskMetaText(createdItem)}`,
      "",
      "若要新增驗收標準，可輸入：",
      "新增標準 本週能說明一個學到的觀念",
      "",
      "可以輸入「清單」查看目前案件板。",
    ].join("\n");
  }

  return ["Tiny Progress 已新增本週驗收標準：", `☐ ${createdItem.title || parsed.title}`, "", "可以輸入「清單」查看目前案件板。"].join("\n");
}

async function findItemByNumber({ type, numberText, label }) {
  const itemNumber = Number(numberText);
  const displayLabel = getDisplayLabel(label);

  if (!Number.isInteger(itemNumber) || itemNumber <= 0) {
    return {
      error: [`這份公文還缺少正確的${displayLabel}編號，本局未更動資料。`, "", "可以這樣輸入：", `完成${label}3`, `完成第三個${label}`].join("\n"),
    };
  }

  const items = await getItemsByType(type);
  const targetItem = items[itemNumber - 1];

  if (!targetItem) {
    return {
      error: [`本局目前查無第 ${itemNumber} 個${displayLabel}。`, "", "可以先輸入「清單」確認編號。"].join("\n"),
    };
  }

  return { itemNumber, item: targetItem, items };
}

async function handleDoneCommand({ numberText, type, label, done }) {
  const result = await findItemByNumber({ type, numberText, label });
  if (result.error) return result.error;

  const updatedItem = await updateItemToGoogleSheets(result.item.id, { done });
  const checkbox = done ? "☑" : "☐";
  const actionText = done ? "已辦理" : "已撤回辦理";
  const displayLabel = getDisplayLabel(label);

  return [`${actionText}第 ${result.itemNumber} 個${displayLabel}：`, `${checkbox} ${updatedItem.title || result.item.title}`, "", "小小前進，也算數。"].join("\n");
}

async function handleDeleteCommand({ numberText, type, label }) {
  const result = await findItemByNumber({ type, numberText, label });
  if (result.error) return result.error;

  const deletedItem = await deleteItemFromGoogleSheets(result.item.id);
  const displayLabel = getDisplayLabel(label);

  return [`已撤案第 ${result.itemNumber} 個${displayLabel}：`, deletedItem.title || result.item.title, "", "本局已更新案件板。"].join("\n");
}

async function handleEditCommand({ sourceKey, numberText, newTitle, type, label }) {
  const result = await findItemByNumber({ type, numberText, label });
  if (result.error) return result.error;

  const displayLabel = getDisplayLabel(label);

  if (newTitle && newTitle.trim()) {
    const updatedItem = await updateItemToGoogleSheets(result.item.id, { title: newTitle.trim() });
    return [`已修訂第 ${result.itemNumber} 個${displayLabel}：`, updatedItem.title || newTitle.trim(), "", "本局已更新公文內容。"].join("\n");
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

  return [`請輸入第 ${result.itemNumber} 個${displayLabel}的新文字：`, "", `目前內容：${result.item.title}`, "", "若不想修訂，請輸入：取消修改"].join("\n");
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
    return { error: "這份公文還缺少正確編號，本局未更動資料。可以這樣輸入：完成第 3 個任務" };
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
    "這份公文格式需補正，本局未更動資料。",
    "",
    "常用格式：",
    "新增任務 練習 CSS｜程式學習｜練習｜適中",
    "完成任務3",
    "取消任務3",
    "修改任務3",
    "刪除任務3",
    "完成標準2",
    "",
    "需要完整說明請輸入：攻略",
  ].join("\n");
}

function getUnknownCommandText() {
  return [
    "Tiny Progress 目前看不懂這份公文，所以未更動資料。",
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

  if (["攻略", "說明", "help", "Help"].includes(userText)) return getGuideText();
  if (["用量", "用量小抄", "訊息用量"].includes(userText)) return getUsageText();
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

app.get("/", (req, res) => {
  res.send("Tiny Progress API 開張中。本局小櫃台今日值班。");
});

app.post("/gas-queue", async (req, res) => {
  try {
    const { source, queueId, userId, messageText } = req.body || {};

    if (source !== "gas_queue") return res.status(400).json({ ok: false, message: "source 必須是 gas_queue" });
    if (!queueId) return res.status(400).json({ ok: false, message: "缺少 queueId" });
    if (!userId) return res.status(400).json({ ok: false, message: "缺少 userId" });

    const userText = String(messageText || "").trim();
    if (!userText) return res.status(400).json({ ok: false, message: "缺少 messageText" });

    const replyResult = await handleLineTextCommand({ sourceKey: String(userId).trim(), userText });
    const normalizedReply = normalizeLineReplyResult(replyResult);

    return res.json({
      ok: true,
      queueId,
      replyText: normalizedReply.replyText,
      replyMessages: normalizedReply.replyMessages,
    });
  } catch (error) {
    console.error("處理 /gas-queue 發生錯誤：", error);
    return res.status(500).json({ ok: false, message: "處理 GAS queue 訊息失敗", error: error.message });
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

      if (event.replyToken) {
        await replyToLine(event.replyToken, "管理局小櫃台剛剛卡住了，本局未更動資料。請稍後再試一次。");
      }
    }
  }

  res.status(200).send("OK");
});

app.get("/week-context", async (req, res) => {
  try {
    res.json(await fetchWeekContextFromGoogleSheets());
  } catch (error) {
    console.error("GET /week-context 讀取週次資料發生錯誤：", error);
    res.status(500).json({ message: "讀取週次資料失敗", error: error.message });
  }
});

app.post("/weeks/complete-current", async (req, res) => {
  try {
    const result = await completeCurrentWeekInGoogleSheets();

    res.json({
      message: "本週結案成功",
      completedWeek: result.completedWeek,
      currentWeek: result.currentWeek,
      nextWeek: result.nextWeek,
    });
  } catch (error) {
    console.error("POST /weeks/complete-current 發生錯誤：", error);
    res.status(500).json({ message: "本週結案失敗", error: error.message });
  }
});

app.get("/items", async (req, res) => {
  try {
    res.json(await fetchItemsFromGoogleSheets());
  } catch (error) {
    console.error("GET /items 讀取 Google Sheets 發生錯誤：", error);
    res.status(500).json({ message: "讀取 Google Sheets 資料失敗", error: error.message });
  }
});

app.post("/items", async (req, res) => {
  try {
    const { type, title, category, subCategory, difficulty, weekNumber } = req.body;

    if (!type || !title) return res.status(400).json({ message: "type 和 title 都是必填" });
    if (type !== "task" && type !== "standard") return res.status(400).json({ message: "type 只能是 task 或 standard" });

    const createdItem = await createItemToGoogleSheets({ type, title, category, subCategory, difficulty, weekNumber });
    res.status(201).json(createdItem);
  } catch (error) {
    console.error("POST /items 新增 Google Sheets 發生錯誤：", error);
    res.status(getApiErrorStatus(error)).json({ message: "新增資料到 Google Sheets 失敗", error: error.message });
  }
});

app.patch("/items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, done, category, subCategory, difficulty, weekNumber } = req.body;
    const updates = {};

    if (title !== undefined) updates.title = title;
    if (done !== undefined) updates.done = done;
    if (category !== undefined) updates.category = category;
    if (subCategory !== undefined) updates.subCategory = subCategory;
    if (difficulty !== undefined) updates.difficulty = difficulty;
    if (weekNumber !== undefined) updates.weekNumber = weekNumber;

    if (Object.keys(updates).length === 0) return res.status(400).json({ message: "沒有收到要更新的欄位" });

    res.json(await updateItemToGoogleSheets(id, updates));
  } catch (error) {
    console.error("PATCH /items/:id 更新 Google Sheets 發生錯誤：", error);
    res.status(getApiErrorStatus(error)).json({ message: "更新資料到 Google Sheets 失敗", error: error.message });
  }
});

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
    res.status(getApiErrorStatus(error)).json({ message: "刪除 Google Sheets 資料失敗", error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Tiny Progress 後端啟動：http://localhost:${PORT}`);
});
