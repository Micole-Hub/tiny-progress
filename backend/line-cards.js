"use strict";
const D = require("./domain");
const C = {
  paper: "#FFFEFA",
  text: "#3C4941",
  muted: "#606A60",
  line: "#E4E1D8",
  soft: "#EEF3EA",
  list: "#739377",
  draw: "#7A9F95",
  monday: "#889EAD",
  footprint: "#A89A78",
};
// Visual category chips match the low-saturation forest leaves in the web QA.
// Stored HEX values are never changed.
function morandiTone(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(String(hex || ""))) return "#9AAE97";
  const normalized = hex.toUpperCase();
  const palette = [
    "#829D86", "#90AA9B", "#8FA6B5", "#A5A98C",
    "#B3A080", "#9DA7B2", "#76958A", "#A9BBA6",
    "#A49E85", "#99A8A4", "#9D9FB4", "#B8AD91",
  ];
  const tones = [
    ["#A58E72", "#BBAA8A"],
    ["#999875", "#B0AE86"],
    ["#78977E", "#A1B59D"],
    ["#779995", "#9AB4B0"],
    ["#8198AD", "#A2B4C4"],
    ["#9695A7", "#B1B0C2"],
  ];
  if (palette.includes(normalized) || tones.some(pair => pair.includes(normalized)))
    return normalized;
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min;
  let hue = 0;
  if (delta) {
    const n = rgb.indexOf(max);
    hue = 60 * (n === 0 ? ((rgb[1] - rgb[2]) / delta) % 6
      : n === 1 ? (rgb[2] - rgb[0]) / delta + 2
      : (rgb[0] - rgb[1]) / delta + 4);
    if (hue < 0) hue += 360;
  }
  const group = hue < 25 || hue >= 330 ? 0
    : hue < 72 ? 1 : hue < 170 ? 2
      : hue < 207 ? 3 : hue < 273 ? 4 : 5;
  return tones[group][(max + min) / 2 >= 0.63 ? 1 : 0];
}
const txt = (text, size = "sm", extra = {}) => ({
  type: "text",
  text: String(text || " "),
  size,
  color: C.text,
  wrap: true,
  ...extra,
});
const box = (contents, extra = {}) => ({
  type: "box",
  layout: "vertical",
  contents,
  ...extra,
});
const row = (contents, extra = {}) =>
  box(contents, {
    layout: "horizontal",
    spacing: "sm",
    alignItems: "center",
    ...extra,
  });
const sep = () => ({ type: "separator", color: C.line, margin: "md" });
function action(label, a, p = {}) {
  return {
    type: "postback",
    label: label.slice(0, 20),
    data: new URLSearchParams({ a, ...p }).toString(),
  };
}
function pill(label, a, p = {}, accent = C.list, primary = false) {
  return box(
    [
      txt(label, "sm", {
        align: "center",
        weight: "bold",
        color: primary ? "#FFFFFF" : C.text,
      }),
    ],
    {
      paddingAll: "12px",
      cornerRadius: "14px",
      backgroundColor: primary
        ? accent === C.monday
          ? "#566E88"
          : accent === C.draw
            ? "#476E63"
            : "#526E56"
        : C.soft,
      action: typeof a === "object" ? a : action(label, a, p),
      flex: 1,
    },
  );
}
function quick(text, buttons = []) {
  const msg = { type: "text", text: String(text).slice(0, 4900) };
  if (buttons.length)
    msg.quickReply = {
      items: buttons
        .slice(0, 13)
        .map((b) => ({
          type: "action",
          action: b.uri
            ? { type: "uri", label: b.label.slice(0, 20), uri: b.uri }
            : action(b.label, b.a, b.p),
        })),
    };
  return msg;
}
function frame(s, w, title, kind, contents, footer, webUrl) {
  const ds = D.dates(s, w),
    date = `${ds[0].slice(5).replace("-", "/")}–${ds.at(-1).slice(5).replace("-", "/")}`;
  const brand = row([
    txt(`Tiny Progress · Cycle ${s.cycle.number}`, "xs", { flex: 1 }),
    txt("∞", "lg", { flex: 0, color: C[kind] }),
  ]);
  if (webUrl) brand.action = { type: "uri", label: "開網頁", uri: webUrl };
  return {
    type: "flex",
    altText: `Tiny Progress｜${title}｜Week ${w}`,
    contents: {
      type: "bubble",
      size: "mega",
      body: box(
        [
          box(
            [
              brand,
              txt(title, "xl", { weight: "bold", margin: "md" }),
              txt(`Week ${w}　${date}`, "xs", { color: C.muted }),
              sep(),
              ...contents,
              ...(footer ? [sep(), footer] : []),
            ],
            {
              spacing: "sm",
              paddingAll: "16px",
              backgroundColor: C.paper,
              borderColor: C[kind],
              borderWidth: "1px",
              cornerRadius: "18px",
            },
          ),
        ],
        { paddingAll: "5px", backgroundColor: "#F3F1EA" },
      ),
    },
  };
}
function progress(n, total) {
  const blocks = [];
  if (n > 0)
    blocks.push(box([], { backgroundColor: C.list, height: "7px", flex: n }));
  if (total - n > 0 || !total)
    blocks.push(
      box([], {
        backgroundColor: "#E4E8DF",
        height: "7px",
        flex: Math.max(1, total - n),
      }),
    );
  return box(
    [
      txt("一般事情", "xs", { color: C.muted }),
      txt(`${n} / ${total} 件`, "xxl", { weight: "bold" }),
      row(blocks, { spacing: "none", cornerRadius: "8px", margin: "sm" }),
      txt(
        total
          ? total === n
            ? "一般事情都完成了"
            : `還有 ${total - n} 件待完成`
          : "本週尚未安排一般事情",
        "xs",
        { color: C.muted },
      ),
    ],
    { spacing: "sm", margin: "md" },
  );
}
function nextOccurrence(t, s) {
  if (!D.recurring(t)) return null;
  const pending = t.occurrences.filter((o) => !o.done);
  return (
    (t.frequency === "daily"
      ? pending.find((o) => o.date === D.today())
      : pending[0]) || null
  );
}
function taskRow(s, t, compact = false) {
  const cat = D.category(s, t),
    clr = morandiTone(D.color(s, t)),
    isrec = D.recurring(t),
    o = nextOccurrence(t, s),
    isDone = D.done(t);
  const completion = isrec
    ? o
      ? action("完成一次", "done", { id: t.id, oid: o.id })
      : action("查看次數", "occurrences", { id: t.id })
    : action(isDone ? "復原" : "完成", "done", {
        id: t.id,
        value: isDone ? "0" : "1",
      });
  const info = [
    txt(t.title, "sm", { weight: compact ? "regular" : "bold", flex: 1 }),
  ];
  if (!compact && cat)
    info.push(
      row([
        box([txt(cat.name, "xxs", { color: "#3C4941", align: "center" })], {
          backgroundColor: clr,
          cornerRadius: "8px",
          paddingAll: "4px",
          flex: 0,
        }),
      ]),
    );
  if (isrec && !compact) {
    const n = D.doneCount(t);
    info.push(
      row(
        [
          txt(
            t.frequency === "daily" ? "每天" : `每週 ${t.targetCount} 次`,
            "xxs",
            { flex: 1, color: C.muted },
          ),
          ...Array.from({ length: t.targetCount }, (_, i) =>
            box([], {
              width: "8px",
              height: "8px",
              cornerRadius: "4px",
              backgroundColor: i < n ? C.list : "#FFFFFF",
              borderColor: C.list,
              borderWidth: "1px",
              flex: 0,
            }),
          ),
          txt(`${n}/${t.targetCount}`, "xxs", { flex: 0, color: C.muted }),
        ],
        { spacing: "xs" },
      ),
    );
  }
  if (compact)
    return row([txt("•", "sm", { flex: 0, color: clr }), ...info], {
      paddingTop: "5px",
      paddingBottom: "5px",
    });
  return row(
    [
      box(
        [txt(isDone ? "✓" : "○", "xl", { align: "center", color: "#526E56" })],
        {
          width: "44px",
          height: "44px",
          justifyContent: "center",
          action: completion,
          flex: 0,
        },
      ),
      box(info, { flex: 1, spacing: "xs" }),
      box([txt("⋯", "lg", { align: "center" })], {
        width: "40px",
        height: "44px",
        justifyContent: "center",
        action: action("更多", "menu", { id: t.id }),
        flex: 0,
      }),
    ],
    { paddingTop: "9px", paddingBottom: "9px" },
  );
}
const section = (name, count) =>
  row(
    [
      txt(name, "sm", { weight: "bold", flex: 1 }),
      txt(count === undefined ? " " : String(count), "xs", {
        color: C.muted,
        flex: 0,
      }),
    ],
    { margin: "md" },
  );
function list(s, { week = D.currentWeek(s), page = 0, webUrl } = {}) {
  const tasks = D.active(s, week),
    normal = tasks.filter((t) => !D.recurring(t)),
    pending = normal.filter((t) => !D.done(t)),
    rec = tasks.filter(D.recurring),
    completed = normal.length - pending.length;
  const n = Math.max(
      1,
      Math.ceil(pending.length / 5),
      Math.ceil(rec.length / 3),
    ),
    p = Math.max(0, Math.min(n - 1, Number(page) || 0));
  const closed = D.archived(s, week),
    body = [
      progress(completed, normal.length),
      sep(),
      ...pending.slice(p * 5, p * 5 + 5).map((t) => taskRow(s, t, closed)),
    ];
  if (rec.length)
    body.push(
      section("日常小事", rec.length),
      ...rec.slice(p * 3, p * 3 + 3).map((t) => taskRow(s, t, closed)),
    );
  if (completed)
    body.push(pill(`已完成 ${completed} 件 ›`, "completed", { week }, C.list));
  if (n > 1)
    body.push(
      row([
        ...(p ? [pill("上一頁", "list", { week, page: p - 1 })] : []),
        txt(`${p + 1} / ${n}`, "xs", { align: "center" }),
        ...(p < n - 1 ? [pill("下一頁", "list", { week, page: p + 1 })] : []),
      ]),
    );
  return frame(
    s,
    week,
    "本週清單",
    "list",
    body,
    closed
      ? row([pill("看足跡", "footprint", { week })])
      : row([
          pill("＋ 新增", "add", { week }),
          pill(
            pending.length ? "抽一件" : "看足跡",
            pending.length ? "draw" : "footprint",
            { week },
            pending.length ? C.draw : C.footprint,
          ),
          ...(pending.length
            ? [pill("看足跡", "footprint", { week }, C.footprint)]
            : []),
        ]),
    webUrl,
  );
}
function draw(
  s,
  { week = D.currentWeek(s), exclude, webUrl, random = Math.random } = {},
) {
  const all = D.active(s, week).filter((t) => !D.done(t) && !D.recurring(t));
  const pool =
    all.length > 1 ? all.filter((t) => String(t.id) !== String(exclude)) : all;
  if (!pool.length)
    return frame(
      s,
      week,
      "抽一件",
      "draw",
      [
        txt("一般事情都完成了。", "lg", { weight: "bold", margin: "xl" }),
        txt("日常小事可以回本週清單記錄。", "sm", { color: C.muted }),
      ],
      row([
        pill("回本週", "list", { week }),
        pill("看足跡", "footprint", { week }, C.footprint),
      ]),
      webUrl,
    );
  const t = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))],
    cat = D.category(s, t);
  return frame(
    s,
    week,
    "抽一件",
    "draw",
    [
      txt("今天先做這件", "sm", {
        align: "center",
        color: C.muted,
        margin: "xl",
      }),
      txt(t.title, "xl", { align: "center", weight: "bold", margin: "xl" }),
      txt(cat?.name || " ", "xs", { align: "center", color: C.muted }),
      box([], { height: "24px" }),
      pill("✓ 完成這件", "done", { id: t.id, value: "1" }, C.draw, true),
    ],
    row([
      pill("換一件", "draw", { week, exclude: t.id }),
      pill("回本週", "list", { week }),
    ]),
    webUrl,
  );
}
function monday(s, { week = D.currentWeek(s), page = 0, webUrl } = {}) {
  const tasks = D.active(s, week),
    ordinary = tasks.filter((t) => !D.recurring(t)),
    rec = tasks.filter(D.recurring),
    carried = ordinary.filter((t) => (t.originalWeek || t.week) !== week),
    fresh = ordinary.filter((t) => (t.originalWeek || t.week) === week);
  const groups = [
      ["承接上週", carried],
      ["本週新排", fresh],
      ["日常小事", rec],
    ],
    all = groups.flatMap(([g, rows]) => rows.map((t) => ({ g, t }))),
    pages = Math.max(1, Math.ceil(all.length / 9)),
    p = Math.min(pages - 1, Math.max(0, Number(page) || 0)),
    body = [txt(`本週 ${ordinary.length} 件 · 日常 ${rec.length} 項`, "sm")];
  let prev = "";
  all.slice(p * 9, p * 9 + 9).forEach(({ g, t }) => {
    if (g !== prev)
      body.push(section(g, groups.find((x) => x[0] === g)[1].length));
    prev = g;
    body.push(taskRow(s, t, true));
  });
  if (!all.length) body.push(txt("本週還沒有安排，先放進一件小事。"));
  if (pages > 1)
    body.push(
      row([
        ...(p ? [pill("上一頁", "monday", { week, page: p - 1 })] : []),
        ...(p < pages - 1
          ? [pill("下一頁", "monday", { week, page: p + 1 })]
          : []),
      ]),
    );
  return frame(
    s,
    week,
    `Week ${week} 開始了`,
    "monday",
    body,
    row([
      pill("去做一件", "draw", { week }, C.monday, true),
      pill("調整安排", "list", { week }, C.monday),
    ]),
    webUrl,
  );
}
function footprint(s, { week = D.currentWeek(s), page = 0, webUrl } = {}) {
  const ts = D.active(s, week),
    ordinary = ts.filter((t) => !D.recurring(t)),
    finished = ordinary.filter(D.done),
    pending = ordinary.filter((t) => !D.done(t)),
    rec = ts.filter(D.recurring),
    body = [
      txt(`${finished.length} 件`, "xxl", { weight: "bold" }),
      txt("一般事情已完成", "sm"),
    ];
  const pages = Math.max(
      1,
      Math.ceil(finished.length / 5),
      Math.ceil(pending.length / 5),
      Math.ceil(rec.length / 3),
    ),
    p = Math.min(pages - 1, Math.max(0, Number(page) || 0));
  finished
    .slice(p * 5, p * 5 + 5)
    .forEach((t) => body.push(txt(`✓ ${t.title}`, "sm")));
  if (rec.length) {
    body.push(sep(), section("日常也有累積"));
    rec
      .slice(p * 3, p * 3 + 3)
      .forEach((t) =>
        body.push(
          row([
            txt(t.title, "sm", { flex: 1 }),
            txt(`${D.doneCount(t)} 次`, "xs", { flex: 0 }),
          ]),
        ),
      );
  }
  if (pending.length) {
    body.push(sep(), section(`還有 ${pending.length} 件`));
    pending
      .slice(p * 5, p * 5 + 5)
      .forEach((t) => body.push(taskRow(s, t, true)));
    if (!D.archived(s, week) && week < 12)
      body.push(
        row([
          pill("移到其他週", "move_list", { week }, C.footprint),
          pill("我來挑", "move_list", { week }, C.footprint),
        ]),
      );
  }
  const r = s.reflections[week];
  if (r?.savedAt)
    body.push(
      section("感想"),
      txt([r.good, r.adjust].filter(Boolean).join("\n") || "已記錄", "sm"),
    );
  if (pages > 1)
    body.push(
      row([
        ...(p ? [pill("上一頁", "footprint", { week, page: p - 1 })] : []),
        ...(p < pages - 1
          ? [pill("下一頁", "footprint", { week, page: p + 1 })]
          : []),
      ]),
    );
  const foot = [pill("回本週", "list", { week })];
  if (s.preferences.weeklyReflection && !r?.savedAt)
    foot.push(pill("寫感想", "reflect", { week }));
  return frame(s, week, "本週足跡", "footprint", body, row(foot), webUrl);
}
module.exports = {
  C,
  action,
  quick,
  list,
  draw,
  monday,
  footprint,
  nextOccurrence,
};
