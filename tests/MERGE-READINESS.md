# TinyProgress 合併前一次性驗收（2026-10-25）

> 本檔是驗收規格與阻擋項目，不是「測試已通過」聲明。QA 分支為 `test/pr8-local-ui-preview-20261024`，正式版為 `main`。**禁止在未確認前合併、修改正式 Sheets、替換正式 GAS 或推送 LINE 訊息。**

## 產品定案（不可因合併而退化）

- 12 週成長系統以 **Week** 為唯一週次/葉子/封存/回顧的歸屬，每週固定七天，依真實台灣日期前進。
- **整週**與**每日**只是共用同一份任務的兩種檢視；每日指定日期可留空，不能另建一份獨立日任務資料。首次偏好留在裝置，兩端可不同。
- 一般任務完成後移到已完成區塊。完成切換在圈圈；**三點選單**提供編輯、移到其他週、刪除。任務移週不改日期與週長。
- 「本輪目標」＝整個 12 週的主要成果；「成長方向」＝1–3 個葉子累積方向；「分類與顏色 → 編輯」保持原正式版操作能力，不用「改名稱」誤導。
- 溫暖紙白底、咖啡導覽、柔紅月份、成長綠選取底線；真實今日與選取日期明確區分。**整週只出現 12 週導覽、每日只出現 7 天日期導覽**。
- 2026-10-26 才開始第 1 週；休息期不提前跳週。History 只記真實已結束的週。手機須能單手完成主要操作；不新增重複的巨大狀態條。
- LINE 卡片與網頁共享相同週次、任務、完成、移週與足跡語義；不允許另一套資料或週長。

## 已做的 QA 程式調整（不是部署）

- 首頁資訊層次、整週／每日標籤、設定的「本輪目標／成長方向」、分類按鈕「編輯」。
- 計畫尚未開始，開始日僅能以完整週為單位調整。移除設定中的「順延 1–7 天」表單。
- QA 後端 `POST /weeks/postpone-current` 返回 409；QA `gas/Code.gs` 同步禁止 `postpone-current-week`。既有任務移週流程和 LINE 卡片未改。
- PWA `sw.js` 更新快取版本與首頁檔案清單，以免顯示舊 JS/CSS。
- `node tests/release-smoke.js` 提供不連網的語法、靜態資產、存取控制掛載及 LINE Flex 卡片預覽檢查。**目前尚未在使用者的實際 Windows 本機 QA 跑過這支新測試。**

## 本次已實際執行的本機測試（不連雲端）
- PASS：`backend/line-cards.js` 的 list / monday / footprint 產生 Flex bubble，`backend/line-bot.js` 的「清單」指令返回訊息。測試檔案以 Git blob SHA 比對 QA，三份來源完全相同，沒有呼叫 LINE 或使用任何正式資料。
- PASS：在與 QA SHA 完全相同的 `github-page/domain.js`、`backend/domain.js`、`gas/TPDomain.gs` 上執行 `tests/cycle-boundaries.js` 邏輯，涵蓋休息期、跨週、封存、完成備註、刪除原因、每週習慣、12 週結束。
- 尚未在使用者 Windows QA 跑 `tests/release-smoke.js` 全套，也**尚未測試真正的 Sheets 寫入、Render 登入、LINE push/reply、手機瀏覽器 PWA**。

## 合併阻擋（須先解決並驗證）

1. **週期資料來源不同步：** `gas/TinyProgressMissing.gs` 的 `tpWebRead(cycle)` 目前未依參數切換週期；`changeCycleStartDateInSheet` 只修改 `cycles/weeks/items` 的日期，首頁以 `web_state.cycle.startDate` 為準。應先明訂唯一真實來源，修復週期選擇/開始日更新，並做 QA 實際讀寫/重新載入驗收。**目前不要透過正式版測試修改開始日。**
2. **獨立 QA 持久化驗收尚未完成：** 已有 QA Sheets/GAS，但尚須從網頁實際新增、編輯、完成、取消完成、修改分類、移週、記錄感想、刷新重登；比較不同分頁與實際測試表中的紀錄與修訂版號。
3. **正式 GAS 檔案/部署版本須核對：** QA 新增 `gas/TinyProgressMissing.gs`（曾用於修復 400）；正式 GAS 是否已包含同樣函式尚未驗證。沒有核對前不能認定網頁和 LINE 在正式 Render 正常。
4. **LINE 端對同一份資料的實測尚未完成：** `backend/line-cards.js`、`line-bot.js` 與 Render 路由需完成不發送的卡片預覽、測試帳號/受控情境回覆、移週及完成後與網頁雙向讀取。QA 本機 runner 特意封鎖 `/line/*` 和提醒傳送，故只跑 QA 網頁不能當作 LINE 已驗證。
5. **合併目標不是舊 PR #8：** PR #8 仍指向 `feature/week-first-ui-pwa-20261024`，不包含整個 QA 新修改。須在上述驗收通過後，建立或更新包含 QA 審核內容的 PR，再進行正式合併。
6. **正式資料與回復點：** 正式 Sheets（包括 web_state）完整備份、記下 main commit、Render 設定與可回復 GAS 部署、LINE webhook URL。正式版舊測試任務僅在確認哪些是測試資料後精準移除，絕不可清空整個正式資料庫或直接覆蓋。

## 建議一次跑完的驗收順序

1. 在隔離 QA clone 跑 `node tests/release-smoke.js`、`node tests/cycle-boundaries.js`、`node tests/weekly-reflection.js`、`node tests/remember-device.js`。任何失敗即停止合併。
2. QA 首頁：桌機 1366、平板 768、手機 390/360 px；整週/每日切換、空白/完成/未排日期任務、三點編輯、週次/今日標示、設定、表單滑動、PWA 安裝/重整後快取；驗收完成後拍照留證。
3. **只使用獨立 QA GAS/Sheets** 完成至少一筆真實存檔的新增→改名→完成→小記→移週（另一筆未完成）→重新整理→重新登入→另一分頁衝突測試。若時間尚未跨週，只測規則，不把系統時間或正式試算表往前調。
4. QA 核對週期 startDate/selectedCycle 的一致性與分類、目標編輯。驗證 QA 的 `web_state`、`cycles`、`weeks` 和 LINE 所讀的資料一致。
5. 確認 Render 現行登入限制、CORS、GAS 專用 Secret、LINE Webhook 簽章與 owner 白名單。不可把 Secret 貼到對話、commit、或截圖。
6. 使用無推送的 LINE Flex 預覽先檢查週一、本週清單、本週足跡（日期、標題、長文字、空資料、9 件以上分頁、按鈕）；再在使用者明確同意的受控正式測試窗口檢驗實際收發與資料同步。
7. 全部通過才做正式 Sheets 備份、標記回復點、更新正確 PR、審查 diff、合併到 main；更新 Render/GAS 時用可回復部署，最後才驗證 LINE 正式卡片。任何一項失敗，回退而非把測試資料帶入正式版。

## 已知可靠性風險（需告知後決定是否接受）

- Render `lineIngressPending` 是程序記憶體中的短期緩衝；若在 GAS 確認入列前 Render 重啟，事件可能遺失。若產品需要強可靠性，需額外的持久化入列方案。
- `tpRecoverWebTransaction()` 是 no-op，不能把它當成有真正跨多步驟交易恢復機制。
- QA mirror 替換登入且禁用 LINE/排程，只可驗證瀏覽器存檔與 QA GAS，不等於正式登入、排程或 LINE 整合已通過。
