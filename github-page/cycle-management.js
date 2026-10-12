/* Original cycle operations are available from Web settings. */
(() => {
  const $ = (s) => document.querySelector(s),
    message = $("#cycleMessage");
  const show = (e) => {
    message.textContent = e?.message || String(e);
  };
  function setEnabled(enabled, hasCycles = false) {
    const select = $("#cycleSelect");
    select.disabled = !enabled || !hasCycles;
    $("#viewCycle").disabled = !enabled || !hasCycles;
    $("#currentCycle").disabled = !enabled;
    $("#changeCycleStartForm")
      .querySelectorAll("input,select,button")
      .forEach((el) => (el.disabled = !enabled || !hasCycles));
    $("#newCycleForm")
      .querySelectorAll("input,select,button")
      .forEach((el) => (el.disabled = !enabled));
    $("#postponeForm")
      .querySelectorAll("input,select,button")
      .forEach((el) => (el.disabled = !enabled));
  }
  function emptyChoices(label) {
    $("#cycleSelect").innerHTML = `<option value="">${label}</option>`;
  }
  function normalizeDateValue(v) {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return TPDomain.isoDate(v);
    if (typeof v === "object") {
      if (typeof v.toDate === "function") return TPDomain.isoDate(v.toDate());
      if (typeof v.seconds === "number") {
        return TPDomain.isoDate(new Date(v.seconds * 1000));
      }
    }
    return TPDomain.isoDate(v);
  }
  async function choices() {
    const [cycles, weeks] = await Promise.all([
      TPConnection.manage("/cycles"),
      TPConnection.manage("/weeks"),
    ]);
    const validCycles = (Array.isArray(cycles) ? cycles : []).filter(
      (c) =>
        c &&
        Number.isFinite(Number(c.cycleNumber)) &&
        normalizeDateValue(c.startDate),
    );
    $("#cycleSelect").innerHTML = validCycles.length
      ? validCycles
          .map(
            (c) =>
              `<option value="${Number(c.cycleNumber)}">第 ${Number(c.cycleNumber)} 輪 · ${normalizeDateValue(c.startDate)} 開始</option>`,
          )
          .join("")
      : `<option value="">目前沒有可選週期</option>`;
    const validWeeks = (Array.isArray(weeks) ? weeks : []).filter(
      (w) => w && normalizeDateValue(w.weekEnd),
    );
    const last = validWeeks.at(-1);
    $("#newCycleDate").value = last
      ? TPDomain.addDays(last.weekEnd, 1) || TPDomain.today()
      : TPDomain.today();
    setEnabled(true, validCycles.length > 0);
    $("#cycleSyncSettings").hidden = true;
    return validCycles;
  }
  $("#openCycleManagement").onclick = async () => {
    if (TPConnection.demo) {
      emptyChoices("示範模式不提供正式週期");
      setEnabled(false);
      $("#cycleSyncSettings").hidden = true;
      message.textContent =
        "示範模式使用獨立資料，不會連接或更改正式的 12 週計畫。";
      $("#cycleDialog").showModal();
      return;
    }
    emptyChoices("正在載入週期…");
    setEnabled(false);
    $("#cycleSyncSettings").hidden = true;
    $("#cycleDialog").showModal();
    if (!TPConnection.isConnected()) {
      emptyChoices("尚未載入週期");
      message.textContent = "請先設定雲端同步並登入，才能載入週期資料。";
      $("#cycleSyncSettings").hidden = false;
      return;
    }
    try {
      const cycles = await choices();
      message.textContent = cycles.length ? "" : "伺服器目前沒有可選的週期。";
    } catch (e) {
      emptyChoices("載入失敗");
      setEnabled(false);
      show(e);
    }
  };
  $("#cycleSyncSettings").onclick = () => {
    $("#cycleDialog").close();
    $("#syncPanel").open = true;
    $("#connectionSettings").click();
  };
  $("#viewCycle").onclick = async () => {
    try {
      await TPConnection.selectCycle($("#cycleSelect").value);
      show("已切換到選擇的 12 週計畫。");
      $("#cycleDialog").close();
    } catch (e) {
      show(e);
    }
  };
  $("#currentCycle").onclick = async () => {
    try {
      await TPConnection.selectCycle(null);
      $("#cycleDialog").close();
    } catch (e) {
      show(e);
    }
  };
  $("#newCycleForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const created = await TPConnection.manage("/cycles", {
        method: "POST",
        body: {
          startDate: $("#newCycleDate").value,
          theme: $("#newCycleTheme").value,
        },
      });
      await choices();
      await TPConnection.selectCycle(created.cycleNumber);
      show("新的 12 週計畫已建立，現在已切換到新計畫。");
      $("#cycleDialog").close();
    } catch (e) {
      show(e);
    }
  };
  $("#changeCycleStartForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const cycle = $("#cycleSelect").value;
      await TPConnection.manage("/cycles/" + cycle + "/start-date", {
        method: "PATCH",
        body: { startDate: $("#changeCycleDate").value },
      });
      await choices();
      await TPConnection.selectCycle(cycle);
      show("開始日期已更新");
    } catch (e) {
      show(e);
    }
  };
  $("#postponeForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await TPConnection.manage("/weeks/postpone-current", {
        method: "POST",
        body: {
          days: Number($("#postponeDays").value),
          reason: $("#postponeReason").value,
        },
      });
      await TPConnection.selectCycle(null);
      show("本週及後續週次已順延。");
      $("#cycleDialog").close();
    } catch (e) {
      show(e);
    }
  };
})();
