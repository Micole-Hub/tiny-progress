/* Version-checked cloud saves. Failed/conflicting drafts remain downloadable. */
window.TPConnection = (() => {
  "use strict";
  const D = window.TPDomain,
    demo = new URLSearchParams(location.search).get("demo") === "1";
  const CACHE = "tiny-progress-v28-cache",
    DEMO = "tiny-progress-v28-demo",
    LEGACY = "tiny-progress-v25-6-state",
    META = "tiny-progress-v28-sync";
  let adapter,
    base = "",
    auth = "",
    ready = false,
    revision = 0,
    baseline = "",
    inflight = false,
    paused = false,
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
      status("草稿空間不足，請下載備份", true);
    }
  }
  const status = (message, error = false) => {
    const el = document.querySelector("#syncStatus");
    if (el) {
      el.textContent = message;
      el.classList.toggle("error", error);
    }
    document.querySelector("#syncActions").hidden = !error;
  };
  const locked = (value) => {
    document.querySelector(".app-shell").inert = value;
    document.querySelector("#connectionGate").hidden = !value;
  };
  function cache(s) {
    try {
      localStorage.setItem(demo ? DEMO : CACHE, JSON.stringify(s));
    } catch {
      status("儲存空間不足，請立即下載備份", true);
    }
  }
  function download(value, name) {
    const blob = new Blob([JSON.stringify(value, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      throw new Error("伺服器沒有回傳有效資料，請檢查網址");
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
    if (!force && recovery?.dirty && recovery.base === base) {
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
    if (demo || !ready || paused || inflight || (!dirty() && !pendingSave))
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
      paused = true;
      status(
        error.status === 409
          ? "其他裝置有更新，草稿已保留。請下載草稿後載入最新資料。"
          : error.status === 401
            ? "登入已過期，請重新登入。草稿已保留。"
            : "尚未同步：" + error.message,
        true,
      );
    } finally {
      inflight = false;
      remember();
      if (!paused && dirty()) timer = setTimeout(flush, 100);
    }
  }
  function save(s) {
    cache(s);
    if (demo) return;
    if (!ready) return;
    remember();
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
    document.querySelector("#downloadDraft").onclick = () =>
      download(adapter.get(), "tiny-progress-draft.json");
    document.querySelector("#downloadGateDraft").onclick = () =>
      download(adapter.get(), "tiny-progress-draft.json");
    document.querySelector("#reloadCloud").onclick = async () => {
      if (
        !confirm(
          "載入雲端最新資料會替換目前畫面。請先下載尚未同步的草稿，確定繼續？",
        )
      )
        return;
      try {
        await reload(true);
      } catch (e) {
        status(e.message, true);
      }
    };
    document.querySelector("#retrySync").onclick = () => {
      paused = false;
      flush();
    };
    document.querySelector("#connectionSettings").onclick = () => {
      locked(true);
      message.textContent = "重新登入前可先下載草稿。";
    };
    document.querySelector("#exportData").onclick = () =>
      download(
        {
          version: D.VERSION,
          exportedAt: new Date().toISOString(),
          state: adapter.get(),
        },
        "tiny-progress-backup.json",
      );
    document.querySelector("#exportLegacy").onclick = () =>
      download(read(LEGACY) || {}, "tiny-progress-old-browser-backup.json");
    document.querySelector("#importLegacy").onclick = async () => {
      const old = read(LEGACY);
      if (!old) return adapter.toast("這個瀏覽器沒有舊資料");
      if (demo) return adapter.toast("示範模式不匯入正式資料");
      if (!ready || inflight || dirty()) return adapter.toast("請先完成同步");
      if (!confirm("只會匯入到空白雲端，不會覆蓋既有資料。要繼續嗎？")) return;
      try {
        const data = await request("/api/import-local", {
          method: "POST",
          body: { state: old },
        });
        revision = data.revision;
        baseline = serialize(data.state);
        adapter.replace(data.state);
        status("匯入完成");
      } catch (e) {
        adapter.toast(e.message);
      }
    };
    document.querySelector("#demoLink").href = location.pathname + "?demo=1";
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      message.textContent = "連線中，第一次可能需要等候伺服器啟動…";
      try {
        const selected = serverBase(url.value.trim());
        if (recovery?.dirty && recovery.base !== selected)
          throw new Error(
            "有另一個伺服器的未同步草稿，請先回原伺服器同步或下載草稿",
          );
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
    locked(true);
    url.value =
      window.TP_CONFIG?.API_BASE_URL ||
      localStorage.getItem("tp-v28-server") ||
      "";
    const session = read("tp-v28-session", sessionStorage);
    if (session?.auth && session.base === url.value) {
      try {
        base = serverBase(session.base);
        auth = session.auth;
        message.textContent = "正在載入…";
        await reload();
        message.textContent = "";
      } catch (e) {
        message.textContent = e.message;
      }
    }
    window.addEventListener("beforeunload", (e) => {
      if (dirty() || inflight) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    const refresh = async () => {
      if (
        !ready ||
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
        status("目前離線，變更會保留在本機", true);
      }
    };
    setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
  }
  async function manage(path, options = {}) {
    if (demo) throw new Error("示範模式不會變更正式週期");
    await flush();
    if (dirty() || inflight || paused)
      throw new Error("請先完成同步或下載草稿");
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
    flush,
    manage,
    selectCycle,
    isReady: () => ready,
  };
})();
