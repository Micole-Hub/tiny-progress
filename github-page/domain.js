/* Tiny Progress v28.0 — authoritative rules shared by Web and LINE. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TPDomain = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  const VERSION = "28.0.0";
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const text = (v, max = 200) =>
    String(v ?? "")
      .trim()
      .slice(0, max);
  const bool = (v) => v === true || String(v).toLowerCase() === "true";
  const isoDate = (v) =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(v)) &&
    !isNaN(Date.parse(v)) &&
    new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v
      ? String(v)
      : "";
     const today = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  const addDays = (d, n) =>
    new Date(Date.parse(d + "T12:00:00Z") + n * 86400000)
      .toISOString()
      .slice(0, 10);
  const monday = (d) =>
    addDays(d, -((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7));
  let lastId = 0;
  const id = () =>
    (lastId = Math.max(
      lastId + 1,
      Date.now() * 1000 + Math.floor(Math.random() * 1000),
    ));
  const fail = (message, status = 400) => {
    const e = new Error(message);
    e.status = status;
    throw e;
  };
  const dates = (s, w) => {
    const range = s.cycle.weekRanges?.[Number(w) - 1];
    const start =
      range?.start ||
      s.cycle.weekStarts?.[Number(w) - 1] ||
      addDays(s.cycle.startDate, (Number(w) - 1) * 7);
    const length = range
      ? Math.round((Date.parse(range.end) - Date.parse(start)) / 86400000) + 1
      : 7;
    return Array.from({ length }, (_, i) => addDays(start, i));
  };
  const currentWeek = (s, date = today()) =>
    s.cycle.weekStarts?.length === 12
      ? Math.max(
          1,
          s.cycle.weekStarts.reduce(
            (n, start, i) => (start <= date ? i + 1 : n),
            1,
          ),
        )
      : Math.max(
          1,
          Math.min(
            12,
            Math.floor(
              (Date.parse(date) - Date.parse(s.cycle.startDate)) / 604800000,
            ) + 1,
          ),
        );
  const recurring = (t) => !!t.recurringRuleId && Array.isArray(t.occurrences);
  const doneCount = (t) =>
    recurring(t) ? t.occurrences.filter((o) => o.done).length : t.done ? 1 : 0;
  const target = (t) => (recurring(t) ? t.targetCount : 1);
  const done = (t) => doneCount(t) >= target(t);
  const active = (s, w) =>
    s.tasks.filter(
      (t) => Number(t.week) === Number(w) && t.status === "active",
    );
  const complete = (s, w) =>
    active(s, w).length > 0 && active(s, w).every(done);
  const archived = (s, w) => !!s.weekMeta[String(w)]?.archivedAt;
  const highest = (s, date = today()) => {
    let w = currentWeek(s, date);
    while (
      w < 12 &&
      (complete(s, w) || s.weekMeta[w]?.archiveReason === "review")
    )
      w++;
    return w;
  };
  const category = (s, t) => s.categories.find((c) => c.id === t.categoryId);
  const color = (s, t) => category(s, t)?.color || "#9eb29a";
  const syncDone = (t) => {
    t.done = done(t);
    if (!t.done) t.doneDate = "";
    else if (recurring(t))
      t.doneDate =
        t.occurrences
          .map((o) => o.doneDate || "")
          .sort()
          .at(-1) || "";
    return t;
  };
  function empty(date = today()) {
    return {
      schemaVersion: 27,
      simulationWeekStart: monday(date),
      mode: "week",
      selectedWeek: 1,
      selectedDate: date,
      cycle: {
        number: 1,
        startDate: monday(date),
        locked: true,
        direction: "一件一件，累積自己的進度",
        directions: [],
        goals: [],
      },
      preferences: {
        completionNote: false,
        weeklyReflection: true,
        lineEnabled: false,
        lineTime: "08:00",
      },
      categories: [
        { id: "learn", name: "學習", color: "#9fc3de" },
        { id: "life", name: "生活", color: "#e3b48a" },
        { id: "create", name: "創作", color: "#efb8cf" },
      ],
      tasks: [],
      recurringRules: [],
      archivedWeeks: [],
      weekMeta: {},
      footprintDeferred: {},
      reflections: {},
      events: [],
      leafSlots: {},
      onboarded: false,
      tankReviewed: {},
      unfinishedReasons: {},
    };
  }
  function leaves(s, w) {
    return active(s, w).flatMap((t) =>
      recurring(t)
        ? t.occurrences
            .filter((o) => o.done)
            .map((o) => ({
              key: `${t.id}:${o.id}`,
              title: t.title,
              color: color(s, t),
              taskId: t.id,
              rec: true,
              target: t.targetCount,
              date: o.doneDate || "",
              note: o.note || "",
            }))
        : t.done
          ? [
              {
                key: String(t.id),
                title: t.title,
                color: color(s, t),
                taskId: t.id,
                date: t.doneDate || "",
                note: t.note || "",
              },
            ]
          : [],
    );
  }
  function archive(s, w, reason = "date") {
    if (archived(s, w)) return;
    const meta = {
      archivedAt: new Date().toISOString(),
      archiveReason: reason,
      autoArchived: reason === "date",
    };
    s.weekMeta[w] = meta;
    s.archivedWeeks = s.archivedWeeks.filter(
      (x) => Number(x.week) !== Number(w),
    );
    s.archivedWeeks.push({
      week: Number(w),
      completed: leaves(s, w),
      replanned: s.events
        .filter((e) => e.type === "replan" && e.fromWeek === w)
        .map((e) => `${e.title} → Week ${e.toWeek}｜${e.reason || ""}`),
      deleted: s.events
        .filter((e) => e.type === "delete" && e.week === w)
        .map((e) => `${e.title}｜${e.reason || ""}`),
      reflection: s.reflections[w] || null,
      ...meta,
    });
    s.archivedWeeks.sort((a, b) => a.week - b.week);
  }
  function makeRecurring(s, r, w) {
    const tid = id(),
      n = r.frequency === "daily" ? 7 : r.timesPerWeek;
    return {
      id: tid,
      week: w,
      originalWeek: w,
      title: r.title,
      categoryId: r.categoryId,
      goal: r.goal || "",
      status: "active",
      focusDate: "",
      done: false,
      doneDate: "",
      note: "",
      recurringRuleId: r.id,
      frequency: r.frequency,
      targetCount: n,
      occurrences: Array.from({ length: n }, (_, i) => ({
        id: `${tid}-o${i + 1}`,
        date: r.frequency === "daily" ? dates(s, w)[i] : "",
        done: false,
        doneDate: "",
      })),
    };
  }
  function advance(s, date = today()) {
    const cw = currentWeek(s, date);
    for (let w = 1; w < cw; w++) archive(s, w);
    if (date > dates(s, 12).at(-1)) archive(s, 12);
    // Past records are never synthesized or changed by a new recurring rule.
    const max = highest(s, date);
    for (let w = cw; w <= max; w++)
      if (!archived(s, w))
        s.recurringRules
          .filter((r) => r.active)
          .forEach((r) => {
            if (
              !s.tasks.some((t) => t.week === w && t.recurringRuleId === r.id)
            )
              s.tasks.push(makeRecurring(s, r, w));
          });
    return s;
  }
  function validate(s) {
    if (
      !s ||
      typeof s !== "object" ||
      Array.isArray(s) ||
      s.schemaVersion !== 27
    )
      fail("資料格式或版本不正確");
    for (const k of [
      "tasks",
      "categories",
      "recurringRules",
      "events",
      "archivedWeeks",
    ])
      if (!Array.isArray(s[k])) fail("缺少資料欄位：" + k);
    if (
      !s.cycle ||
      !isoDate(s.cycle.startDate) ||
      !Number.isInteger(s.cycle.number) ||
      s.cycle.number < 1
    )
      fail("Cycle 日期或編號不正確");
    if (
      s.cycle.weekRanges &&
      (s.cycle.weekRanges.length !== 12 ||
        s.cycle.weekRanges.some(
          (r, i) =>
            !isoDate(r.start) ||
            !isoDate(r.end) ||
            r.end < r.start ||
            (Date.parse(r.end) - Date.parse(r.start)) / 86400000 > 13 ||
            (i > 0 && r.start !== addDays(s.cycle.weekRanges[i - 1].end, 1)),
        ))
    )
      fail("每週日期範圍不正確");
    if (
      s.cycle.weekStarts &&
      (s.cycle.weekStarts.length !== 12 ||
        s.cycle.weekStarts.some(
          (v, i) => !isoDate(v) || (i > 0 && v <= s.cycle.weekStarts[i - 1]),
        ))
    )
      fail("每週起點不正確");
    if (!Array.isArray(s.cycle.directions) || s.cycle.directions.length > 3)
      fail("方向最多三個");
    if (
      s.cycle.directionLinks &&
      (typeof s.cycle.directionLinks !== "object" ||
        Array.isArray(s.cycle.directionLinks) ||
        Object.entries(s.cycle.directionLinks).some(
          ([k, v]) =>
            !/^\d+$/.test(k) || (v !== "" && !/^[\w-]{1,90}$/.test(v)),
        ))
    )
      fail("方向連結格式不正確");
    const ids = new Set();
    for (const t of s.tasks) {
      if (!Number.isSafeInteger(t.id) || ids.has(t.id))
        fail("事情 ID 重複或無效");
      ids.add(t.id);
      if (!text(t.title) || t.title.length > 200)
        fail("事情名稱需為 1～200 字");
      if (!Number.isInteger(t.week) || t.week < 1 || t.week > 12)
        fail("Week 必須介於 1～12");
      if (!["active", "deleted", "replanned"].includes(t.status))
        fail("事情狀態不正確");
      if (typeof t.done !== "boolean") fail("完成狀態不正確");
      if (t.focusDate && !dates(s, t.week).includes(t.focusDate))
        fail("安排日期必須在事情所屬週內");
      if (recurring(t)) {
        if (
          !["daily", "weekly"].includes(t.frequency) ||
          !Number.isInteger(t.targetCount) ||
          t.targetCount < 1 ||
          t.targetCount > 7 ||
          t.occurrences.length !== t.targetCount
        )
          fail("日常次數不正確");
        const oid = new Set();
        for (const o of t.occurrences) {
          if (!/^[\w-]{1,120}$/.test(o.id) || oid.has(o.id))
            fail("日常紀錄 ID 重複或無效");
          oid.add(o.id);
          if (typeof o.done !== "boolean") fail("日常完成狀態不正確");
          if (o.date && !dates(s, t.week).includes(o.date))
            fail("日常日期必須在所屬週內");
        }
        if (t.done !== done(t)) fail("日常總完成狀態與次數不一致");
      }
    }
    for (const list of [s.categories, s.recurringRules, s.cycle.directions]) {
      const set = new Set();
      for (const x of list) {
        if (!/^[\w-]{1,90}$/.test(String(x.id)) || set.has(x.id))
          fail("設定 ID 重複或無效");
        set.add(x.id);
      }
    }
    for (const c of [...s.categories, ...s.cycle.directions])
      if (!/^#[0-9a-f]{6}$/i.test(c.color) || !text(c.name, 60))
        fail("名稱或色碼不正確");
    for (const snapshot of s.archivedWeeks) {
      if (
        !Number.isInteger(snapshot.week) ||
        snapshot.week < 1 ||
        snapshot.week > 12 ||
        !Array.isArray(snapshot.completed) ||
        !Array.isArray(snapshot.replanned) ||
        !Array.isArray(snapshot.deleted)
      )
        fail("封存紀錄格式不正確");
      for (const leaf of snapshot.completed)
        if (leaf.color && !/^#[0-9a-f]{6}$/i.test(leaf.color))
          fail("封存色碼不正確");
    }
    for (const direction of s.cycle.directions)
      if (
        !Number.isInteger(direction.target) ||
        direction.target < 1 ||
        direction.target > 999
      )
        fail("方向葉子目標需介於 1～999");
    for (const r of s.recurringRules)
      if (
        !text(r.title) ||
        !["daily", "weekly"].includes(r.frequency) ||
        !Number.isInteger(r.timesPerWeek) ||
        r.timesPerWeek < 1 ||
        r.timesPerWeek > 7
      )
        fail("日常規則不正確");
    if (
      !s.preferences ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.preferences.lineTime)
    )
      fail("提醒時間不正確");
    for (const k of [
      "weekMeta",
      "footprintDeferred",
      "reflections",
      "unfinishedReasons",
      "tankReviewed",
      "leafSlots",
    ])
      if (!s[k] || typeof s[k] !== "object" || Array.isArray(s[k]))
        fail("設定格式不正確：" + k);
    if (JSON.stringify(s).length > 1500000) fail("資料量超過可儲存上限");
    return s;
  }
  const PUBLIC_KEYS = [
    "schemaVersion",
    "simulationWeekStart",
    "mode",
    "selectedWeek",
    "selectedDate",
    "cycle",
    "preferences",
    "categories",
    "recurringRules",
    "tasks",
    "archivedWeeks",
    "weekMeta",
    "footprintDeferred",
    "reflections",
    "events",
    "leafSlots",
    "onboarded",
    "tankReviewed",
    "unfinishedReasons",
    "legacyArchive",
  ];
  function publicState(s) {
    return clone(
      Object.fromEntries(
        PUBLIC_KEYS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]),
      ),
    );
  }
  function acceptWebState(current, input) {
    const next = publicState(input);
    validate(next);
    if (
      next.cycle.number !== current.cycle.number ||
      next.cycle.startDate !== current.cycle.startDate ||
      JSON.stringify(next.cycle.weekStarts) !==
        JSON.stringify(current.cycle.weekStarts) ||
      JSON.stringify(next.cycle.weekRanges) !==
        JSON.stringify(current.cycle.weekRanges)
    )
      fail("不能在存檔時變更 Cycle 起點", 409);
    // The browser cannot erase tasks or rewrite sealed history through a snapshot save.
    for (const t of current.tasks) {
      const n = next.tasks.find((x) => x.id === t.id);
      if (!n) fail("事情不可直接移除；請使用刪除並留下原因", 409);
      if (archived(current, t.week) && JSON.stringify(t) !== JSON.stringify(n))
        fail("已封存的事情不能修改", 409);
      if (
        n.week !== t.week &&
        (recurring(t) ||
          done(t) ||
          n.week <= t.week ||
          n.week > 12 ||
          archived(current, n.week) ||
          (n.week !== t.week + 1 && n.week > highest(current)))
      )
        fail("這件事情不能移到指定週", 409);
      if (
        n.status === "deleted" &&
        t.status !== "deleted" &&
        !next.events
          .slice(current.events.length)
          .some(
            (e) => e.type === "delete" && e.taskId === t.id && text(e.reason),
          )
      )
        fail("刪除必須留下原因", 409);
      if (
        n.week !== t.week &&
        !next.events
          .slice(current.events.length)
          .some(
            (e) =>
              e.type === "replan" &&
              e.taskId === t.id &&
              e.fromWeek === t.week &&
              e.toWeek === n.week &&
              text(e.reason),
          )
      )
        fail("移週必須留下原因", 409);
    }
    for (const t of next.tasks)
      if (
        !current.tasks.some((x) => x.id === t.id) &&
        (archived(current, t.week) || t.week > highest(next))
      )
        fail("不能在封存或尚未開放的週新增事情", 409);
    for (const [w, m] of Object.entries(current.weekMeta))
      if (m.archivedAt) {
        if (JSON.stringify(m) !== JSON.stringify(next.weekMeta[w]))
          fail("封存狀態不能更改", 409);
        const old = current.archivedWeeks.find((x) => String(x.week) === w),
          n = next.archivedWeeks.find((x) => String(x.week) === w);
        if (
          !n ||
          JSON.stringify(old?.completed) !== JSON.stringify(n.completed) ||
          JSON.stringify(old?.replanned) !== JSON.stringify(n.replanned) ||
          JSON.stringify(old?.deleted) !== JSON.stringify(n.deleted)
        )
          fail("封存紀錄不能修改", 409);
      }
    for (const [w, r] of Object.entries(current.reflections))
      if (
        r?.savedAt &&
        JSON.stringify(r) !== JSON.stringify(next.reflections[w])
      )
        fail("已儲存的感想不能修改", 409);
    if (
      JSON.stringify(next.events.slice(0, current.events.length)) !==
      JSON.stringify(current.events)
    )
      fail("歷史紀錄不能刪改", 409);
    for (const [k, v] of Object.entries(current))
      if (k.startsWith("_")) next[k] = clone(v);
    next.legacyArchive = current.legacyArchive;
    return advance(next);
  }
  function editable(s, t) {
    if (!t || t.status !== "active") fail("這件事情已不存在或已刪除", 404);
    if (archived(s, t.week)) fail("這週已封存，只能查看", 409);
  }
  function event(s, t, type, extra = {}) {
    s.events.push({
      type,
      taskId: t.id,
      title: t.title,
      week: t.week,
      date: today(),
      ...extra,
    });
  }
  function setCompletion(s, tid, value, oid) {
    const t = s.tasks.find((t) => String(t.id) === String(tid));
    editable(s, t);
    if (recurring(t)) {
      if (!oid) fail("請指定這一次日常紀錄");
      const o = t.occurrences.find((o) => o.id === oid);
      if (!o) fail("找不到這次日常紀錄");
      if (o.done === value) return t;
      o.done = value;
      o.doneDate = value ? today() : "";
      if (t.frequency === "weekly")
        o.date = value
          ? o.date || (dates(s, t.week).includes(today()) ? today() : "")
          : "";
      if (!value) o.note = "";
      event(s, t, value ? "complete" : "uncomplete", {
        occurrenceId: o.id,
        color: color(s, t),
      });
      syncDone(t);
    } else {
      if (t.done === value) return t;
      t.done = value;
      t.doneDate = value ? today() : "";
      if (!value) t.note = "";
      event(s, t, value ? "complete" : "uncomplete", { color: color(s, t) });
    }
    s.footprintDeferred[t.week] = false;
    return t;
  }
  function add(s, title, w = currentWeek(s)) {
    title = text(title);
    if (!title) fail("名稱不能空白");
    if (archived(s, w) || w < 1 || w > highest(s)) fail("這週尚未開放或已封存");
    const t = {
      id: id(),
      week: w,
      originalWeek: w,
      title,
      status: "active",
      done: false,
      doneDate: "",
      focusDate: "",
      categoryId: s.categories[0]?.id || "",
      goal: "",
      note: "",
    };
    s.tasks.push(t);
    return t;
  }
  function remove(s, tid, reason) {
    const t = s.tasks.find((x) => String(x.id) === String(tid));
    editable(s, t);
    if (!text(reason, 60)) fail("請寫下刪除原因");
    event(s, t, "delete", {
      reason: text(reason, 60),
      completedUnits: doneCount(t),
    });
    t.status = "deleted";
    return t;
  }
  function move(s, tid, w, reason) {
    const t = s.tasks.find((x) => String(x.id) === String(tid));
    editable(s, t);
    w = Number(w);
    if (recurring(t) || done(t)) fail("已完成或日常小事不能移週");
    if (
      !Number.isInteger(w) ||
      w <= t.week ||
      w > 12 ||
      archived(s, w) ||
      (w !== t.week + 1 && w > highest(s))
    )
      fail("目標週尚未開放");
    if (!text(reason, 60)) fail("請寫下移週原因");
    event(s, t, "replan", {
      fromWeek: t.week,
      toWeek: w,
      reason: text(reason, 60),
    });
    t.originalWeek = t.originalWeek || t.week;
    t.week = w;
    t.focusDate = "";
    return t;
  }
  function migrateLegacy(raw, date = today()) {
    const s = empty(date),
      weeks = raw.weeks || [],
      cycles = raw.cycles || [];
    const candidate =
      weeks.find((w) => w.weekStart <= date && w.weekEnd >= date) ||
      weeks.find((w) => w.status === "current") ||
      weeks.at(-1);
    const cn = Number(
      candidate?.cycleNumber || cycles.at(-1)?.cycleNumber || 1,
    );
    const cw = weeks
      .filter((w) => Number(w.cycleNumber) === cn)
      .sort((a, b) => a.weekNumber - b.weekNumber);
    s.cycle.number = cn;
    s.cycle.startDate =
      isoDate(cycles.find((c) => Number(c.cycleNumber) === cn)?.startDate) ||
      isoDate(cw.find((w) => Number(w.weekNumber) === 1)?.weekStart) ||
      monday(date);
    s.simulationWeekStart = s.cycle.startDate;
    if (cw.length === 12 && cw.every((w) => isoDate(w.weekStart))) {
      s.cycle.weekStarts = cw.map((w) => w.weekStart);
      s.cycle.weekRanges = cw.map((w) => ({
        start: w.weekStart,
        end: w.weekEnd,
      }));
    }
    s.cycle.direction =
      text(cycles.find((c) => Number(c.cycleNumber) === cn)?.theme) ||
      s.cycle.direction;
    const cats = (raw.categories || []).filter(
      (c) => !c.parentId && c.active !== false,
    );
    if (cats.length)
      s.categories = cats.map((c, i) => ({
        id: /^[\w-]{1,90}$/.test(c.id) ? c.id : "legacy-cat-" + i,
        name: text(c.name, 60),
        color: ["#9fc3de", "#a9cb9f", "#efb8cf", "#e3b48a"][i % 4],
      }));
    const lookup = {};
    (raw.items || [])
      .filter(
        (t) =>
          Number(t.scheduledCycleNumber || t.cycleNumber || 1) === cn &&
          (!t.type || t.type === "task"),
      )
      .forEach((old, index) => {
        const tid = 100000 + index;
        lookup[old.id] = tid;
        let occ = old.occurrences;
        if (!Array.isArray(occ)) {
          try {
            occ = JSON.parse(old.occurrencesJson || "[]");
          } catch {
            occ = [];
          }
        }
        const t = {
          id: tid,
          legacyId: String(old.id),
          week: Number(old.scheduledWeekNumber || old.weekNumber || 1),
          originalWeek: Number(old.originalWeekNumber || old.weekNumber || 1),
          title: text(old.title) || "未命名事情",
          categoryId:
            s.categories.find(
              (c) => c.id === old.categoryId || c.name === old.category,
            )?.id ||
            s.categories[0]?.id ||
            "",
          goal: "",
          status: ["cancelled", "deleted"].includes(old.status)
            ? "deleted"
            : old.status === "replanned"
              ? "replanned"
              : "active",
          done: bool(old.done) || old.status === "completed",
          doneDate: String(old.completedAt || "").slice(0, 10),
          focusDate: "",
          note: text(old.completionNote, 2000),
        };
        if (["daily", "weekly"].includes(old.frequency)) {
          t.recurringRuleId = text(old.recurringRuleId) || "legacy-rule-" + tid;
          t.frequency = old.frequency;
          t.targetCount = Math.max(
            1,
            Math.min(
              7,
              Number(old.timesPerWeek) ||
                occ.length ||
                (old.frequency === "daily" ? 7 : 1),
            ),
          );
          t.occurrences = Array.from({ length: t.targetCount }, (_, i) => {
            const o = occ[i] || {
              done: bool(old.done) || old.status === "completed",
            };
            return {
              id: `${tid}-o${i + 1}`,
              date:
                t.frequency === "daily"
                  ? dates(s, t.week)[i]
                  : dates(s, t.week).includes(String(o.date || ""))
                    ? o.date
                    : "",
              done: bool(o.done),
              doneDate: String(o.completedAt || o.doneDate || "").slice(0, 10),
              note: text(o.note, 2000),
            };
          });
          syncDone(t);
          if (!s.recurringRules.some((r) => r.id === t.recurringRuleId))
            s.recurringRules.push({
              id: t.recurringRuleId,
              title: t.title,
              frequency: t.frequency,
              timesPerWeek: t.targetCount,
              categoryId: t.categoryId,
              active: true,
            });
        }
        s.tasks.push(t);
        if (t.status === "deleted")
          event(s, t, "delete", {
            date: String(old.cancelledAt || "").slice(0, 10),
            reason: text(old.cancelReason, 60) || "舊版刪除紀錄",
          });
        if (t.originalWeek !== t.week)
          event(s, t, "replan", {
            fromWeek: t.originalWeek,
            toWeek: t.week,
            reason: "從舊版移入",
          });
      });
    (raw.retrospectives || [])
      .filter((r) => Number(r.cycleNumber) === cn)
      .forEach((r) => {
        s.reflections[r.weekNumber] = {
          good: text(r.q1, 80),
          adjust: text(r.q2, 80),
          savedAt: r.submittedAt || r.updatedAt || new Date().toISOString(),
        };
      });
    cw.filter((w) => bool(w.archived)).forEach((w) =>
      archive(s, Number(w.weekNumber), w.archiveReason || "date"),
    );
    // Keep the complete original sheet snapshot, including earlier cycles and uncommon legacy columns.
    s.legacyArchive = clone(raw);
    s.onboarded = false;
    s.selectedWeek = currentWeek(s, date);
    advance(s, date);
    return validate(s);
  }
  return {
    VERSION,
    clone,
    text,
    today,
    addDays,
    monday,
    id,
    empty,
    currentWeek,
    dates,
    recurring,
    doneCount,
    target,
    done,
    active,
    complete,
    archived,
    highest,
    category,
    color,
    syncDone,
    leaves,
    archive,
    makeRecurring,
    advance,
    validate,
    publicState,
    acceptWebState,
    editable,
    event,
    setCompletion,
    add,
    remove,
    move,
    migrateLegacy,
    fail,
  };
});
