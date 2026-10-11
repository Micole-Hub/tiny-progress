/* Version-checked cloud saves with local recovery for failed drafts. */
window.TPConnection = (() => {
  "use strict";
  const D = window.TPDomain,
    demo = new URLSearchParams(location.search).get("demo") === "1";
  const CACHE = "tiny-progress-v28-cache",
    DEMO = "tiny-progress-v28-demo",
    META = "tiny-progress-v28-sync";
  let adapter,
    base = "",
    auth = "",
    ready = false,
    revision = 0,
    baseline = "",
    inflight = false,
    paused = false,
    unboundDraft = false,
    conflictRetries = 0,
    timer;
  let pendingSave = null,
    selectedCycle = null;
  const read = (key, storage = localStorage) => {
    try {
      return JSON.parse(storage.getItem(key) || "null");
    } catch {
      return null;
    }
  };
  let recovery = read(META);
  const serialize = (s) => JSON.stringify(D.publicState(s));
  const MISSING = Symbol("missing");
  function equal(a, b) {
    if (a === MISSING || b === MISSING) return a === b;
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object")
      return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a))
      return (
        a.length === b.length &&
        a.every((value, index) => equal(value, b[index]))
      );
    const ak = Object.keys(a).sort(),
      bk = Object.keys(b).sort();
    return (
      ak.length === bk.length &&
      ak.every((key, index) => key === bk[index] && equal(a[key], b[key]))
    );
  }
  const copy = (value) =>
    value === MISSING ? MISSING : JSON.parse(JSON.stringify(value));
  function arrayKey(path) {
    const key = path.at(-1);
    if (
      ["tasks", "categories", "recurringRules", "directions", "occurrences"].includes(
        key,
      )
    )
      return (item) =>
        item && typeof item === "object" && item.id !== undefined
          ? String(item.id)
          : null;
    if (key === "archivedWeeks")
      return (item) =>
        item && typeof item === "object" && item.week !== undefined
          ? String(item.week)
          : null;
    if (key === "completed")
      return (item) =>
        item && typeof item === "object" && item.key !== undefined
          ? String(item.key)
          : null;
    return null;
  }
  function mergeValue(baseValue, localValue, remoteValue, path = []) {
    if (equal(localValue, baseValue)) return copy(remoteValue);
    if (equal(remoteValue, baseValue) || equal(localValue, remoteValue))
      return copy(localValue);
    if (
      path.at(-1) === "events" &&
      Array.isArray(localValue) &&
      Array.isArray(remoteValue)
    ) {
      const merged = remoteValue.map(copy);
      for (const event of localValue)
        if (!merged.some((existing) => equal(existing, event)))
          merged.push(copy(event));
      return merged;
    }
    if (
      [baseValue, localValue, remoteValue].every(
        (value) =>
          value === MISSING ||
          (value !== null && typeof value === "object" && !Array.isArray(value)),
      )
    ) {
      const result = {};
      const keys = new Set(
        [baseValue, localValue, remoteValue].flatMap((value) =>
          value === MISSING ? [] : Object.keys(value),
        ),
      );
      for (const key of keys) {
        const value = mergeValue(
          baseValue === MISSING || !Object.hasOwn(baseValue, key)
            ? MISSING
            : baseValue[key],
          localValue === MISSING || !Object.hasOwn(localValue, key)
            ? MISSING
            : localValue[key],
          remoteValue === MISSING || !Object.hasOwn(remoteValue, key)
            ? MISSING
            : remoteValue[key],
          [...path, key],
        );
        if (value !== MISSING) result[key] = value;
      }
      return result;
    }
    if (
      [baseValue, localValue, remoteValue].every(
        (value) => value === MISSING || Array.isArray(value),
      )
    ) {
      const identity = arrayKey(path);
      if (identity) {
        const arrays = [baseValue, localValue, remoteValue].map((value) =>
          value === MISSING ? [] : value,
        );
        const entries = arrays.flat();
        const keys = arrays.every((array) => array.every((item) => identity(item)))
          ? [...new Set(entries.map(identity))]
          : null;
        if (keys) {
          const get = (array, key) => array.find((item) => identity(item) === key);
          const [baseArray, localArray, remoteArray] = arrays;
          const result = [];
          for (const key of keys) {
            const baseItem = get(baseArray, key) ?? MISSING;
            const localItem = get(localArray, key) ?? MISSING;
            const remoteItem = get(remoteArray, key) ?? MISSING;
            if (baseItem !== MISSING && localItem === MISSING) continue;
            if (baseItem !== MISSING && remoteItem === MISSING) {
              if (!equal(localItem, baseItem)) result.push(copy(localItem));
              continue;
            }
            const value = mergeValue(
              baseItem,
              localItem,
              remoteItem,
              [...path, key],
            );
            if (value !== MISSING) result.push(value);
          }
          return result;
        }
      }
    }
    return copy(localValue);
  }
  function mergeStates(baseState, localState, remoteState) {
    return mergeValue(baseState, localState, remoteState);
  }
  const dirty = () => ready && serialize(adapter.get()) !== baseline;
  function remember() {
    if (demo || !ready) return;
    try {
      recovery = {
        base,
        revision,
        baseline,
        pendingSave,
        dirty: dirty() || !!pendingSave,
      };
      localStorage.setItem(META, JSON.stringify(recovery));
    } catch {
      status("草稿空間不足，請清理瀏覽器空間後重試同步", true);
    }
  }
  const status = (message, error = false) => {
    const el = document.querySelector("#syncStatus");
    if (el) {
      el.textContent = message;
      el.classList.toggle("error", error);
    }
    const actions = document.querySelector("#syncActions");
    actions.hidden = !error;
    if (error) document.querySelector("#syncPanel").open = true;
  };
  const locked = (value) => {
    document.querySelector(".app-shell").inert = value;
    document.querySelector("#connectionGate").hidden = !value;
  };
  function cache(s) {
    try {
      localStorage.setItem(demo ? DEMO : CACHE, JSON.stringify(s));
    } catch {
      status("儲存空間不足，請清理瀏覽器空間後重試同步", true);
    }
  }
  async function request(path, { method = "GET", body } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: "Bearer " + auth } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(45000),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(
        "伺服器回應不是有效的 API 資料；請確認同步設定使用 Render 後端網址，而不是網頁網址，並確認伺服器正常運作。",
      );
    }
    if (!res.ok) {
      const error = new Error(data.message || "連線失敗");
      error.status = res.status;
      throw error;
    }
    return data;
  }
  async function reload(force = false) {
    const data = await request(
      "/api/state" + (selectedCycle ? "?cycle=" + selectedCycle : ""),
    );
    D.validate(data.state);
    if (!force && recovery?.dirty && recovery.base === base && !unboundDraft) {
      revision = recovery.revision;
      baseline = recovery.baseline;
      pendingSave = recovery.pendingSave || null;
      ready = true;
      paused = false;
      locked(false);
      status("已保留未同步草稿，正在重試…");
      await flush();
      return;
    }
    if (!force && recovery?.dirty && (recovery.base !== base || unboundDraft)) {
      const baseState = JSON.parse(recovery.baseline || serialize(D.empty()));
      const merged = mergeStates(baseState, adapter.get(), data.state);
      D.validate(merged);
      adapter.replace(merged);
      revision = data.revision;
      baseline = serialize(data.state);
      pendingSave = null;
      unboundDraft = false;
      paused = false;
      ready = true;
      locked(false);
      remember();
      if (dirty()) {
        status("正在合併並同步更新…");
        await flush();
      } else status("已同步");
      return;
    }
    unboundDraft = false;
    revision = data.revision;
    baseline = serialize(data.state);
    pendingSave = null;
    paused = false;
    ready = true;
    adapter.replace(data.state);
    cache(adapter.get());
    remember();
    status("已同步");
    locked(false);
  }
  async function flush() {
    if (
      demo ||
      !ready ||
      !base ||
      !auth ||
      unboundDraft ||
      paused ||
      inflight ||
      (!dirty() && !pendingSave)
    )
      return;
    inflight = true;
    status("儲存中…");
    const snapshot = serialize(adapter.get());
    if (!pendingSave)
      pendingSave = {
        expectedRevision: revision,
        mutationId: crypto.randomUUID(),
        state: JSON.parse(snapshot),
      };
    const sent = pendingSave;
    remember();
    try {
      const data = await request("/api/state", { method: "PUT", body: sent });
      revision = data.revision;
      const canonical = data.state || sent.state;
      if (serialize(adapter.get()) === JSON.stringify(sent.state))
        adapter.replace(canonical);
      else if (data.state) {
        adapter.get().legacyArchive = data.state.legacyArchive;
        for (const t of adapter.get().tasks) {
          const saved = data.state.tasks.find((x) => x.id === t.id);
          if (saved?.legacyId) t.legacyId = saved.legacyId;
        }
      }
      baseline = JSON.stringify(canonical);
      pendingSave = null;
      cache(adapter.get());
      status("已同步");
    } catch (error) {
      if (error.status === 409) {
        try {
          const data = await request(
            "/api/state" + (selectedCycle ? "?cycle=" + selectedCycle : ""),
          );
          D.validate(data.state);
          const baseState = JSON.parse(baseline || serialize(D.empty()));
          const merged = mergeStates(baseState, adapter.get(), data.state);
          D.validate(merged);
          adapter.replace(merged);
          revision = data.revision;
          baseline = serialize(data.state);
          pendingSave = null;
          conflictRetries++;
          paused = false;
          status("正在合併其他裝置的更新…");
          remember();
        } catch (mergeError) {
          paused = true;
          status(
            "同步遇到多裝置更新，修改仍已保留；請稍後重試。" +
              (mergeError.message ? ` ${mergeError.message}` : ""),
            true,
          );
        }
      } else {
        paused = true;
        const offline = !navigator.onLine;
        status(
          offline
            ? "目前離線，恢復網路後會自動同步"
            : error.status === 401
              ? "登入已過期，請重新設定同步。修改仍已保留。"
              : "同步失敗，修改仍已保留：" + error.message,
          true,
        );
      }
    } finally {
      inflight = false;
      remember();
      if (!paused && dirty()) {
        const delay = conflictRetries
          ? Math.min(500 * 2 ** Math.min(conflictRetries, 5), 15000)
          : 100;
        timer = setTimeout(flush, delay);
      } else if (!dirty()) conflictRetries = 0;
    }
  }
  function save(s) {
    cache(s);
    if (demo) return;
    if (!ready) return;
    remember();
    if (!base || !auth || unboundDraft) {
      status("同步尚未設定");
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(flush, 400);
  }
  function initial(seed) {
    if (demo) {
      const s = read(DEMO) || D.clone(seed);
      s.schemaVersion = 27;
      s.cycle.startDate =
        s.cycle.startDate || s.simulationWeekStart || D.monday(D.today());
      s.weekMeta = s.weekMeta || {};
      s.unfinishedReasons = s.unfinishedReasons || {};
      s.preferences.lineEnabled = false;
      return s;
    }
    return read(CACHE) || D.empty();
  }
  function serverBase(value) {
    const u = new URL(value);
    if (u.username || u.password || u.search || u.hash || u.pathname !== "/")
      throw new Error("請填 Render 根網址，不要加路徑或參數");
    if (
      u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["localhost", "128.0.0.1"].includes(u.hostname)
      )
    )
      throw new Error("請使用 HTTPS 網址");
    return u.origin;
  }
  async function start(a) {
    adapter = a;
    const form = document.querySelector("#connectionForm"),
      url = document.querySelector("#serverUrl"),
      password = document.querySelector("#webPassword"),
      message = document.querySelector("#connectionMessage");
    document.querySelector("#retrySync").onclick = () => {
      paused = false;
      if (dirty() || pendingSave) flush();
      else refresh();
    };
    document.querySelector("#connectionSettings").onclick = () => {
      locked(true);
      message.textContent =
        "登入後，網頁與 LINE 會自動共用資料；暫時離線時會在恢復網路後自動同步。";
    };
    document.querySelector("#continueOffline").onclick = () => {
      locked(false);
      status(
        dirty() ? "等待網路恢復後同步" : "同步尚未設定",
      );
    };
    document.querySelector("#demoLink").href = location.pathname + "?demo=1";
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      message.textContent = "連線中，第一次可能需要等候伺服器啟動…";
      try {
        const selected = serverBase(url.value.trim());
        if (recovery?.dirty && recovery.base && recovery.base !== selected)
          throw new Error(
            "有另一個伺服器的未同步草稿，請先回原伺服器完成同步",
          );
        unboundDraft = Boolean(recovery?.dirty && !recovery.base);
        base = selected;
        auth = "";
        const login = await request("/auth/login", {
          method: "POST",
          body: { password: password.value },
        });
        auth = login.token;
        sessionStorage.setItem(
          "tp-v28-session",
          JSON.stringify({ base, auth }),
        );
        localStorage.setItem("tp-v28-server", base);
        password.value = "";
        await reload();
        message.textContent = "";
      } catch (error) {
        message.textContent = error.message;
      } finally {
        btn.disabled = false;
      }
    };
    if (demo) {
      ready = true;
      baseline = serialize(adapter.get());
      status("示範模式・不會同步到 LINE");
      locked(false);
      return;
    }
    base = recovery?.base || "";
    revision = Number(recovery?.revision) || 0;
    baseline = recovery?.baseline || serialize(adapter.get());
    pendingSave = recovery?.pendingSave || null;
    ready = true;
    locked(false);
    status(recovery?.dirty ? "等待網路恢復後同步" : "同步尚未設定");
    url.value =
      window.TP_CONFIG?.API_BASE_URL ||
      localStorage.getItem("tp-v28-server") ||
      "";
    const session = read("tp-v28-session", sessionStorage);
    if (session?.auth && session.base === url.value) {
      try {
        unboundDraft = Boolean(recovery?.dirty && !recovery.base);
        base = serverBase(session.base);
        auth = session.auth;
        message.textContent = "正在載入…";
        await reload();
        message.textContent = "";
      } catch (error) {
        message.textContent =
          error.status === 401
            ? "登入已過期，請重新登入；本機修改仍會保留。"
            : "雲端暫時無法連線；仍可繼續使用，恢復網路後會自動同步。";
        status(
          error.status === 401
            ? "登入已過期，請重新設定同步。修改仍已保留。"
            : "目前離線，恢復網路後會自動同步",
          error.status === 401,
        );
      }
    }
    const refresh = async () => {
      if (
        !ready ||
        !base ||
        !auth ||
        inflight ||
        dirty() ||
        paused ||
        document.hidden ||
        document.querySelector("dialog[open]") ||
        document.activeElement?.matches("input,textarea,select") ||
        !document.querySelector("#weekFootprintLayer").hidden
      )
        return;
      try {
        const data = await request(
          "/api/state" + (selectedCycle ? "?cycle=" + selectedCycle : ""),
        );
        if (
          inflight ||
          dirty() ||
          paused ||
          document.querySelector("dialog[open]") ||
          document.activeElement?.matches("input,textarea,select")
        )
          return;
        if (data.revision !== revision) {
          D.validate(data.state);
          revision = data.revision;
          baseline = serialize(data.state);
          adapter.replace(data.state);
          cache(data.state);
          remember();
          status("已同步 LINE 的最新進度");
        }
      } catch {
        status("目前離線，恢復網路後會自動同步", true);
      }
    };
    setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("offline", () => {
      if (base && auth) status("目前離線，恢復網路後會自動同步");
    });
    window.addEventListener("online", () => {
      if (!base || !auth) {
        status("同步尚未設定");
        return;
      }
      paused = false;
      if (unboundDraft) {
        reload().catch(() => status("目前離線，恢復網路後會自動同步", true));
        return;
      }
      status("網路已恢復，正在同步…");
      flush().then(refresh);
    });
  }
  async function manage(path, options = {}) {
    if (demo) throw new Error("示範模式不會變更正式週期");
    if (!base || !auth)
      throw new Error("請先設定雲端同步並登入，才能載入或管理週期。");
    await flush();
    if (dirty() || inflight || paused) throw new Error("請先完成同步");
    return request(path, options);
  }
  async function selectCycle(cycle) {
    await flush();
    if (dirty() || inflight || paused) throw new Error("請先完成同步");
    selectedCycle = Number(cycle) || null;
    await reload(true);
  }
  return {
    initial,
    save,
    start,
    demo,
    isConnected: () => !demo && Boolean(base && auth),
    flush,
    manage,
    selectCycle,
    isReady: () => ready,
  };
})();
