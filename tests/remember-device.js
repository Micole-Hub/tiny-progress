"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const Access = require("../backend/access");

function routeHarness() {
  const routes = new Map();
  const app = { post(path, handler) { routes.set(path, handler); }, use() {} };
  const store = new Map();
  Access.install(app, { password: "testing-password", sessionSecret: "x".repeat(48),
    apiSecret: "s".repeat(48), lineSecret: "line-secret" }, {
    create: async (hash) => { store.set(hash, Date.now() + 30 * 86400000); return { expiresAt: store.get(hash) }; },
    rotate: async (old, next) => {
      const exp = store.get(old);
      if (!exp || exp <= Date.now()) throw Object.assign(new Error("expired"), { status: 401 });
      store.delete(old); store.set(next, exp); return { expiresAt: exp };
    },
    revoke: async (hash) => { store.delete(hash); },
  });
  async function invoke(path, body) {
    let code = 200, data;
    const res = { status(s) { code = s; return this; }, json(v) { data = v; return this; } };
    await routes.get(path)({ socket: { remoteAddress: "127.0.0.1" }, body }, res);
    return { code, data };
  }
  return { invoke, store };
}
(async () => {
  const { invoke, store } = routeHarness();
  let r = await invoke("/auth/login", {password:"wrong", remember:true});
  assert.equal(r.code,401);
  r = await invoke("/auth/login", {password:"testing-password", remember:false});
  assert.equal(r.code,200);
  assert.equal(r.data.expiresIn,43200);
  assert.equal(r.data.rememberToken,undefined);
  assert.equal(store.size,0);
  r = await invoke("/auth/login", {password:"testing-password", remember:true});
  assert.equal(r.code,200);
  assert.match(r.data.rememberToken,/^[a-zA-Z0-9_-]{43}$/);
  assert.equal(store.has(crypto.createHash("sha256").update(r.data.rememberToken).digest("hex")),true);
  const initial = r.data.rememberToken;
  const expiration = r.data.rememberExpiresAt;
  r = await invoke("/auth/refresh", {rememberToken:initial});
  assert.equal(r.code,200);
  assert.notEqual(r.data.rememberToken,initial);
  assert.equal(r.data.rememberExpiresAt,expiration); // Refresh does not extend 30-day limit.
  assert.equal((await invoke("/auth/refresh", {rememberToken:initial})).code,401); // Replay denied.
  const renewed = r.data.rememberToken;
  assert.equal((await invoke("/auth/logout", {rememberToken:renewed})).code,200);
  assert.equal((await invoke("/auth/refresh", {rememberToken:renewed})).code,401);
  assert.equal(store.size,0);
  console.log("PASS backend: opt-in 30-day device token, 12h access, rotation, replay prevention, revoke");

  const gas = fs.readFileSync(path.join(__dirname,"../gas/Code.gs"),"utf8");
  const begin = gas.indexOf("const TP_DEVICE_PREFIX =");
  const end = gas.indexOf("function isItemWriteAction(action)",begin);
  assert(begin>0 && end>begin);
  let fakeNow = Date.now();
  const properties = new Map();
  const props = {
    getProperties: () => Object.fromEntries(properties),
    getProperty: key => properties.get(key) || null,
    setProperty: (key,value) => properties.set(key,value),
    deleteProperty: key => properties.delete(key),
  };
  const lock = { waitLock() {}, releaseLock() {} };
  const context = {
    Date: {now: () => fakeNow},
    LockService:{getScriptLock:()=>lock},
    PropertiesService:{getScriptProperties:()=>props},
    Number, String, Object, Error,
  };
  vm.createContext(context);
  vm.runInContext(gas.slice(begin,end),context);
  const digest = crypto.randomBytes(32).toString("hex");
  const next = crypto.randomBytes(32).toString("hex");
  const call = (action, body) => context.tpRememberDeviceAction("auth-remember-"+action, body);
  const created = call("create",{hash:digest});
  assert.equal(properties.size,1);
  assert.equal(created.expiresAt,fakeNow+30*86400000);
  assert(![...properties.values()].includes(digest));
  const rotated = call("rotate",{oldHash:digest,newHash:next});
  assert.equal(rotated.expiresAt,created.expiresAt);
  assert.throws(()=>call("rotate",{oldHash:digest,newHash:crypto.randomBytes(32).toString("hex")}),/裝置登入已失效/);
  assert.equal(properties.has("TP_REMEMBER_DEVICE_"+next),true);
  fakeNow += 31*86400000;
  assert.throws(()=>call("rotate",{oldHash:next,newHash:digest}),/裝置登入已失效/);
  assert.equal(properties.size,0);
  console.log("PASS GAS: SHA-256 hashes only, 30-day limit, atomic rotation, expiry, no sheet writes");

  const frontend=fs.readFileSync(path.join(__dirname,"../github-page/connection.js"),"utf8");
  const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
  assert(frontend.includes('sessionStorage.setItem(SESSION_KEY'));
  assert(frontend.includes('requestOnce("/auth/refresh"'));
  assert(frontend.includes('requestOnce("/auth/logout"'));
  assert(html.includes('id="rememberDevice"') && html.includes('id="logoutDevice"'));
  assert(!frontend.includes('localStorage.setItem("tp-v28-session"'));
  console.log("PASS frontend: remembered-device controls, access in session storage, refresh and logout hooks");
})().catch((e) => { console.error(e); process.exitCode=1; });
