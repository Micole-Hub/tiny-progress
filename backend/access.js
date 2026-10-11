"use strict";
const crypto = require("node:crypto");
const equal = (a, b) => {
  const x = Buffer.from(String(a || "")),
    y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
function config(env = process.env) {
  const c = {
    apiSecret: env.GOOGLE_SHEETS_API_SECRET,
    password: env.WEB_PASSWORD,
    sessionSecret: env.WEB_SESSION_SECRET,
    lineSecret: env.LINE_CHANNEL_SECRET,
    owner: env.LINE_ALLOWED_USER_ID,
    webUrl:
      env.TINY_PROGRESS_WEB_URL ||
      "https://micole-hub.github.io/tiny-progress/",
  };
  c.origins = (env.ALLOWED_ORIGINS || new URL(c.webUrl).origin)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return c;
}
function validate(c, env = process.env) {
  for (const key of [
    "apiSecret",
    "password",
    "sessionSecret",
    "lineSecret",
    "owner",
  ])
    if (!c[key]) throw Error("缺少設定：" + key);
  if (
    !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(
      env.GOOGLE_SHEETS_API_URL || "",
    )
  )
    throw Error("Apps Script 網址需為正式 /exec 網址");
  if (!env.LINE_CHANNEL_ACCESS_TOKEN)
    throw Error("缺少 LINE_CHANNEL_ACCESS_TOKEN");
  if (
    c.apiSecret.length < 32 ||
    c.sessionSecret.length < 32 ||
    c.password.length < 12
  )
    throw Error("伺服器密鑰至少 32 字；網頁密碼至少 12 字");
  if (
    c.apiSecret === c.sessionSecret ||
    c.apiSecret === c.password ||
    c.sessionSecret === c.password
  )
    throw Error("三組密碼請使用不同內容");
  if (!/^U[0-9a-f]{32}$/i.test(c.owner))
    throw Error("LINE_ALLOWED_USER_ID 格式不正確");
  if (
    !c.origins.length ||
    c.origins.some(
      (s) => s === "*" || new URL(s).origin !== s || !s.startsWith("https://"),
    )
  )
    throw Error("網站來源需為指定的 HTTPS 網域");
}
function install(app, c) {
  const failures = new Map();
  const token = () => {
    const data = Buffer.from(
      JSON.stringify({
        exp: Date.now() + 12 * 3600000,
        nonce: crypto.randomUUID(),
      }),
    ).toString("base64url");
    return (
      data +
      "." +
      crypto
        .createHmac("sha256", c.sessionSecret)
        .update(data)
        .digest("base64url")
    );
  };
  const session = (req) => {
    const parts = String(req.headers.authorization || "")
      .replace(/^Bearer /, "")
      .split(".");
    if (
      parts.length !== 2 ||
      !equal(
        parts[1],
        crypto
          .createHmac("sha256", c.sessionSecret || "")
          .update(parts[0])
          .digest("base64url"),
      )
    )
      return false;
    try {
      return (
        JSON.parse(Buffer.from(parts[0], "base64url").toString()).exp >
        Date.now()
      );
    } catch {
      return false;
    }
  };
  app.post("/auth/login", (req, res) => {
    const key = req.socket.remoteAddress,
      now = Date.now(),
      old = failures.get(key),
      rate = old && old.until > now ? old : { n: 0, until: now + 900000 };
    if (rate.n >= 10)
      return res.status(429).json({ message: "請 15 分鐘後再試" });
    if (!equal(req.body?.password, c.password)) {
      rate.n++;
      if (failures.size > 1000) failures.clear();
      failures.set(key, rate);
      return res.status(401).json({ message: "密碼不正確" });
    }
    failures.delete(key);
    res.json({ token: token(), expiresIn: 43200 });
  });
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    if (req.path === "/" && req.method === "GET") return next();
    if (req.path === "/line/webhook") {
      const signature = crypto
        .createHmac("sha256", c.lineSecret || "")
        .update(req.rawBody || Buffer.alloc(0))
        .digest("base64");
      if (!c.lineSecret || !equal(req.headers["x-line-signature"], signature))
        return res.status(401).json({ message: "LINE 簽章無效" });
      return next();
    }
    if (req.path === "/gas-queue" || req.path.startsWith("/internal/")) {
      if (
        !c.apiSecret ||
        !equal(req.headers.authorization, "Bearer " + c.apiSecret)
      )
        return res.status(401).json({ message: "未授權" });
      return next();
    }
    if (!session(req)) return res.status(401).json({ message: "請先登入" });
    next();
  });
}
module.exports = { config, validate, install, equal };
