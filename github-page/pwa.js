/* Installable shell only. Cloud state is never cached for offline edits. */
(() => {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    if (!location.protocol.startsWith("https")) return;
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {
      // Installation remains optional. Online-only authenticated use continues.
    });
  });
})();