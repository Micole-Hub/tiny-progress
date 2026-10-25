/* Original cycle operations are available from Web settings. */
(() => {
  const $ = (s) => document.querySelector(s),
    message = $("#cycleMessage");
  const show = (e) => {
    message.textContent = e?.message || String(e);
  };
  let cycleRecords = [];
  const shiftSelect = $("#changeCycleWeekShift");
  function renderWeekStartEditor() {
    const cycle = cycleRecords.find((c) => Number(c.cycleNumber) === Number($("#cycleSelect").value));
    const start = normalizeDateValue(cycle?.startDate);
    const today = TPDomain.today();
    const eligible = Boolean(start && start > today);
    $("#changeCycleStartForm").hidden = !eligible;
    if (!eligible) return;
    $("#cycleOriginalStart").textContent = "目前開始日期：" + start;
    const choices = [];
    for (let shift = -12; shift <= 12; shift++) {
      const date = TPDomain.addDays(start, shift * 7);
      if (date <= today) continue;
      choices.push('<option value="' + shift + '"' + (shift === 0 ? ' selected' : '') + '>' +
        (shift === 0 ? "維持原日期" : shift > 0 ? "延後 " + shift + " 週" : "提前 " + (-shift) + " 週") +
        "（" + date + "）</option>");
    }
    shiftSelect.innerHTML = choices.join("");
    renderWeekStartPreview();
  }
  function renderWeekStartPreview() {
    const cycle = cycleRecords.find((c) => Number(c.cycleNumber) === Number($("#cycleSelect").value));
    const start = normalizeDateValue(cycle?.startDate);
    if (!start) return;
    const next = TPDomain.addDays(start, Number(shiftSelect.value || 0) * 7);
    $("#cycleDatePreview").textContent = "調整後： " + next + " 開始";
  }
  shiftSelect.addEventListener("change", renderWeekStartPreview);
  function renderGoalEditor() {
    const selected = Number($("#cycleSelect").value);
    const row = cycleRecords.find((c) => Number(c.cycleNumber) === selected);
    $("#updateCycleThemeForm").hidden = !row;
    $("#updateCycleThemeHeading").textContent = row
      ? `編輯第 ${selected} 輪的本輪目標` : "編輯本輪目標";
    $("#updateCycleThemeInput").value = row?.theme || "";
  }
  $("#cycleSelect").addEventListener("change", () => { renderGoalEditor(); renderWeekStartEditor(); });
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
    $("#updateCycleThemeForm")
      .querySelectorAll("input,select,button")
      .forEach((el) => (el.disabled = !enabled || !hasCycles));
    if (!enabled) $("#changeCycleStartForm").hidden = true;
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
    cycleRecords = validCycles;
    const current = TPConnection.currentCycleNumber();
    if (validCycles.some((c) => Number(c.cycleNumber) === current))
      $("#cycleSelect").value = String(current);
    renderGoalEditor();
    const validWeeks = (Array.isArray(weeks) ? weeks : []).filter(
      (w) => w && normalizeDateValue(w.weekEnd),
    );
    const last = validWeeks.at(-1);
    $("#newCycleDate").value = last
      ? TPDomain.addDays(last.weekEnd, 1) || TPDomain.today()
      : TPDomain.today();
    setEnabled(true, validCycles.length > 0);
    renderWeekStartEditor();
    $("#cycleSyncSettings").hidden = true;
    return validCycles;
  }
  $("#openCycleManagement").onclick = async () => {
    if (TPConnection.demo) {
      cycleRecords = [];
      $("#updateCycleThemeForm").hidden = true;
      emptyChoices("教學模式不提供正式週期");
      setEnabled(false);
      $("#cycleSyncSettings").hidden = true;
      message.textContent =
        "教學模式使用本地練習資料，不會連接或更改正式的 12 週計畫。";
      $("#cycleDialog").showModal();
      return;
    }
    cycleRecords = [];
    $("#updateCycleThemeForm").hidden = true;
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
  $("#updateCycleThemeForm").onsubmit = async (e) => {
    e.preventDefault();
    const selected = Number($("#cycleSelect").value);
    const theme = $("#updateCycleThemeInput").value.trim();
    const row = cycleRecords.find((c) => Number(c.cycleNumber) === selected);
    if (!row || !theme) return show("請先選擇計畫並填寫本輪目標。");
    const button = $("#updateCycleThemeSubmit");
    button.disabled = true;
    message.textContent = "正在儲存本輪目標…";
    try {
      await TPConnection.manage(`/cycles/${selected}/theme`, {
        method: "PATCH", body: { theme },
      });
      await choices();
      $("#cycleSelect").value = String(selected);
      renderGoalEditor();
      if (TPConnection.currentCycleNumber() === selected)
        await TPConnection.refreshCycleTheme(true);
      message.textContent = "本輪目標已更新，任務與週次沒有重置。";
    } catch (error) {
      show(error);
    } finally {
      button.disabled = false;
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
      const cycle = cycleRecords.find((c) => Number(c.cycleNumber) === Number($("#cycleSelect").value));
      const oldStart = normalizeDateValue(cycle?.startDate);
      if (!oldStart || oldStart <= TPDomain.today())
        throw new Error("這輪計畫已開始，無法調整開始日期。");
      const shift = Number(shiftSelect.value);
      if (!Number.isInteger(shift) || shift === 0) {
        message.textContent = "開始日期沒有變更。";
        return;
      }
      const newStart = TPDomain.addDays(oldStart, shift * 7);
      if (newStart <= TPDomain.today())
        throw new Error("新的開始日期必須晚於今天。");
      await TPConnection.manage("/cycles/" + cycle.cycleNumber + "/start-date", {
        method: "PATCH",
        body: { startDate: newStart },
      });
      await choices();
      await TPConnection.selectCycle(cycle.cycleNumber);
      message.textContent = "開始日期已按整週調整。";
    } catch (e) {
      show(e);
    }
  };

})();
