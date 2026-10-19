# 假TradingView

仿 TradingView 介面的網頁版 K 線圖，使用 TradingView 開源的 [Lightweight Charts](https://github.com/tradingview/lightweight-charts)（v5.2.1，Apache 2.0）。

## 線上使用

👉 https://amperessr.github.io/tradingvieww/

不用安裝，打開網址就能用。模擬交易紀錄、繪圖、偏好設定都只存在你自己的瀏覽器（localStorage），不會上傳到任何地方。
所在地區連不上 Binance 時，會自動改用模擬行情（圖例旁的綠點變成橘色）。

## 在自己電腦上跑

```bash
npm start
```

開啟 http://localhost:5173（只需要 Node.js，不用 `npm install`；任何靜態網頁伺服器都可以）

## 功能

- 介面比照 TradingView 桌面版深色主題（#0f0f0f 底、4px 分隔、#1c1c1c 格線）
- 即時行情：Binance USDⓈ-M 永續合約（顯示為 `BTCUSDT.P`，BTC 跳動點 0.1），連不上時自動改用模擬行情
- 週期列可加星號設為最愛、K線類型、K 棒收盤倒數、成交量標籤、往左捲動自動補舊資料
- 指標：成交量、MA、EMA、布林通道、RSI、MACD
- 左側工具列（和 TradingView 一樣，滑到按鈕上點右側小箭頭打開該組清單，按鈕會記住上次用的工具）：
  - 游標：十字線 / 點 / 箭頭 / 橡皮擦
  - 趨勢線、射線、延長線、箭頭、水平線、水平射線、垂直線、十字線、平行通道
  - 斐波那契回撤（0～4.236）、斐波那契時間週期
  - XABCD / ABCD 型態
  - 多頭 / 空頭部位（帳戶 1000、風險 25%，顯示目標、停損、已平倉/未平倉盈虧、風險報酬比）、價格範圍、日期範圍、日期和價格範圍
  - 筆刷、螢光筆、矩形、圓形、文字（雙擊可編輯）、價格標籤、表情圖示
  - 測量（或按住 Shift 點圖表）、放大（框選範圍）
  - 磁鐵（弱/強）、保持繪圖模式、鎖定所有繪圖、隱藏、移除
  - 選取繪圖會出現浮動工具列（顏色、線寬、線條樣式、鎖定、刪除）；Delete 刪除、Esc 取消、Ctrl+Z / Ctrl+Y 復原重做
  - 快捷鍵：Alt+T 趨勢線、Alt+H 水平線、Alt+J 水平射線、Alt+V 垂直線、Alt+C 十字線、Alt+F 斐波那契
- 模擬交易（資料存在瀏覽器 localStorage）：
  - 圖表左上角一鍵買入/賣出（市價）
  - 右上「交易」打開下單面板和底部交易面板：市價 / 限價 / 停損，可加止盈止損，圖上有可拖曳的預覽線
  - 圖上的持倉、掛單、止盈、止損線都能拖曳改價；滑到持倉線上會出現「止盈」「止損」按鈕，往上/下拖出即可設定
  - 右鍵圖表可在該價位直接掛單
- 右側欄：觀察清單、物件樹（列出繪圖和指標）
- K 線重播（拍影片用）：
  1. 按上方「重播」，在圖上點一下選起點，或按住拖曳框選一段（只播到框選終點，終點會有藍色虛線）
  2. 起點之後的 K 線會藏起來；這時可以畫多頭/空頭部位，或用左上角買賣按鈕、下單面板下單並設止盈止損
  3. 按 ▶ 播放，K 線會一根根長出來（每根內部會逐筆走出 開→高/低→收），止盈止損碰到就觸發
  4. ⏩ 加速（0.5x～50x，1x = 每秒一根），⏮ 倒轉回起點（帳戶也會還原成按播放前的狀態，方便重拍），◀| |▶ 後退/前進一根，✕ 退出回到即時行情
  - 快捷鍵：空白鍵 播放/暫停、→ 前進、← 後退、↑ 加速、↓ 減速
  - 播放中控制列會自動淡出，滑鼠移過去才出現；重播用的是獨立的臨時帳戶，不會影響平常的模擬交易

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `index.html`, `css/style.css` | 版面與 TradingView 深色主題 |
| `js/main.js` | 圖表、圖例、工具列、下單面板、觀察清單、交易面板 |
| `js/datafeed.js` | Binance 行情與模擬行情 |
| `js/broker.js` | 模擬券商（淨額持倉、括號單） |
| `js/tradelines.js` | 圖上可拖曳的交易線 |
| `js/drawings.js` | 繪圖工具（series primitive） |
| `js/lefttoolbar.js` | 左側工具列與工具清單 |
| `js/replay.js` | K 線重播（選段、播放、倒轉、加速） |
| `js/indicators.js` | 技術指標 |
| `lib/` | TradingView Lightweight Charts v5.2.1 打包檔與授權（`npm run update-lib` 可更新） |

## 授權與聲明

- 圖表使用 [TradingView Lightweight Charts™](https://github.com/tradingview/lightweight-charts)（Apache License 2.0，見 `lib/LIGHTWEIGHT-CHARTS-LICENSE`、`lib/LIGHTWEIGHT-CHARTS-NOTICE`），圖表左下角保留 TradingView 標誌作為出處標示。
- 本專案是個人製作的練習／教學用模擬工具，與 TradingView Inc. 及 Binance 沒有任何關係，也不是官方產品。
- 所有交易都是模擬，不會動到真實資金；畫面內容不構成任何投資建議。
