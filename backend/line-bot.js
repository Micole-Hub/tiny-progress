"use strict";
const D = require("./domain"),
  Cards = require("./line-cards");
const nav = (week) => [
  { label: "看本週", a: "list", p: { week } },
  { label: "看足跡", a: "footprint", p: { week } },
];
function respond(s, event, { webUrl, random } = {}) {
  const uid = event.source.userId,
    w = D.currentWeek(s),
    raw = String(event.message?.text || "").trim();
  s._pending = s._pending || {};
  let p = event.postback
    ? Object.fromEntries(new URLSearchParams(event.postback.data))
    : null;
  const pending = s._pending[uid];
  const clear = () => {
    delete s._pending[uid];
  };
  const set = (value) => {
    s._pending[uid] = { ...value, expires: Date.now() + 600000 };
  };
  const q = (text, buttons = nav(w)) => [Cards.quick(text, buttons)];
  const task = () => {
    const t = s.tasks.find((t) => String(t.id) === String(p.id));
    D.editable(s, t);
    return t;
  };
  if (!p) {
    const commands = {
      清單: "list",
      本週: "list",
      本週清單: "list",
      看本週: "list",
      抽一件: "draw",
      抽任務: "draw",
      足跡: "footprint",
      本週足跡: "footprint",
      週一: "monday",
      新增: "add",
      取消: "cancel",
      取消修改: "cancel",
      說明: "help",
      help: "help",
      攻略: "help",
    };
    if (commands[raw]) {
      clear();
      p = { a: commands[raw] };
    } else if (pending && pending.expires > Date.now()) {
      if (!raw) return q("請輸入文字，或輸入「取消」。");
      if (pending.kind === "add") {
        D.add(s, raw, pending.week);
        clear();
        return q(`已新增「${D.text(raw)}」。`, nav(pending.week));
      }
      if (pending.kind === "rename") {
        const t = s.tasks.find((t) => String(t.id) === pending.id);
        D.editable(s, t);
        t.title = D.text(raw);
        clear();
        return q("名稱已更新。", nav(t.week));
      }
      if (pending.kind === "delete") {
        const t = D.remove(s, pending.id, raw);
        clear();
        return q(`已刪除「${t.title}」，原因已留在紀錄中。`, [
          { label: "復原刪除", a: "restore", p: { id: t.id } },
          ...nav(t.week),
        ]);
      }
      if (pending.kind === "move") {
        const t = D.move(s, pending.id, pending.week, raw);
        clear();
        return q(`已移到 Week ${t.week}。`, nav(w));
      }
      if (pending.kind === "note") {
        const t = s.tasks.find((t) => String(t.id) === pending.id);
        D.editable(s, t);
        const o = pending.oid
          ? t.occurrences?.find((o) => o.id === pending.oid)
          : t;
        if (!o?.done) D.fail("這次完成已復原，無法留小記");
        o.note = D.text(raw, 2000);
        clear();
        return q("完成小記已儲存。", nav(t.week));
      }
      if (pending.kind === "reflection") {
        const week = Number(pending.week);
        if (s.reflections[week]?.savedAt) D.fail("本週感想已儲存，只能查看");
        s.reflections[week] = {
          good: D.text(raw, 80),
          adjust: "",
          savedAt: new Date().toISOString(),
        };
        const snap = s.archivedWeeks.find((x) => x.week === week);
        if (snap) snap.reflection = s.reflections[week];
        clear();
        return q("感想已儲存，事情仍可繼續完成。", nav(week));
      }
    } else if (/^新增(?:任務|事情)?[：:\s]/.test(raw)) {
      const t = D.add(s, raw.replace(/^新增(?:任務|事情)?[：:\s]+/, ""));
      return q(`已新增「${t.title}」。`);
    } else {
      clear();
      p = { a: "help" };
    }
  }
  const week = p.week === undefined ? w : Number(p.week);
  if (!Number.isInteger(week) || week < 1 || week > 12) D.fail("Week 不正確");
  if (["list", "monday", "draw", "footprint", "completed"].includes(p.a)) {
    clear();
    if (week > D.highest(s)) D.fail("這週尚未開放");
    if (p.a === "draw" && D.archived(s, week)) D.fail("這週已封存，只能看足跡");
    if (p.a === "completed") {
      const ts = D.active(s, week).filter((t) => !D.recurring(t) && D.done(t)),
        page = Math.max(0, Number(p.page) || 0),
        slice = ts.slice(page * 8, page * 8 + 8);
      return q(
        slice.length
          ? slice.map((t) => "✓ " + t.title).join("\n")
          : "還沒有完成的一般事情。",
        [
          ...(!D.archived(s, week)
            ? slice.map((t) => ({
                label: "查看：" + t.title,
                a: "menu",
                p: { id: t.id },
              }))
            : []),
          ...(ts.length > (page + 1) * 8
            ? [{ label: "下一頁", a: "completed", p: { week, page: page + 1 } }]
            : []),
          ...nav(week),
        ],
      );
    }
    return [
      Cards[p.a](s, { week, page: p.page, exclude: p.exclude, webUrl, random }),
    ];
  }
  if (p.a === "cancel") {
    clear();
    return q("已取消這次操作。");
  }
  if (p.a === "add") {
    if (D.archived(s, week) || week > D.highest(s)) D.fail("這週無法新增");
    set({ kind: "add", week });
    return q("想加入什麼事情？直接輸入名稱。", [
      { label: "取消", a: "cancel" },
    ]);
  }
  if (p.a === "restore") {
    const t = s.tasks.find((t) => String(t.id) === String(p.id));
    if (!t || D.archived(s, t.week)) D.fail("這件事情已封存");
    if (t.status === "deleted") {
      t.status = "active";
      D.event(s, t, "restore");
    }
    clear();
    return q("已復原「" + t.title + "」。", nav(t.week));
  }
  if (p.a === "menu") {
    const t = task(),
      buttons = [];
    if (D.recurring(t)) {
      const next = Cards.nextOccurrence(t, s);
      if (next)
        buttons.push({
          label: "完成一次",
          a: "done",
          p: { id: t.id, oid: next.id },
        });
      buttons.push({
        label: "查看／復原次數",
        a: "occurrences",
        p: { id: t.id },
      });
    } else
      buttons.push({
        label: t.done ? "復原完成" : "完成",
        a: "done",
        p: { id: t.id, value: t.done ? "0" : "1" },
      });
    buttons.push(
      { label: "改名稱", a: "rename", p: { id: t.id } },
      { label: "刪除", a: "delete_confirm", p: { id: t.id } },
    );
    if (!t.done && !D.recurring(t) && t.week < 12)
      buttons.push({ label: "移到其他週", a: "move_choose", p: { id: t.id } });
    return q(`「${t.title}」要做什麼？`, buttons.concat(nav(t.week)));
  }
  if (p.a === "occurrences") {
    const t = task();
    if (!D.recurring(t)) D.fail("這不是日常小事");
    return q(
      `${t.title}：${D.doneCount(t)} / ${t.targetCount} 次。\n點選要完成或復原的那一次。`,
      t.occurrences
        .map((o, i) => ({
          label: `${o.done ? "✓ 復原" : "○ 完成"} ${o.date ? o.date.slice(5) : "第 " + (i + 1) + " 次"}`,
          a: "done",
          p: { id: t.id, oid: o.id, value: o.done ? "0" : "1" },
        }))
        .concat(nav(t.week)),
    );
  }
  if (p.a === "done") {
    const t = task(),
      value = p.value !== "0",
      updated = D.setCompletion(s, t.id, value, p.oid);
    clear();
    const buttons = [
      {
        label: value ? "復原" : "再完成",
        a: "done",
        p: {
          id: t.id,
          ...(p.oid ? { oid: p.oid } : {}),
          value: value ? "0" : "1",
        },
      },
      ...nav(t.week),
    ];
    if (value && s.preferences.completionNote)
      buttons.unshift({
        label: "留小記",
        a: "note",
        p: { id: t.id, ...(p.oid ? { oid: p.oid } : {}) },
      });
    return q(
      `${value ? "✓ 已完成" : "已復原"}「${updated.title}」${D.recurring(t) ? ` ${D.doneCount(t)}/${t.targetCount} 次` : ""}。`,
      buttons,
    );
  }
  if (p.a === "note") {
    const t = task();
    set({ kind: "note", id: String(t.id), oid: p.oid || "" });
    return q("替這次完成留一句話。", [{ label: "略過", a: "cancel" }]);
  }
  if (p.a === "rename") {
    const t = task();
    set({ kind: "rename", id: String(t.id) });
    return q(`請輸入「${t.title}」的新名稱。`, [
      { label: "取消", a: "cancel" },
    ]);
  }
  if (p.a === "delete_confirm") {
    const t = task();
    return q(`確定刪除「${t.title}」嗎？刪除後會保留原因。`, [
      { label: "確定刪除", a: "delete_reason", p: { id: t.id } },
      { label: "先不要", a: "cancel" },
    ]);
  }
  if (p.a === "delete_reason" || p.a === "move_reason") {
    const t = task(),
      move = p.a === "move_reason";
    set({
      kind: move ? "move" : "delete",
      id: String(t.id),
      week: Number(p.week),
    });
    return q(
      move
        ? `將「${t.title}」移到 Week ${week}，請輸入原因。`
        : "請輸入刪除原因，或選下方選項。",
      [
        ...["時間不夠", "事情太大", "改變安排"].map((reason) => ({
          label: reason,
          a: "reason",
          p: { reason },
        })),
        { label: "取消", a: "cancel" },
      ],
    );
  }
  if (p.a === "reason") {
    const live = s._pending[uid];
    if (
      !live ||
      live.expires < Date.now() ||
      !["delete", "move"].includes(live.kind)
    )
      D.fail("操作已過期，請重新選擇");
    return respond(
      s,
      { source: event.source, message: { text: p.reason } },
      { webUrl, random },
    );
  }
  if (p.a === "move_list") {
    const ts = D.active(s, week).filter((t) => !D.done(t) && !D.recurring(t)),
      page = Math.max(0, Number(p.page) || 0),
      slice = ts.slice(page * 9, page * 9 + 9);
    if (!ts.length) return q("沒有需要移週的一般事情。", nav(week));
    return q(
      "選擇要移到其他週的事情。",
      slice
        .map((t) => ({ label: t.title, a: "move_choose", p: { id: t.id } }))
        .concat(
          ts.length > (page + 1) * 9
            ? [{ label: "下一頁", a: "move_list", p: { week, page: page + 1 } }]
            : [],
        )
        .concat(nav(week)),
    );
  }
  if (p.a === "move_choose") {
    const t = task();
    if (D.recurring(t) || D.done(t) || t.week === 12)
      D.fail("這件事情無法移週");
    const targets = Array.from(
      { length: 12 - t.week },
      (_, i) => t.week + i + 1,
    ).filter(
      (x) => !D.archived(s, x) && (x === t.week + 1 || x <= D.highest(s)),
    );
    return q(
      `「${t.title}」要移到哪一週？`,
      targets
        .map((week) => ({
          label: "Week " + week,
          a: "move_reason",
          p: { id: t.id, week },
        }))
        .concat([{ label: "取消", a: "cancel" }]),
    );
  }
  if (p.a === "reflect") {
    if (!s.preferences.weeklyReflection) D.fail("每週記錄目前已關閉");
    if (s.reflections[week]?.savedAt) D.fail("本週感想已儲存，只能查看");
    set({ kind: "reflection", week });
    return q("本週想留下什麼感想？儲存後只能查看；不會立即封存這一週。", [
      { label: "取消", a: "cancel" },
    ]);
  }
  return q(
    "可輸入「清單」、「抽一件」、「足跡」或「新增」。\n事情旁的圓圈可完成，⋯ 可改名、刪除與移週。\n日常小事每次只記錄一次。",
    nav(w).concat([
      { label: "新增", a: "add", p: { week: w } },
      ...(webUrl ? [{ label: "開網頁", uri: webUrl }] : []),
    ]),
  );
}
module.exports = { respond };
