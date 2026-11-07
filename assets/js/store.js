/* 資料存取層：同一組介面，兩種實作
 *   DemoStore     示範模式，資料存在瀏覽器 localStorage，可切換身分試用
 *   SupabaseStore 正式模式，Supabase（Auth、Postgres＋RLS、Storage）
 * 介面（全部回傳 Promise）：
 *   init() / me() / signIn(arg) / signOut() / updateProfile(patch)
 *   listVisits({county, site, user, status, limit}) / getVisit(id) / saveVisit(data, photos) / deleteVisit(id) / reviewVisit(id, status, note)
 *   siteStats() → { "slug/id": {visits, last_visit, avg_recommend, last_condition, last_open_status} }
 *   expertStats() / listProfiles() / setRole(id, role, trusted)
 *   listPlans({user, county, site}) / savePlan(data) / savePlans([data]) / updatePlan(id, patch) / updatePlans([id], patch)
 *     預計到訪可帶 trip（行程名稱）與 planned_end（行程結束日），同一趟行程的多處文資一起登記
 *   applyExpert(data) / myApplications() / listApplications(status) / reviewApplication(id, status, note)
 *   auditLog()
 * photos：[{blob, caption, license}]，blob 已在前端縮圖、移除 EXIF。 */
(function () {
  "use strict";
  var CFG = window.VISIT_CONFIG;

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function blobToDataUrl(b) {
    return new Promise(function (ok, no) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = no; r.readAsDataURL(b); });
  }
  function aggSites(visits) {
    var m = {};
    visits.filter(function (v) { return v.status === "published"; })
      .sort(function (a, b) { return a.visit_date < b.visit_date ? 1 : -1; })
      .forEach(function (v) {
        var k = v.county_slug + "/" + v.site_id, s = m[k];
        if (!s) s = m[k] = { visits: 0, last_visit: v.visit_date, sum: 0, last_condition: v.condition, last_open_status: v.open_status };
        s.visits++; s.sum += v.recommend;
      });
    Object.keys(m).forEach(function (k) { m[k].avg_recommend = Math.round(m[k].sum / m[k].visits * 100) / 100; delete m[k].sum; });
    return m;
  }
  function aggExperts(profiles, visits, plans) {
    var t = today();
    return profiles.filter(function (p) { return p.role !== "member"; }).map(function (p) {
      var vs = visits.filter(function (v) { return v.user_id === p.id && v.status === "published"; });
      var ps = plans.filter(function (x) { return x.user_id === p.id; });
      var sites = {}, cs = {}, last = null;
      vs.forEach(function (v) { sites[v.county_slug + "/" + v.site_id] = 1; cs[v.county_slug] = 1; if (!last || v.visit_date > last) last = v.visit_date; });
      return {
        id: p.id, display_name: p.display_name, regions: p.regions || [], role: p.role, created_at: p.created_at,
        published: vs.length, sites: Object.keys(sites).length, counties: Object.keys(cs).length, last_visit: last,
        planned: ps.filter(function (x) { return x.status !== "cancelled"; }).length,
        plans_done: ps.filter(function (x) { return x.status === "done"; }).length,
        plans_overdue: ps.filter(function (x) { return x.status === "planned" && (x.planned_end || x.planned_date) < t; }).length
      };
    });
  }

  /* ======================= 示範模式 ======================= */
  var KEY = "chv-demo-v1";
  var PERSONAS = [
    { id: "demo-allan", display_name: "Allan Lo", role: "admin", trusted: true, regions: ["chiayi-city", "tainan-city", "taipei-city"], bio: "文資網站規劃者，主要更新者與審查者。" },
    { id: "demo-expert", display_name: "示範達人・小林", role: "expert", trusted: false, regions: ["taipei-city", "new-taipei-city"], bio: "（示範帳號）喜歡老街與日式建築。" },
    { id: "demo-member", display_name: "示範會員・阿美", role: "member", trusted: false, regions: [], bio: "（示範帳號）想申請成為達人。" }
  ];
  function seed() {
    var now = new Date().toISOString();
    var profiles = PERSONAS.map(function (p) { return Object.assign({ created_at: now }, p); });
    function v(user, county, site, name, cat, date, cond, open, rec, body, extra) {
      return Object.assign({
        id: uuid(), user_id: user, county_slug: county, site_id: site, site_name: name, category: cat, visit_date: date,
        condition: cond, open_status: open, recommend: rec, scores: { history: rec, preserve: rec, interpret: 3, friendly: 4, access: 4 },
        body: body, tips: "", fee: "免費", mood: "愉快",
        nearby: [{ type: "美食", name: "【示範】附近小吃店", note: "示範資料：達人可以推薦訪查順路的美食、住宿、交通或其他資訊。", link: "" }], duration_min: 40, crowd: "適中", accessible: "部分", correction: "", plan_id: null,
        status: "published", review_note: null, created_at: now, updated_at: now, demo: true, photos: []
      }, extra || {});
    }
    var visits = [
      v("demo-allan", "chiayi-city", "renwu", "嘉義仁武宮", "市定古蹟", "2026-10-12", "良好", "正常開放", 4,
        "【示範資料】這是示範模式的範例紀錄，用來展示版面。正式上線後會由核准的達人填寫真實訪查心得：例如三川殿龍柱、門神彩繪的保存情形，廟方是否提供解說牌，周邊停車與步行動線等。"),
      v("demo-expert", "taipei-city", "zhongzheng-zongtongfu", "總統府", "國定古蹟", "2026-09-20", "良好", "限時或預約", 5,
        "【示範資料】範例紀錄：說明開放參觀的時段、預約方式、安檢流程、導覽解說品質，以及現場可以拍照的範圍。此筆由示範達人帳號建立。"),
      v("demo-expert", "taipei-city", "zhongzheng-zongtongfu", "總統府", "國定古蹟", "2026-11-01", "良好", "限時或預約", 4,
        "【示範資料】待審範例：一般達人送出的紀錄會先進入審查佇列，審查者核准後才公開。", { status: "pending" })
    ];
    var plans = [
      { id: uuid(), user_id: "demo-expert", county_slug: "taipei-city", site_id: "zhongzheng-zongtongfu", site_name: "總統府", planned_date: "2026-09-20", note: "", status: "done", visit_id: visits[1].id, created_at: now },
      { id: uuid(), user_id: "demo-allan", county_slug: "tainan-city", site_id: "zhongxi-kongzimiao", site_name: "臺南孔子廟", planned_date: "2026-12-05", note: "【示範】年底回訪", status: "planned", visit_id: null, created_at: now },
      { id: uuid(), user_id: "demo-allan", county_slug: "kinmen-county", site_id: "jincheng-wentaibaota", site_name: "文臺寶塔", planned_date: "2026-11-07", planned_end: "2026-11-10", trip: "【示範】金門行", note: "", status: "planned", visit_id: null, created_at: now },
      { id: uuid(), user_id: "demo-allan", county_slug: "kinmen-county", site_id: "jincheng-qiulianggongmujie", site_name: "邱良功母節孝坊", planned_date: "2026-11-07", planned_end: "2026-11-10", trip: "【示範】金門行", note: "", status: "planned", visit_id: null, created_at: now },
      { id: uuid(), user_id: "demo-allan", county_slug: "kinmen-county", site_id: "jinhu-qionglincaishici", site_name: "瓊林蔡氏祠堂", planned_date: "2026-11-07", planned_end: "2026-11-10", trip: "【示範】金門行", note: "", status: "planned", visit_id: null, created_at: now },
      { id: uuid(), user_id: "demo-expert", county_slug: "new-taipei-city", site_id: "danshui-hongmaocheng", site_name: "淡水紅毛城", planned_date: "2026-10-15", note: "【示範】逾期未完成的預計到訪", status: "planned", visit_id: null, created_at: now }
    ];
    var apps = [
      { id: uuid(), user_id: "demo-member", display_name: "示範會員・阿美", real_name: "（示範）", contact: "（示範）", regions: ["kaohsiung-city"], expertise: "【示範】地方文史工作室志工，帶過十年古蹟導覽。", sample_url: "", agree_terms: true, status: "pending", review_note: null, created_at: now }
    ];
    return { profiles: profiles, visits: visits, plans: plans, apps: apps, audit: [], session: "demo-allan" };
  }

  function DemoStore() {
    var db;
    function load() { try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; } if (!db || !db.profiles) db = seed(); }
    function save() {
      try { localStorage.setItem(KEY, JSON.stringify(db)); }
      catch (e) { throw new Error("瀏覽器儲存空間已滿（示範模式的照片存在本機），請刪除部分示範紀錄或照片後再試。"); }
    }
    function me() { return db.profiles.filter(function (p) { return p.id === db.session; })[0] || null; }
    function role() { var m = me(); return m ? m.role : "anon"; }
    function isReviewer() { return role() === "reviewer" || role() === "admin"; }
    function isExpert() { return ["expert", "reviewer", "admin"].indexOf(role()) >= 0; }
    function audit(action, type, id, detail) { db.audit.unshift({ id: db.audit.length + 1, actor: db.session, action: action, target_type: type, target_id: id, detail: detail, at: new Date().toISOString() }); }
    function withAuthor(v) {
      var p = db.profiles.filter(function (x) { return x.id === v.user_id; })[0];
      return Object.assign({}, v, { author: p ? p.display_name : "（已刪除）" });
    }
    function visible(v) { return v.status === "published" || v.user_id === db.session || isReviewer(); }
    var P = Promise.resolve.bind(Promise);
    function need(cond, msg) { if (!cond) throw new Error(msg); }

    return {
      mode: "demo",
      personas: PERSONAS,
      init: function () { load(); return P(); },
      me: function () { return P(me()); },
      signIn: function (id) { db.session = id || null; save(); return P(me()); },
      signOut: function () { db.session = null; save(); return P(); },
      reset: function () { localStorage.removeItem(KEY); load(); return P(); },
      updateProfile: function (patch) {
        var m = me(); need(m, "請先登入");
        ["display_name", "bio", "regions"].forEach(function (k) { if (k in patch) m[k] = patch[k]; });
        save(); return P(m);
      },
      listVisits: function (f) {
        f = f || {};
        var r = db.visits.filter(visible).filter(function (v) {
          return (!f.county || v.county_slug === f.county) && (!f.site || v.site_id === f.site) &&
            (!f.user || v.user_id === f.user) && (!f.status || v.status === f.status);
        }).sort(function (a, b) { return a.visit_date === b.visit_date ? (a.created_at < b.created_at ? 1 : -1) : (a.visit_date < b.visit_date ? 1 : -1); });
        if (f.limit) r = r.slice(0, f.limit);
        return P(r.map(withAuthor));
      },
      getVisit: function (id) { var v = db.visits.filter(function (x) { return x.id === id && visible(x); })[0]; return P(v ? withAuthor(v) : null); },
      saveVisit: function (data, photos) {
        var m = me();
        return Promise.all((photos || []).map(function (p) {
          return Promise.all([blobToDataUrl(p.blob), p.thumb ? blobToDataUrl(p.thumb) : null]).then(function (u) { return { url: u[0], thumb: u[1], caption: p.caption, license: p.license }; });
        }))
          .then(function (ph) {
            need(isExpert(), "只有核准的達人可以新增訪查紀錄");
            var v;
            if (data.id) {
              v = db.visits.filter(function (x) { return x.id === data.id; })[0];
              need(v && (v.user_id === m.id || isReviewer()), "不能修改別人的紀錄");
              Object.assign(v, data, { updated_at: new Date().toISOString() });
              if (!isReviewer()) v.status = v.status === "hidden" ? "hidden" : (m.trusted ? "published" : "pending");
              v.photos = (data.keepPhotos || v.photos || []).concat(ph);
              delete v.keepPhotos;
            } else {
              v = Object.assign({ id: uuid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), review_note: null }, data,
                { user_id: m.id, status: m.trusted ? "published" : "pending", photos: ph });
              delete v.keepPhotos;
              db.visits.push(v);
            }
            // 完成對應的預計到訪：指定的那筆，以及自己同一處文資其他未完成的預計
            db.plans.forEach(function (p) {
              if (p.user_id === v.user_id && p.status === "planned" && (p.id === v.plan_id || (p.county_slug === v.county_slug && p.site_id === v.site_id))) { p.status = "done"; p.visit_id = v.id; }
            });
            save(); return withAuthor(v);
          });
      },
      deleteVisit: function (id) {
        var v = db.visits.filter(function (x) { return x.id === id; })[0];
        need(v && ((v.user_id === db.session && v.status !== "published") || role() === "admin"), "沒有刪除權限（已公開的紀錄請由管理者下架）");
        db.visits = db.visits.filter(function (x) { return x.id !== id; });
        audit("visit_delete", "visit", id, null); save(); return P();
      },
      reviewVisit: function (id, status, note) {
        need(isReviewer(), "只有審查者可以審核");
        var v = db.visits.filter(function (x) { return x.id === id; })[0];
        v.status = status; v.review_note = note || null; v.reviewer_id = db.session; v.reviewed_at = new Date().toISOString();
        audit("visit_" + status, "visit", id, { note: note }); save(); return P(withAuthor(v));
      },
      siteStats: function () { return P(aggSites(db.visits)); },
      expertStats: function () { return P(aggExperts(db.profiles, db.visits, db.plans)); },
      listProfiles: function () { need(isReviewer(), "沒有權限"); return P(db.profiles.slice()); },
      setRole: function (id, r, trusted) {
        need(role() === "admin", "只有管理者可以調整角色");
        var p = db.profiles.filter(function (x) { return x.id === id; })[0];
        audit("role_change", "profile", id, { from: p.role, to: r, trusted: trusted });
        p.role = r; p.trusted = !!trusted; save(); return P(p);
      },
      listPlans: function (f) {
        f = f || {};
        return P(db.plans.filter(function (p) {
          return (!f.user || p.user_id === f.user) && (!f.county || p.county_slug === f.county) && (!f.site || p.site_id === f.site);
        }).map(withAuthor).sort(function (a, b) { return a.planned_date < b.planned_date ? -1 : 1; }));
      },
      savePlan: function (d) {
        need(isExpert(), "只有核准的達人可以登記預計到訪");
        var p = Object.assign({ id: uuid(), user_id: db.session, status: "planned", visit_id: null, created_at: new Date().toISOString() }, d);
        db.plans.push(p); save(); return P(p);
      },
      savePlans: function (list) {
        need(isExpert(), "只有核准的達人可以登記預計到訪");
        var out = list.map(function (d) { var p = Object.assign({ id: uuid(), user_id: db.session, status: "planned", visit_id: null, created_at: new Date().toISOString() }, d); db.plans.push(p); return p; });
        save(); return P(out);
      },
      updatePlans: function (ids, patch) {
        var ps = db.plans.filter(function (x) { return ids.indexOf(x.id) >= 0; });
        need(ps.every(function (p) { return p.user_id === db.session; }), "只能修改自己的預計到訪");
        ps.forEach(function (p) { Object.assign(p, patch); }); save(); return P(ps);
      },
      updatePlan: function (id, patch) {
        var p = db.plans.filter(function (x) { return x.id === id; })[0];
        need(p && p.user_id === db.session, "只能修改自己的預計到訪");
        Object.assign(p, patch); save(); return P(p);
      },
      applyExpert: function (d) {
        var m = me(); need(m, "請先登入");
        need(!db.apps.some(function (a) { return a.user_id === m.id && a.status === "pending"; }), "你已經有一筆審查中的申請");
        var a = Object.assign({ id: uuid(), user_id: m.id, status: "pending", review_note: null, created_at: new Date().toISOString() }, d);
        db.apps.push(a); save(); return P(a);
      },
      myApplications: function () { return P(db.apps.filter(function (a) { return a.user_id === db.session; })); },
      listApplications: function (status) {
        need(isReviewer(), "沒有權限");
        return P(db.apps.filter(function (a) { return !status || a.status === status; }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }));
      },
      reviewApplication: function (id, status, note) {
        need(isReviewer(), "只有審查者可以審核");
        var a = db.apps.filter(function (x) { return x.id === id; })[0];
        a.status = status; a.review_note = note || null; a.reviewer_id = db.session; a.reviewed_at = new Date().toISOString();
        if (status === "approved") db.profiles.forEach(function (p) {
          if (p.id === a.user_id) { if (p.role === "member") p.role = "expert"; p.display_name = a.display_name; p.regions = a.regions; }
        });
        audit("application_" + status, "application", id, { user: a.user_id, note: note }); save(); return P(a);
      },
      auditLog: function () {
        need(isReviewer(), "沒有權限");
        return P(db.audit.map(function (x) { var p = db.profiles.filter(function (y) { return y.id === x.actor; })[0]; return Object.assign({ actor_name: p ? p.display_name : x.actor }, x); }));
      }
    };
  }

  /* ======================= 正式模式（Supabase） ======================= */
  function SupabaseStore() {
    var sb, profile = null, BUCKET = "visit-photos";
    function chk(r) { if (r.error) throw new Error(r.error.message); return r.data; }
    function photoUrl(path) { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; }
    /* 小圖與大圖放在一起，檔名加 -t（例如 123-0.jpg → 123-0-t.jpg）；舊照片沒有小圖，網頁會自動改用大圖 */
    function thumbPath(path) { return path.replace(/\.jpg$/, "-t.jpg"); }
    function withThumbs(paths) { return paths.reduce(function (a, p) { return a.concat([p, thumbPath(p)]); }, []); }
    var SEL = "*, author:profiles!visits_user_id_fkey(display_name), visit_photos(path, caption, license, ord)";
    function shape(v) {
      v.author = v.author ? v.author.display_name : "";
      v.photos = (v.visit_photos || []).sort(function (a, b) { return a.ord - b.ord; })
        .map(function (p) { return { url: photoUrl(p.path), thumb: photoUrl(thumbPath(p.path)), path: p.path, caption: p.caption, license: p.license }; });
      delete v.visit_photos; return v;
    }
    /* 讀取登入者：用 getSession（本機讀取，token 過期才連線換新），比 getUser（每次連線）快，也比較不會卡。
     * 資料權限一律由伺服器端 RLS 驗證，前端只用來決定畫面。 */
    function loadProfile() {
      return sb.auth.getSession().then(function (r) {
        var u = r.data && r.data.session && r.data.session.user;
        if (!u) { profile = null; return null; }
        return sb.from("profiles").select("*").eq("id", u.id).single().then(function (x) { profile = x.data || null; if (profile) profile.email = u.email; return profile; });
      });
    }
    /* 登入狀態的鎖只在本分頁內排隊。supabase-js 預設用瀏覽器的 navigator.locks 跨分頁共用一把鎖，
     * iPhone／iPad 的 Safari 核心在背景分頁被暫停時可能一直不放鎖，新開的分頁就永遠停在「載入中」 */
    var LOCKS = {};
    function tabLock(name, acquireTimeout, fn) {
      var prev = LOCKS[name] || Promise.resolve();
      var run = prev.then(fn, fn);
      LOCKS[name] = run.then(function () {}, function () {});
      return run;
    }
    function notify() { window.dispatchEvent(new Event("chv-auth")); }
    var authSlow = false;
    return {
      mode: "supabase",
      authSlow: function () { return authSlow; },
      init: function () {
        var main = sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { lock: tabLock } });
        // 事件處理裡不能直接呼叫其他 auth 方法（會和觸發事件的那個呼叫互等），延到下一輪再做
        sb.auth.onAuthStateChange(function (ev) {
          if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") setTimeout(function () { loadProfile().then(notify, notify); }, 0);
        });
        // 8 秒內讀不到登入狀態（例如換新 token 的連線卡住），先以訪客身分開啟網站：
        // 改用一個不帶登入資訊的連線讀公開資料（否則每個查詢都會等那個卡住的 token）；之後登入狀態讀到了再換回來、更新畫面
        var settled = false;
        function back() { sb = main; authSlow = false; notify(); }
        var real = loadProfile().then(function (p) { if (settled) back(); settled = true; return p; },
          function (e) { console.warn("讀取登入狀態失敗", e); profile = null; if (settled) back(); settled = true; return null; });
        var timer = new Promise(function (ok) {
          setTimeout(function () {
            if (settled) return;
            settled = true; authSlow = true; profile = null;
            sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey,
              { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "chv-visitor", lock: tabLock } });
            ok(null);
          }, 8000);
        });
        return Promise.race([real, timer]);
      },
      me: function () { return Promise.resolve(profile); },
      signIn: function (email) {
        return sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname } }).then(chk);
      },
      signOut: function () { return sb.auth.signOut().then(function () { profile = null; }); },
      updateProfile: function (patch) {
        return sb.from("profiles").update({ display_name: patch.display_name, bio: patch.bio, regions: patch.regions }).eq("id", profile.id).select().single()
          .then(chk).then(function (p) { profile = Object.assign(profile, p); return profile; });
      },
      listVisits: function (f) {
        f = f || {};
        var q = sb.from("visits").select(SEL).order("visit_date", { ascending: false }).order("created_at", { ascending: false });
        if (f.county) q = q.eq("county_slug", f.county);
        if (f.site) q = q.eq("site_id", f.site);
        if (f.user) q = q.eq("user_id", f.user);
        if (f.status) q = q.eq("status", f.status);
        if (f.limit) q = q.limit(f.limit);
        return q.then(chk).then(function (r) { return r.map(shape); });
      },
      getVisit: function (id) { return sb.from("visits").select(SEL).eq("id", id).maybeSingle().then(chk).then(function (v) { return v && shape(v); }); },
      saveVisit: function (data, photos) {
        var keep = data.keepPhotos, row = Object.assign({}, data);
        ["id", "keepPhotos", "photos", "author", "status", "user_id", "created_at", "updated_at", "review_note", "reviewer_id", "reviewed_at"].forEach(function (k) { delete row[k]; });
        var q = data.id ? sb.from("visits").update(row).eq("id", data.id) : sb.from("visits").insert(row);
        return q.select().single().then(chk).then(function (v) {
          var jobs = [];
          if (data.id && keep) {
            // 刪掉使用者移除的照片
            jobs.push(sb.from("visit_photos").select("id,path").eq("visit_id", v.id).then(chk).then(function (old) {
              var keepPaths = keep.map(function (k) { return k.path; });
              var gone = old.filter(function (o) { return keepPaths.indexOf(o.path) < 0; });
              if (!gone.length) return;
              return Promise.all([
                sb.from("visit_photos").delete().in("id", gone.map(function (g) { return g.id; })),
                sb.storage.from(BUCKET).remove(withThumbs(gone.map(function (g) { return g.path; })))
              ]);
            }));
          }
          var base = (keep || []).length;
          (photos || []).forEach(function (p, i) {
            var path = profile.id + "/" + v.id + "/" + Date.now() + "-" + i + ".jpg";
            jobs.push(Promise.all([
              sb.storage.from(BUCKET).upload(path, p.blob, { contentType: "image/jpeg", upsert: false }).then(chk),
              p.thumb ? sb.storage.from(BUCKET).upload(thumbPath(path), p.thumb, { contentType: "image/jpeg", upsert: false }).then(chk) : null
            ]).then(function () {
              return sb.from("visit_photos").insert({ visit_id: v.id, path: path, caption: p.caption, license: p.license, ord: base + i }).then(chk);
            }));
          });
          if (data.plan_id) jobs.push(sb.from("visit_plans").update({ status: "done", visit_id: v.id }).eq("id", data.plan_id).then(chk));
          jobs.push(sb.from("visit_plans").update({ status: "done", visit_id: v.id }).eq("user_id", v.user_id).eq("status", "planned")
            .eq("county_slug", v.county_slug).eq("site_id", v.site_id).then(chk));
          return Promise.all(jobs).then(function () { return v; });
        });
      },
      deleteVisit: function (id) {
        return sb.from("visit_photos").select("path").eq("visit_id", id).then(chk).then(function (ph) {
          return (ph.length ? sb.storage.from(BUCKET).remove(withThumbs(ph.map(function (p) { return p.path; }))) : Promise.resolve())
            .then(function () { return sb.from("visits").delete().eq("id", id).then(chk); });
        });
      },
      reviewVisit: function (id, status, note) { return sb.from("visits").update({ status: status, review_note: note || null }).eq("id", id).select().single().then(chk); },
      siteStats: function () {
        return sb.from("v_site_stats").select("*").then(chk).then(function (r) {
          var m = {}; r.forEach(function (s) { m[s.county_slug + "/" + s.site_id] = s; }); return m;
        });
      },
      expertStats: function () { return sb.from("v_expert_stats").select("*").then(chk); },
      listProfiles: function () { return sb.from("profiles").select("*").order("created_at").then(chk); },
      setRole: function (id, role, trusted) { return sb.from("profiles").update({ role: role, trusted: !!trusted }).eq("id", id).select().single().then(chk); },
      listPlans: function (f) {
        f = f || {};
        var q = sb.from("visit_plans").select("*, author:profiles(display_name)").order("planned_date");
        if (f.user) q = q.eq("user_id", f.user);
        if (f.county) q = q.eq("county_slug", f.county);
        if (f.site) q = q.eq("site_id", f.site);
        return q.then(chk).then(function (r) { return r.map(function (p) { p.author = p.author ? p.author.display_name : ""; return p; }); });
      },
      savePlan: function (d) { return sb.from("visit_plans").insert(d).select().single().then(chk); },
      savePlans: function (list) { return sb.from("visit_plans").insert(list).select().then(chk); },
      updatePlan: function (id, patch) { return sb.from("visit_plans").update(patch).eq("id", id).select().single().then(chk); },
      updatePlans: function (ids, patch) { return ids.length ? sb.from("visit_plans").update(patch).in("id", ids).select().then(chk) : Promise.resolve([]); },
      applyExpert: function (d) { return sb.from("expert_applications").insert(Object.assign({ user_id: profile.id }, d)).select().single().then(chk); },
      myApplications: function () { return profile ? sb.from("expert_applications").select("*").eq("user_id", profile.id).then(chk) : Promise.resolve([]); },
      listApplications: function (status) {
        var q = sb.from("expert_applications").select("*").order("created_at", { ascending: false });
        if (status) q = q.eq("status", status);
        return q.then(chk);
      },
      reviewApplication: function (id, status, note) { return sb.from("expert_applications").update({ status: status, review_note: note || null }).eq("id", id).select().single().then(chk); },
      auditLog: function () {
        return sb.from("audit_log").select("*").order("at", { ascending: false }).limit(300).then(chk).then(function (r) {
          return sb.from("profiles").select("id,display_name").then(chk).then(function (ps) {
            var n = {}; ps.forEach(function (p) { n[p.id] = p.display_name; });
            return r.map(function (x) { x.actor_name = n[x.actor] || x.actor; return x; });
          });
        });
      }
    };
  }

  /* 防呆：config.js 只能放 anon（publishable）key。誤貼 service_role／secret key 時拒絕啟動，避免金鑰在公開網頁上外洩 */
  function isSecretKey(k) {
    if (/^sb_secret_/.test(k)) return true;
    try { return JSON.parse(atob(k.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role === "service_role"; } catch (e) { return false; }
  }
  if (CFG.supabaseAnonKey && isSecretKey(CFG.supabaseAnonKey)) {
    throw new Error("config.js 填的是 service_role／secret key，這把金鑰不能放在網頁上。請立刻到 Supabase 重新產生（rotate）這把金鑰，改填 anon（publishable）key。");
  }
  window.Store = CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase ? SupabaseStore() : DemoStore();
})();
