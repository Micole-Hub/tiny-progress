"use strict";
/**
 * Full-stack QA mirror. Serves the unmodified PR frontend and imports the
 * unmodified production backend routes/domain. ONLY authentication differs.
 *
 * Requires a separate, deployed TEST GAS bound to a separate TEST spreadsheet.
 * No fallback to production URL, cached state, or mock tasks.
 */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const configFile = path.join(__dirname, ".env.qa");
if (!fs.existsSync(configFile)) {
  console.error("Missing tests/.env.qa. Copy tests/qa-mirror-env.example and configure a separate TEST spreadsheet + GAS.");
  process.exit(1);
}
process.loadEnvFile(configFile);
const gas = process.env.TP_QA_GAS_URL || "";
const secret = process.env.TP_QA_GAS_SECRET || "";
const confirmed = process.env.TP_QA_DATA_ISOLATED;
const testUrlPattern = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/;
if (!testUrlPattern.test(gas) || secret.length < 32 || confirmed !== "YES_SEPARATE_TEST_SHEET") {
  console.error("QA refuses to start: TEST GAS URL, TEST secret (32+ chars), and isolation confirmation are required.");
  process.exit(1);
}
if (process.env.GOOGLE_SHEETS_API_URL && process.env.GOOGLE_SHEETS_API_URL === gas) {
  console.error("QA refuses to start: TEST GAS URL matches the previously configured production GAS URL.");
  process.exit(1);
}
const sitePort = 5517;
const apiPort = 3017;
process.env.GOOGLE_SHEETS_API_URL = gas;
process.env.GOOGLE_SHEETS_API_SECRET = secret;
process.env.PORT = String(apiPort);
process.env.ALLOWED_ORIGINS = ["http://127.0.0.1:" + sitePort, "http://localhost:" + sitePort].join(",");
process.env.QUEUE_RETRY_INTERVAL_MS = "999999999";
// Authentication-only override, installed before requiring the REAL server.
const Access = require("../backend/access");
Access.install = function installQaLogin(app) {
  const sessionToken = crypto.randomBytes(32).toString("hex");
  const bearer = "Bearer " + sessionToken;
  app.post("/auth/login", (_req, res) => res.json({ token: sessionToken, expiresIn: 43200 }));
  app.post("/auth/refresh", (_req, res) => res.status(401).json({ message: "測試環境請重新登入" }));
  app.post("/auth/logout", (_req, res) => res.json({ ok: true }));
  app.use((req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    // No LINE, queue or reminder operations in an isolated UI/data QA run.
    if (/^\/(?:line\/|gas-queue|internal\/)/.test(req.path))
      return res.status(404).json({ message: "本機測試不會發送 LINE 或提醒" });
    if (req.headers.authorization !== bearer)
      return res.status(401).json({ message: "請先用本機測試登入" });
    next();
  });
};
const { app } = require("../backend/server"); // Exact backend/server.js code, no copied handlers.
const allowedRootFiles = new Set([
  "index.html", "script.js", "style.css", "manifest.webmanifest",
  "sw.js", "app-icon.svg", "favicon.ico"
]);
const types = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css",
  ".webmanifest":"application/manifest+json", ".svg":"image/svg+xml", ".ico":"image/x-icon" };
const site = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const allowed = allowedRootFiles.has(relative) ||
    (/^github-page\/[a-z0-9-]+\.(?:js|css)$/.test(relative));
  if (!allowed) { res.writeHead(404); return res.end("Not found"); }
  const fullPath = path.join(root, relative);
  fs.readFile(fullPath, (error, buffer) => {
    if (error) { res.writeHead(404); return res.end("File missing"); }
    res.writeHead(200, {
      "Content-Type": (types[path.extname(relative)] || "application/octet-stream") + "; charset=utf-8",
      "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff"
    });
    res.end(req.method === "HEAD" ? undefined : buffer);
  });
});
const backend = app.listen(apiPort, "127.0.0.1", () => {
  site.listen(sitePort, "127.0.0.1", () => {
    console.log("TinyProgress QA mirror: http://127.0.0.1:" + sitePort);
    console.log("TEST API: http://127.0.0.1:" + apiPort);
    console.log("Use the TEST API address and any nonempty password at the login gate.");
    console.log("HTML, CSS, JS, connection.js and backend routes are the exact repo sources.");
    console.log("This QA instance is isolated from LINE reminders. Test GAS/sheet configuration is your responsibility.");
  });
});
process.on("SIGINT", () => { site.close(); backend.close(); process.exit(0); });
