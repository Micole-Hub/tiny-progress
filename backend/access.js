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
  const shortValues = [
    ["GOOGLE_SHEETS_API_SECRET", c.apiSecret, 32],
    ["WEB_SESSION_SECRET", c.sessionSecret, 32],
    ["WEB_PASSWORD", c.password, 12],
  ].filter(([, value, minimum]) => value.length < minimum);
  if (shortValues.length)
    throw Error(
      "設定長度不足：" +
        shortValues
          .map(([name, , minimum]) => `${name}（至少 ${minimum} 字）`)
          .join("、"),
    );
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
function install(app, c, deviceSessions) {
  const failures = new Map();
  const hashDeviceToken = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const newDeviceToken = () => crypto.randomBytes(32).toString("base64url");
  const validDeviceToken = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
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
  app.post("/auth/login", async (req, res) => {
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
    try {
      if (req.body?.remember === true) {
        const deviceToken = newDeviceToken();
        const saved = await deviceSessions.create(hashDeviceToken(deviceToken));
        return res.json({
          token: token(), expiresIn: 43200,
          rememberToken: deviceToken, rememberExpiresAt: saved.expiresAt,
        });
      }
      return res.json({ token: token(), expiresIn: 43200 });
    } catch (error) {
      console.error("[auth] 無法記住裝置：", error.message);
      return res.status(503).json({ message: "目前無法記住裝置，請稍後重試或取消勾選後登入。" });
    }
  });
  // A long-lived opaque device token is rotated server-side and never used as an API bearer.
  // The server stores only its SHA-256 digest in GAS, with a fixed 30-day expiry.
  app.post("/auth/refresh", async (req, res) => {
    const oldToken = req.body?.rememberToken;
    if (!validDeviceToken(oldToken))
      return res.status(401).json({ message: "記住裝置已失效，請重新登入。" });
    try {
      const replacement = newDeviceToken();
      const saved = await deviceSessions.rotate(hashDeviceToken(oldToken), hashDeviceToken(replacement));
      return res.json({
        token: token(), expiresIn: 43200,
        rememberToken: replacement, rememberExpiresAt: saved.expiresAt,
      });
    } catch (error) {
      const invalid = error.status === 401;
      return res.status(invalid ? 401 : 503).json({
        message: invalid ? "記住裝置已過期或登出，請重新登入。" : "暫時無法恢復登入，請稍後重試。",
      });
    }
  });
  app.post("/auth/logout", async (req, res) => {
    const value = req.body?.rememberToken;
    if (!validDeviceToken(value)) return res.json({ ok: true });
    try {
      await deviceSessions.revoke(hashDeviceToken(value));
      return res.json({ ok: true });
    } catch (error) {
      console.error("[auth] 無法撤銷裝置：", error.message);
      return res.status(503).json({ message: "暫時無法撤銷記住裝置，請稍後重試。" });
    }
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
