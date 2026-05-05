require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

const PORT = process.env.PORT || 3000;

const GOOGLE_SHEETS_API_URL = process.env.GOOGLE_SHEETS_API_URL;
const GOOGLE_SHEETS_API_SECRET = process.env.GOOGLE_SHEETS_API_SECRET;

// LINE Bot 回覆訊息用
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

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

// === LINE 小工具：讀取目前 task 清單 ===
// 目前 LINE 指令先只操作 type === "task"，不處理 standard
async function getTasksForLine() {
  const items = await fetchItemsFromGoogleSheets();
  return items.filter((item) => item.type === "task");
}

// === LINE 小工具：把任務清單組成 LINE 文字 ===
function formatTaskListForLine(tasks) {
  if (tasks.length === 0) {
    return [
      "本週目前沒有任務。",
      "",
      "可以輸入：",
      "新增 任務內容",
    ].join("\n");
  }

  const taskLines = tasks.map((item, index) => {
    const checkbox = item.done ? "☑" : "☐";
    return `${index + 1}. ${checkbox} ${item.title}`;
  });

  return [
    "本週任務：",
    "",
    ...taskLines,
    "",
    "可用指令：",
    "新增 任務內容",
    "完成 1",
    "取消 1",
    "改 1 新文字",
    "刪除 1",
    "說明",
  ].join("\n");
}

// === LINE 小工具：把使用者輸入的編號轉成真正的 task ===
async function findTaskByNumber(numberText) {
  const taskNumber = Number(numberText);

  if (!Number.isInteger(taskNumber) || taskNumber <= 0) {
    return {
      error: "請輸入正確的任務編號，例如：完成 1",
    };
  }

  const tasks = await getTasksForLine();
  const targetTask = tasks[taskNumber - 1];

  if (!targetTask) {
    return {
      error: `找不到第 ${taskNumber} 個任務，請先輸入「清單」確認編號。`,
    };
  }

  return {
    taskNumber,
    task: targetTask,
    tasks,
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

// === LINE 小工具：處理文字指令 ===
async function handleLineTextCommand(userText) {
  let replyText = `管理局收到：${userText}`;

  // === 指令：說明 ===
  if (userText === "說明" || userText === "help" || userText === "Help") {
    replyText = [
      "不努力時間有限管理局 指令小抄：",
      "",
      "清單",
      "查看本週任務",
      "",
      "新增 任務內容",
      "例如：新增 練習 LINE Bot",
      "",
      "完成 編號",
      "例如：完成 1",
      "",
      "取消 編號",
      "例如：取消 1",
      "",
      "改 編號 新文字",
      "例如：改 1 練習 LINE 指令",
      "",
      "刪除 編號",
      "例如：刪除 1",
    ].join("\n");
  }

  // === 指令：清單 ===
  else if (userText === "清單") {
    const tasks = await getTasksForLine();
    replyText = formatTaskListForLine(tasks);
  }

  // === 指令：新增 任務內容 ===
  else if (userText.startsWith("新增 ")) {
    const title = userText.replace(/^新增\s+/, "").trim();

    if (!title) {
      replyText = "請輸入任務內容，例如：新增 練習 GitHub Pages";
    } else {
      const createdItem = await createItemToGoogleSheets({
        type: "task",
        title,
      });

      replyText = [
        "已新增任務：",
        `☐ ${createdItem.title}`,
        "",
        "可以輸入「清單」查看目前任務。",
      ].join("\n");
    }
  }

  // === 指令：完成 1 ===
  else if (userText.startsWith("完成 ")) {
    const numberText = userText.replace(/^完成\s+/, "").trim();
    const result = await findTaskByNumber(numberText);

    if (result.error) {
      replyText = result.error;
    } else {
      const updatedItem = await updateItemToGoogleSheets(result.task.id, {
        done: true,
      });

      replyText = [
        `已完成第 ${result.taskNumber} 項：`,
        `☑ ${updatedItem.title}`,
      ].join("\n");
    }
  }

  // === 指令：取消 1 ===
  else if (userText.startsWith("取消 ")) {
    const numberText = userText.replace(/^取消\s+/, "").trim();
    const result = await findTaskByNumber(numberText);

    if (result.error) {
      replyText = result.error;
    } else {
      const updatedItem = await updateItemToGoogleSheets(result.task.id, {
        done: false,
      });

      replyText = [
        `已取消完成第 ${result.taskNumber} 項：`,
        `☐ ${updatedItem.title}`,
      ].join("\n");
    }
  }

  // === 指令：改 1 新文字 ===
  else if (userText.startsWith("改 ")) {
    const match = userText.match(/^改\s+(\d+)\s+(.+)$/);

    if (!match) {
      replyText = "格式不對，請輸入：改 1 新任務文字";
    } else {
      const numberText = match[1];
      const newTitle = match[2].trim();

      const result = await findTaskByNumber(numberText);

      if (result.error) {
        replyText = result.error;
      } else if (!newTitle) {
        replyText = "請輸入新的任務文字，例如：改 1 練習 LINE Bot";
      } else {
        const updatedItem = await updateItemToGoogleSheets(result.task.id, {
          title: newTitle,
        });

        replyText = [
          `已更新第 ${result.taskNumber} 項：`,
          updatedItem.title,
        ].join("\n");
      }
    }
  }

  // === 指令：刪除 1 ===
  else if (userText.startsWith("刪除 ")) {
    const numberText = userText.replace(/^刪除\s+/, "").trim();
    const result = await findTaskByNumber(numberText);

    if (result.error) {
      replyText = result.error;
    } else {
      const deletedTitle = result.task.title;

      await deleteItemFromGoogleSheets(result.task.id);

      replyText = [
        `已刪除第 ${result.taskNumber} 項：`,
        deletedTitle,
      ].join("\n");
    }
  }

  // === 其他文字：回提示 ===
  else {
    replyText = [
      `管理局收到：${userText}`,
      "",
      "目前可用指令：",
      "清單",
      "新增 任務內容",
      "完成 1",
      "取消 1",
      "改 1 新文字",
      "刪除 1",
      "",
      "也可以輸入：說明",
    ].join("\n");
  }

  return replyText;
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

      const userText = event.message.text.trim();
      const replyToken = event.replyToken;

      const replyText = await handleLineTextCommand(userText);

      await replyToLine(replyToken, replyText);
    } catch (error) {
      console.error("處理 LINE Webhook 發生錯誤：", error);

      // 如果處理指令時出錯，盡量回覆一個安全訊息給使用者
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