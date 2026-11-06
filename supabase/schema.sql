-- =====================================================================
-- 文資達人訪查網站 — Supabase 資料庫結構
-- 在 Supabase 專案的 SQL Editor 貼上整份執行一次即可（可重複執行）。
--
-- 角色（profiles.role）：
--   member   一般註冊會員：可閱讀、可提出「達人申請」
--   expert   核准的文資達人：可新增訪查紀錄、預計到訪、上傳照片
--   reviewer 審查者：審核達人申請與訪查紀錄、查看稽核紀錄
--   admin    管理者（Allan Lo）：審查者權限＋調整角色
-- 訪查紀錄狀態（visits.status）：pending 待審 → published 公開／rejected 退回；hidden 下架
--   profiles.trusted = true 的達人（例如 Allan Lo）送出即公開，其餘先待審。
-- 第一位管理者：註冊登入後，在 SQL Editor 執行
--   update public.profiles set role = 'admin', trusted = true where id = (select id from auth.users where email = '你的 email');
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- 會員資料 ----------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null default '新會員',
  bio           text,
  regions       text[] not null default '{}',      -- 擅長縣市（slug）
  avatar_url    text,
  role          text not null default 'member' check (role in ('member','expert','reviewer','admin')),
  trusted       boolean not null default false,    -- 送出紀錄免審
  created_at    timestamptz not null default now()
);

-- 新使用者註冊時自動建立 profile
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anon')
$$;
create or replace function public.is_reviewer() returns boolean
language sql stable as $$ select public.my_role() in ('reviewer','admin') $$;
create or replace function public.is_expert() returns boolean
language sql stable as $$ select public.my_role() in ('expert','reviewer','admin') $$;

-- 會員不能自己改角色、免審標記（只有 admin 能改）
-- 網站上的請求一定帶登入者 auth.uid()；SQL Editor、service role 沒有 auth.uid()，可用來設定第一位管理者。
-- 注意：security definer 函式裡的 current_user 是函式擁有者，不能拿來判斷呼叫者。
create or replace function public.guard_profile() returns trigger
language plpgsql as $$
begin
  if (new.role is distinct from old.role or new.trusted is distinct from old.trusted)
     and auth.uid() is not null and public.my_role() <> 'admin' then
    raise exception '只有管理者可以調整角色';
  end if;
  return new;
end $$;
drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles
  for each row execute function public.guard_profile();

-- ---------- 稽核紀錄（ISMS：審查、核准、角色變更都留痕） ----------
create table if not exists public.audit_log (
  id          bigserial primary key,
  actor       uuid,
  action      text not null,
  target_type text not null,
  target_id   text not null,
  detail      jsonb,
  at          timestamptz not null default now()
);
create or replace function public.audit(p_action text, p_type text, p_id text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (actor, action, target_type, target_id, detail)
  values (auth.uid(), p_action, p_type, p_id, p_detail)
$$;

create or replace function public.audit_profile_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role or new.trusted is distinct from old.trusted then
    perform public.audit('role_change', 'profile', new.id::text,
      jsonb_build_object('from', old.role, 'to', new.role, 'trusted', new.trusted));
  end if;
  return new;
end $$;
drop trigger if exists audit_profile_role on public.profiles;
create trigger audit_profile_role after update on public.profiles
  for each row execute function public.audit_profile_role();

-- ---------- 達人申請 ----------
create table if not exists public.expert_applications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  display_name text not null,                 -- 公開署名
  real_name    text,                          -- 僅審查者可見
  contact      text,                          -- 僅審查者可見
  regions      text[] not null default '{}',
  expertise    text not null,                 -- 專長與資歷
  sample_url   text,                          -- 作品或過往紀錄連結
  agree_terms  boolean not null check (agree_terms),
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note  text,
  reviewer_id  uuid references public.profiles(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- 核准申請 → 會員升為 expert，署名、擅長縣市帶入 profile
create or replace function public.on_application_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> old.status then
    new.reviewer_id := auth.uid();
    new.reviewed_at := now();
    if new.status = 'approved' then
      update public.profiles set role = case when role = 'member' then 'expert' else role end,
        display_name = new.display_name, regions = new.regions where id = new.user_id;
    end if;
    perform public.audit('application_' || new.status, 'application', new.id::text,
      jsonb_build_object('user', new.user_id, 'note', new.review_note));
  end if;
  return new;
end $$;
drop trigger if exists on_application_review on public.expert_applications;
create trigger on_application_review before update on public.expert_applications
  for each row execute function public.on_application_review();

-- ---------- 訪查紀錄 ----------
create table if not exists public.visits (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  county_slug   text not null,                -- 對應文資知識網站的縣市資料夾
  site_id       text not null,                -- 對應文資知識網站的景點 id
  site_name     text not null,
  category      text,
  visit_date    date not null check (visit_date <= current_date),
  condition     text not null check (condition in ('良好','尚可','待修繕','修復施工中','閉館或封閉','已消失或拆除')),
  open_status   text not null check (open_status in ('正常開放','限時或預約','僅能看外觀','未開放')),
  recommend     smallint not null check (recommend between 1 and 5),
  scores        jsonb not null default '{}',  -- {history, preserve, interpret, friendly, access} 各 1–5
  body          text not null check (char_length(body) between 30 and 5000),
  tips          text,
  fee           text,
  duration_min  smallint check (duration_min between 5 and 1440),
  crowd         text check (crowd in ('冷清','適中','擁擠')),
  accessible    text check (accessible in ('友善','部分','不友善','未確認')),
  mood          text check (mood in ('驚喜','感動','愉快','普通','可惜')),
  nearby        jsonb not null default '[]',  -- 附近推薦：[{type: 美食|住宿|交通|景點|其他, name, note, link}]
  correction    text,                         -- 官方或知識網站資料勘誤
  plan_id       uuid,
  status        text not null default 'pending' check (status in ('pending','published','rejected','hidden')),
  review_note   text,
  reviewer_id   uuid references public.profiles(id),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists visits_site on public.visits (county_slug, site_id);
create index if not exists visits_user on public.visits (user_id);

create or replace function public.on_visit_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    new.status := case when (select trusted from public.profiles where id = auth.uid()) then 'published' else 'pending' end;
    new.reviewer_id := null; new.reviewed_at := null; new.review_note := null;
  else
    new.updated_at := now();
    if not public.is_reviewer() then
      -- 作者修改內容：狀態、審查欄位不能自己改；已公開或退回的紀錄修改後重新送審（免審達人除外）
      new.user_id := old.user_id; new.reviewer_id := old.reviewer_id; new.reviewed_at := old.reviewed_at; new.review_note := old.review_note;
      new.status := case when (select trusted from public.profiles where id = auth.uid()) and old.status <> 'hidden'
                         then 'published' else case when old.status = 'hidden' then 'hidden' else 'pending' end end;
    elsif new.status <> old.status then
      new.reviewer_id := auth.uid(); new.reviewed_at := now();
      perform public.audit('visit_' || new.status, 'visit', new.id::text, jsonb_build_object('note', new.review_note));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists on_visit_write on public.visits;
create trigger on_visit_write before insert or update on public.visits
  for each row execute function public.on_visit_write();

-- ---------- 訪查照片（檔案放 Storage bucket visit-photos） ----------
create table if not exists public.visit_photos (
  id         uuid primary key default gen_random_uuid(),
  visit_id   uuid not null references public.visits(id) on delete cascade,
  path       text not null,                  -- <user_id>/<visit_id>/<n>.jpg
  caption    text,
  license    text not null default 'CC BY-SA 4.0',
  ord        smallint not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- 預計到訪 ----------
create table if not exists public.visit_plans (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  county_slug  text not null,
  site_id      text not null,
  site_name    text not null,
  planned_date date not null,
  planned_end  date,                          -- 行程結束日（同一趟行程的多處文資共用起訖日）
  trip         text,                          -- 行程名稱，例如「2026 金門行」
  note         text,
  status       text not null default 'planned' check (status in ('planned','done','cancelled')),
  visit_id     uuid references public.visits(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists plans_user on public.visit_plans (user_id);
-- 舊版資料庫升級（重複執行無妨）
alter table public.visits      add column if not exists mood text;
alter table public.visits      add column if not exists nearby jsonb not null default '[]';
alter table public.visit_plans add column if not exists planned_end date;
alter table public.visit_plans add column if not exists trip text;

-- ---------- 列級權限（RLS） ----------
alter table public.profiles            enable row level security;
alter table public.expert_applications enable row level security;
alter table public.visits              enable row level security;
alter table public.visit_photos        enable row level security;
alter table public.visit_plans         enable row level security;
alter table public.audit_log           enable row level security;

drop policy if exists p_profiles_read on public.profiles;
create policy p_profiles_read on public.profiles for select using (true);   -- 只有公開欄位，不含 email
drop policy if exists p_profiles_update on public.profiles;
create policy p_profiles_update on public.profiles for update
  using (id = auth.uid() or public.my_role() = 'admin');

drop policy if exists p_app_insert on public.expert_applications;
create policy p_app_insert on public.expert_applications for insert
  with check (user_id = auth.uid() and status = 'pending');
drop policy if exists p_app_read on public.expert_applications;
create policy p_app_read on public.expert_applications for select
  using (user_id = auth.uid() or public.is_reviewer());
drop policy if exists p_app_review on public.expert_applications;
create policy p_app_review on public.expert_applications for update using (public.is_reviewer());

drop policy if exists p_visit_read on public.visits;
create policy p_visit_read on public.visits for select
  using (status = 'published' or user_id = auth.uid() or public.is_reviewer());
drop policy if exists p_visit_insert on public.visits;
create policy p_visit_insert on public.visits for insert with check (public.is_expert());
drop policy if exists p_visit_update on public.visits;
create policy p_visit_update on public.visits for update
  using (user_id = auth.uid() or public.is_reviewer());
drop policy if exists p_visit_delete on public.visits;
create policy p_visit_delete on public.visits for delete
  using ((user_id = auth.uid() and status <> 'published') or public.my_role() = 'admin');

drop policy if exists p_photo_read on public.visit_photos;
create policy p_photo_read on public.visit_photos for select
  using (exists (select 1 from public.visits v where v.id = visit_id));       -- 跟隨訪查紀錄的可見性
drop policy if exists p_photo_write on public.visit_photos;
create policy p_photo_write on public.visit_photos for all
  using (exists (select 1 from public.visits v where v.id = visit_id and (v.user_id = auth.uid() or public.is_reviewer())))
  with check (exists (select 1 from public.visits v where v.id = visit_id and v.user_id = auth.uid()));

drop policy if exists p_plan_read on public.visit_plans;
create policy p_plan_read on public.visit_plans for select using (true);       -- 預計到訪公開，供統計
drop policy if exists p_plan_write on public.visit_plans;
create policy p_plan_write on public.visit_plans for all
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_expert());

drop policy if exists p_audit_read on public.audit_log;
create policy p_audit_read on public.audit_log for select using (public.is_reviewer());

-- ---------- 統計檢視表（只計公開紀錄） ----------
create or replace view public.v_site_stats as
select county_slug, site_id,
       count(*)::int                         as visits,
       max(visit_date)                        as last_visit,
       round(avg(recommend)::numeric, 2)      as avg_recommend,
       (array_agg(condition order by visit_date desc))[1]   as last_condition,
       (array_agg(open_status order by visit_date desc))[1] as last_open_status
from public.visits where status = 'published'
group by county_slug, site_id;

create or replace view public.v_expert_stats as
select p.id, p.display_name, p.regions, p.role, p.created_at,
       coalesce(v.published, 0)  as published,
       coalesce(v.sites, 0)      as sites,
       coalesce(v.counties, 0)   as counties,
       v.last_visit,
       coalesce(pl.planned, 0)   as planned,
       coalesce(pl.done, 0)      as plans_done,
       coalesce(pl.overdue, 0)   as plans_overdue
from public.profiles p
left join (select user_id, count(*)::int published, count(distinct county_slug || '/' || site_id)::int sites,
                  count(distinct county_slug)::int counties, max(visit_date) last_visit
           from public.visits where status = 'published' group by user_id) v on v.user_id = p.id
left join (select user_id, count(*) filter (where status <> 'cancelled')::int planned,
                  count(*) filter (where status = 'done')::int done,
                  count(*) filter (where status = 'planned' and coalesce(planned_end, planned_date) < current_date)::int overdue
           from public.visit_plans group by user_id) pl on pl.user_id = p.id
where p.role in ('expert','reviewer','admin');

grant select on public.v_site_stats, public.v_expert_stats to anon, authenticated;

-- ---------- Storage：照片 bucket ----------
insert into storage.buckets (id, name, public) values ('visit-photos', 'visit-photos', true)
on conflict (id) do nothing;
drop policy if exists s_photo_insert on storage.objects;
create policy s_photo_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'visit-photos' and public.is_expert() and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists s_photo_delete on storage.objects;
create policy s_photo_delete on storage.objects for delete to authenticated
  using (bucket_id = 'visit-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_reviewer()));
