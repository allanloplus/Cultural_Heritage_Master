# 文資達人訪查

「[Allan Lo 和你逛文化](https://cultural.123hi.org/)」的姊妹站。知識網站介紹文化資產的歷史；本站由經審查核准的**文資達人**實地走訪，記錄每處文資的**現況與推薦**：參訪日期、保存現況、開放情形、心得與心情、實地照片、推薦指數，以及附近的美食、住宿、交通推薦。

- 規劃書：[`docs/PLAN.md`](docs/PLAN.md)（目標、角色、流程、欄位、統計、架構、資安與個資、上線步驟、分期）
- 規劃設計：Allan Lo，https://www.123hi.org

## 功能

| 頁面 | 說明 |
|---|---|
| 總覽 `#home` | 全臺文資數、已訪查、覆蓋率、近一年更新、紀錄數、達人數；最新訪查；達人即將到訪 |
| 查核資訊 `#coverage` | 各縣市文資數、已訪查、覆蓋率、近一年、需回訪、預計到訪、紀錄筆數；依類別覆蓋率；下載 CSV |
| 縣市 `#county/<縣市>` | 每處文資的最近訪查與現況，可篩選未訪查、需回訪；達人可**規劃訪查行程**（勾選多處＋起訖日期） |
| 文資 `#site/<縣市>/<景點 id>` | 該處文資的所有訪查紀錄、最新現況、平均推薦、達人的附近推薦；連到知識網站同一處文資 |
| 達人 `#experts`、`#expert/<id>` | 每位達人的紀錄數、涵蓋縣市、預計與實際到訪、達成率、每月長條圖 |
| 我的訪查 `#mine` | 依行程分組的預計到訪、完成進度、Google 地圖路線、快速填寫紀錄 |
| 新增紀錄 `#submit/<縣市>/<景點 id>` | 現況、開放、推薦指數與分項、心情、心得、建議、附近推薦、照片（縮圖並移除 GPS）、資料勘誤 |
| 申請 `#apply`、審查 `#admin` | 達人申請；審查者核准紀錄與申請、調整角色、稽核紀錄、勘誤清單 |

**對應連結**：本站的 `#site/<縣市>/<景點 id>` 與知識網站的 `https://cultural.123hi.org/<縣市>/#map/<景點 id>`（第二網站縣市為 `cultural2.123hi.org`）一一對應；知識網站的景點詳情有「達人實地訪查・現況與推薦」按鈕連到本站（`Cultural_Heritage/assets/js/city/app.js` 的 `VISIT_BASE`）。

## 示範模式與正式模式

- `assets/js/config.js` 沒填 Supabase ＝ **示範模式**：資料只存在瀏覽器，頁面上方黃色列可切換身分（管理者、達人、會員、訪客）試用所有流程。
- 填入 Supabase 的 Project URL 與 anon key ＝ **正式模式**：email 免密碼登入、多人共用資料、照片存 Supabase Storage。設定步驟見 `docs/PLAN.md`〈上線步驟〉。

## 檔案

| 檔案 | 內容 |
|---|---|
| `index.html` | 網頁 |
| `assets/js/config.js` | Supabase 設定、照片上限、需回訪天數 |
| `assets/js/store.js` | 資料存取層（示範模式 localStorage／正式模式 Supabase，同一組介面） |
| `assets/js/app.js` | 各頁畫面與流程 |
| `assets/css/app.css` | 樣式（沿用知識網站配色，支援深色模式與手機） |
| `data/heritage-index.json` | 兩個知識網站的全部有形文化資產（22 縣市、3,032 處），由 `tools/build_index.py` 產生 |
| `supabase/schema.sql` | 資料表、觸發器、RLS 權限、統計檢視表、照片 bucket（可重複執行，也可用來升級） |

## 更新文資清單

知識網站新增或修改文資後：

```bash
python3 tools/build_index.py
```

預設讀本 repo 旁邊的 `Cultural_Heritage`、`Cultural_Heritage2`（或設環境變數 `CH1_DIR`、`CH2_DIR`）。

## 本機預覽

```bash
python3 -m http.server 8000
```

開啟 http://localhost:8000/ 。

---

Copyright © 2026 Allan Lo. 訪查文字與照片版權屬各達人，依標示授權使用。
