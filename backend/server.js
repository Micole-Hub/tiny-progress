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

// ==============================
// 共用工具
// ==============================

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

function normalizeDone(value) {
  return value === true || String(value).toUpperCase() === "TRUE";
}

function normalizeItem(item) {
  const safeItem = item || {};

  return {
    ...safeItem,
    id: String(safeItem.id || "").trim(),
    type: String(safeItem.type || "").trim(),
    title: String(safeItem.title || "").trim(),
    category: normalizeCategory(safeItem.category),
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

function getDisplayLabel(label) {
  if (label === "完成標準") {
    return "本週驗收標準";
  }

  return label;
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

// ==============================
// Google Sheets API
// ==============================

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
    currentWeek: data.currentWeek,
    nextWeek: data.nextWeek,
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

  if (!response.ok) {
    throw new Error("呼叫 Google Apps Script 失敗，狀態碼：" + response.status);
  }

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.message || "Google Apps Script 回傳失敗");
  }

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
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      secret: GOOGLE_SHEETS_API_SECRET,
      action: "complete-current-week",
    }),
  });

  if (!response.ok) {
    throw new Error("呼叫 Google Apps Script 結案失敗，狀態碼：" + response.status);
  }

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.message || "Google Apps Script 結案失敗");
  }

  return data.result;
}

async function createItemToGoogleSheets({
  type,
  title,
  category,
  difficulty,
  done,
  weekNumber,
  weekStart,
  weekEnd,
  createdAt,
  updatedAt,
}) {
  const itemPayload = {
    type,
    title,
    category: normalizeCategory(category),
    difficulty: normalizeDifficulty(difficulty),
    done: done === true,
  };

  if (weekNumber !== undefined && weekNumber !== null && weekNumber !== "") {
    itemPayload.weekNumber = Number(weekNumber);
  }

  if (weekStart !== undefined) {
    itemPayload.weekStart = weekStart;
  }

  if (weekEnd !== undefined) {
    itemPayload.weekEnd = weekEnd;
  }

  if (createdAt !== undefined) {
    itemPayload.createdAt = createdAt;
  }

  if (updatedAt !== undefined) {
    itemPayload.updatedAt = updatedAt;
  }

  const response = await fetch(GOOGLE_SHEETS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      secret: GOOGLE_SHEETS_API_SECRET,
      action: "create",
      item: itemPayload,
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

async function updateItemToGoogleSheets(id, updates) {
  const safeUpdates = { ...updates };

  if (safeUpdates.category !== undefined) {
    safeUpdates.category = normalizeCategory(safeUpdates.category);
  }

  if (safeUpdates.difficulty !== undefined) {
    safeUpdates.difficulty = normalizeDifficulty(safeUpdates.difficulty);
  }

  if (
    safeUpdates.weekNumber !== undefined &&
    safeUpdates.weekNumber !== null &&
    safeUpdates.weekNumber !== ""
  ) {
    safeUpdates.weekNumber = Number(safeUpdates.weekNumber);
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

// ==============================
// LINE 資料取得工具
// ==============================

function getLineSourceKey(event) {
  return (
    event.source?.userId ||
    event.source?.groupId ||
    event.source?.roomId ||
    "unknown-source"
  );
}

async function getItemsByType(type) {
  const items = await fetchCurrentWeekItemsFromGoogleSheets();
  const filteredItems = items.filter((item) => item.type === type);

  if (type === "task") {
    return sortTasksByCategory(filteredItems);
  }

  return filteredItems;
}

async function getTaskBoardForLine() {
  const [items, weekContext] = await Promise.all([
    fetchCurrentWeekItemsFromGoogleSheets(),
    fetchWeekContextFromGoogleSheets(),
  ]);

  const tasks = sortTasksByCategory(
    items.filter((item) => item.type === "task")
  );

  const standards = items.filter((item) => item.type === "standard");

  return {
    currentWeek: weekContext.currentWeek,
    tasks,
    standards,
  };
}

function getLineCommandHintText() {
  return [
    "需要操作說明請輸入：攻略",
    "想看用量請輸入：用量小抄",
  ].join("\n");
}

// ==============================
// 純文字格式化
// ==============================

function formatTaskSectionByCategory(tasks) {
  if (tasks.length === 0) {
    return [
      "【本週任務】",
      "本週尚未立案。放一個小任務，就是好的開始。",
    ].join("\n");
  }

  const lines = ["【本週任務】"];
  let taskNumber = 1;

  CATEGORY_OPTIONS.forEach(function (category) {
    const categoryTasks = tasks.filter(function (task) {
      return normalizeCategory(task.category) === category;
    });

    if (categoryTasks.length === 0) {
      return;
    }

    lines.push("");
    lines.push(`《${category}》`);

    categoryTasks.forEach(function (task) {
      const checkbox = task.done ? "☑" : "☐";
      const difficulty = normalizeDifficulty(task.difficulty);

      lines.push(`${taskNumber}. ${checkbox} ${task.title}｜${difficulty}`);
      taskNumber += 1;
    });
  });

  return lines.join("\n").trim();
}

function formatLineSection(title, items, emptyText) {
  if (items.length === 0) {
    return [title, emptyText].join("\n");
  }

  const lines = items.map((item, index) => {
    const checkbox = item.done ? "☑" : "☐";
    return `${index + 1}. ${checkbox} ${item.title}`;
  });

  return [title, ...lines].join("\n");
}

function formatTaskBoardForLine({ currentWeek, tasks, standards }) {
  const taskSection = formatTaskSectionByCategory(tasks);

  const standardSection = formatLineSection(
    "【本週驗收標準】",
    standards,
    "本週標準尚未成文。寫下一個方向，慢慢前進。"
  );

  const weekTitle = currentWeek
    ? `第 ${currentWeek.weekNumber} 週｜${currentWeek.title}`
    : "本週案件板";

  return [
    "📋 Tiny Progress",
    weekTitle,
    "",
    `任務進度：${tasks.filter((task) => task.done).length} / ${tasks.length}`,
    `標準進度：${standards.filter((standard) => standard.done).length} / ${standards.length}`,
    "",
    taskSection,
    "",
    standardSection,
    "",
    getLineCommandHintText(),
  ].join("\n");
}

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
      "沒有案件也無妨，先喝水，本局不追殺。",
      "",
      "需要完整清單請輸入：清單",
    ].join("\n");
  }

  const lines = matchedTasks.map(function (entry) {
    const checkbox = entry.task.done ? "☑" : "☐";
    const category = normalizeCategory(entry.task.category);

    return `${entry.originalNumber}. ${checkbox} ${entry.task.title}｜${category}`;
  });

  const firstUnfinishedEntry = matchedTasks.find(function (entry) {
    return !entry.task.done;
  });

  const commandHint = firstUnfinishedEntry
    ? `可直接輸入：完成任務${firstUnfinishedEntry.originalNumber}`
    : "本區案件已辦理完畢";

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

// ==============================
// Flex Message 共用樣式
// ==============================

const FLEX_BRAND_NAME = "Tiny Progress";
const FLEX_FIXED_LINE = "小小前進，也算數。";

const FLEX_COLORS = {
  cream: "#F7F0E6",
  card: "#FFF9EF",
  darkGreen: "#203A32",
  green: "#2F7D56",
  greenFresh: "#7DB46C",
  sage: "#9DBF9A",
  sageLight: "#E5EEE2",
  beige: "#EFE3C7",
  beigeLine: "#DDD1BD",
  mutedText: "#7A6E5F",
  red: "#B85F4B",
  redLight: "#F0D8D2",
  redText: "#6B3932",
  gold: "#D8A85F",
  goldLight: "#F4E4C7",
  blueGray: "#DCE8EA",
  blueText: "#2E5460",

  // 分類專用色，需與前端 style.css 一致
  programming: "#507592",
  programmingText: "#FFFDF7",

  wellness: "#8A6F7F",
  wellnessText: "#FFFDF7",

  interest: "#B9854A",
  interestText: "#FFFDF7",
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
    return {
      backgroundColor: FLEX_COLORS.programming,
      textColor: FLEX_COLORS.programmingText,
    };
  }

  if (normalizedCategory === "身心穩定") {
    return {
      backgroundColor: FLEX_COLORS.wellness,
      textColor: FLEX_COLORS.wellnessText,
    };
  }

  if (normalizedCategory === "興趣探索") {
    return {
      backgroundColor: FLEX_COLORS.interest,
      textColor: FLEX_COLORS.interestText,
    };
  }

  return {
    backgroundColor: "#DFE9DD",
    textColor: "#36533F",
  };
}

function getDifficultyFlexStyle(difficulty) {
  const normalizedDifficulty = normalizeDifficulty(difficulty);

  if (normalizedDifficulty === "簡單") {
    return {
      backgroundColor: "#DBF0D5",
      textColor: "#315B35",
    };
  }

  if (normalizedDifficulty === "適中") {
    return {
      backgroundColor: "#F4E4C7",
      textColor: "#6A4E21",
    };
  }

  return {
    backgroundColor: "#F0D8D2",
    textColor: "#6B3932",
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

  if (normalizedDifficulty === "簡單") {
    return isCompleted
      ? "熱身完成，今天已經有動起來。"
      : "先熱身一下，本局不催跑。";
  }

  if (normalizedDifficulty === "適中") {
    return isCompleted
      ? "穩穩辦完，本局予以記錄。"
      : "穩穩推進，不用開倍速。";
  }

  return isCompleted
    ? "大案收妥，今天可以蓋一枚章。"
    : "大案也能小辦，不必硬闖。";
}

function buildFlexTag(label, backgroundColor, textColor) {
  return {
    type: "box",
    layout: "vertical",
    backgroundColor,
    cornerRadius: "999px",
    paddingTop: "6px",
    paddingBottom: "6px",
    paddingStart: "10px",
    paddingEnd: "10px",
    contents: [
      {
        type: "text",
        text: label,
        size: "xs",
        weight: "bold",
        color: textColor,
        align: "center",
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
    spacing: "xs",
    contents: [
      {
        type: "text",
        text: FLEX_BRAND_NAME,
        size: "sm",
        color: FLEX_COLORS.darkGreen,
        weight: "bold",
      },
      {
        type: "text",
        text: title,
        size: "xl",
        weight: "bold",
        color: FLEX_COLORS.darkGreen,
        wrap: true,
      },
      {
        type: "text",
        text: subtitle || FLEX_FIXED_LINE,
        size: "sm",
        color: FLEX_COLORS.mutedText,
        wrap: true,
      },
    ],
  };
}

function buildFlexInfoCard(contents, options = {}) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    backgroundColor: options.backgroundColor || FLEX_COLORS.card,
    cornerRadius: "16px",
    paddingAll: "16px",
    borderColor: options.borderColor || "#E5D7C3",
    borderWidth: "1px",
    contents,
  };
}

function buildProgressLine(label, doneCount, totalCount) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    contents: [
      {
        type: "text",
        text: label,
        size: "sm",
        color: FLEX_COLORS.mutedText,
        flex: 0,
      },
      {
        type: "text",
        text: `${doneCount} / ${totalCount}`,
        size: "sm",
        color: FLEX_COLORS.darkGreen,
        weight: "bold",
        align: "end",
      },
    ],
  };
}

function buildTaskFlexRow({ task, taskNumber, showDifficulty, showCategory }) {
  const checkbox = task.done ? "☑" : "☐";
  const difficulty = normalizeDifficulty(task.difficulty);
  const category = normalizeCategory(task.category);
  const difficultyStyle = getDifficultyFlexStyle(difficulty);

  const tagContents = [];

  if (showCategory) {
    const categoryStyle = getCategoryFlexStyle(category);

    tagContents.push(
      buildFlexTag(
        category,
        categoryStyle.backgroundColor,
        categoryStyle.textColor
      )
    );
  }

  if (showDifficulty) {
    tagContents.push(
      buildFlexTag(
        difficulty,
        difficultyStyle.backgroundColor,
        difficultyStyle.textColor
      )
    );
  }

  const rowContents = [
    {
      type: "text",
      text: `${taskNumber}. ${checkbox} ${task.title}`,
      size: "sm",
      color: task.done ? "#8A7E6E" : FLEX_COLORS.darkGreen,
      wrap: true,
      weight: task.done ? "regular" : "bold",
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
    paddingBottom: "10px",
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
        text: `${standardNumber}. ${checkbox} ${standard.title}`,
        size: "sm",
        color: standard.done ? "#8A7E6E" : FLEX_COLORS.darkGreen,
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
    contents: lines.map(function (line, index) {
      return {
        type: "text",
        text: line,
        size: index === 0 ? "sm" : "xs",
        color: index === 0 ? FLEX_COLORS.darkGreen : "#8A7E6E",
        weight: index === 0 ? "bold" : "regular",
        wrap: true,
      };
    }),
  };
}

function buildBaseFlexBubble({
  title,
  subtitle,
  bodyContents,
  footerContents,
  accentColor,
}) {
  const contents = [
    buildAccentBar(accentColor),
    buildFlexHeader(title, subtitle),
    {
      type: "separator",
      margin: "md",
      color: FLEX_COLORS.beigeLine,
    },
    ...bodyContents,
  ];

  if (footerContents) {
    contents.push({
      type: "separator",
      margin: "md",
      color: FLEX_COLORS.beigeLine,
    });
    contents.push(footerContents);
  }

  return {
    type: "bubble",
    size: "mega",
    styles: {
      body: {
        backgroundColor: FLEX_COLORS.cream,
      },
      footer: {
        backgroundColor: FLEX_COLORS.cream,
      },
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

// ==============================
// Flex Message：抽一件
// ==============================

function buildDrawOneTaskFallbackText({ selectedTask, taskNumber }) {
  return [
    "🎲 Tiny Progress｜本局今日先派這一件",
    "",
    `第 ${taskNumber} 個任務`,
    `☐ ${selectedTask.title}`,
    "",
    `分類：${selectedTask.category}`,
    `難度：${selectedTask.difficulty}`,
    "",
    "做完可以輸入：",
    `完成任務${taskNumber}`,
    "",
    "不用想太多，先開這一案。",
  ].join("\n");
}

function buildDrawOneTaskFlexMessage({ selectedTask, taskNumber }) {
  const category = normalizeCategory(selectedTask.category);
  const difficulty = normalizeDifficulty(selectedTask.difficulty);

  const categoryStyle = getCategoryFlexStyle(category);
  const difficultyStyle = getDifficultyFlexStyle(difficulty);

  const bubble = buildBaseFlexBubble({
    title: "本局今日先派這一件",
    subtitle: FLEX_FIXED_LINE,
    accentColor: FLEX_ACCENTS.draw,
    bodyContents: [
      buildFlexInfoCard(
        [
          {
            type: "text",
            text: `第 ${taskNumber} 個任務`,
            size: "sm",
            color: FLEX_COLORS.mutedText,
            weight: "bold",
          },
          {
            type: "text",
            text: selectedTask.title,
            size: "lg",
            weight: "bold",
            color: FLEX_COLORS.darkGreen,
            wrap: true,
          },
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            margin: "md",
            contents: [
              buildFlexTag(
                category,
                categoryStyle.backgroundColor,
                categoryStyle.textColor
              ),
              buildFlexTag(
                difficulty,
                difficultyStyle.backgroundColor,
                difficultyStyle.textColor
              ),
            ],
          },
        ],
        {
          borderColor: "#E8C887",
          backgroundColor: "#FFF8EA",
        }
      ),
    ],
    footerContents: buildFlexFooterHint([
      `做完可以輸入：完成任務${taskNumber}`,
      "不用想太多，先開這一案。",
    ]),
  });

  return {
    type: "flex",
    altText: `Tiny Progress｜本局今日先派這一件：${selectedTask.title}`,
    contents: bubble,
  };
}

async function handleDrawOneTaskCommand() {
  const board = await getTaskBoardForLine();

  const unfinishedTasks = board.tasks.filter(function (task) {
    return !task.done;
  });

  if (unfinishedTasks.length === 0) {
    return [
      "🎲 Tiny Progress｜本局抽籤結果",
      "",
      "本週沒有未完成任務可以抽。",
      "如果都完成了，請給自己蓋一枚小章。",
      "",
      "可以輸入「清單」確認目前案件板。",
    ].join("\n");
  }

  const randomIndex = Math.floor(Math.random() * unfinishedTasks.length);
  const selectedTask = unfinishedTasks[randomIndex];

  const taskNumber =
    board.tasks.findIndex(function (task) {
      return task.id === selectedTask.id;
    }) + 1;

  const replyText = buildDrawOneTaskFallbackText({
    selectedTask,
    taskNumber,
  });

  const flexMessage = buildDrawOneTaskFlexMessage({
    selectedTask,
    taskNumber,
  });

  return {
    replyText,
    replyMessages: [flexMessage],
  };
}

// ==============================
// Flex Message：難度任務清單
// ==============================

function buildDifficultyTaskFooterLines(matchedTasks, difficulty) {
  const firstUnfinishedEntry = matchedTasks.find(function (entry) {
    return !entry.task.done;
  });

  if (!firstUnfinishedEntry) {
    return [
      "本區案件已辦理完畢",
      getDifficultyFooterCopy(difficulty, true),
    ];
  }

  return [
    `可直接輸入：完成任務${firstUnfinishedEntry.originalNumber}`,
    getDifficultyFooterCopy(difficulty, false),
  ];
}

function buildDifficultyTaskListFlexMessage({ tasks, difficulty }) {
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

  const unfinishedCount = matchedTasks.filter(function (entry) {
    return !entry.task.done;
  }).length;

  let bodyContents = [];

  if (matchedTasks.length === 0) {
    bodyContents = [
      buildFlexInfoCard([
        {
          type: "text",
          text: `目前沒有${difficulty}任務。`,
          size: "md",
          color: FLEX_COLORS.darkGreen,
          weight: "bold",
          wrap: true,
        },
        {
          type: "text",
          text: "沒有案件也無妨，先喝水，本局不追殺。",
          size: "sm",
          color: FLEX_COLORS.mutedText,
          wrap: true,
        },
      ]),
    ];
  } else {
    const limitedEntries = matchedTasks.slice(0, 8);

    bodyContents = [
      buildFlexInfoCard([
        {
          type: "text",
          text: `未完成：${unfinishedCount} 件`,
          size: "sm",
          color: FLEX_COLORS.mutedText,
          weight: "bold",
        },
        ...limitedEntries.map(function (entry) {
          return buildTaskFlexRow({
            task: entry.task,
            taskNumber: entry.originalNumber,
            showDifficulty: false,
            showCategory: true,
          });
        }),
        ...(matchedTasks.length > limitedEntries.length
          ? [
              {
                type: "text",
                text: `還有 ${matchedTasks.length - limitedEntries.length} 件未顯示，可輸入「清單」查看完整案件板。`,
                size: "xs",
                color: FLEX_COLORS.mutedText,
                wrap: true,
              },
            ]
          : []),
      ]),
    ];
  }

  const bubble = buildBaseFlexBubble({
    title: `本週${difficulty}任務`,
    subtitle: "以上編號沿用完整清單",
    accentColor: getDifficultyAccentColor(difficulty),
    bodyContents,
    footerContents: buildFlexFooterHint(
      matchedTasks.length === 0
        ? ["需要完整清單請輸入：清單", "沒有案件也算一種清爽。"]
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
  const replyText = formatTasksByDifficultyForLine(tasks, difficulty);
  const flexMessage = buildDifficultyTaskListFlexMessage({
    tasks,
    difficulty,
  });

  return {
    replyText,
    replyMessages: [flexMessage],
  };
}

// ==============================
// Flex Message：全部清單
// ==============================

function buildAllListFlexMessage({ currentWeek, tasks, standards }) {
  const taskDoneCount = tasks.filter(function (task) {
    return task.done;
  }).length;

  const standardDoneCount = standards.filter(function (standard) {
    return standard.done;
  }).length;

  const weekTitle = currentWeek
    ? `第${currentWeek.weekNumber}週｜${currentWeek.title}`
    : "本週案件板";

  const taskRows = tasks.slice(0, 8).map(function (task, index) {
    return buildTaskFlexRow({
      task,
      taskNumber: index + 1,
      showDifficulty: true,
      showCategory: true,
    });
  });

  const standardRows = standards.slice(0, 5).map(function (standard, index) {
    return buildStandardFlexRow({
      standard,
      standardNumber: index + 1,
    });
  });

  const bodyContents = [
    buildFlexInfoCard([
      {
        type: "text",
        text: weekTitle,
        size: "xs",
        color: FLEX_COLORS.mutedText,
        weight: "bold",
        wrap: false,
        maxLines: 1,
      },
      buildProgressLine("任務進度", taskDoneCount, tasks.length),
      buildProgressLine("標準進度", standardDoneCount, standards.length),
    ]),
  ];

  if (tasks.length === 0) {
    bodyContents.push(
      buildFlexInfoCard([
        {
          type: "text",
          text: "本週任務尚未立案。",
          size: "md",
          color: FLEX_COLORS.darkGreen,
          weight: "bold",
          wrap: true,
        },
        {
          type: "text",
          text: "放一個小任務，就是好的開始。",
          size: "sm",
          color: FLEX_COLORS.mutedText,
          wrap: true,
        },
      ])
    );
  } else {
    bodyContents.push(
      buildFlexInfoCard([
        {
          type: "text",
          text: "本週任務",
          size: "sm",
          color: FLEX_COLORS.mutedText,
          weight: "bold",
        },
        ...taskRows,
        ...(tasks.length > taskRows.length
          ? [
              {
                type: "text",
                text: `還有 ${tasks.length - taskRows.length} 件任務未顯示，可打開任務板查看完整內容。`,
                size: "xs",
                color: FLEX_COLORS.mutedText,
                wrap: true,
              },
            ]
          : []),
      ])
    );
  }

  if (standards.length === 0) {
    bodyContents.push(
      buildFlexInfoCard([
        {
          type: "text",
          text: "本週驗收標準尚未成文。",
          size: "sm",
          color: FLEX_COLORS.darkGreen,
          weight: "bold",
          wrap: true,
        },
        {
          type: "text",
          text: "寫下一個方向，慢慢前進。",
          size: "xs",
          color: FLEX_COLORS.mutedText,
          wrap: true,
        },
      ])
    );
  } else {
    bodyContents.push(
      buildFlexInfoCard([
        {
          type: "text",
          text: "本週驗收標準",
          size: "sm",
          color: FLEX_COLORS.mutedText,
          weight: "bold",
        },
        ...standardRows,
        ...(standards.length > standardRows.length
          ? [
              {
                type: "text",
                text: `還有 ${standards.length - standardRows.length} 則標準未顯示。`,
                size: "xs",
                color: FLEX_COLORS.mutedText,
                wrap: true,
              },
            ]
          : []),
      ])
    );
  }

  const bubble = buildBaseFlexBubble({
    title: "本週案件板",
    subtitle: FLEX_FIXED_LINE,
    accentColor: FLEX_ACCENTS.all,
    bodyContents,
    footerContents: buildFlexFooterHint([
      "案件都在這裡，今天先辦一小件。",
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
  const replyText = formatTaskBoardForLine(board);
  const flexMessage = buildAllListFlexMessage(board);

  return {
    replyText,
    replyMessages: [flexMessage],
  };
}

// ==============================
// LINE Reply 格式整理
// ==============================

function buildLineTextMessage(text) {
  return {
    type: "text",
    text: String(text || "本局目前沒有可回覆的內容。"),
  };
}

function getFallbackTextFromReplyMessages(replyMessages) {
  const textMessage = replyMessages.find(function (message) {
    return message && message.type === "text" && message.text;
  });

  if (textMessage) {
    return textMessage.text;
  }

  const flexMessage = replyMessages.find(function (message) {
    return message && message.type === "flex" && message.altText;
  });

  if (flexMessage) {
    return flexMessage.altText;
  }

  return "Tiny Progress 已回覆。";
}

function normalizeLineReplyResult(replyResult) {
  if (
    replyResult &&
    typeof replyResult === "object" &&
    Array.isArray(replyResult.replyMessages)
  ) {
    const replyMessages = replyResult.replyMessages;
    const replyText =
      replyResult.replyText || getFallbackTextFromReplyMessages(replyMessages);

    return {
      replyText,
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
    const errorText = await lineResponse.text();
    console.error("LINE Reply API 回覆失敗：", lineResponse.status, errorText);
  }
}

// ==============================
// LINE 指令文字
// ==============================

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
    "新增任務 練習 CSS Flex｜程式學習｜適中",
    "新增標準 本週能說明一個學到的觀念",
    "",
    "分類可用：程式學習、身心穩定、興趣探索",
    "難度可用：簡單、適中、困難",
    "",
    "【辦理】",
    "完成任務3",
    "取消任務3",
    "修改任務3",
    "刪除任務3",
    "",
    "完成標準2",
    "取消標準2",
    "修改標準2",
    "刪除標準2",
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
    "這類通常是 reply message。",
    "",
    "Bot 主動傳給你：",
    "每日提醒、主動補提醒、主動通知",
    "",
    "這類通常是 push message，會計入主動訊息用量。",
    "",
    "目前建議：",
    "每天主動提醒最多 1 則。",
    "你主動問，本局再回。",
  ].join("\n");
}

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
    "本局已更新公文內容。",
  ].join("\n");
}

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
      `例：${command} ${example}`,
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
      "例：新增任務 練習 CSS｜程式學習｜適中",
    ].join("\n");
  }

  const currentWeekNumber = await getCurrentWeekNumberFromGoogleSheets();

  const createdItem = await createItemToGoogleSheets({
    type,
    title: parsed.title,
    category,
    difficulty,
    weekNumber: currentWeekNumber,
  });

  if (type === "task") {
    return [
      "Tiny Progress 已立案：",
      `☐ ${createdItem.title || parsed.title}`,
      `分類：${createdItem.category}｜難度：${createdItem.difficulty}`,
      "",
      "若要新增驗收標準，可輸入：",
      "新增標準 本週能說明一個學到的觀念",
      "",
      "可以輸入「清單」查看目前案件板。",
    ].join("\n");
  }

  return [
    "Tiny Progress 已新增本週驗收標準：",
    `☐ ${createdItem.title || parsed.title}`,
    "",
    "可以輸入「清單」查看目前案件板。",
  ].join("\n");
}

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
        "可以先輸入「清單」確認編號。",
      ].join("\n"),
    };
  }

  return {
    itemNumber,
    item: targetItem,
    items,
  };
}

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
    "小小前進，也算數。",
  ].join("\n");
}

async function handleDeleteCommand({ numberText, type, label }) {
  const result = await findItemByNumber({
    type,
    numberText,
    label,
  });

  if (result.error) {
    return result.error;
  }

  const deletedItem = await deleteItemFromGoogleSheets(result.item.id);
  const displayLabel = getDisplayLabel(label);

  return [
    `已撤案第 ${result.itemNumber} 個${displayLabel}：`,
    deletedItem.title || result.item.title,
    "",
    "本局已更新案件板。",
  ].join("\n");
}

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
      "本局已更新公文內容。",
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
    "若不想修訂，請輸入：取消修改",
  ].join("\n");
}

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

function getFormatReminderText() {
  return [
    "這份公文格式需補正，本局未更動資料。",
    "",
    "常用格式：",
    "新增任務 練習 CSS｜程式學習｜適中",
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

// ==============================
// LINE 指令主處理
// ==============================

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

  if (
    userText === "抽一件" ||
    userText === "抽任務" ||
    userText === "隨機任務" ||
    userText === "今天做什麼"
  ) {
    return handleDrawOneTaskCommand();
  }

  if (userText === "清單" || userText === "全部清單") {
    return handleAllListFlexCommand();
  }

  if (userText === "簡單任務" || userText === "簡單") {
    return handleDifficultyTaskFlexCommand("簡單");
  }

  if (userText === "適中任務" || userText === "適中") {
    return handleDifficultyTaskFlexCommand("適中");
  }

  if (userText === "困難任務" || userText === "困難") {
    return handleDifficultyTaskFlexCommand("困難");
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

// ==============================
// Express Routes
// ==============================

app.get("/", (req, res) => {
  res.send("Tiny Progress API 開張中。本局小櫃台今日值班。");
});

app.post("/gas-queue", async (req, res) => {
  try {
    console.log("收到 GAS Queue 訊息：", req.body);

    const { source, queueId, userId, messageText } = req.body || {};

    if (source !== "gas_queue") {
      return res.status(400).json({
        ok: false,
        message: "source 必須是 gas_queue",
      });
    }

    if (!queueId) {
      return res.status(400).json({
        ok: false,
        message: "缺少 queueId",
      });
    }

    if (!userId) {
      return res.status(400).json({
        ok: false,
        message: "缺少 userId",
      });
    }

    const userText = String(messageText || "").trim();

    if (!userText) {
      return res.status(400).json({
        ok: false,
        message: "缺少 messageText",
      });
    }

    const sourceKey = String(userId).trim();

    const replyResult = await handleLineTextCommand({
      sourceKey,
      userText,
    });

    const normalizedReply = normalizeLineReplyResult(replyResult);

    return res.json({
      ok: true,
      queueId,
      replyText: normalizedReply.replyText,
      replyMessages: normalizedReply.replyMessages,
    });
  } catch (error) {
    console.error("處理 /gas-queue 發生錯誤：", error);

    return res.status(500).json({
      ok: false,
      message: "處理 GAS queue 訊息失敗",
      error: error.message,
    });
  }
});

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

      const replyResult = await handleLineTextCommand({
        sourceKey,
        userText,
      });

      await replyToLine(replyToken, replyResult);
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

app.get("/week-context", async (req, res) => {
  try {
    const context = await fetchWeekContextFromGoogleSheets();

    res.json(context);
  } catch (error) {
    console.error("GET /week-context 讀取週次資料發生錯誤：", error);

    res.status(500).json({
      message: "讀取週次資料失敗",
      error: error.message,
    });
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

    res.status(500).json({
      message: "本週結案失敗",
      error: error.message,
    });
  }
});

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

app.post("/items", async (req, res) => {
  try {
    const { type, title, category, difficulty, weekNumber } = req.body;

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
      weekNumber,
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

app.patch("/items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, done, category, difficulty, weekNumber } = req.body;

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

    if (weekNumber !== undefined) {
      updates.weekNumber = weekNumber;
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
  console.log(`Tiny Progress 後端啟動：http://localhost:${PORT}`);
});