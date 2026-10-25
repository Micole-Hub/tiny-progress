// =========================================================
// Tiny Progress：補齊 Code.gs 缺少的函式
// 用法：在 Apps Script 新增一個檔案（例如 TinyProgressMissing），整份貼上。
// 不要動 Code.gs 其他部分。Code.gs 需要有這一行（只要一次）：
//   let TP_DATA_LOCK_DEPTH = 0;
// tpSpreadsheet() 已在 Code.gs，這裡不要重複定義。
// =========================================================

// ---------- 基礎小工具 ----------

// 網頁交易恢復：目前的寫入都是單一步驟，沒有半途交易需要恢復。
function tpRecoverWebTransaction() {
  return { recovered: false };
}

// 舊式寫入通道：所有 action 統一走 executeTinyProgressAction。
function tpLegacyMutationAction(action) {
  return false;
}

function tpExecuteLegacyMutation(action, body) {
  return executeTinyProgressAction(action, body);
}

// 檢查 YYYY-MM-DD 日期是否存在。
function tpCheckYmd(value) {
  const text = cleanText(value).slice(0, 10);
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error("日期格式要是 YYYY-MM-DD：" + cleanText(value));
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d
  )
    throw new Error("日期不存在：" + text);
  return text;
}

// SHA-256 十六進位字串，用來產生穩定的 queue id。
function tpDigest(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ""),
    Utilities.Charset.UTF_8,
  );
  return bytes
    .map(function (b) {
      return ("0" + (b & 0xff).toString(16)).slice(-2);
    })
    .join("");
}

// ---------- 網頁狀態儲存 ----------
// 網頁整包 state 存在「web_state」工作表（key / value 兩欄，太長就切段）。
// 舊的 items / weeks / cycles 等工作表不會被改動。

const TP_STATE_SHEET = "web_state";
const TP_STATE_CHUNK = 40000;

function tpStateSheet() {
  const sheet = getOrCreateSheet(TP_STATE_SHEET);
  if (sheet.getLastRow() < 1) {
    sheet.getRange("A:B").setNumberFormat("@");
    sheet.getRange(1, 1, 1, 2).setValues([["key", "value"]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function tpStateLoad() {
  const sheet = tpStateSheet();
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const map = {};
  sheet
    .getRange(2, 1, last - 1, 2)
    .getValues()
    .forEach(function (row) {
      map[String(row[0])] = String(row[1]);
    });
  const count = Number(map.chunks || 0);
  if (!count) return null;
  let json = "";
  for (let i = 0; i < count; i++) {
    if (map["state:" + i] === undefined)
      throw new Error("web_state 資料不完整，請先不要手動修改這個工作表");
    json += map["state:" + i];
  }
  return {
    state: JSON.parse(json),
    revision: Number(map.revision || 0),
    mutationId: map.mutationId || "",
  };
}

function tpStateStore(state, revision, mutationId) {
  const sheet = tpStateSheet();
  const json = JSON.stringify(state);
  const chunks = [];
  for (let i = 0; i < json.length; i += TP_STATE_CHUNK)
    chunks.push(json.slice(i, i + TP_STATE_CHUNK));
  const rows = [
    ["revision", String(revision)],
    ["mutationId", String(mutationId || "")],
    ["updatedAt", new Date().toISOString()],
    ["chunks", String(chunks.length)],
  ];
  chunks.forEach(function (chunk, i) {
    rows.push(["state:" + i, chunk]);
  });
  const previousLast = sheet.getLastRow();
  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  if (previousLast > rows.length + 1)
    sheet
      .getRange(rows.length + 2, 1, previousLast - rows.length - 1, 2)
      .clearContent();
  SpreadsheetApp.flush();
}

// 第一次讀取、雲端還沒有 state 時，用舊工作表的資料轉出來（只讀取，不改舊資料）。
function tpBuildStateFromSheets() {
  return TPDomain.migrateLegacy(
    {
      weeks: getWeeksFromSheetRaw(),
      cycles: getCyclesFromSheetRaw(),
      categories: getCategoriesFromSheetRaw(),
      items: getItemsFromSheetRaw(),
      retrospectives: getRetrospectivesFromSheetRaw(),
    },
    TPDomain.today(),
  );
}

// ---------- 網頁讀寫 ----------

// 回傳 { state, revision }，前端 loadWebState 依賴這個格式。
function tpWebRead(cycle) {
  let record = tpStateLoad();
  if (!record) {
    const state = tpBuildStateFromSheets();
    tpStateStore(state, 1, "");
    record = { state: state, revision: 1, mutationId: "" };
  }
  return { state: record.state, revision: record.revision };
}

function tpReadResource(resource, params) {
  const p = params || {};
  const name = cleanText(resource) || "items";
  if (name === "core" || name === "week-context")
    syncTimelineAndOverdueIfNeeded(false);

  if (name === "core") return buildCoreSnapshot();
  if (name === "items") return { items: getItemsFromSheetRaw() };
  if (name === "weeks") return { weeks: getWeeksFromSheetRaw() };
  if (name === "cycles") return { cycles: getCyclesFromSheetRaw() };
  if (name === "categories")
    return { categories: getCategoriesFromSheetRaw() };
  if (name === "history") return { history: buildHistoryData() };
  if (name === "retrospectives")
    return { retrospectives: getRetrospectivesFromSheetRaw() };
  if (name === "week-context") return getWeekContextFromSheet();
  if (name === "review") {
    const c = parsePositiveInteger(p.cycleNumber);
    if (!c) throw new Error("缺少 cycleNumber");
    return { review: buildCycleReview(c) };
  }
  throw new Error("不支援的 resource：" + name);
}

// 網頁存檔：版本號要對、規則由 TPDomain.acceptWebState 把關。
function tpWebSave(body) {
  const record = tpStateLoad();
  if (!record) TPDomain.fail("雲端還沒有資料，請重新整理後再試", 409);
  const mutationId = String(body.mutationId || "");
  if (mutationId && record.mutationId === mutationId)
    return { state: record.state, revision: record.revision };
  if (Number(body.expectedRevision) !== record.revision)
    TPDomain.fail("資料已在別處更新，請重新整理", 409);
  const next = TPDomain.acceptWebState(record.state, body.state);
  const revision = record.revision + 1;
  tpStateStore(next, revision, mutationId);
  return { state: next, revision: revision };
}

// 離線資料匯入：格式還沒確認，先不動資料。
function tpImportLocal(body) {
  throw new Error("web-import 尚未實作：請提供前端匯入的呼叫格式");
}

// ---------- LINE ----------

// Render 驗證簽章後，把 LINE webhook 內容轉進來。
function tpLineIngress(body) {
  return handleLineWebhookToQueue(body);
}

// LINE 和網頁共用同一份 state。
function tpLineStateRead(body) {
  const record = tpWebRead();
  return { state: record.state, revision: record.revision,
    pending: body && body.userId ? tpLineBotPendingRead(body).pending : null };
}

function tpLineStateSave(body) {
  // Both Web and LINE follow the same append-only / archive rules.
  if (body.expectedRevision === undefined) TPDomain.fail("缺少雲端版本，請重新讀取", 409);
  const saved = tpWebSave({
    state: body.state,
    expectedRevision: body.expectedRevision,
    mutationId: String(body.eventId || body.mutationId || ""),
  });
  if (body.userId) tpLineBotPendingSave({userId:body.userId,pending:body.pending || null});
  return saved;
}

// Keep unfinished LINE conversations outside canonical web_state.
const TP_BOT_PENDING_KEY = "tp-line-bot-v29:";
function tpLineBotPendingRead(body) {
  const userId = cleanText(body.userId);
  if (!userId) throw new Error("缺少 LINE userId");
  const raw = CacheService.getScriptCache().get(TP_BOT_PENDING_KEY + userId);
  const pending = safeParseJson(raw);
  return { pending: pending && Number(pending.expires) > Date.now() ? pending : null };
}
function tpLineBotPendingSave(body) {
  const userId = cleanText(body.userId);
  if (!userId) throw new Error("缺少 LINE userId");
  const cache = CacheService.getScriptCache(), key = TP_BOT_PENDING_KEY + userId;
  const value = body.pending;
  if (!value) { cache.remove(key); return { ok: true }; }
  if (!value.kind || !Number.isFinite(Number(value.expires))) throw new Error("LINE pending 格式不正確");
  const ttl = Math.max(1, Math.min(600, Math.ceil((Number(value.expires) - Date.now()) / 1000)));
  cache.put(key, JSON.stringify(value), ttl);
  return { ok: true };
}

// 提醒只送一次：先 claim，送成功後再標記 sent。
// 目前只處理「週一安排」與「週日足跡」；每日模式的卡片名稱還沒確認，先略過。
const TP_REMINDER_PROP = "tp-reminder-v29:";
const TP_REMINDER_CLAIM_WINDOW_MS = 10 * 60 * 1000;
function tpReminderClaim() {
  const record = tpStateLoad();
  if (!record) return { skipped: "no_state" };
  const state = record.state, prefs = state.preferences || {};
  if (!prefs.lineEnabled) return { skipped: "line_disabled" };
  const today = TPDomain.today();
  if (today < state.cycle.startDate || today > TPDomain.dates(state,12).slice(-1)[0])
    return { skipped: "cycle_not_active" };
  const weekday = Number(Utilities.formatDate(new Date(), "Asia/Taipei", "u"));
  const kind = weekday === 1 ? "monday" : weekday === 7 ? "footprint" : "";
  if (!kind) return { skipped: "no_card_today" };
  if (kind === "monday" && prefs.lineMondayEnabled === false) return { skipped: "monday_disabled" };
  if (kind === "footprint" && prefs.lineSundayEnabled === false) return { skipped: "sunday_disabled" };
  const at = kind === "monday" ? (prefs.lineMondayTime || prefs.lineTime || "08:00")
    : (prefs.lineSundayTime || prefs.lineTime || "08:00");
  const nowHm = Utilities.formatDate(new Date(), "Asia/Taipei", "HH:mm");
  if (nowHm < at) return { skipped: "not_time_yet" };
  const week = TPDomain.currentWeek(state,today);
  const key = state.cycle.number + ":" + week + ":" + kind + ":" + today;
  const props = PropertiesService.getScriptProperties();
  const propKey = TP_REMINDER_PROP + key;
  const recordClaim = safeParseJson(props.getProperty(propKey)) || {};
  if (recordClaim.sent) return { skipped: "already_sent" };
  if (recordClaim.claimedAt && Date.now() - recordClaim.claimedAt < TP_REMINDER_CLAIM_WINDOW_MS)
    return { skipped: "claimed_recently" };
  props.setProperty(propKey, JSON.stringify({ claimedAt: Date.now(), sent: false }));
  return { kind, key, state, week };
}
function tpReminderSent(body) {
  const key = cleanText(body.key);
  if (!/^\d+:\d+:(monday|footprint):\d{4}-\d{2}-\d{2}$/.test(key))
    throw new Error("提醒記錄識別碼不正確");
  const propKey = TP_REMINDER_PROP + key;
  const props = PropertiesService.getScriptProperties();
  const claim = safeParseJson(props.getProperty(propKey));
  if (!claim || !claim.claimedAt) throw new Error("找不到這筆提醒的 claim");
  props.setProperty(propKey, JSON.stringify({ claimedAt: claim.claimedAt, sent: true }));
  return { ok: true, sentKey: key };
}

// ---------- LINE 卡片 ----------

function tpCardTasks(cycleNumber, weekNumber) {
  return sortWeeklyMondayTasks(
    getItemsFromSheetRaw().filter(function (item) {
      return (
        item.type === "task" &&
        Number(item.scheduledCycleNumber || item.cycleNumber) ===
          Number(cycleNumber) &&
        Number(item.scheduledWeekNumber || item.weekNumber) ===
          Number(weekNumber) &&
        ["cancelled", "replanned"].indexOf(item.status) < 0
      );
    }),
  );
}

function tpCardText(text, options) {
  const opts = options || {};
  return {
    type: "text",
    text: text,
    size: opts.size || "sm",
    weight: opts.weight || "regular",
    color: opts.color || TP_LINE_THEME.text,
    wrap: opts.wrap !== false,
    margin: opts.margin || "none",
  };
}

// kind："monday"（週一安排）或 "footprint"（週日回顧）
function tpRenderCard(kind, cycleNumber, weekNumber) {
  const week = findWeek(cycleNumber, weekNumber);
  if (!week)
    throw new Error("找不到 Cycle " + cycleNumber + " · Week " + weekNumber);

  const isSunday = kind === "footprint";
  const accent = isSunday
    ? TP_LINE_CARD_ACCENTS.sunday
    : TP_LINE_CARD_ACCENTS.monday;
  const tasks = tpCardTasks(cycleNumber, weekNumber);
  const doneCount = tasks.filter(isWeeklyMondayDone).length;
  const pending = tasks.filter(function (t) {
    return !isWeeklyMondayDone(t);
  });

  const contents = [
    tpLineBrandRow(cycleNumber),
    tpCardText(isSunday ? "本週足跡" : "本週安排", {
      size: "lg",
      weight: "bold",
    }),
    tpLineCircleWeekMeta(week, isSunday),
    tpLineInfoCard("", "", [
      tpLineProgressBlock("", doneCount, tasks.length, accent),
    ]),
  ];

  const shown = isSunday ? pending : tasks;
  const limit = isSunday ? 5 : 8;
  const rows = shown.slice(0, limit).map(tpLineTaskRow);

  if (!tasks.length) {
    rows.push(
      tpCardText("這週還沒有安排，先放一件小事就好", {
        color: TP_LINE_THEME.muted,
      }),
    );
  } else if (isSunday && !pending.length) {
    rows.push(tpCardText("這週的事都完成了，辛苦了"));
  }
  if (shown.length > limit) {
    rows.push(
      tpCardText("還有 " + (shown.length - limit) + " 件，到網頁看全部", {
        size: "xs",
        color: TP_LINE_THEME.muted,
      }),
    );
  }
  if (rows.length)
    contents.push(
      tpLineInfoCard(isSunday ? "還留在這週的" : "這週的事", "•", rows),
    );

  if (isSunday) {
    contents.push(
      tpCardText("只完成一件小事，也算往前走了一步", {
        size: "xs",
        color: TP_LINE_THEME.muted,
      }),
    );
  }

  tpLineAppendQuickActions(contents, isSunday ? "sunday" : "monday");

  if (isSunday) {
    contents.push(
      tpLineActionRow([
        tpLineActionPill(
          "回網頁寫足跡",
          { type: "uri", label: "回網頁寫足跡", uri: TINY_PROGRESS_WEB_URL },
          { backgroundColor: TP_LINE_THEME.paper },
        ),
      ]),
    );
  }

  return {
    type: "flex",
    altText:
      "Tiny Progress · Week " +
      weekNumber +
      "：完成 " +
      doneCount +
      " / " +
      tasks.length,
    contents: tpLineFrame(accent, contents),
  };
}