/* TinyProgress local PR8 preview adapter.
 * Deliberately isolated: NO fetch, tokens, storage, cloud sync or production writes.
 * This file is only loaded by local-preview.html and only works on localhost.
 */
(() => {
  "use strict";
  const host = location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error("Local UI preview is restricted to localhost.");
  }
  const D = window.TPDomain;
  if (!D || typeof D.empty !== "function") throw new Error("TPDomain unavailable");
  const previewDate = "2026-10-26";
  // Advance the isolated *test clock* to actual Week 1 start for UI interactions.
  // The live clock, published site, cloud cycle, and Google Sheets remain unchanged.
  D.today = () => previewDate;
  const seed = D.empty(previewDate);
  seed.cycle.startDate = previewDate;
  seed.cycle.direction = "完成這一週的小小進度";
  seed.cycle.directions = [{
    id: "preview-direction", name: "學習", outcome: "循序完成基礎練習",
    color: "#9fc3de", target: 12
  }];
  seed.cycle.goals = ["學習"];
  seed.selectedWeek = 1;
  seed.selectedDate = previewDate;
  seed.onboarded = true;
  const normal = (id, title, date) => ({
    id, title, week: 1, focusDate: date, categoryId: "learn",
    goal: "學習", done: false, doneDate: "", status: "active", note: ""
  });
  seed.tasks = [
    normal(90101, "整理 HTML 筆記", "2026-10-26"),
    normal(90102, "完成 CSS 練習", "2026-10-28"),
    normal(90103, "閱讀一篇前端文章", "")
  ];
  // This page intentionally resets on refresh so no preview task survives or leaks.
  window.TPConnection = {
    demo: true,
    initial: () => D.clone(seed),
    save: () => {},
    start: async () => {
      const gate = document.getElementById("connectionGate");
      if (gate) gate.hidden = true;
      const app = document.querySelector(".app-shell");
      if (app) app.inert = false;
    },
    isReady: () => true,
    isConnected: () => false,
    cycleTheme: () => seed.cycle.direction,
    flush: async () => {},
    manage: async () => { throw new Error("本機預覽不連正式雲端。"); },
    selectCycle: async () => { throw new Error("本機預覽不能切換正式計畫。"); }
  };
})();
