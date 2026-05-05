## 目前部署狀態

- 前端已部署到 GitHub Pages，並可正常開啟。
- 後端已部署到 Render Free Web Service。
- 前端 `script.js` 已改為呼叫 Render 後端 API。
- Render 後端 `/items` 可正常讀取 Google Sheets 資料。
- GitHub Pages 線上版已測試成功：
  - 可新增任務
  - 可勾選任務
  - 可刪除任務
- 目前已不再依賴本機 `http://localhost:3000` 作為正式後端。

## 下一階段

- 申請 / 設定 LINE 官方帳號。
- 啟用 Messaging API。
- 建立 LINE Webhook。
- 製作聊天指令：
  - 清單
  - 新增 任務內容
  - 完成 1
  - 取消 1
  - 改 1 新文字
  - 刪除 1
- 之後再做圖文選單、LIFF、每日提醒。