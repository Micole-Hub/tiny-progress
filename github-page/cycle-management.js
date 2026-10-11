/* Original cycle operations are available from Web settings. */
(() => {
  const $ = (s) => document.querySelector(s),
    message = $("#cycleMessage");
  const show = (e) => {
    message.textContent = e?.message || String(e);
  };
  async function choices() {
    const [cycles, weeks] = await Promise.all([
      TPConnection.manage("/cycles"),
      TPConnection.manage("/weeks"),
    ]);
    $("#cycleSelect").innerHTML = cycles
      .map(
        (c) =>
          `<option value="${Number(c.cycleNumber)}">Cycle ${Number(c.cycleNumber)} · ${String(c.startDate).slice(0, 10)}</option>`,
      )
      .join("");
    const last = weeks.at(-1);
    $("#newCycleDate").value = last
      ? TPDomain.addDays(last.weekEnd, 1)
      : TPDomain.today();
    return cycles;
  }
  $("#openCycleManagement").onclick = async () => {
    if (TPConnection.demo) {
      message.textContent = "示範模式不會變更正式資料";
      $("#cycleDialog").showModal();
      return;
    }
    try {
      await choices();
      message.textContent = "";
      $("#cycleDialog").showModal();
    } catch (e) {
      show(e);
      $("#cycleDialog").showModal();
    }
  };
  $("#viewCycle").onclick = async () => {
    try {
      await TPConnection.selectCycle($("#cycleSelect").value);
      show("已載入選擇的 Cycle");
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
      show("下一輪已建立，已載入新一輪");
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
      show("本週已延後，後面的日期也已順延");
      $("#cycleDialog").close();
    } catch (e) {
      show(e);
    }
  };
})();
