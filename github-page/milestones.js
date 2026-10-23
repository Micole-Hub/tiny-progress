/* Read-only visual extras for History. No task changes or cloud writes. */
(function (root) {
  "use strict";
  function completedForWeek(s, week) {
    if (!s) return 0;
    const archived = (s.archivedWeeks || []).find(x => Number(x.week) === Number(week));
    if (archived) return (archived.completed || []).length;
    return (s.tasks || []).filter(t => Number(t.week) === Number(week) && t.status === "active")
      .reduce((n, t) => n + (Array.isArray(t.occurrences) && t.occurrences.length
        ? t.occurrences.filter(o => o.done).length : Number(Boolean(t.done))), 0);
  }
  function hasReflection(s) {
    if (!s) return false;
    const notes = Object.values(s.reflections || {});
    (s.archivedWeeks || []).forEach(w => { if (w.reflection) notes.push(w.reflection); });
    return notes.some(v => v && v.savedAt &&
      (String(v.good || "").trim() || String(v.adjust || "").trim()));
  }
  function awards(s, finishedWeeks) {
    if (!s) return [];
    const finished = Array.isArray(finishedWeeks) ? finishedWeeks : [];
    const first = (s.tasks || []).some(t => Boolean(t.done) ||
      (t.occurrences || []).some(o => o.done)) ||
      (s.archivedWeeks || []).some(w => (w.completed || []).length > 0);
    return [
      { id: "first", icon: "✦", name: "第一步", detail: "第一次完成任務", earned: first },
      { id: "reflection", icon: "✎", name: "留下足跡", detail: "第一次留下每週感想", earned: hasReflection(s) },
      { id: "journey", icon: "✧", name: "十二週的自己", detail: "走完一輪十二週，不必全部完成", earned: finished.length === 12 }
    ];
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function renderGallery(s, finishedWeeks) {
    if (typeof document === "undefined") return;
    const el = document.getElementById("tpMilestones");
    if (!el) return;
    if (!s) {
      el.innerHTML = '<div class="tp-awards-head"><h2>我的成就收藏</h2></div>' +
        '<p class="tp-awards-hint">成功連線雲端後，這裡會顯示已取得的紀念章。</p>';
      return;
    }
    const badges = awards(s, finishedWeeks);
    el.innerHTML = '<div class="tp-awards-head"><h2>我的成就收藏</h2>' +
      '<span class="tp-awards-count">' + badges.filter(b => b.earned).length + ' / ' +
      badges.length + '</span></div>' +
      '<p class="tp-awards-hint">由已儲存的進度自動判定，不需要集點，也沒有連續打卡壓力。</p>' +
      '<div class="tp-awards-grid">' + badges.map(b =>
        '<div class="tp-award' + (b.earned ? ' is-earned' : ' is-locked') + '">' +
        '<span class="tp-award-symbol" aria-hidden="true">' + b.icon + '</span>' +
        '<strong>' + b.name + '</strong><small>' + b.detail + '</small>' +
        '<span class="tp-award-state">' + (b.earned ? '已收藏' : '尚未獲得') +
        '</span></div>').join("") + '</div>';
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
  const api = { completedForWeek, awards, renderGallery, renderWeekKeepsake };
  if (root) root.TPMilestones = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window === "undefined" ? null : window);
