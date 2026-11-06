-- =====================================================================
-- 升級 002：訪查紀錄加入「無形文化資產」與「古物」
-- 已經執行過 schema.sql 的資料庫，在 SQL Editor 貼上整份執行一次即可（可重複執行）。
-- 既有的訪查紀錄與預計到訪自動歸為有形文資（kind = 'site'），不受影響。
--
-- kind（類別）     condition（現況）                                open_status（公開／展示情形）
--   site 有形文資   良好、尚可、待修繕、修復施工中、閉館或封閉、已消失或拆除   正常開放、限時或預約、僅能看外觀、未開放
--   ich  無形文資   傳承活躍、穩定傳承、傳承人少、式微或停辦               定期公開舉行、預約或不定期、僅限社群內部、已停辦
--   antiquity 古物  良好、尚可、待修護、未能看到                        常設展出、特展或輪展、預約參觀、未公開展示
-- mode（參與方式，僅無形文資）：觀賞祭典、觀賞演出、工藝體驗、參訪工坊、其他
-- =====================================================================

alter table public.visits      add column if not exists kind text not null default 'site';
alter table public.visits      add column if not exists mode text;
alter table public.visit_plans add column if not exists kind text not null default 'site';

alter table public.visits drop constraint if exists visits_condition_check;
alter table public.visits drop constraint if exists visits_open_status_check;
alter table public.visits drop constraint if exists visits_kind_values;
alter table public.visits add constraint visits_kind_values check (
     (kind = 'site'      and condition in ('良好','尚可','待修繕','修復施工中','閉館或封閉','已消失或拆除')
                         and open_status in ('正常開放','限時或預約','僅能看外觀','未開放') and mode is null)
  or (kind = 'ich'       and condition in ('傳承活躍','穩定傳承','傳承人少','式微或停辦')
                         and open_status in ('定期公開舉行','預約或不定期','僅限社群內部','已停辦')
                         and (mode is null or mode in ('觀賞祭典','觀賞演出','工藝體驗','參訪工坊','其他')))
  or (kind = 'antiquity' and condition in ('良好','尚可','待修護','未能看到')
                         and open_status in ('常設展出','特展或輪展','預約參觀','未公開展示') and mode is null)
);
alter table public.visit_plans drop constraint if exists visit_plans_kind_values;
alter table public.visit_plans add constraint visit_plans_kind_values check (kind in ('site','ich','antiquity'));

-- 統計檢視表加上 kind（新欄位只能加在最後）
create or replace view public.v_site_stats as
select county_slug, site_id,
       count(*)::int                         as visits,
       max(visit_date)                        as last_visit,
       round(avg(recommend)::numeric, 2)      as avg_recommend,
       (array_agg(condition order by visit_date desc))[1]   as last_condition,
       (array_agg(open_status order by visit_date desc))[1] as last_open_status,
       max(kind)                              as kind
from public.visits where status = 'published'
group by county_slug, site_id;
grant select on public.v_site_stats to anon, authenticated;
