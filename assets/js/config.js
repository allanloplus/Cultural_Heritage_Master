/* 文資達人訪查網站 — 設定
 * supabaseUrl、supabaseAnonKey 留空＝「示範模式」：資料只存在這台電腦的瀏覽器，可切換身分試用所有流程。
 * 填入 Supabase 專案的 URL 與 anon public key（Project Settings → API）＝正式模式：會員登入、多人共用資料。
 * anon key 是公開金鑰，可以放在網頁裡；資料權限由 supabase/schema.sql 的 RLS 規則控管。
 * 絕對不要把 service_role key 放進這個檔案。 */
window.VISIT_CONFIG = {
  supabaseUrl: "https://nrkyehwamiyjgnvoliel.supabase.co",
  supabaseAnonKey: "sb_publishable_LN3h9tUyL6mitzQidJFGhQ_S90EHzRx",   // publishable key（公開金鑰）
  siteName: "文資達人訪查",
  knowledgeHome: "https://cultural.123hi.org/",   // 文資知識網站（入口頁）
  maxPhotos: 6,                                     // 每筆訪查紀錄最多幾張照片
  photoMaxPx: 1280,                                 // 上傳前縮圖的長邊像素（同時移除 EXIF／GPS 資訊），約 200–300 KB
  photoQuality: 0.8,                                // 大圖 JPEG 品質
  thumbPx: 480,                                     // 列表用小圖的長邊像素（與大圖一起上傳，檔名加 -t），約 30–50 KB
  thumbQuality: 0.72,                               // 小圖 JPEG 品質
  staleDays: 730                                    // 最近一次訪查超過幾天算「需要回訪」
};
