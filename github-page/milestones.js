/* Tiny Progress History journey: presentation only, no state mutation or cloud calls. */
(function (root) {
  "use strict";

  const TOTAL = 12;
  function clean(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function shortDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    return match ? Number(match[2]) + "/" + Number(match[3]) : "";
  }
  function daysBetween(first, second) {
    const a = Date.parse(String(first || "") + "T12:00:00Z");
    const b = Date.parse(String(second || "") + "T12:00:00Z");
    return Number.isFinite(a) && Number.isFinite(b) ?
      Math.max(0, Math.round((a - b) / 86400000)) : 0;
  }
  function calculate(config) {
    const weeks = Array.isArray(config.weeks) ? config.weeks : [];
    const finished = weeks.filter(w => w.finished).length;
    const resting = Boolean(config.resting);
    const allDone = finished === TOTAL;
    const currentWeek = Math.min(TOTAL, Math.max(1, Number(config.currentWeek) || 1));
    const active = !resting && !allDone;
    const item = weeks.find(w => Number(w.number) === currentWeek);
    const start = weeks[0] && weeks[0].start;
    let title, subtitle, eyebrow;
    if (resting) {
      title = "還在準備起點 🌿";
      subtitle = "預計 " + shortDate(start) + " 開始 Week 1。休息期間不會提前跳週。";
      eyebrow = "尚未開始 · " + daysBetween(start, config.today) + " 天後出發";
    } else if (allDone) {
      title = "十二週的路，已經走過了";
      subtitle = "每一週的樹都留在下方 History，想回顧時隨時可以打開。";
      eyebrow = "12 WEEKS · JOURNEY COMPLETE";
    } else {
      title = "現在走到 Week " + currentWeek;
      subtitle = (item ? shortDate(item.start) + "－" + shortDate(item.end) + " · " +
        Number(item.leaves || 0) + " 片葉子已留下" : "這一週正在進行中");
      eyebrow = "正在前進 · WEEK " + String(currentWeek).padStart(2, "0");
    }
    return { weeks, finished, resting, active, allDone, currentWeek, title, subtitle, eyebrow };
  }
  const leaf = '<svg viewBox="0 0 32 32" aria-hidden="true">' +
    '<path d="M8 24c.5-11 7.5-16 18-18-.7 12.4-5.6 19-14 19" fill="currentColor" opacity=".85"/>' +
    '<path d="M7 27c4-8 8-10 15-15" fill="none" stroke="#fffdf8" stroke-width="1.7" stroke-linecap="round"/>' +
    '</svg>';

  function renderJourney(config) {
    const el = typeof document !== "undefined" ? document.getElementById("tpMilestones") : null;
    if (!el || !config || !Array.isArray(config.weeks) || config.weeks.length !== TOTAL) return;
    const p = calculate(config);
    const pct = Math.round(p.finished / TOTAL * 100);
    // Archived weeks alone count as History. Current/future leaves do not appear early.
    const totalLeaves = p.weeks.filter(w => w.finished)
      .reduce((sum, w) => sum + Math.max(0, Number(w.leaves) || 0), 0);
    const stages = p.weeks.map(w => {
      const number = Number(w.number);
      const status = w.finished ? "finished" :
        p.active && number === p.currentWeek ? "current" :
        p.resting && number === 1 ? "start" : "future";
      const clickable = status === "finished" && typeof config.onReviewWeek === "function";
      const label = "Week " + number +
        (status === "finished" ? "，已結束，點選查看回顧" :
         status === "current" ? "，進行中" :
         status === "start" ? "，預計 " + shortDate(w.start) + " 開始" : "，尚未到來");
      const tag = clickable ? "button" : "span";
      return '<' + tag + ' class="tp-journey-stop is-' + status + '"' +
        (clickable ? ' type="button" data-journey-week="' + number + '"' : '') +
        ' aria-label="' + clean(label) + '">' +
        '<span class="tp-journey-node" aria-hidden="true">' +
          (status === "finished" ? "✓" : String(number).padStart(2, "0")) +
        '</span><span class="tp-journey-stop-copy"><strong>W' +
          String(number).padStart(2, "0") + '</strong></span></' + tag + '>';
    }).join("");
    el.className = "tp-journey-section";
    el.setAttribute("aria-label", "十二週旅程：已走過 " + p.finished + " 週");
    el.innerHTML =
      '<div class="tp-journey-overview">' +
        '<div class="tp-journey-numbers"><span class="tp-journey-kicker">12-WEEK JOURNEY</span>' +
          '<div class="tp-journey-big"><strong>' + p.finished + '</strong><span>/ 12 週</span></div>' +
          '<p>已走過的週次</p></div>' +
        '<div class="tp-journey-copy"><span class="tp-journey-status">' +
          clean(p.eyebrow) + '</span><h2>' + clean(p.title) + '</h2>' +
          '<p class="tp-journey-sub">' + clean(p.subtitle) + '</p>' +
          '<div class="tp-journey-leaves"><span aria-hidden="true">✦</span> ' +
          (p.finished ? '累積 ' + totalLeaves + ' 片葉子' : '第一週結束後，成果才會收進歷史') +
          '</div></div>' +
      '</div>' +
      '<div class="tp-journey-progress"><div class="tp-journey-bar" role="progressbar" ' +
        'aria-valuemin="0" aria-valuemax="12" aria-valuenow="' + p.finished +
        '" aria-label="已結束的週數"><span style="width:' + pct + '%"></span></div></div>' +
      '<div class="tp-journey-trail" aria-label="十二週總覽">' + stages + '</div>' +
      '<p class="tp-journey-hint">' +
      (p.finished ? "點選已走過的週次，查看當週留下的成果。" :
       p.resting ? "計畫尚未開始。週次會依真正日期前進，不會提前產生歷史紀錄。" :
       "每週結束後，才會生成那一週的歷史紀錄。") +
      '</p>';
    el.querySelectorAll("[data-journey-week]").forEach(button => {
      button.addEventListener("click", () =>
        config.onReviewWeek(Number(button.dataset.journeyWeek)));
    });
  }

  // Read existing state only; keepsake must never change saved task records.
  const escapeHtml = clean;
  function completedForWeek(s, week) {
    if (!s) return 0;
    const archived = (s.archivedWeeks || []).find(x => Number(x.week) === Number(week));
    if (archived) return (archived.completed || []).length;
    return (s.tasks || []).filter(t => Number(t.week) === Number(week) && t.status === "active")
      .reduce((n, t) => n + (Array.isArray(t.occurrences) && t.occurrences.length
        ? t.occurrences.filter(o => o.done).length : Number(Boolean(t.done))), 0);
  }

  function renderWeekKeepsake(container, s, week) {
    if (typeof document === "undefined" || !container || !s) return;
    const w = Number(week);
    if (!Number.isInteger(w) || w < 1 || w > 12) return;
    const archived = (s.archivedWeeks || []).find(v => Number(v.week) === w);
    const reflection = (s.reflections || {})[String(w)] || (archived && archived.reflection) || {};
    const n = completedForWeek(s, w);
    const saved = Boolean(reflection.savedAt);
    const good = saved ? String(reflection.good || "").trim() : "";
    const adjust = saved ? String(reflection.adjust || "").trim() : "";
    const details = document.createElement("details");
    details.className = "tp-keepsake";
    details.innerHTML = '<summary><span aria-hidden="true" class="tp-keepsake-mark">✧</span>' +
      '<span><strong>Week ' + w + ' 成果紀念卡</strong>' +
      '<small>收藏已經走過的這一週</small></span><span class="tp-keepsake-open">展開</span></summary>' +
      '<div class="tp-keepsake-paper">' +
      '<span class="tp-keepsake-label">TINY PROGRESS · WEEK ' + w + '</span>' +
      '<h3>這一週，我留下了進步。</h3>' +
      '<div class="tp-keepsake-stats"><strong>' + n + '</strong><span>片完成的葉子</span></div>' +
      (good ? '<p><b>做得不錯的地方</b>' + escapeHtml(good) + '</p>' : '') +
      (adjust ? '<p><b>下週想調整</b>' + escapeHtml(adjust) + '</p>' : '') +
      (!good && !adjust ? '<p>即使還沒寫感想，這一週也值得被保存。</p>' : '') +
      '<small>依已儲存的雲端紀錄顯示 · 不影響原本的每週足跡</small>' +
      '</div>';
    container.prepend(details);
  }

  if (root) root.TPMilestones = { renderJourney, calculate, renderWeekKeepsake };
  if (typeof module !== "undefined" && module.exports)
    module.exports = { renderJourney, calculate, renderWeekKeepsake };
})(typeof window === "undefined" ? null : window);
