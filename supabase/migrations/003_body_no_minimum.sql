-- =====================================================================
-- 升級 003：取消「參訪心得至少 30 字」的限制
-- 在 Supabase SQL Editor 貼上整份執行一次即可（可重複執行）。既有紀錄不受影響。
-- 心得仍為必填（不可空白），上限維持 5,000 字。
-- =====================================================================
alter table public.visits drop constraint if exists visits_body_check;
alter table public.visits add constraint visits_body_check check (char_length(btrim(body)) between 1 and 5000);
