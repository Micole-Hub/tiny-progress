/* Cloud-first: authoritative reads/writes, no offline editing. */
window.TPConnection = (() => {
  "use strict";
  const D = window.TPDomain,
    demo = new URLSearchParams(location.search).get("demo") === "1";
  const CACHE = "tiny-progress-v28-cache",
    META = "tiny-progress-v28-sync",
    SESSION_KEY = "tp-v28-session",
    REMEMBER_KEY = "tp-v29-remember";
  const read = (key, storage = localStorage) => {
    try {
      return JSON.parse(storage.getItem(key) || "null");
    } catch {
      return null;
    }
  };
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
  // Cloud is authoritative. Browser cache is read-only until a cloud response succeeds.
  // The previous offline draft storage is never imported into cloud data automatically.
  const LEGACY_BACKUP = "tiny-progress-legacy-draft-backup-cloud-first";
  let adapter;
  let base = "";
  let auth = "";
  let ready = false;
  let revision = 0;
  let baseline = "";
  let inflight = false;
  let paused = false;
  let pendingSave = null;
  let selectedCycle = null;
  let conflictRetries = 0;
  let writeTimer = null;
  let statusTimer = null;
  let reauthForSave = false;
  let startCompleted = false;
  // 計畫目標獨立儲存在 cycles.theme；只讀取，不改動 web_state。
  // 水缸 cycle.directions 和這段計畫文字是不同的資料。
  let planTheme = "";
  let planCycleNumber = null;
  let planThemeServer = "";
  let planThemeRequest = 0;
  let planThemeLastAttempt = 0;
  let planThemeAttemptCycle = null;
  let planThemeAttemptServer = "";
  function cycleTheme() {
    const current = Number(adapter?.get()?.cycle?.number);
    return current === planCycleNumber && base === planThemeServer
      ? planTheme
      : "";
  }
  async function refreshCycleTheme() {
    if (demo || !ready || !base || !auth || paused || !navigator.onLine) return;
    const cycle = Number(adapter?.get()?.cycle?.number);
    if (!Number.isSafeInteger(cycle) || cycle < 1) return;
    const now = Date.now();
    // 同一週期十分鐘內不重複詢問；登入／切換週期會讀取對應計畫。
    if (cycle === planThemeAttemptCycle && base === planThemeAttemptServer &&
        now - planThemeLastAttempt < 600000) return;
    const sequence = ++planThemeRequest;
    planThemeLastAttempt = now;
    planThemeAttemptCycle = cycle;
    planThemeAttemptServer = base;
    try {
      const rows = await request("/cycles");
      if (sequence !== planThemeRequest ||
          cycle !== Number(adapter?.get()?.cycle?.number)) return;
      if (!Array.isArray(rows)) return;
      const entry = rows.find((row) => Number(row?.cycleNumber) === cycle);
      if (!entry) return;
      const next = typeof entry.theme === "string" ? entry.theme.trim() : "";
      const changed = planCycleNumber !== cycle ||
        planThemeServer !== base || planTheme !== next;
      planCycleNumber = cycle;
      planThemeServer = base;
      planTheme = next;
      if (changed) adapter.onCycleTheme?.();
    } catch (error) {
      // 目標讀取失敗不得阻擋任務、登入或雲端存檔。
      // 首頁仍可使用 web_state.cycle.direction 作為備援。
    }
  }
  const oldMeta = read(META);
  let oldUnsaved = oldMeta?.dirty &&
    localStorage.getItem("tiny-progress-cloud-first-legacy-reviewed") !== "yes"
      ? { meta: oldMeta, state: read(CACHE) } : null;
  const dirty = () => ready && serialize(adapter.get()) !== baseline;

  function ui(id) {
    return document.getElementById(id);
  }
  function status(message, kind = "info", autoHide = false) {
    clearTimeout(statusTimer);
    const panel = ui("syncPanel");
    panel.hidden = !message;
    panel.classList.toggle("error", kind === "error");
    ui("syncStatus").textContent = message;
    if (autoHide && message)
      statusTimer = setTimeout(() => {
        if (!inflight && !paused) panel.hidden = true;
      }, 2400);
  }
  function gate(kind) {
    ui("connectionGate").hidden = kind !== "login";
    ui("saveFailureGate").hidden = kind !== "save";
    document.querySelector(".app-shell").inert = kind !== null;
  }
  function cacheConfirmed(s) {
    if (demo) return;
    try {
      localStorage.setItem(CACHE, JSON.stringify(s));
    } catch {
      // Cache is optional: cloud saves must not fail when browser storage is full.
    }
  }
  function preserveLegacyDraft() {
    if (!oldUnsaved) return;
    try {
      if (!localStorage.getItem(LEGACY_BACKUP))
        localStorage.setItem(LEGACY_BACKUP, JSON.stringify(oldUnsaved));
    } catch { /* The original old META/CACHE keys are left untouched. */ }
    ui("legacyDraftNotice").hidden = false;
  }
  function downloadLegacyDraft() {
    const content = localStorage.getItem(LEGACY_BACKUP) || JSON.stringify(oldUnsaved);
    if (!content) return;
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tiny-progress-舊版未同步草稿備份.json";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  // Short-lived API access stays in sessionStorage. Only an opted-in, rotating
  // device token (never the password) is kept across browser sessions.
  const currentRemember = () => read(REMEMBER_KEY);
  const saveAccess = () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ base, auth }));
    localStorage.removeItem(SESSION_KEY); // Migrate old 12-hour login storage.
  };
  let refreshPromise = null;
  async function requestOnce(path, { method = "GET", body } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(auth && !path.startsWith("/auth/") ? { Authorization: "Bearer " + auth } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(45000),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error("伺服器回傳格式異常，請檢查 Render 服務是否正常。");
    }
    if (!res.ok) {
      const error = new Error(data.message || "雲端暫時無法使用");
      error.status = res.status;
      throw error;
    }
    return data;
  }
  async function renewDeviceSession() {
    if (refreshPromise) return refreshPromise;
    const remembered = currentRemember();
    if (!remembered?.token || remembered.base !== base) return false;
    if (remembered.expiresAt && Number(remembered.expiresAt) <= Date.now()) {
      localStorage.removeItem(REMEMBER_KEY);
      return false;
    }
    refreshPromise = (async () => {
      try {
        const next = await requestOnce("/auth/refresh", {
          method: "POST", body: { rememberToken: remembered.token },
        });
        auth = next.token;
        saveAccess();
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({
          base, token: next.rememberToken, expiresAt: next.rememberExpiresAt,
        }));
        return true;
      } catch (error) {
        if (error.status === 401 && currentRemember()?.token === remembered.token) {
          // Another browser tab might already have rotated the shared token.
          localStorage.removeItem(REMEMBER_KEY);
          sessionStorage.removeItem(SESSION_KEY);
          auth = "";
        }
        throw error;
      }
    })();
    try { return await refreshPromise; }
    finally { refreshPromise = null; }
  }
  async function request(path, options = {}) {
    try {
      return await requestOnce(path, options);
    } catch (error) {
      // Refresh transparently when the 12-hour access token expires.
      // Avoid refreshing auth endpoints, and retry each API operation at most once.
      if (error.status !== 401 || path.startsWith("/auth/") ||
          !(await renewDeviceSession())) throw error;
      return requestOnce(path, options);
    }
  }
  function statePath() {
    return "/api/state" + (selectedCycle ? "?cycle=" + selectedCycle : "");
  }
  function takeCloud(data) {
    D.validate(data.state);
    revision = Number(data.revision);
    baseline = serialize(data.state);
    pendingSave = null;
    paused = false;
    conflictRetries = 0;
    ready = true;
    adapter.replace(data.state);
    cacheConfirmed(data.state);
    gate(null);
    // 只讀取舊計畫文字，不等待此請求，不影響登入或儲存。
    void refreshCycleTheme();
  }
  async function reload() {
    const data = await request(statePath());
    takeCloud(data);
    status("已載入雲端進度", "info", true);
  }
  function showFailure(error) {
    paused = true;
    const unauthorized = error?.status === 401;
    ui("saveFailureText").textContent = unauthorized
      ? "登入已過期。這次修改尚未儲存，請重新登入後繼續送出。"
      : "這次修改尚未儲存到雲端。為避免資料分岔，編輯已暫停。" +
        (error?.message ? " 原因：" + error.message : "");
    ui("reloginFailedSave").hidden = !unauthorized;
    ui("retryFailedSave").hidden = unauthorized;
    gate("save");
    status("雲端儲存失敗，請處理未儲存的修改", "error");
  }
  async function flush() {
    if (demo || !ready || !base || !auth || paused || inflight || (!dirty() && !pendingSave)) return;
    inflight = true;
    clearTimeout(writeTimer);
    status("正在儲存雲端進度…");
    if (!pendingSave)
      pendingSave = {
        expectedRevision: revision,
        mutationId: crypto.randomUUID(),
        state: JSON.parse(serialize(adapter.get())),
      };
    const sent = pendingSave;
    try {
      const data = await request("/api/state", { method: "PUT", body: sent });
      const cloud = data.state || sent.state;
      D.validate(cloud);
      revision = Number(data.revision);
      baseline = serialize(cloud);
      pendingSave = null;
      conflictRetries = 0;
      // Don't replace additional edits made while this request was in flight.
      if (serialize(adapter.get()) === JSON.stringify(sent.state))
        adapter.replace(cloud);
      else {
        // Keep server-assigned metadata when there were later local changes.
        const current = adapter.get();
        current.legacyArchive = cloud.legacyArchive;
        for (const item of current.tasks || []) {
          const saved = (cloud.tasks || []).find((x) => x.id === item.id);
          if (saved?.legacyId) item.legacyId = saved.legacyId;
        }
      }
      cacheConfirmed(cloud);
      gate(navigator.onLine ? null : "login");
      // The server has confirmed *sent*, but the user may have made further edits
      // while the request was in flight. Do not claim everything is saved yet.
      const newerChangesPending = dirty();
      status(newerChangesPending
        ? "上一批已儲存，最新變更仍在儲存中…"
        : "已儲存至雲端", "info", !newerChangesPending);
    } catch (error) {
      if (error.status === 409 && conflictRetries < 3) {
        // Only merge while connected, not from an offline edit copy.
        try {
          const data = await request(statePath());
          D.validate(data.state);
          const merged = mergeStates(JSON.parse(baseline), adapter.get(), data.state);
          D.validate(merged);
          revision = Number(data.revision);
          baseline = serialize(data.state);
          pendingSave = null;
          conflictRetries += 1;
          adapter.replace(merged);
          cacheConfirmed(data.state);
          status("正在整合其他裝置的更新…");
        } catch (mergeError) {
          showFailure(mergeError);
        }
      } else {
        showFailure(error);
      }
    } finally {
      inflight = false;
      if (!paused && dirty())
        writeTimer = setTimeout(flush, 100 + 200 * conflictRetries);
    }
  }
  function save() {
    if (demo || !ready || paused) return;
    if (!dirty() && !pendingSave) return;
    if (!navigator.onLine) {
      showFailure(new Error("網路中斷。恢復網路後才能儲存。"));
      return;
    }
    status("正在儲存雲端進度…");
    clearTimeout(writeTimer);
    if (!inflight) writeTimer = setTimeout(flush, 220);
  }
  function initial(seed) {
    if (demo) {
      const s = D.clone(seed);
      s.schemaVersion = 27;
      s.cycle.startDate = s.cycle.startDate || s.simulationWeekStart || D.monday(D.today());
      s.weekMeta ||= {};
      s.unfinishedReasons ||= {};
      s.preferences.lineEnabled = false;
      return s;
    }
    // Preview is visible only behind a locked login panel until fresh cloud data arrives.
    return read(CACHE) || D.empty();
  }
  function serverBase(value) {
    const u = new URL(value);
    if (u.username || u.password || u.search || u.hash || u.pathname !== "/")
      throw new Error("請填入 Render 根網址，不要包含其他路徑或參數");
    if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)))
      throw new Error("請使用 HTTPS Render 網址");
    return u.origin;
  }
  async function start(a) {
    adapter = a;
    if (demo) {
      ready = true;
      baseline = serialize(adapter.get());
      gate(null);
      status("");
      return;
    }
    gate("login");
    const form = ui("connectionForm");
    const url = ui("serverUrl");
    const password = ui("webPassword");
    const message = ui("connectionMessage");
    const rememberInput = ui("rememberDevice");
    preserveLegacyDraft();
    ui("downloadLegacyDraft").onclick = downloadLegacyDraft;
    // Preserve existing active sessions during the upgrade, but stop persisting
    // access tokens in localStorage from this version onward.
    const oldSession = read(SESSION_KEY);
    const session = read(SESSION_KEY, sessionStorage) || oldSession;
    if (oldSession?.auth) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(oldSession));
      localStorage.removeItem(SESSION_KEY);
    }
    const remembered = currentRemember();
    url.value = window.TP_CONFIG?.API_BASE_URL || localStorage.getItem("tp-v28-server") || "";
    if (!url.value && session?.base) url.value = session.base;
    if (!url.value && remembered?.base) url.value = remembered.base;
    rememberInput.checked = Boolean(remembered?.token && remembered.base === url.value);
    // No password flash: first verify an existing access token or remembered device.
    const autoRestore = !oldUnsaved && Boolean(
      (session?.auth && session.base === url.value) ||
      (remembered?.token && remembered.base === url.value)
    );
    form.hidden = autoRestore;
    ui("autoLoginLoading").hidden = !autoRestore;

    form.onsubmit = async (event) => {
      event.preventDefault();
      if (oldUnsaved && !ui("legacyDraftConfirmed").checked) {
        message.textContent = "請先確認舊版草稿備份，再繼續使用雲端版。";
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      message.textContent = "正在連線到雲端，Render 首次啟動可能需要稍等…";
      try {
        const chosenBase = serverBase(url.value.trim());
        if (reauthForSave && base && chosenBase !== base)
          throw new Error("要完成目前未儲存的修改，請登入原本的 Render 服務。 ");
        base = chosenBase;
        auth = "";
        const login = await requestOnce("/auth/login", {
          method: "POST", body: {
            password: password.value, remember: rememberInput.checked,
          },
        });
        auth = login.token;
        saveAccess();
        if (login.rememberToken) {
          localStorage.setItem(REMEMBER_KEY, JSON.stringify({
            base, token: login.rememberToken, expiresAt: login.rememberExpiresAt,
          }));
        } else {
          const previous = currentRemember();
          if (previous?.token) {
            // Opting out of remembered login must also revoke an older device token.
            const oldBase = base;
            base = previous.base;
            try {
              await requestOnce("/auth/logout", {
                method: "POST", body: { rememberToken: previous.token },
              });
              localStorage.removeItem(REMEMBER_KEY);
            } catch {
              // Do not silently claim that the old device was revoked.
              message.textContent = "已登入，但先前的記住裝置尚未撤銷，請在設定頁重試登出。";
            } finally { base = oldBase; }
          }
        }
        localStorage.setItem("tp-v28-server", base);
        password.value = "";
        if (reauthForSave && pendingSave) {
          reauthForSave = false;
          paused = false;
          await flush();
          if (paused) return;
        } else {
          await reload();
        }
        if (oldUnsaved) {
          localStorage.setItem("tiny-progress-cloud-first-legacy-reviewed", "yes");
          oldUnsaved = null;
        }
        if (!message.textContent.startsWith("已登入，但")) message.textContent = "";
      } catch (error) {
        message.textContent = error.message;
        gate("login");
      } finally {
        button.disabled = false;
      }
    };
    ui("retryFailedSave").onclick = async () => {
      if (!navigator.onLine) {
        ui("saveFailureText").textContent = "目前沒有網路，恢復連線後才能重新儲存。";
        return;
      }
      paused = false;
      await flush();
    };
    ui("reloginFailedSave").onclick = () => {
      reauthForSave = true;
      message.textContent = "請重新登入，系統會再嘗試儲存剛剛的修改。";
      gate("login");
    };
    ui("discardFailedSave").onclick = async () => {
      if (!window.confirm("確定放棄這次尚未儲存的修改，重新載入雲端版本嗎？")) return;
      // Always verify the cloud is reachable before discarding a failed write.
      try {
        const data = await request(statePath());
        takeCloud(data);
        status("已還原成雲端版本，未儲存的變更已放棄", "info", true);
      } catch (error) {
        ui("saveFailureText").textContent = "目前還無法讀取雲端，尚未放棄你的修改：" + error.message;
      }
    };

    // Explicit logout revokes the remembered device server-side.
    ui("logoutDevice").onclick = async () => {
      if (inflight || dirty() || pendingSave) {
        status("有尚未儲存的修改，請先確認雲端已儲存再登出。", "error");
        return;
      }
      const button = ui("logoutDevice");
      button.disabled = true;
      try {
        const saved = currentRemember();
        if (saved?.token) {
          const currentBase = base;
          base = serverBase(saved.base);
          try {
            await requestOnce("/auth/logout", {
              method: "POST", body: { rememberToken: saved.token },
            });
          } finally { base = currentBase; }
        }
        sessionStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(REMEMBER_KEY);
        localStorage.removeItem(CACHE);
        localStorage.removeItem(META);
        auth = "";
        ready = false;
        location.reload();
      } catch (error) {
        status("無法安全登出並撤銷裝置，請確認網路後重試：" + error.message, "error");
      } finally {
        button.disabled = false;
      }
    };

    if (autoRestore) {
      try {
        base = serverBase(url.value);
        auth = session?.base === base ? session.auth : "";
        message.textContent = "正在確認雲端登入…";
        if (!auth && !(await renewDeviceSession()))
          throw Object.assign(new Error("登入已過期，請重新輸入密碼。"), {status: 401});
        await reload();
        message.textContent = "";
      } catch (error) {
        message.textContent = error.status === 401
          ? "登入已過期，請重新輸入密碼。"
          : "暫時無法讀取雲端，請稍後重試。未開啟離線編輯。";
        if (error.status === 401) {
          auth = "";
          sessionStorage.removeItem(SESSION_KEY);
        }
        gate("login");
      } finally {
        // Show manual login only after failed or expired automatic verification.
        form.hidden = false;
        ui("autoLoginLoading").hidden = true;
      }
    }
    if (startCompleted) return;
    startCompleted = true;
    const refresh = async () => {
      if (!ready || !base || !auth || inflight || paused || dirty() ||
          document.hidden || document.querySelector("dialog[open]") ||
          document.activeElement?.matches("input,textarea,select") ||
          !ui("weekFootprintLayer").hidden || !navigator.onLine) return;
      try {
        const data = await request(statePath());
        if (inflight || paused || dirty() || document.querySelector("dialog[open]") ||
            document.activeElement?.matches("input,textarea,select")) return;
        const changed = data.revision !== revision ||
          !equal(D.publicState(data.state), JSON.parse(baseline || "null"));
        if (changed) {
          takeCloud(data);
          status("已更新雲端最新進度", "info", true);
        }
        // 週期目標可能由週期管理更新，定期同步文字但不改資料。
        void refreshCycleTheme();
      } catch (error) {
        // No offline edits when the cloud cannot be reached.
        if (dirty() || pendingSave) {
          showFailure(error);
        } else {
          gate("login");
          message.textContent = error.status === 401
            ? "登入已過期，請重新登入。"
            : "暫時無法連線到雲端，編輯已暫停。連線恢復後會重新載入。";
          status("暫時無法連線到雲端，已暫停編輯", "error");
        }
      }
    };
    setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("offline", () => {
      if (!ready || paused) return;
      if (dirty() || pendingSave) {
        showFailure(new Error("網路中斷，這次修改仍未儲存。"));
      } else {
        gate("login");
        message.textContent = "目前離線，編輯已暫停。恢復網路後會重新載入雲端資料。";
        status("目前離線，已暫停編輯", "error");
      }
    });
    window.addEventListener("beforeunload", (event) => {
      if (ready && (dirty() || pendingSave || inflight)) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    window.addEventListener("online", () => {
      if (!auth || !base) return;
      if (paused && (dirty() || pendingSave)) {
        paused = false;
        flush();
      } else if (ready && !dirty() && !pendingSave) {
        reload().catch((error) => {
          gate("login");
          message.textContent = "無法重新讀取雲端，請再次登入：" + error.message;
        });
      }
    });
  }
  async function manage(path, options = {}) {
    if (demo) throw new Error("教學模式不會變更正式週期");
    if (!ready || !base || !auth || paused || !navigator.onLine)
      throw new Error("請先完成雲端登入，並確認網路連線正常。");
    await flush();
    if (dirty() || inflight || paused) throw new Error("請等待雲端儲存完成");
    return request(path, options);
  }
  async function selectCycle(cycle) {
    if (!ready || paused) throw new Error("雲端尚未就緒");
    await flush();
    if (dirty() || inflight || paused) throw new Error("請先完成雲端儲存");
    selectedCycle = Number(cycle) || null;
    await reload();
  }
  return {
    initial, save, start, demo,
    isConnected: () => !demo && Boolean(ready && base && auth && !paused),
    flush, manage, selectCycle, cycleTheme,
    isReady: () => ready && !paused,
  };
})();
