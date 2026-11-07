/* 文資達人訪查 — 單頁應用
 * 路由（網址 # 後面）：
 *   home                     總覽
 *   coverage[/<類別>]        查核資訊：各縣市文資數、已訪查數、覆蓋率（類別 site 有形文資／ich 無形文資／antiquity 古物，分開統計）
 *   county/<縣市>[/<類別>]   縣市文資清單（可篩選未訪查、需回訪），可規劃訪查行程
 *   site/<縣市>/<id>          單一文資的現況與所有紀錄。有形文資對應知識網站 <網站>/<縣市>/#map/<景點 id>；
 *                            無形文資與古物對應知識網站的展示點 #map/<展示點 id>（沒有固定地點的無形文資連到縣市首頁）
 *   venue/<縣市>/<展示點 id>  展示點：該處的無形文資與古物（知識網站展示點的「達人紀錄」按鈕連到這裡）
 *   visit/<紀錄 id>          單筆訪查紀錄
 *   experts、expert/<id>      達人列表、達人個人統計（預計與實際到訪）
 *   latest                   最新紀錄
 *   submit/<縣市>/<景點 id>   新增訪查紀錄；edit/<紀錄 id> 修改
 *   mine                     我的訪查、預計到訪、個人資料
 *   apply                    申請成為達人；login 登入；admin 審查；about 關於 */
(function () {
  "use strict";
  var CFG = window.VISIT_CONFIG, S = window.Store;
  if (!S) { document.getElementById("view").innerHTML = '<div class="notice bad">網站設定錯誤，無法啟動：請檢查 assets/js/config.js 的 Supabase 金鑰（只能填 anon／publishable key）。</div>'; return; }
  var IDX, COUNTY = {}, SITE = {}, ME = null, STATS = null;
  var view = document.getElementById("view");

  /* ---------- 小工具 ---------- */
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 : 0; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function daysAgo(d) { return Math.floor((Date.now() - new Date(d + "T00:00:00").getTime()) / 864e5); }
  function stars(n) { n = Math.round(n || 0); var s = ""; for (var i = 1; i <= 5; i++) s += i <= n ? "★" : '<span class="off">★</span>'; return '<span class="stars" aria-label="推薦 ' + n + ' 顆星">' + s + "</span>"; }
  /* ---------- 阿拉蕾（AI 小助手）：依情境換表情與台詞 ----------
   * 表情：explain 說明、laugh 開心、thumb 比讚、fight 加油、think 想一想、surprised 驚訝、confused 疑惑、sad 難過、present 介紹、wave 揮手、stand 站姿 */
  var CH = "assets/characters/";
  function araImg(mood, cls) { return '<img class="' + (cls || "ara-face") + '" src="' + CH + "arale-" + mood + '.webp" alt="阿拉蕾" loading="lazy">'; }
  function ara(mood, html, opt) {
    opt = opt || {};
    return '<div class="ara' + (opt.cls ? " " + opt.cls : "") + '">' + araImg(mood) +
      '<div class="ara-bubble"><span class="ara-name">阿拉蕾</span>' + html + "</div></div>";
  }
  function pickOne(a) { return a[Math.floor(Math.random() * a.length)]; }
  var MOOD_FACE = { "驚喜": "surprised", "感動": "thumb", "愉快": "laugh", "普通": "think", "可惜": "sad" };
  function toast(msg, mood) {
    $$(".toast").forEach(function (x) { x.parentNode.removeChild(x); });   // 新訊息取代舊的，避免重疊
    var t = document.createElement("div"); t.className = "toast" + (mood ? " toast-ara" : "");
    t.innerHTML = (mood ? araImg(mood, "toast-face") : "") + "<span>" + esc(msg) + "</span>";
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3600);
  }
  function fail(e) { console.error(e); toast(e && e.message || String(e), "confused"); }
  function roleOf() { return ME ? ME.role : "anon"; }
  function isExpert() { return ["expert", "reviewer", "admin"].indexOf(roleOf()) >= 0; }
  function isReviewer() { return roleOf() === "reviewer" || roleOf() === "admin"; }
  var ROLE = { anon: "訪客", member: "會員", expert: "文資達人", reviewer: "審查者", admin: "管理者" };
  var STATUS = { published: "已公開", pending: "待審", rejected: "退回", hidden: "已下架" };
  /* 三類文化資產：現況選項與資料庫 supabase/migrations/002_ich_antiquity.sql 的檢查條件一致 */
  var KIND = {
    site: { label: "有形文資", unit: "處", verb: "訪查", what: "文化資產", condL: "文資現況", openL: "開放情形",
      conds: ["良好", "尚可", "待修繕", "修復施工中", "閉館或封閉", "已消失或拆除"], opens: ["正常開放", "限時或預約", "僅能看外觀", "未開放"],
      bad: ["閉館或封閉", "已消失或拆除"], warn: ["待修繕", "修復施工中"], color: "var(--teal)",
      desc: "古蹟、歷史建築、紀念建築、聚落、考古遺址、文化景觀" },
    ich: { label: "無形文資", unit: "項", verb: "參與", what: "無形文化資產", condL: "傳承現況", openL: "公開情形",
      conds: ["傳承活躍", "穩定傳承", "傳承人少", "式微或停辦"], opens: ["定期公開舉行", "預約或不定期", "僅限社群內部", "已停辦"],
      bad: ["式微或停辦", "已停辦"], warn: ["傳承人少", "僅限社群內部"], color: "#b8860b",
      desc: "民俗、傳統表演藝術、傳統工藝、口述傳統、保存技術" },
    antiquity: { label: "古物", unit: "件", verb: "觀賞", what: "古物", condL: "保存狀況", openL: "展示情形",
      conds: ["良好", "尚可", "待修護", "未能看到"], opens: ["常設展出", "特展或輪展", "預約參觀", "未公開展示"],
      bad: ["未能看到", "未公開展示"], warn: ["待修護"], color: "#8a6d3b",
      desc: "博物館、廟宇等展示點收藏的國寶、重要古物與一般古物" }
  };
  var KINDS = ["site", "ich", "antiquity"];
  var MODES = ["觀賞祭典", "觀賞演出", "工藝體驗", "參訪工坊", "其他"];
  function kindOf(x) { return (x && x.kind) || "site"; }
  function K(x) { return KIND[typeof x === "string" ? x : kindOf(x)] || KIND.site; }
  var SCORE = { history: "歷史價值", preserve: "保存狀況", interpret: "解說資訊", friendly: "參觀友善", access: "交通便利" };
  var LICENSES = ["CC BY-SA 4.0", "CC BY 4.0", "CC0", "保留所有權利"];
  var MOODS = { "驚喜": "🤩", "感動": "🥹", "愉快": "😊", "普通": "🙂", "可惜": "😔" };
  var NEARBY = ["美食", "住宿", "交通", "景點", "其他"];
  function planEnd(p) { return p.planned_end || p.planned_date; }
  function planRange(p) { return p.planned_end && p.planned_end !== p.planned_date ? p.planned_date + " ～ " + p.planned_end.slice(5) : p.planned_date; }
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : ""; }
  function nearbyList(items, withSrc) {
    return '<ul class="nearby">' + items.map(function (n) {
      var u = safeUrl(n.link);
      return '<li><span class="tag nb-' + esc(n.type) + '">' + esc(n.type) + "</span><b>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(n.name) + " ↗</a>" : esc(n.name)) + "</b>" +
        (n.note ? "　" + esc(n.note) : "") + (withSrc && n.src ? ' <small class="muted">— ' + n.src + "</small>" : "") + "</li>";
    }).join("") + "</ul>";
  }
  /* Google 地圖多點路線（最多 10 點），依傳入順序 */
  function routeUrl(sites) {
    var pts = sites.filter(function (x) { return x && x.lat; }).slice(0, 10).map(function (x) { return x.lat + "," + x.lng; });
    if (!pts.length) return "";
    var u = "https://www.google.com/maps/dir/?api=1&destination=" + pts[pts.length - 1];
    if (pts.length > 1) u += "&waypoints=" + encodeURIComponent(pts.slice(0, -1).join("|"));
    return u;
  }

  /* 知識網站的對應頁：有形文資→景點；無形文資、古物→展示點（沒有固定地點的無形文資→縣市首頁） */
  function knowledgeUrl(slug, id) {
    var c = COUNTY[slug]; if (!c) return CFG.knowledgeHome;
    var it = id && SITE[slug + "/" + id];
    if (it && it.kind !== "site") return c.base + (it.venueId ? "#map/" + encodeURIComponent(it.venueId) : "");
    return c.base + (id ? "#map/" + encodeURIComponent(id) : "");
  }
  function officialUrl(u) { return u && u.charAt(0) === "~" ? IDX.meta.officialPrefix + u.slice(1) : u; }
  function site(slug, id) { return SITE[slug + "/" + id]; }
  function kindTag(x) { var k = kindOf(x); return k === "site" ? "" : '<span class="tag kind-' + k + '">' + KIND[k].label + "</span>"; }
  /* 全臺三類合計，供首頁與查核資訊使用 */
  function totals(plans) {
    var T = {};
    KINDS.forEach(function (k) {
      var t = T[k] = { total: 0, visited: 0, fresh: 0, stale: 0, visits: 0, planned: 0 };
      IDX.counties.forEach(function (c) { var x = coverage(c, plans, k); Object.keys(t).forEach(function (f) { t[f] += x[f]; }); });
    });
    return T;
  }
  function kindCards(T, linkBase) {
    return '<div class="kind-cards">' + KINDS.map(function (k) {
      var t = T[k], P = pct(t.visited, t.total);
      return '<a class="kind-card kc-' + k + '" href="' + linkBase + k + '"><span class="kc-label">' + KIND[k].label + "</span>" +
        '<span class="kc-total"><b>' + t.total.toLocaleString() + "</b> " + KIND[k].unit + "</span>" +
        '<span class="kc-done">已' + KIND[k].verb + " <b>" + t.visited.toLocaleString() + "</b> " + KIND[k].unit + "・" + P + "%</span>" +
        '<span class="bar"><i style="width:' + P + '%;background:' + KIND[k].color + '"></i></span><span class="kc-desc">' + KIND[k].desc + "</span></a>";
    }).join("") + "</div>";
  }
  function siteLink(v) { return '<a href="#site/' + v.county_slug + "/" + encodeURIComponent(v.site_id) + '">' + esc(v.site_name) + "</a>"; }
  function stTag(s) { return '<span class="tag st-' + s + '">' + STATUS[s] + "</span>"; }

  /* ---------- 文資清單 ---------- */
  function loadIndex() {
    return fetch("data/heritage-index.json").then(function (r) { return r.json(); }).then(function (d) {
      IDX = d;
      d.counties.forEach(function (c) {
        COUNTY[c.slug] = c;
        c.list = c.sites.map(function (a) {
          var s = { kind: "site", slug: c.slug, id: a[0], name: a[1], category: a[2], town: a[3], lat: a[4], lng: a[5], short: a[6] || a[1], url: officialUrl(a[7]) };
          SITE[c.slug + "/" + s.id] = s; return s;
        });
        c.venueMap = {};
        (c.venues || []).forEach(function (v) { c.venueMap[v[0]] = { id: v[0], name: v[1], lat: v[2], lng: v[3], relatedSiteId: v[4], address: v[5] }; });
        function item(kind, a) {
          var v = c.venueMap[a[3]] || null;
          var s = { kind: kind, slug: c.slug, id: a[0], name: a[1], short: a[1], category: a[2], venueId: a[3], venue: v, town: "",
            lat: v ? v.lat : null, lng: v ? v.lng : null };
          SITE[c.slug + "/" + s.id] = s; return s;
        }
        c.ichList = (c.ich || []).map(function (a) { return item("ich", a); });
        c.antiList = (c.anti || []).map(function (a) { return item("antiquity", a); });
        c.byKind = { site: c.list, ich: c.ichList, antiquity: c.antiList };
      });
    });
  }
  function refreshStats() { return S.siteStats().then(function (m) { STATS = m; }); }

  /* 縣市覆蓋統計 */
  function coverage(c, plans, kind) {
    var list = c.byKind[kind || "site"];
    var r = { total: list.length, visited: 0, fresh: 0, stale: 0, visits: 0, planned: 0, cats: {} };
    var plannedSet = {};
    (plans || []).forEach(function (p) { if (p.county_slug === c.slug && p.status === "planned") plannedSet[p.site_id] = 1; });
    list.forEach(function (s) {
      var st = STATS[c.slug + "/" + s.id], k = r.cats[s.category] || (r.cats[s.category] = { total: 0, visited: 0 });
      k.total++;
      if (st) { r.visited++; k.visited++; r.visits += st.visits; if (daysAgo(st.last_visit) <= 365) r.fresh++; if (daysAgo(st.last_visit) > CFG.staleDays) r.stale++; }
      if (plannedSet[s.id]) r.planned++;
    });
    return r;
  }

  /* ---------- 版頭、身分 ---------- */
  function renderChrome() {
    $$("#nav a[data-need]").forEach(function (a) { a.hidden = a.dataset.need === "expert" ? !isExpert() : !isReviewer(); });
    var who = $("#who");
    if (ME) who.innerHTML = '<span>' + esc(ME.display_name) + ' <span class="tag">' + ROLE[ME.role] + "</span></span>" +
      (S.mode === "supabase" ? '<button class="btn btn-sm" id="out">登出</button>' : "");
    else who.innerHTML = S.mode === "supabase" ? '<a class="btn btn-sm btn-p" href="#login">達人登入</a>' : "";
    var o = $("#out"); if (o) o.onclick = function () { S.signOut().then(function () { ME = null; renderChrome(); route(); }); };
    if (S.mode === "demo") {
      var bar = $("#demoBar"); bar.hidden = false;
      bar.innerHTML = '<div class="wrap"><b>示範模式</b><span>資料只存在這台電腦的瀏覽器，尚未連接資料庫。切換身分試用：</span>' +
        '<select id="persona"><option value="">訪客（未登入）</option>' + S.personas.map(function (p) {
          return '<option value="' + p.id + '"' + (ME && ME.id === p.id ? " selected" : "") + ">" + esc(p.display_name) + "（" + ROLE[p.role] + "）</option>";
        }).join("") + '</select><button class="btn btn-sm" id="demoReset" style="background:#fff8e6;color:#2b2521">重設示範資料</button></div>';
      $("#persona").onchange = function () { S.signIn(this.value).then(function (m) { ME = m; renderChrome(); route(); }); };
      $("#demoReset").onclick = function () { if (confirm("清除本機所有示範資料並重新開始？")) S.reset().then(boot); };
    }
    if (isReviewer()) S.listApplications("pending").then(function (a) {
      return S.listVisits({ status: "pending" }).then(function (v) {
        var n = a.length + v.length, el = $('#nav a[data-r="admin"]');
        el.innerHTML = "審查" + (n ? '<span class="cnt">' + n + "</span>" : "");
      });
    }).catch(function () {});
  }

  /* ---------- 路由 ---------- */
  var ROUTES = {};
  function route() {
    var h = (location.hash || "#home").slice(1).split("/").map(decodeURIComponent), name = h[0] || "home";
    $$("#nav a").forEach(function (a) { a.classList.toggle("on", a.dataset.r === name || (name === "county" && a.dataset.r === "coverage") || (name === "expert" && a.dataset.r === "experts")); });
    var fn = ROUTES[name] || ROUTES.home;
    view.innerHTML = '<div class="loading">' + araImg("think", "loading-face") + '<span>阿拉蕾正在翻資料…</span></div>';
    window.scrollTo(0, 0);
    Promise.resolve().then(function () { return fn.apply(null, h.slice(1)); }).catch(function (e) {
      view.innerHTML = ara("confused", "哎呀，出了點問題：" + esc(e.message || e) + '<br><a href="#home">回總覽</a>', { cls: "ara-lg" }); console.error(e);
    });
  }

  /* ---------- 共用片段 ---------- */
  function visitCard(v, opt) {
    opt = opt || {};
    var s = site(v.county_slug, v.site_id), c = COUNTY[v.county_slug], KD = K(v);
    var mine = ME && v.user_id === ME.id;
    return '<article class="visit" id="v-' + v.id + '">' +
      '<div class="visit-h"><h3>' + (opt.showSite ? siteLink(v) + " " + kindTag(v) + '<small class="muted">' + esc(c ? c.label : "") + "</small>" : KD.verb + " " + esc(v.visit_date)) + "</h3>" +
      "<div>" + stars(v.recommend) + " " + (v.status !== "published" ? stTag(v.status) : "") + (v.demo ? '<span class="tag">示範</span>' : "") + "</div></div>" +
      '<p class="meta">' + (opt.showSite ? KD.verb + "日 " + esc(v.visit_date) + "・" : "") + '達人 <a href="#expert/' + v.user_id + '">' + esc(v.author) + "</a>" +
      (v.updated_at && v.updated_at.slice(0, 10) !== v.created_at.slice(0, 10) ? "・更新於 " + v.updated_at.slice(0, 10) : "") + "</p>" +
      '<div class="facts"><span><b>' + KD.condL + '</b><span class="cond-' + esc(v.condition) + '">' + esc(v.condition) + "</span></span><span><b>" + KD.openL + "</b>" + esc(v.open_status) + "</span>" +
      (v.mode ? "<span><b>參與方式</b>" + esc(v.mode) + "</span>" : "") +
      (v.duration_min ? "<span><b>停留</b>約 " + v.duration_min + " 分</span>" : "") + (v.fee ? "<span><b>費用</b>" + esc(v.fee) + "</span>" : "") +
      (v.crowd ? "<span><b>人潮</b>" + esc(v.crowd) + "</span>" : "") + (v.accessible ? "<span><b>無障礙</b>" + esc(v.accessible) + "</span>" : "") + "</div>" +
      '<p class="body">' + (v.mood ? '<span class="mood" title="當天心情">' + (MOOD_FACE[v.mood] ? araImg(MOOD_FACE[v.mood], "mood-face") : "") + esc(v.mood) + "</span>" : "") + esc(opt.short && v.body.length > 160 ? v.body.slice(0, 160) + "…" : v.body) + "</p>" +
      (opt.short && (v.nearby || []).length ? '<p class="small muted">附近推薦：' + v.nearby.map(function (n) { return esc(n.type + "・" + n.name); }).join("、") + "</p>" : "") +
      (opt.short ? "" :
        (v.tips ? '<p><b>參訪建議｜</b>' + esc(v.tips) + "</p>" : "") +
        (v.scores ? '<div class="facts">' + Object.keys(SCORE).filter(function (k) { return v.scores[k]; }).map(function (k) { return "<span><b>" + SCORE[k] + "</b>" + stars(v.scores[k]) + "</span>"; }).join("") + "</div>" : "") +
        ((v.nearby || []).length ? '<div class="d-near"><h4>附近推薦</h4>' + nearbyList(v.nearby) + "</div>" : "") +
        (v.correction ? '<div class="notice"><b>資料勘誤｜</b>' + esc(v.correction) + "</div>" : "") +
        (v.review_note && (mine || isReviewer()) ? '<div class="notice bad"><b>審查意見｜</b>' + esc(v.review_note) + "</div>" : "")) +
      ((v.photos || []).length ? '<div class="photos">' + v.photos.slice(0, opt.short ? 4 : 99).map(function (p) {
        return '<figure><img loading="lazy" src="' + esc(p.url) + '" alt="' + esc(p.caption || v.site_name) + '" data-cap="' + esc((p.caption || "") + "　© " + v.author + "，" + p.license) + '"><figcaption>' + esc(p.caption || "") + "　© " + esc(v.author) + "・" + esc(p.license) + "</figcaption></figure>";
      }).join("") + "</div>" : "") +
      '<div class="btns">' + (opt.short ? '<a class="btn btn-sm" href="#visit/' + v.id + '">閱讀全文</a>' : "") +
      (s ? '<a class="btn btn-sm" href="' + knowledgeUrl(v.county_slug, v.site_id) + '" target="_blank" rel="noopener">' + (s.kind !== "site" && !s.venueId ? "縣市知識頁" : "文資知識頁") + "</a>" : "") +
      ((mine && v.status !== "hidden") || isReviewer() ? '<a class="btn btn-sm" href="#edit/' + v.id + '">修改</a>' : "") + "</div>" +
      "</article>";
  }
  function bindPhotos(el) {
    $$(".photos img", el).forEach(function (img) {
      img.onclick = function () {
        var lb = document.createElement("div"); lb.className = "lightbox";
        lb.innerHTML = '<div><img src="' + img.src + '" alt=""><p>' + esc(img.dataset.cap) + "</p></div>";
        lb.onclick = function () { lb.remove(); }; document.body.appendChild(lb);
      };
    });
  }
  function needLogin(msg) {
    view.innerHTML = ara("confused", "<b>咦，這裡要先登入喔！</b><br>" + esc(msg), { cls: "ara-lg" }) +
      '<p class="btns" style="margin-top:14px">' + (S.mode === "demo" ? "<span>示範模式：請在頁面上方黃色列切換身分。</span>" : '<a class="btn btn-p" href="#login">登入</a>') + "</p>";
  }

  /* ---------- 總覽 ---------- */
  ROUTES.home = function () {
    return Promise.all([refreshStats(), S.listVisits({ status: "published", limit: 6 }), S.expertStats(), S.listPlans({})]).then(function (r) {
      var latest = r[1], experts = r[2], plans = r[3];
      var T = totals(plans), tot = T.site.total, vis = T.site.visited;
      var visits = KINDS.reduce(function (n, k) { return n + T[k].visits; }, 0);
      var rows = IDX.counties.map(function (c) { var k = {}; KINDS.forEach(function (x) { k[x] = coverage(c, plans, x); }); return { c: c, k: k }; });
      var upcoming = plans.filter(function (p) { return p.status === "planned" && planEnd(p) >= today(); });
      view.innerHTML =
        '<section class="hero"><div class="hero-text"><p class="eyebrow">Allan Lo 和你逛文化・姊妹站</p><h1>文化資產的<span class="hl">實地現況</span>與推薦</h1>' +
        '<p>「<a href="' + CFG.knowledgeHome + '" target="_blank" rel="noopener">Allan Lo 和你逛文化</a>」整理了文資局與維基百科的文資知識；這裡由審查核准的<b>文資達人</b>親自走訪，記下每處文化資產現在的樣子：保存現況、開放情形、心得照片、推薦指數，還有附近的好吃好玩。</p>' +
        '<div class="hero-talk">' + homeLine(tot, vis, latest, upcoming) + "</div></div>" +
        '<div class="hero-cast" aria-hidden="true"><img class="cast-allan" src="' + CH + 'allan-wave.webp" alt=""><img class="cast-arale" src="' + CH + 'arale-wave.webp" alt=""></div></section>' +
        kindCards(T, "#coverage/") +
        '<div class="kpis">' + kpi(visits.toLocaleString(), "公開紀錄（筆）") + kpi((T.site.fresh + T.ich.fresh + T.antiquity.fresh).toLocaleString(), "近一年內更新") +
        kpi(upcoming.length, "預計到訪（筆）") + kpi(experts.length, "核准達人（位）") + "</div>" +
        '<div class="btns">' + (isExpert() ? '<a class="btn btn-warm" href="#coverage">挑一處文資去訪查</a>' : '<a class="btn btn-warm" href="#apply">申請成為文資達人</a>') +
        '<a class="btn" href="#coverage">看各縣市查核資訊</a></div></section>' +
        '<section class="sec"><div class="sec-h"><h2>最新訪查</h2><a href="#latest">全部紀錄 →</a></div>' +
        (latest.length ? latest.map(function (v) { return visitCard(v, { showSite: true, short: true }); }).join("") : ara("think", "還沒有公開的訪查紀錄耶……第一篇會是哪裡呢？好期待！")) + "</section>" +
        '<section class="sec"><div class="sec-h"><h2>各縣市訪查覆蓋率</h2><a href="#coverage">詳細查核資訊 →</a></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>縣市</th>' + KINDS.map(function (k) { return '<th class="n">' + KIND[k].label + "</th>"; }).join("") + '<th style="width:30%">有形文資進度</th></tr></thead><tbody>' + rows.map(function (x) {
          return '<tr><td><a href="#county/' + x.c.slug + '">' + esc(x.c.label) + "</a></td>" + KINDS.map(function (k) {
            var y = x.k[k]; return '<td class="n">' + (y.total ? '<a href="#county/' + x.c.slug + "/" + k + '">' + y.visited + " / " + y.total + "</a>" : '<span class="muted">—</span>') + "</td>";
          }).join("") + '<td><div class="bar"><i style="width:' + pct(x.k.site.visited, x.k.site.total) + '%"></i></div></td></tr>';
        }).join("") + "</tbody></table></div></section>" +
        (upcoming.length ? '<section class="sec"><h2>達人即將到訪</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>預計日期</th><th>文資</th><th>縣市</th><th>行程</th><th>達人</th></tr></thead><tbody>' +
          upcoming.slice(0, 12).map(function (p) { return "<tr><td>" + planRange(p) + "</td><td>" + siteLink(p) + "</td><td>" + esc((COUNTY[p.county_slug] || {}).label) + "</td><td>" + esc(p.trip || "") + '</td><td><a href="#expert/' + p.user_id + '">' + esc(p.author) + "</a></td></tr>"; }).join("") +
          "</tbody></table></div></section>" : "");
      bindPhotos(view);
    });
  };
  function homeLine(tot, vis, latest, upcoming) {
    var who = ME ? esc(ME.display_name) : "";
    if (ME && isExpert() && upcoming.some(function (p) { return p.user_id === ME.id; })) {
      var p = upcoming.filter(function (x) { return x.user_id === ME.id; })[0];
      return ara("fight", "<b>" + who + "，" + (p.trip ? "「" + esc(p.trip) + "」" : esc(p.site_name)) + "快到了！</b><br>記得帶行動電源，拍照時避開路人的臉喔～ <a href=\"#mine\">看我的行程 →</a>");
    }
    if (ME && isExpert()) return ara("present", "<b>" + who + "，今天要去看哪一處文資？</b><br>全臺還有 <b>" + (tot - vis).toLocaleString() + "</b> 處有形文資沒有人訪查過；也可以去參加祭典、看演出，記錄<a href=\"#coverage/ich\">無形文資</a>的傳承現況喔！");
    if (ME && roleOf() === "member") return ara("thumb", "<b>歡迎 " + who + "！</b><br>想一起記錄文資現況嗎？<a href=\"#apply\">申請成為文資達人</a>，我幫你送去審查！");
    if (latest.length) return ara("laugh", "嗨！我是 AI 小助手阿拉蕾～<br>最新一篇是 <b>" + esc(latest[0].author) + "</b> 去 " + siteLink(latest[0]) + " 的紀錄，" + pickOne(["快去看看！", "照片很好看喔！", "看完也想出發了吧？"]));
    return ara("explain", "嗨！我是 AI 小助手阿拉蕾～<br>全臺 <b>" + tot.toLocaleString() + "</b> 處有形文資、<b>" + IDX.meta.totalIch + "</b> 項無形文資、<b>" + IDX.meta.totalAnti + "</b> 件古物，正等著達人們去拜訪！");
  }
  function kpi(v, l) { return '<div class="kpi"><div class="v">' + v + '</div><div class="l">' + l + "</div></div>"; }

  /* ---------- 查核資訊 ---------- */
  ROUTES.coverage = function (kind) {
    kind = KIND[kind] ? kind : "site";
    var KD = KIND[kind];
    return Promise.all([refreshStats(), S.listPlans({})]).then(function (r) {
      var plans = r[1], ALL = totals(plans), T = ALL[kind], cats = {};
      var rows = IDX.counties.map(function (c) {
        var k = coverage(c, plans, kind);
        Object.keys(k.cats).forEach(function (n) { var x = cats[n] || (cats[n] = { total: 0, visited: 0 }); x.total += k.cats[n].total; x.visited += k.cats[n].visited; });
        return { c: c, k: k };
      });
      var catOrder = ["國定古蹟", "直轄市定古蹟", "市定古蹟", "縣定古蹟", "歷史建築", "紀念建築", "聚落建築群", "考古遺址", "文化景觀",
        "傳統表演藝術", "傳統工藝", "口述傳統", "民俗", "傳統知識與實踐", "保存技術", "國寶", "重要古物", "一般古物"];
      var catNames = Object.keys(cats).sort(function (a, b) { return (catOrder.indexOf(a) + 99) % 99 - (catOrder.indexOf(b) + 99) % 99 || cats[b].total - cats[a].total; });
      var has = rows.filter(function (x) { return x.k.total; });
      var best = has.slice().sort(function (a, b) { return pct(b.k.visited, b.k.total) - pct(a.k.visited, a.k.total); })[0];
      var most = has.slice().sort(function (a, b) { return (b.k.total - b.k.visited) - (a.k.total - a.k.visited); })[0];
      var U = KD.unit, V = KD.verb;
      var covLine = T.visited === 0 ? ara("think", KD.label + "還是一片空白耶……第一位達人會從哪個縣市開始" + V + "呢？" + (kind === "ich" ? "<br><small>無形文資的紀錄是參加祭典、看演出、體驗工藝，記下傳承的現況。</small>" : kind === "antiquity" ? "<br><small>古物的紀錄是到博物館或廟宇看到實物，記下展示和保存的情形。</small>" : ""))
        : ara("present", KD.label + "目前覆蓋率最高的是 <b>" + esc(best.c.label) + "</b>（" + pct(best.k.visited, best.k.total) + "%）！<br><b>" + esc(most.c.label) + "</b> 還有 " + (most.k.total - most.k.visited) + " " + U + "沒人" + V + "過，" + pickOne(["誰要接下挑戰？", "需要更多達人幫忙！", "排進下次旅行吧～"]));
      view.innerHTML = '<h1>查核資訊</h1>' + kindCards(ALL, "#coverage/") +
        '<div class="tabs kind-tabs">' + KINDS.map(function (k) { return '<a class="tab' + (k === kind ? " on" : "") + '" href="#coverage/' + k + '">' + KIND[k].label + "</a>"; }).join("") + "</div>" +
        covLine + '<p class="muted">對照文資知識網站收錄的 ' + T.total.toLocaleString() + " " + U + KD.label + "（" + KD.desc + "；資料產生日 " + esc(IDX.meta.generated) +
        '），統計各縣市已有多少' + U + '有實地' + V + '紀錄。三類分開統計，不合併計算覆蓋率。「近一年」指最近一次公開紀錄在 365 天內；「需回訪」指最近一次紀錄已超過 ' + Math.round(CFG.staleDays / 365) + ' 年；「預計」為達人已登記但尚未完成的' + U + '數。</p>' +
        '<div class="kpis">' + kpi(T.total.toLocaleString(), KD.label + "（" + U + "）") + kpi(T.visited.toLocaleString(), "已" + V + "（" + U + "）") + kpi(pct(T.visited, T.total) + "%", "覆蓋率") +
        kpi((T.total - T.visited).toLocaleString(), "尚未" + V + "（" + U + "）") + kpi(T.fresh.toLocaleString(), "近一年更新（" + U + "）") + kpi(T.planned.toLocaleString(), "預計" + V + "（" + U + "）") + "</div>" +
        '<div class="legend"><span><i style="background:' + KD.color + '"></i>已' + V + '</span><span><i style="background:var(--sun)"></i>預計' + V + '</span></div>' +
        '<div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>縣市</th><th>知識網站</th><th class="n">' + KD.label + '</th><th class="n">已' + V + '</th><th class="n">覆蓋率</th><th style="min-width:140px">進度</th><th class="n">近一年</th><th class="n">需回訪</th><th class="n">預計' + V + '</th><th class="n">紀錄筆數</th></tr></thead><tbody>' +
        rows.map(function (x) {
          var k = x.k, p1 = pct(k.visited, k.total), p2 = Math.min(100 - p1, pct(k.planned, k.total));
          return '<tr><td><a href="#county/' + x.c.slug + "/" + kind + '">' + esc(x.c.label) + '</a></td><td><a href="' + x.c.base + '" target="_blank" rel="noopener">第' + (x.c.site === 2 ? "二" : "一") + "網站</a></td>" +
            '<td class="n">' + k.total + '</td><td class="n">' + k.visited + '</td><td class="n">' + (k.total ? p1 + "%" : "—") + "</td>" +
            '<td><div class="bar two"><i style="width:' + p1 + "%;background:" + KD.color + '"></i><i style="width:' + p2 + '%"></i></div></td>' +
            '<td class="n">' + k.fresh + '</td><td class="n">' + k.stale + '</td><td class="n">' + k.planned + '</td><td class="n">' + k.visits + "</td></tr>";
        }).join("") + '</tbody><tfoot><tr><td>合計</td><td></td><td class="n">' + T.total + '</td><td class="n">' + T.visited + '</td><td class="n">' + pct(T.visited, T.total) + '%</td><td></td><td class="n">' + T.fresh + '</td><td class="n">' + T.stale + '</td><td class="n">' + T.planned + '</td><td class="n">' + T.visits + "</td></tr></tfoot></table></div>" +
        '<section class="sec"><h2>依' + (kind === "ich" ? "無形文資類別" : kind === "antiquity" ? "古物等級" : "文資類別") + '</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>類別</th><th class="n">數量</th><th class="n">已' + V + '</th><th class="n">覆蓋率</th><th style="width:40%">進度</th></tr></thead><tbody>' +
        catNames.map(function (n) { var x = cats[n]; return "<tr><td>" + esc(n) + '</td><td class="n">' + x.total + '</td><td class="n">' + x.visited + '</td><td class="n">' + pct(x.visited, x.total) + '%</td><td><div class="bar"><i style="width:' + pct(x.visited, x.total) + "%;background:" + KD.color + '"></i></div></td></tr>'; }).join("") +
        "</tbody></table></div></section>" +
        '<p><button class="btn" id="csv">下載查核資訊 CSV（三類）</button></p>';
      $("#csv").onclick = function () {
        var head = ["縣市", "網站"];
        KINDS.forEach(function (k) { var L = KIND[k].label; head.push(L + "數", L + "已" + KIND[k].verb, L + "覆蓋率%", L + "近一年", L + "需回訪", L + "預計", L + "紀錄筆數"); });
        var lines = [head].concat(IDX.counties.map(function (c) {
          var row = [c.label, c.site];
          KINDS.forEach(function (k) { var x = coverage(c, plans, k); row.push(x.total, x.visited, pct(x.visited, x.total), x.fresh, x.stale, x.planned, x.visits); });
          return row;
        }));
        download("文資訪查查核資訊-" + today() + ".csv", "﻿" + lines.map(function (l) { return l.join(","); }).join("\n"), "text/csv");
      };
    });
  };
  function download(name, text, type) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ---------- 縣市文資清單 ---------- */
  ROUTES.county = function (slug, kind) {
    var c = COUNTY[slug]; if (!c) { location.hash = "#coverage"; return; }
    kind = KIND[kind] ? kind : "site";
    var KD = KIND[kind], U = KD.unit, V = KD.verb, LIST = c.byKind[kind];
    return Promise.all([refreshStats(), S.listPlans({ county: slug })]).then(function (r) {
      var plans = r[1], k = coverage(c, plans, kind), planned = {};
      var all = {}; KINDS.forEach(function (x) { all[x] = coverage(c, plans, x); });
      plans.forEach(function (p) { if (p.status === "planned") (planned[p.site_id] = planned[p.site_id] || []).push(p); });
      var towns = [], cats = [];
      LIST.forEach(function (s) {
        var t = kind === "site" ? s.town : (s.venue ? s.venue.name : "（各地／無固定地點）");
        if (t && towns.indexOf(t) < 0) towns.push(t);
        if (cats.indexOf(s.category) < 0) cats.push(s.category);
      });
      if (kind !== "site") towns.sort();
      view.innerHTML = '<p class="crumb"><a href="#coverage/' + kind + '">查核資訊</a> › ' + esc(c.label) + "</p>" +
        "<h1>" + esc(c.label) + '的文化資產訪查</h1><div class="btns"><a class="btn" href="' + c.base + '" target="_blank" rel="noopener">' + esc(c.label) + "文資知識網站 ↗</a>" +
        (isExpert() ? '<button class="btn btn-warm" id="tripBtn">規劃訪查行程</button>' : "") + "</div>" +
        '<div class="tabs kind-tabs">' + KINDS.map(function (x) {
          return '<a class="tab' + (x === kind ? " on" : "") + '" href="#county/' + slug + "/" + x + '">' + KIND[x].label + ' <small>' + all[x].visited + "/" + all[x].total + "</small></a>";
        }).join("") + "</div>" +
        '<form class="card form" id="tripForm" hidden style="margin-top:12px"><h3>' + (TRIP_FORM.addTo && TRIP_OPEN === slug ? "加入行程「" + esc(TRIP_FORM.trip) + "」" : "規劃訪查行程") + "</h3>" + '<p class="small muted">在下方清單勾選這趟要去的地方（可以切換有形文資、無形文資、古物分頁一起勾選，也可用類別、地點、「尚未' + V + '」篩選），再填行程名稱與日期，一次登記成預計到訪。到現場後在「我的訪查」逐一填寫紀錄。</p>' +
        '<div class="row"><label>行程名稱<input type="text" name="trip" required maxlength="40" placeholder="例如：2026 ' + esc(c.label.replace(/（.*）/, "")) + '行"></label><label>開始日<input type="date" name="d1" required></label><label>結束日<input type="date" name="d2" required></label></div>' +
        '<p><b id="pickCnt">已勾選 0 筆</b>　<button type="button" class="btn btn-sm" id="pickClr">清除勾選</button></p><div class="btns"><button class="btn btn-p">登記行程</button><button type="button" class="btn" id="tripCancel">取消</button></div></form>' +
        (k.total === 0 ? ara("think", esc(c.label) + "的知識網站目前沒有收錄" + KD.label + "喔，看看其他分頁吧！") :
        ara(k.visited === 0 ? "think" : pct(k.visited, k.total) >= 50 ? "thumb" : "explain",
          k.visited === 0 ? esc(c.label) + "的 " + k.total + " " + U + KD.label + "都還沒有人" + V + "過！" + (isExpert() ? "按「規劃訪查行程」一次勾選好幾" + U + "，出發吧！" : "")
            : esc(c.label) + "已經" + V + " " + k.visited + " " + U + KD.label + "，還有 " + (k.total - k.visited) + " " + U + "等你去看看。" + (k.stale ? "另外有 " + k.stale + " " + U + "太久沒更新，需要回訪喔！" : ""))) +
        '<div class="kpis">' + kpi(k.total, KD.label + "（" + U + "）") + kpi(k.visited, "已" + V) + kpi(pct(k.visited, k.total) + "%", "覆蓋率") + kpi(k.total - k.visited, "尚未" + V) + kpi(k.stale, "需回訪") + kpi(k.planned, "預計" + V) + "</div>" +
        '<div class="filters"><input class="search" id="q" type="search" placeholder="搜尋名稱" style="max-width:220px">' +
        '<select id="fs"><option value="">全部狀態</option><option value="none">尚未' + V + '</option><option value="done">已' + V + '</option><option value="stale">需回訪</option><option value="plan">預計到訪</option></select>' +
        '<select id="fc"><option value="">全部類別</option>' + cats.map(function (x) { return "<option>" + esc(x) + "</option>"; }).join("") + "</select>" +
        (towns.length ? '<select id="ft"><option value="">' + (kind === "site" ? "全部鄉鎮市區" : "全部展示點") + "</option>" + towns.map(function (x) { return "<option>" + esc(x) + "</option>"; }).join("") + "</select>" : "") +
        '</div><p class="muted small" id="cnt"></p><div class="tbl-wrap"><table class="tbl"><thead><tr><th class="pick" hidden>選</th><th>' + KD.label + "</th><th>類別</th><th>" + (kind === "site" ? "鄉鎮" : "展示點") + "</th><th>最近紀錄</th><th>" + KD.condL + '</th><th>推薦</th><th class="n">紀錄</th><th>連結</th></tr></thead><tbody id="rows"></tbody></table></div>';
      var picking = false, picked = PICKED[slug] || (PICKED[slug] = {});
      function place(s) { return kind === "site" ? s.town : (s.venue ? s.venue.name : "（各地／無固定地點）"); }
      function draw() {
        var q = $("#q").value.trim(), fs = $("#fs").value, fc = $("#fc").value, ft = $("#ft") ? $("#ft").value : "";
        var list = LIST.filter(function (s) {
          var st = STATS[slug + "/" + s.id];
          if (q && s.name.indexOf(q) < 0) return false;
          if (fc && s.category !== fc) return false;
          if (ft && place(s) !== ft) return false;
          if (fs === "none" && st) return false;
          if (fs === "done" && !st) return false;
          if (fs === "stale" && !(st && daysAgo(st.last_visit) > CFG.staleDays)) return false;
          if (fs === "plan" && !planned[s.id]) return false;
          return true;
        });
        $("#cnt").textContent = "共 " + list.length + " " + U;
        $("#rows").innerHTML = list.map(function (s) {
          var st = STATS[slug + "/" + s.id], pl = place(s);
          return "<tr>" + (picking ? '<td><input type="checkbox" data-pick="' + esc(s.id) + '"' + (picked[s.id] ? " checked" : "") + ' aria-label="選擇 ' + esc(s.name) + '"></td>' : "") +
            '<td><a href="#site/' + slug + "/" + encodeURIComponent(s.id) + '">' + esc(s.name) + "</a>" + (planned[s.id] ? ' <span class="tag st-pending">預計 ' + planRange(planned[s.id][0]) + "</span>" : "") + "</td><td>" + esc(s.category) + "</td><td>" +
            (kind !== "site" && s.venueId ? '<a href="#venue/' + slug + "/" + encodeURIComponent(s.venueId) + '">' + esc(pl) + "</a>" : esc(pl)) + "</td>" +
            (st ? "<td>" + st.last_visit + '</td><td class="cond-' + esc(st.last_condition) + '">' + esc(st.last_condition) + "</td><td>" + stars(st.avg_recommend) + '</td><td class="n">' + st.visits + "</td>"
              : '<td class="muted">尚未' + V + '</td><td></td><td></td><td class="n">0</td>') +
            '<td><a href="' + knowledgeUrl(slug, s.id) + '" target="_blank" rel="noopener">知識頁</a></td></tr>';
        }).join("") || '<tr><td colspan="9" class="empty">沒有符合條件的' + KD.label + "</td></tr>";
        $$("th.pick").forEach(function (th) { th.hidden = !picking; });
        $$("[data-pick]").forEach(function (cb) { cb.onchange = function () { if (cb.checked) picked[cb.dataset.pick] = 1; else delete picked[cb.dataset.pick]; cntPick(); }; });
      }
      function cntPick() {
        var e = $("#pickCnt"); if (!e) return;
        var n = {}; Object.keys(picked).forEach(function (id) { var x = SITE[slug + "/" + id]; if (x) n[x.kind] = (n[x.kind] || 0) + 1; });
        e.textContent = "已勾選 " + Object.keys(picked).length + " 筆" + (Object.keys(n).length ? "（" + KINDS.filter(function (x) { return n[x]; }).map(function (x) { return KIND[x].label + " " + n[x]; }).join("、") + "）" : "");
      }
      var tb = $("#tripBtn"), tf = $("#tripForm");
      if (tb) {
        tb.onclick = function () { picking = true; TRIP_OPEN = slug; tf.hidden = false; tb.hidden = true; draw(); cntPick(); };
        $("#tripCancel").onclick = function () { picking = false; TRIP_OPEN = null; Object.keys(picked).forEach(function (x) { delete picked[x]; }); tf.hidden = true; tb.hidden = false; draw(); cntPick(); };
        $("#pickClr").onclick = function () { Object.keys(picked).forEach(function (x) { delete picked[x]; }); draw(); cntPick(); };
        tf.d1.onchange = function () { if (!tf.d2.value || tf.d2.value < tf.d1.value) tf.d2.value = tf.d1.value; tf.d2.min = tf.d1.value; };
        ["trip", "d1", "d2"].forEach(function (n) { if (TRIP_FORM[n]) tf[n].value = TRIP_FORM[n]; tf[n].addEventListener("input", function () { TRIP_FORM[n] = tf[n].value; }); });
        tf.onsubmit = function (e) {
          e.preventDefault();
          var ids = Object.keys(picked);
          if (!ids.length) return toast("請在清單勾選至少一筆");
          if (tf.d2.value < tf.d1.value) return toast("結束日不能早於開始日");
          var tripName = tf.trip.value.trim();
          // 同一個行程裡已經預計中的項目不重複登記
          var dup = {}; plans.forEach(function (p) { if (ME && p.user_id === ME.id && p.status === "planned" && p.trip === tripName) dup[p.site_id] = 1; });
          var add = ids.filter(function (sid) { return !dup[sid]; }), skipped = ids.length - add.length;
          if (!add.length) return toast("勾選的項目都已經在「" + tripName + "」裡了", "think");
          S.savePlans(add.map(function (sid) { var x = SITE[slug + "/" + sid]; return { county_slug: slug, site_id: sid, site_name: x.name, kind: x.kind, planned_date: tf.d1.value, planned_end: tf.d2.value, trip: tripName }; }))
            .then(function () {
              Object.keys(picked).forEach(function (x) { delete picked[x]; }); TRIP_OPEN = null; TRIP_FORM = {};
              toast((add.length ? "已登記 " + add.length + " 筆到「" + tripName + "」" : "") + (skipped ? "（" + skipped + " 筆原本就在行程裡）" : "") + "，一路順風～", "fight");
              location.hash = "#mine";
            }).catch(fail);
        };
        if (TRIP_OPEN === slug) tb.onclick();   // 切換分頁時保留勾選中的行程
      }
      ["q", "fs", "fc", "ft"].forEach(function (id) { var el = $("#" + id); if (el) el.oninput = draw; });
      draw();
    });
  };
  var PICKED = {}, TRIP_OPEN = null, TRIP_FORM = {};
  /* 開始規劃行程：到縣市頁並打開勾選模式。preset＝{trip, d1, d2, addTo}，addTo 為 true 表示加入既有行程 */
  function startTrip(slug, preset) {
    TRIP_OPEN = slug; TRIP_FORM = preset || {}; PICKED[slug] = {};
    var h = "#county/" + slug;
    if (location.hash === h) route(); else location.hash = h;
  }
  function countySelect(id, sel) {
    return '<select id="' + id + '">' + IDX.counties.map(function (c) { return '<option value="' + c.slug + '"' + (c.slug === sel ? " selected" : "") + ">" + esc(c.label) + "</option>"; }).join("") + "</select>";
  }
  /* 我的行程清單（依行程名稱分組，只算還有預計中項目的） */
  function myTrips(plans) {
    var m = {};
    plans.forEach(function (p) {
      if (!p.trip || p.status === "cancelled") return;
      var t = m[p.trip] || (m[p.trip] = { name: p.trip, d1: p.planned_date, d2: planEnd(p), open: 0 });
      if (p.planned_date < t.d1) t.d1 = p.planned_date;
      if (planEnd(p) > t.d2) t.d2 = planEnd(p);
      if (p.status === "planned") t.open++;
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return a.d1 < b.d1 ? -1 : 1; });
  }

  /* ---------- 單一文資 ---------- */
  ROUTES.site = function (slug, id) {
    var s = site(slug, id), c = COUNTY[slug];
    if (!s) { view.innerHTML = ara("confused", "找不到這筆文化資產（" + esc(slug + "/" + id) + '）。可能是文資知識網站已更新編號，請回<a href="#coverage">查核資訊</a>查詢。', { cls: "ara-lg" }); return; }
    var KD = K(s), V = KD.verb, ven = s.venue, rel = ven && ven.relatedSiteId && site(slug, ven.relatedSiteId);
    return Promise.all([S.listVisits({ county: slug, site: id }), S.listPlans({ county: slug, site: id }), isExpert() ? S.listPlans({ user: ME.id }) : []]).then(function (r) {
      var visits = r[0], plans = r[1].filter(function (p) { return p.status === "planned"; }), trips = myTrips(r[2]);
      var pub = visits.filter(function (v) { return v.status === "published"; });
      var last = pub[0], avg = pub.length ? pub.reduce(function (a, v) { return a + v.recommend; }, 0) / pub.length : 0;
      var myPlan = ME && plans.filter(function (p) { return p.user_id === ME.id; })[0];
      var near = [];
      pub.forEach(function (v) { (v.nearby || []).forEach(function (n) { near.push(Object.assign({ src: esc(v.author) + "，" + v.visit_date }, n)); }); });
      near.sort(function (a, b) { return NEARBY.indexOf(a.type) - NEARBY.indexOf(b.type); });
      view.innerHTML = '<p class="crumb"><a href="#coverage/' + kindOf(s) + '">查核資訊</a> › <a href="#county/' + slug + "/" + kindOf(s) + '">' + esc(c.label) + "</a> › " + esc(s.name) + "</p>" +
        "<h1>" + esc(s.name) + "</h1><p>" + kindTag(s) + '<span class="tag">' + esc(s.category) + "</span>" + (s.town ? '<span class="tag">' + esc(s.town) + "</span>" : "") + "</p>" +
        (s.kind !== "site" ? '<p class="venue-line">' + (ven ? "展示點：" + '<a href="#venue/' + slug + "/" + encodeURIComponent(ven.id) + '">' + esc(ven.name) + "</a>" + (ven.address ? '<small class="muted">　' + esc(ven.address) + "</small>" : "") +
          (rel ? '<br><small>這裡也是有形文資「<a href="#site/' + slug + "/" + encodeURIComponent(rel.id) + '">' + esc(rel.name) + "</a>」</small>" : "")
          : "沒有固定的展示地點，各地都可能看到；請依知識網站的「哪裡看」說明與當地公告前往。") + "</p>" : "") +
        '<div class="linkpair"><a class="k" href="' + knowledgeUrl(slug, id) + '" target="_blank" rel="noopener"><b>文資知識資料 ↗</b><span class="muted small">' +
          (s.kind === "site" ? "歷史、介紹、語音導覽、照片與官方資訊" : s.venueId ? "展示點的介紹、語音故事與官方資訊" : "縣市首頁（這項沒有固定展示點）") + "（Allan Lo 和你逛文化）</span></a>" +
        '<a class="v" href="#site/' + slug + "/" + encodeURIComponent(id) + '"><b>現況與推薦（本頁）</b><span class="muted small">達人實地' + V + "的心得、照片與推薦指數</span></a></div>" +
        '<div class="kpis">' + kpi(pub.length, "公開" + V + "紀錄") + kpi(last ? last.visit_date : "—", "最近" + V + "日") +
        kpi(last ? '<span class="cond-' + esc(last.condition) + '">' + esc(last.condition) + "</span>" : "—", "最新" + KD.condL) + kpi(last ? esc(last.open_status) : "—", KD.openL) +
        kpi(pub.length ? avg.toFixed(1) + " " + stars(avg) : "—", "平均推薦指數") + "</div>" +
        siteLine(s, pub, last, avg) +
        '<div class="btns">' + (isExpert() ? '<a class="btn btn-warm" href="#submit/' + slug + "/" + encodeURIComponent(id) + '">新增' + V + "紀錄</a>" +
          (myPlan ? '<span class="tag st-pending">你預計 ' + planRange(myPlan) + " 到訪" + (myPlan.trip ? "（" + esc(myPlan.trip) + "）" : "") + "</span>" : '<button class="btn" id="planBtn">登記預計到訪</button>') :
          '<a class="btn" href="#apply">成為達人來更新這裡</a>') +
        (s.url ? '<a class="btn" href="' + esc(s.url) + '" target="_blank" rel="noopener">文資局官方資料 ↗</a>' : "") +
        (s.lat ? '<a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=' + s.lat + "," + s.lng + '" target="_blank" rel="noopener">導航</a>' : "") + "</div>" +
        '<form class="card form" id="planForm" hidden style="margin-top:12px"><h3>登記預計到訪</h3><div class="row">' +
          '<label>加入行程<select name="t"><option value="">（不加入行程）</option>' + trips.map(function (t, i) { return '<option value="' + i + '">' + esc(t.name) + "（" + t.d1 + " ～ " + t.d2.slice(5) + "）</option>"; }).join("") + '<option value="new">＋ 新的行程…</option></select></label>' +
          '<label id="tnW" hidden>新行程名稱<input type="text" name="tn" maxlength="40"></label>' +
          '<label>預計日期<input type="date" name="d" required min="' + today() + '"></label><label>結束日<small>多天行程才需要</small><input type="date" name="d2"></label>' +
          '<label>備註<input type="text" name="n" maxlength="200" placeholder="例如：配合週末導覽場次"></label></div><div class="btns"><button class="btn btn-p">登記</button></div></form>' +
        (plans.length ? '<p class="muted small" style="margin-top:10px">已登記預計到訪：' + plans.map(function (p) { return '<a href="#expert/' + p.user_id + '">' + esc(p.author) + "</a>（" + planRange(p) + "）"; }).join("、") + "</p>" : "") +
        (near.length ? '<section class="sec"><h2>達人的附近推薦</h2><p class="muted small">美食、住宿、交通等資訊來自達人訪查當時的經驗，可能已有變動。</p>' + nearbyList(near, true) + "</section>" : "") +
        '<section class="sec"><h2>' + V + "紀錄</h2>" + (visits.length ? visits.map(function (v) { return visitCard(v); }).join("") : '<p class="empty">還沒有紀錄</p>') + "</section>";
      bindPhotos(view);
      var pb = $("#planBtn"), pf = $("#planForm");
      if (pb) pb.onclick = function () { pf.hidden = false; pb.hidden = true; };
      if (pf) {
        pf.t.onchange = function () {
          var t = trips[+pf.t.value];
          $("#tnW").hidden = pf.t.value !== "new";
          if (t) { pf.d.value = t.d1; pf.d2.value = t.d2; }
        };
        pf.d.onchange = function () { if (pf.d2.value && pf.d2.value < pf.d.value) pf.d2.value = pf.d.value; pf.d2.min = pf.d.value; };
        pf.onsubmit = function (e) {
          e.preventDefault();
          var t = trips[+pf.t.value], trip = pf.t.value === "new" ? pf.tn.value.trim() : t ? t.name : null;
          if (pf.t.value === "new" && !trip) return toast("請填新行程的名稱");
          if (pf.d2.value && pf.d2.value < pf.d.value) return toast("結束日不能早於開始日");
          S.savePlan({ county_slug: slug, site_id: id, site_name: s.name, kind: kindOf(s), planned_date: pf.d.value, planned_end: pf.d2.value || null, trip: trip, note: pf.n.value })
            .then(function () { toast(trip ? "已加入「" + trip + "」！" : "登記好了，等你的訪查心得喔！", "thumb"); route(); }).catch(fail);
        };
      }
    });
  };

  function siteLine(s, pub, last, avg) {
    var KD = K(s), V = KD.verb;
    if (!last) return ara("sad", "<b>" + esc(s.short || s.name) + "</b>還沒有達人" + V + "過……" + (isExpert() ? "你要當第一位嗎？我會幫你記下來！" :
      s.kind === "ich" ? "希望很快有達人去參加、記下它現在的傳承情形！" : s.kind === "antiquity" ? "希望很快有達人去看看它現在有沒有展出！" : "希望很快有達人來看看它現在的樣子！"));
    var bad = KD.bad.indexOf(last.condition) >= 0 || KD.bad.indexOf(last.open_status) >= 0;
    if (bad) return ara("sad", "最近一次" + V + "（" + last.visit_date + "）回報：<b>" + esc(last.condition) + "</b>、" + esc(last.open_status) + "。" + (s.kind === "site" ? "出發前先確認一下喔！" : s.kind === "ich" ? "傳承需要大家關心……" : "想看的話先問問展示單位喔！"));
    if (KD.warn.indexOf(last.condition) >= 0) return ara("confused", "最近回報是「<b>" + esc(last.condition) + "</b>」，" + (s.kind === "site" ? "可能有部分區域看不到，要留意圍籬和公告喔。" : s.kind === "ich" ? "傳承人不多，能看到的機會很珍貴！" : "保存狀況需要留意。"));
    if (daysAgo(last.visit_date) > CFG.staleDays) return ara("think", "最近一次" + V + "已經是 " + last.visit_date + "，超過 " + Math.round(CFG.staleDays / 365) + " 年了，現況可能變了，需要達人回訪更新！");
    if (avg >= 4.5) return ara("thumb", "<b>" + pub.length + "</b> 位達人紀錄、平均 <b>" + avg.toFixed(1) + "</b> 顆星，大家都推薦！" + pickOne(["一定要排進行程～", "我也好想去！"]));
    if (avg >= 3.5) return ara("laugh", "平均 <b>" + avg.toFixed(1) + "</b> 顆星，最新" + KD.condL + "「" + esc(last.condition) + "」、" + esc(last.open_status) + "。看看達人們怎麼說吧！");
    return ara("explain", "平均 " + avg.toFixed(1) + " 顆星。每個人感受不同，看完心得再決定要不要去吧！");
  }

  /* 展示點：該處的無形文資與古物（知識網站展示點詳情的「達人紀錄」按鈕連到這裡） */
  ROUTES.venue = function (slug, vid) {
    var c = COUNTY[slug], ven = c && c.venueMap[vid];
    if (!ven) { view.innerHTML = ara("confused", "找不到這個展示點（" + esc(slug + "/" + vid) + "）。", { cls: "ara-lg" }); return; }
    return refreshStats().then(function () {
      var items = c.ichList.concat(c.antiList).filter(function (x) { return x.venueId === vid; });
      var rel = ven.relatedSiteId && site(slug, ven.relatedSiteId);
      var done = items.filter(function (x) { return STATS[slug + "/" + x.id]; }).length;
      view.innerHTML = '<p class="crumb"><a href="#county/' + slug + '/ich">' + esc(c.label) + "</a> › 展示點</p><h1>" + esc(ven.name) + "</h1>" +
        (ven.address ? '<p class="muted">' + esc(ven.address) + "</p>" : "") +
        '<div class="btns"><a class="btn" href="' + c.base + "#map/" + encodeURIComponent(vid) + '" target="_blank" rel="noopener">知識網站展示點 ↗</a>' +
        (rel ? '<a class="btn" href="#site/' + slug + "/" + encodeURIComponent(rel.id) + '">這裡也是有形文資「' + esc(rel.name) + "」</a>" : "") +
        (ven.lat ? '<a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=' + ven.lat + "," + ven.lng + '" target="_blank" rel="noopener">導航</a>' : "") + "</div>" +
        ara(done ? "explain" : "think", "這裡有 <b>" + items.length + "</b> 筆無形文資和古物，已經有 <b>" + done + "</b> 筆有達人紀錄。" + (isExpert() ? "點名稱就能新增紀錄喔！" : "")) +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>名稱</th><th>類別</th><th>最近紀錄</th><th>現況</th><th>推薦</th><th class="n">紀錄</th></tr></thead><tbody>' +
        items.map(function (x) {
          var st = STATS[slug + "/" + x.id];
          return '<tr><td><a href="#site/' + slug + "/" + encodeURIComponent(x.id) + '">' + esc(x.name) + "</a> " + kindTag(x) + "</td><td>" + esc(x.category) + "</td>" +
            (st ? "<td>" + st.last_visit + "</td><td>" + esc(st.last_condition) + "</td><td>" + stars(st.avg_recommend) + '</td><td class="n">' + st.visits + "</td>" : '<td class="muted">尚未' + K(x).verb + '</td><td></td><td></td><td class="n">0</td>') + "</tr>";
        }).join("") + "</tbody></table></div>";
    });
  };

  ROUTES.visit = function (id) {
    return S.getVisit(id).then(function (v) {
      if (!v) { view.innerHTML = '<div class="notice bad">找不到這筆紀錄，或尚未公開。</div>'; return; }
      var c = COUNTY[v.county_slug];
      view.innerHTML = '<p class="crumb"><a href="#county/' + v.county_slug + '">' + esc(c ? c.label : v.county_slug) + "</a> › " + siteLink(v) + "</p>" + visitCard(v, { showSite: true });
      bindPhotos(view);
    });
  };

  ROUTES.latest = function () {
    return S.listVisits({ status: "published", limit: 100 }).then(function (list) {
      view.innerHTML = '<h1>最新訪查紀錄</h1><div class="filters"><select id="fc"><option value="">全部縣市</option>' + IDX.counties.map(function (c) { return '<option value="' + c.slug + '">' + esc(c.label) + "</option>"; }).join("") + '</select></div><div id="list"></div>';
      function draw() {
        var f = $("#fc").value, l = list.filter(function (v) { return !f || v.county_slug === f; });
        $("#list").innerHTML = l.length ? l.map(function (v) { return visitCard(v, { showSite: true, short: true }); }).join("") : ara("think", "這裡還沒有紀錄耶，換個縣市看看？");
        bindPhotos($("#list"));
      }
      $("#fc").onchange = draw; draw();
    });
  };

  /* ---------- 達人 ---------- */
  ROUTES.experts = function () {
    return S.expertStats().then(function (list) {
      list.sort(function (a, b) { return b.published - a.published; });
      var t = list.reduce(function (a, x) { a.p += x.published; a.pl += x.planned; a.d += x.plans_done; return a; }, { p: 0, pl: 0, d: 0 });
      view.innerHTML = '<h1>文資達人</h1>' + (list.length ? ara("thumb", "謝謝 <b>" + list.length + "</b> 位達人！" + (list[0].published ? "目前紀錄最多的是 <b>" + esc(list[0].display_name) + "</b>，" + list[0].published + " 篇，好厲害！" : "大家一起把文資的現況記下來吧！"))
        : ara("think", "還沒有核准的達人……要不要<a href=\"#apply\">當第一位</a>？")) + '<p class="muted">文資達人須經申請與審查核准，才能新增訪查紀錄。下表統計每位達人的公開紀錄，以及「預計到訪」與實際完成的情形。</p>' +
        '<div class="kpis">' + kpi(list.length, "核准達人") + kpi(t.p, "公開紀錄") + kpi(t.pl, "登記預計到訪") + kpi(t.d, "預計已完成") + kpi(pct(t.d, t.pl) + "%", "預計到訪達成率") + "</div>" +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>達人</th><th>擅長縣市</th><th class="n">公開紀錄</th><th class="n">訪查文資</th><th class="n">涵蓋縣市</th><th class="n">預計到訪</th><th class="n">已完成</th><th class="n">逾期未訪</th><th class="n">達成率</th><th>最近訪查</th></tr></thead><tbody>' +
        list.map(function (x) {
          return '<tr><td><a href="#expert/' + x.id + '">' + esc(x.display_name) + "</a>" + (x.role !== "expert" ? ' <span class="tag">' + ROLE[x.role] + "</span>" : "") + "</td><td>" + (x.regions || []).map(function (r) { return esc((COUNTY[r] || {}).label || r); }).join("、") +
            '</td><td class="n">' + x.published + '</td><td class="n">' + x.sites + '</td><td class="n">' + x.counties + '</td><td class="n">' + x.planned + '</td><td class="n">' + x.plans_done + '</td><td class="n">' + x.plans_overdue +
            '</td><td class="n">' + (x.planned ? pct(x.plans_done, x.planned) + "%" : "—") + "</td><td>" + (x.last_visit || "—") + "</td></tr>";
        }).join("") + "</tbody></table></div>" + (isExpert() ? "" : '<p style="margin-top:16px"><a class="btn btn-warm" href="#apply">申請成為文資達人</a></p>');
    });
  };

  ROUTES.expert = function (uid) {
    return Promise.all([S.expertStats(), S.listVisits({ user: uid }), S.listPlans({ user: uid })]).then(function (r) {
      var x = r[0].filter(function (e) { return e.id === uid; })[0];
      if (!x) { view.innerHTML = '<div class="notice bad">找不到這位達人。</div>'; return; }
      var visits = r[1].filter(function (v) { return v.status === "published" || (ME && (ME.id === uid || isReviewer())); }), plans = r[2];
      // 每月預計 vs 實際
      var months = {}, t = today();
      function m(d) { return d.slice(0, 7); }
      plans.forEach(function (p) { if (p.status !== "cancelled") (months[m(p.planned_date)] = months[m(p.planned_date)] || { plan: 0, act: 0 }).plan++; });
      visits.filter(function (v) { return v.status === "published"; }).forEach(function (v) { (months[m(v.visit_date)] = months[m(v.visit_date)] || { plan: 0, act: 0 }).act++; });
      var keys = Object.keys(months).sort().slice(-12);
      var byCounty = {};
      visits.filter(function (v) { return v.status === "published"; }).forEach(function (v) { byCounty[v.county_slug] = (byCounty[v.county_slug] || 0) + 1; });
      view.innerHTML = '<p class="crumb"><a href="#experts">達人</a> › ' + esc(x.display_name) + "</p><h1>" + esc(x.display_name) + "</h1>" +
        "<p>" + (x.regions || []).map(function (r) { return '<span class="tag">' + esc((COUNTY[r] || {}).label || r) + "</span>"; }).join("") + "</p>" +
        '<div class="kpis">' + kpi(x.published, "公開紀錄") + kpi(x.sites, "訪查文資（處）") + kpi(x.counties, "涵蓋縣市") + kpi(x.planned, "預計到訪") + kpi(x.plans_done, "預計已完成") + kpi(x.plans_overdue, "逾期未訪") + kpi(x.planned ? pct(x.plans_done, x.planned) + "%" : "—", "達成率") + "</div>" +
        (keys.length ? '<section class="sec"><h2>每月預計與實際到訪</h2><div class="legend"><span><i style="background:var(--sun)"></i>預計</span><span><i style="background:var(--teal)"></i>實際（公開紀錄）</span></div>' + monthChart(keys, months) + "</section>" : "") +
        (Object.keys(byCounty).length ? '<section class="sec"><h2>各縣市紀錄</h2><p>' + Object.keys(byCounty).map(function (k) { return '<a class="tag" href="#county/' + k + '">' + esc((COUNTY[k] || {}).label || k) + " " + byCounty[k] + "</a>"; }).join("") + "</p></section>" : "") +
        '<section class="sec"><h2>預計到訪</h2>' + (plans.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>預計日期</th><th>行程</th><th>文資</th><th>狀態</th><th>備註</th></tr></thead><tbody>' +
          plans.map(function (p) {
            var st = p.status === "done" ? '<span class="tag st-published">已完成</span>' : p.status === "cancelled" ? '<span class="tag">已取消</span>' : planEnd(p) < t ? '<span class="tag st-rejected">逾期</span>' : '<span class="tag st-pending">預計中</span>';
            return "<tr><td>" + planRange(p) + "</td><td>" + esc(p.trip || "") + "</td><td>" + siteLink(p) + "</td><td>" + st + "</td><td>" + esc(p.note || "") + "</td></tr>";
          }).join("") + "</tbody></table></div>" : '<p class="muted">沒有登記預計到訪。</p>') + "</section>" +
        '<section class="sec"><h2>訪查紀錄</h2>' + (visits.length ? visits.map(function (v) { return visitCard(v, { showSite: true, short: true }); }).join("") : ara("think", "這位達人還在準備第一篇紀錄～")) + "</section>";
      bindPhotos(view);
    });
  };
  function monthChart(keys, months) {
    var max = 1; keys.forEach(function (k) { max = Math.max(max, months[k].plan, months[k].act); });
    var W = Math.max(320, keys.length * 56), H = 180, bw = 18, step = W / keys.length;
    var s = '<div style="overflow-x:auto"><svg class="chart" viewBox="0 0 ' + W + " " + (H + 30) + '" style="min-width:' + Math.min(W, 640) + 'px" role="img" aria-label="每月預計與實際到訪">';
    keys.forEach(function (k, i) {
      var x = i * step + step / 2, a = months[k].plan / max * H, b = months[k].act / max * H;
      s += '<rect x="' + (x - bw - 1) + '" y="' + (H - a) + '" width="' + bw + '" height="' + a + '" rx="3" fill="var(--sun)"><title>' + k + " 預計 " + months[k].plan + "</title></rect>" +
        '<rect x="' + (x + 1) + '" y="' + (H - b) + '" width="' + bw + '" height="' + b + '" rx="3" fill="var(--teal)"><title>' + k + " 實際 " + months[k].act + "</title></rect>" +
        '<text x="' + x + '" y="' + (H + 18) + '" text-anchor="middle" font-size="12" fill="currentColor">' + k.slice(2).replace("-", "/") + "</text>" +
        (months[k].plan ? '<text x="' + (x - bw / 2 - 1) + '" y="' + (H - a - 4) + '" text-anchor="middle" font-size="11" fill="currentColor">' + months[k].plan + "</text>" : "") +
        (months[k].act ? '<text x="' + (x + bw / 2 + 1) + '" y="' + (H - b - 4) + '" text-anchor="middle" font-size="11" fill="currentColor">' + months[k].act + "</text>" : "");
    });
    return s + '<line x1="0" x2="' + W + '" y1="' + H + '" y2="' + H + '" stroke="var(--line)"/></svg></div>';
  }

  /* ---------- 新增／修改訪查紀錄 ---------- */
  ROUTES.submit = function (slug, id) { return visitForm(null, slug, id); };
  ROUTES.edit = function (vid) { return S.getVisit(vid).then(function (v) { if (!v) throw new Error("找不到紀錄"); return visitForm(v, v.county_slug, v.site_id); }); };

  function visitForm(v, slug, id) {
    if (!isExpert()) return needLogin("只有經審查核准的文資達人可以新增訪查紀錄。還不是達人？請先申請。");
    if (v && v.user_id !== ME.id && !isReviewer()) throw new Error("不能修改別人的紀錄");
    var s = slug && id ? site(slug, id) : null;
    v = v || {};
    var sc = v.scores || {};
    return S.listPlans({ user: ME.id }).then(function (plans) {
      plans = plans.filter(function (p) { return p.status === "planned"; });
      var keep = (v.photos || []).slice(), added = [];
      var kind0 = v.kind || (s ? s.kind : "site");
      view.innerHTML = '<p class="crumb">' + (s ? '<a href="#site/' + slug + "/" + encodeURIComponent(id) + '">' + esc(s.name) + "</a> › " : "") + (v.id ? "修改紀錄" : "新增紀錄") + "</p>" +
        "<h1>" + (v.id ? "修改" : "新增") + '<span id="verbH">' + KIND[kind0].verb + "</span>紀錄</h1>" +
        ara("fight", (v.id ? "要補充什麼呢？" : "出發訪查囉！") + "我的小提醒：" + pickOne(["拍一張全景、一張細節，大家最想看！", "照片避開路人的臉和車牌喔～", "開放時間有改的話，記得寫在「資料勘誤」！", "附近有好吃的，也記得推薦給大家！", "私人宅第只在外面看就好，不要打擾住戶喔。"]) +
          (!ME.trusted && !isReviewer() ? "<br><small>送出後會先給審查者看過才公開；修改已公開的紀錄也會重新送審。</small>" : "")) +
        '<form class="form" id="vf">' +
        '<fieldset><legend>對象</legend><div class="rate kind-pick">' + KINDS.map(function (k) { return '<label><input type="radio" name="kind" value="' + k + '"' + (k === kind0 ? " checked" : "") + ">" + KIND[k].label + "</label>"; }).join("") + "</div>" +
        '<div class="row"><label>縣市<select name="county" required>' + IDX.counties.map(function (c) { return '<option value="' + c.slug + '"' + (c.slug === slug ? " selected" : "") + ">" + esc(c.label) + "</option>"; }).join("") + "</select></label>" +
        '<label><span id="whatL">' + KIND[kind0].label + '</span><input type="text" name="siteq" list="siteopts" placeholder="輸入名稱搜尋" required autocomplete="off" value="' + esc(s ? s.name : "") + '"><datalist id="siteopts"></datalist></label></div>' +
        '<p class="small muted" id="siteHint"></p>' +
        (plans.length && !v.id ? '<label>對應我的預計到訪<select name="plan"><option value="">（無）</option>' + plans.map(function (p) { return '<option value="' + p.id + '"' + (p.county_slug === slug && p.site_id === id ? " selected" : "") + ">" + planRange(p) + " " + (p.trip ? "［" + esc(p.trip) + "］" : "") + esc(p.site_name) + "</option>"; }).join("") + "</select></label>" : "") + "</fieldset>" +
        '<fieldset><legend>現況</legend><div class="row">' +
        '<label>實際<span class="verbL">' + KIND[kind0].verb + '</span>日期<input type="date" name="visit_date" required max="' + today() + '" value="' + esc(v.visit_date || today()) + '"></label>' +
        '<label><span id="condL">' + KIND[kind0].condL + '</span><select name="condition" required></select></label>' +
        '<label><span id="openL">' + KIND[kind0].openL + '</span><select name="open_status" required></select></label>' +
        '<label id="modeW">參與方式<select name="mode"><option value="">—</option>' + MODES.map(function (x) { return "<option" + (v.mode === x ? " selected" : "") + ">" + x + "</option>"; }).join("") + "</select></label>" +
        '<label>停留時間（分鐘）<input type="number" name="duration_min" min="5" max="1440" value="' + esc(v.duration_min || "") + '"></label>' +
        '<label>費用<input type="text" name="fee" maxlength="60" placeholder="免費／全票 100 元" value="' + esc(v.fee || "") + '"></label>' +
        '<label>人潮<select name="crowd"><option value="">—</option>' + ["冷清", "適中", "擁擠"].map(function (x) { return "<option" + (v.crowd === x ? " selected" : "") + ">" + x + "</option>"; }).join("") + "</select></label>" +
        '<label>無障礙<select name="accessible"><option value="">—</option>' + ["友善", "部分", "不友善", "未確認"].map(function (x) { return "<option" + (v.accessible === x ? " selected" : "") + ">" + x + "</option>"; }).join("") + "</select></label>" +
        "</div></fieldset>" +
        '<fieldset><legend>推薦指數</legend><label>推薦實際參訪指數（必填）' + rate("recommend", v.recommend, true) + "</label>" +
        '<div class="row">' + Object.keys(SCORE).map(function (k) { return "<label>" + SCORE[k] + rate("s_" + k, sc[k]) + "</label>"; }).join("") + "</div></fieldset>" +
        '<label>當天心情<select name="mood"><option value="">—</option>' + Object.keys(MOODS).map(function (m) { return '<option value="' + m + '"' + (v.mood === m ? " selected" : "") + ">" + MOODS[m] + " " + m + "</option>"; }).join("") + "</select></label>" +
        '<label>參訪心得<small>至少 30 字。請描述實際看到的狀況，避免抄錄知識網站或官方說明。</small><textarea name="body" required minlength="30" maxlength="5000">' + esc(v.body || "") + "</textarea></label>" +
        '<label>參訪建議<small>交通、停車、最佳時段、注意事項</small><input type="text" name="tips" maxlength="500" value="' + esc(v.tips || "") + '"></label>' +
        '<fieldset><legend>附近推薦</legend><p class="small muted">順路的美食、住宿、交通方式或其他景點，幫下一位訪客規劃。連結請貼店家官網、Google 地圖或粉專網址。</p><div id="nbList" class="form"></div>' +
        '<p style="margin-top:8px"><button type="button" class="btn btn-sm" id="nbAdd">＋ 新增一筆推薦</button></p></fieldset>' +
        '<label>資料勘誤<small>發現知識網站或官方資料與現場不符（地址、開放時間、已改建等），寫在這裡，管理者會回頭修正知識網站。</small><input type="text" name="correction" maxlength="500" value="' + esc(v.correction || "") + '"></label>' +
        '<fieldset><legend>實地照片（最多 ' + CFG.maxPhotos + ' 張）</legend><p class="small muted">照片會在瀏覽器裡縮到長邊 ' + CFG.photoMaxPx + ' 像素並移除 EXIF（含 GPS 位置）後才上傳。請避免拍到可辨識的路人臉孔、車牌或私宅內部。</p>' +
        '<input type="file" id="ph" accept="image/*" multiple><div class="ph-list" id="phList" style="margin-top:8px"></div></fieldset>' +
        '<label class="check"><input type="checkbox" name="agree" required' + (v.id ? " checked" : "") + '><span>我確認這是本人實地訪查的紀錄，照片為本人拍攝；同意依所選授權公開照片，並遵守本站的<a href="#about" target="_blank">投稿規範</a>。</span></label>' +
        '<div class="btns"><button class="btn btn-p" id="sendBtn">' + (v.id ? "儲存修改" : "送出紀錄") + "</button>" + (v.id && (v.status !== "published" || roleOf() === "admin") ? '<button type="button" class="btn btn-bad" id="delBtn">刪除</button>' : "") + "</div></form>";
      var f = $("#vf"), chosen = s, nb = (v.nearby || []).map(function (n) { return Object.assign({}, n); });
      function drawNb() {
        $("#nbList").innerHTML = nb.map(function (n, i) {
          return '<div class="row nb-row"><label>類型<select data-nb="' + i + '" data-f="type">' + NEARBY.map(function (t) { return "<option" + (n.type === t ? " selected" : "") + ">" + t + "</option>"; }).join("") + "</select></label>" +
            '<label>名稱<input type="text" maxlength="60" data-nb="' + i + '" data-f="name" value="' + esc(n.name || "") + '" placeholder="例如：○○廣東粥"></label>' +
            '<label>說明<input type="text" maxlength="200" data-nb="' + i + '" data-f="note" value="' + esc(n.note || "") + '" placeholder="推薦理由、步行幾分鐘、營業時間"></label>' +
            '<label>連結<input type="url" maxlength="300" data-nb="' + i + '" data-f="link" value="' + esc(n.link || "") + '" placeholder="https://"></label>' +
            '<div><button type="button" class="btn btn-sm btn-bad" data-nbdel="' + i + '">移除</button></div></div>';
        }).join("");
        $$("[data-nb]").forEach(function (el) { el.oninput = el.onchange = function () { nb[+el.dataset.nb][el.dataset.f] = el.value; }; });
        $$("[data-nbdel]").forEach(function (b) { b.onclick = function () { nb.splice(+b.dataset.nbdel, 1); drawNb(); }; });
      }
      $("#nbAdd").onclick = function () { if (nb.length >= 10) return toast("最多 10 筆"); nb.push({ type: "美食", name: "", note: "", link: "" }); drawNb(); };
      drawNb();
      function curKind() { var x = f.querySelector("[name=kind]:checked"); return x ? x.value : "site"; }
      function fillOpts() {
        var c = COUNTY[f.county.value], k = curKind(), KD = KIND[k];
        $("#siteopts").innerHTML = c.byKind[k].map(function (x) { return '<option value="' + esc(x.name) + '">' + esc(x.category + (x.town ? "・" + x.town : x.venue ? "・" + x.venue.name : "")) + "</option>"; }).join("");
        $("#whatL").textContent = KD.label; $("#verbH").textContent = KD.verb; $$(".verbL").forEach(function (e) { e.textContent = KD.verb; });
        $("#condL").textContent = KD.condL; $("#openL").textContent = KD.openL; $("#modeW").hidden = k !== "ich";
        f.condition.innerHTML = KD.conds.map(function (x) { return "<option" + (v.condition === x ? " selected" : "") + ">" + x + "</option>"; }).join("");
        f.open_status.innerHTML = KD.opens.map(function (x) { return "<option" + (v.open_status === x ? " selected" : "") + ">" + x + "</option>"; }).join("");
      }
      function pick() {
        var c = COUNTY[f.county.value], n = f.siteq.value.trim(), k = curKind();
        chosen = c.byKind[k].filter(function (x) { return x.name === n; })[0] || null;
        $("#siteHint").innerHTML = chosen ? "對應知識頁：" + '<a href="' + knowledgeUrl(c.slug, chosen.id) + '" target="_blank" rel="noopener">' + esc(chosen.name) + " ↗</a>" +
          (chosen.kind !== "site" ? "　" + (chosen.venue ? "展示點：" + esc(chosen.venue.name) : "沒有固定展示點") : "") : (n ? "請從清單選擇一筆" + KIND[k].label : "");
      }
      f.county.onchange = function () { f.siteq.value = ""; fillOpts(); pick(); };
      $$("[name=kind]", f).forEach(function (r) { r.onchange = function () { f.siteq.value = ""; fillOpts(); pick(); }; });
      f.siteq.oninput = pick;
      if (f.plan) f.plan.onchange = function () {
        var p = plans.filter(function (x) { return x.id === f.plan.value; })[0];
        if (p) { f.county.value = p.county_slug; f.querySelector('[name=kind][value="' + kindOf(p) + '"]').checked = true; fillOpts(); f.siteq.value = p.site_name; pick(); }
      };
      fillOpts(); pick();
      function drawPh() {
        $("#phList").innerHTML = keep.map(function (p, i) { return '<div class="ph-item"><img src="' + esc(p.url) + '" alt=""><small>' + esc(p.caption || "") + '</small><button type="button" class="btn btn-sm btn-bad" data-k="' + i + '">移除</button></div>'; }).join("") +
          added.map(function (p, i) {
            return '<div class="ph-item"><img src="' + p.preview + '" alt=""><input type="text" placeholder="照片說明" maxlength="120" data-cap="' + i + '" value="' + esc(p.caption) + '">' +
              '<select data-lic="' + i + '">' + LICENSES.map(function (l) { return "<option" + (p.license === l ? " selected" : "") + ">" + l + "</option>"; }).join("") + '</select><button type="button" class="btn btn-sm btn-bad" data-a="' + i + '">移除</button></div>';
          }).join("");
        $$("[data-k]").forEach(function (b) { b.onclick = function () { keep.splice(+b.dataset.k, 1); drawPh(); }; });
        $$("[data-a]").forEach(function (b) { b.onclick = function () { URL.revokeObjectURL(added[+b.dataset.a].preview); added.splice(+b.dataset.a, 1); drawPh(); }; });
        $$("[data-cap]").forEach(function (b) { b.oninput = function () { added[+b.dataset.cap].caption = b.value; }; });
        $$("[data-lic]").forEach(function (b) { b.onchange = function () { added[+b.dataset.lic].license = b.value; }; });
      }
      drawPh();
      $("#ph").onchange = function () {
        var files = Array.prototype.slice.call(this.files), room = CFG.maxPhotos - keep.length - added.length;
        if (files.length > room) toast("最多 " + CFG.maxPhotos + " 張，只加入前 " + Math.max(room, 0) + " 張");
        Promise.all(files.slice(0, Math.max(room, 0)).map(function (fl) { return shrink(fl, S.mode === "demo" ? 900 : CFG.photoMaxPx); })).then(function (bs) {
          bs.forEach(function (b) { added.push({ blob: b, preview: URL.createObjectURL(b), caption: "", license: LICENSES[0] }); });
          drawPh();
        }).catch(fail);
        this.value = "";
      };
      var del = $("#delBtn");
      if (del) del.onclick = function () { if (confirm("確定刪除這筆紀錄？")) S.deleteVisit(v.id).then(function () { toast("已刪除這筆紀錄", "sad"); location.hash = "#mine"; }).catch(fail); };
      f.onsubmit = function (e) {
        e.preventDefault();
        pick();
        if (!chosen) return toast("請從清單選擇一筆" + KIND[curKind()].label);
        if (!f.querySelector('[name=recommend]:checked')) return toast("請選擇推薦指數");
        var scores = {};
        Object.keys(SCORE).forEach(function (k) { var x = f.querySelector('[name=s_' + k + ']:checked'); if (x) scores[k] = +x.value; });
        var data = {
          county_slug: f.county.value, site_id: chosen.id, site_name: chosen.name, category: chosen.category, kind: chosen.kind,
          mode: chosen.kind === "ich" ? (f.mode.value || null) : null,
          visit_date: f.visit_date.value, condition: f.condition.value, open_status: f.open_status.value,
          recommend: +f.querySelector("[name=recommend]:checked").value, scores: scores, body: f.body.value.trim(),
          tips: f.tips.value.trim(), correction: f.correction.value.trim(), fee: f.fee.value.trim(),
          duration_min: f.duration_min.value ? +f.duration_min.value : null, crowd: f.crowd.value || null, accessible: f.accessible.value || null,
          mood: f.mood.value || null,
          nearby: nb.filter(function (n) { return n.name && n.name.trim(); }).map(function (n) { return { type: n.type, name: n.name.trim(), note: (n.note || "").trim(), link: safeUrl((n.link || "").trim()) }; })
        };
        if (f.plan && f.plan.value) data.plan_id = f.plan.value;
        if (v.id) { data.id = v.id; data.keepPhotos = keep; }
        $("#sendBtn").disabled = true; $("#sendBtn").textContent = "上傳中…";
        S.saveVisit(data, added.map(function (p) { return { blob: p.blob, caption: p.caption, license: p.license }; })).then(function () {
          toast(ME.trusted || isReviewer() ? "收到！紀錄已公開，辛苦了～" : "收到！已送給審查者，核准後就會公開～", "thumb");
          location.hash = "#site/" + data.county_slug + "/" + encodeURIComponent(data.site_id);
        }).catch(function (e) { $("#sendBtn").disabled = false; $("#sendBtn").textContent = "重新送出"; fail(e); });
      };
    });
  }
  function rate(name, val, req) {
    var s = '<div class="rate">';
    for (var i = 1; i <= 5; i++) s += '<label><input type="radio" name="' + name + '" value="' + i + '"' + (+val === i ? " checked" : "") + (req && i === 1 ? " required" : "") + ">" + i + "</label>";
    return s + "</div>";
  }
  /* 縮圖：重新繪製到 canvas 再輸出 JPEG，EXIF（含 GPS）不會被保留 */
  function shrink(file, max) {
    return new Promise(function (ok, no) {
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () {
        var r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var cv = document.createElement("canvas"); cv.width = Math.round(img.naturalWidth * r); cv.height = Math.round(img.naturalHeight * r);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(u);
        cv.toBlob(function (b) { b ? ok(b) : no(new Error("照片轉檔失敗")); }, "image/jpeg", 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(u); no(new Error("無法讀取照片：" + file.name)); };
      img.src = u;
    });
  }

  /* ---------- 我的訪查 ---------- */
  ROUTES.mine = function () {
    if (!ME) return needLogin("請先登入。");
    return Promise.all([S.listVisits({ user: ME.id }), S.listPlans({ user: ME.id }), S.myApplications()]).then(function (r) {
      var visits = r[0], plans = r[1], apps = r[2], t = today();
      var open = plans.filter(function (p) { return p.status === "planned"; }), now = open.filter(function (p) { return p.planned_date <= t && planEnd(p) >= t; });
      var mineLine = !isExpert() ? "" : now.length ? ara("fight", "<b>行程進行中！</b>今天還有 " + now.length + " 處可以訪查，按「填寫紀錄」就能邊走邊記～")
        : open.length ? ara("present", "你有 <b>" + open.length + "</b> 處預計到訪，最近的是 " + open[0].planned_date + " 的 " + siteLink(open[0]) + "。")
        : visits.length ? ara("thumb", "已經寫了 <b>" + visits.length + "</b> 篇紀錄，太棒了！下一趟要去哪裡呢？")
        : ara("explain", "還沒有行程喔！在下面選一個縣市、按「開始規劃」，一次勾選要去的文資。");
      view.innerHTML = "<h1>我的訪查</h1>" + mineLine +
        (isExpert() ? '<div class="card trip-new"><h3>＋ 規劃新行程</h3><p class="small muted">選一個縣市，到該縣市的清單勾選要去的有形文資、無形文資或古物，填上行程名稱與日期即可。</p>' +
            '<div class="btns">' + countySelect("newTripCounty", ((plans[0] || {}).county_slug) || (ME.regions || [])[0] || "taipei-city") + '<button class="btn btn-warm" id="newTripBtn">開始規劃</button><a class="btn" href="#coverage">看查核資訊找目標</a></div></div>' +
          '<section class="sec"><h2>我的訪查行程與預計到訪</h2>' + (plans.length ? tripGroups(plans, t) : '<p class="muted">還沒有登記。到縣市頁按「規劃訪查行程」一次勾選多處，或在文資頁按「登記預計到訪」。</p>') + "</section>" +
          '<section class="sec"><h2>我的紀錄（' + visits.length + "）</h2>" + (visits.length ? visits.map(function (v) { return visitCard(v, { showSite: true, short: true }); }).join("") : '<p class="empty muted">還沒有紀錄</p>') + "</section>"
          : '<div class="card"><p>你目前是一般會員。成為文資達人後才能新增訪查紀錄。</p>' + (apps.length ? "<p>申請狀態：" + apps.map(function (a) { return a.created_at.slice(0, 10) + " " + ({ pending: "審查中", approved: "已核准", rejected: "未通過" })[a.status] + (a.review_note ? "（" + esc(a.review_note) + "）" : ""); }).join("；") + "</p>" : "") + '<a class="btn btn-warm" href="#apply">申請成為達人</a></div>') +
        '<section class="sec"><h2>個人資料</h2><form class="card form" id="pf"><label>公開署名<input type="text" name="n" required maxlength="40" value="' + esc(ME.display_name) + '"></label>' +
        '<label>簡介<input type="text" name="b" maxlength="300" value="' + esc(ME.bio || "") + '"></label><div class="btns"><button class="btn btn-p">儲存</button></div></form></section>';
      bindPhotos(view);
      bindTrips(plans);
      var nb = $("#newTripBtn"); if (nb) nb.onclick = function () { startTrip($("#newTripCounty").value, {}); };
      $("#pf").onsubmit = function (e) { e.preventDefault(); S.updateProfile({ display_name: this.n.value.trim(), bio: this.b.value.trim(), regions: ME.regions || [] }).then(function (m) { ME = m; renderChrome(); toast("個人資料已儲存", "thumb"); }).catch(fail); };
    });
  };

  function tripRank(groups, k) { return groups[k].some(function (p) { return p.status === "planned"; }) ? (k === "" ? 1 : 0) : 2; }
  function tripGroups(plans, t) {
    var groups = {}, order = [];
    plans.forEach(function (p) { var k = p.trip || ""; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(p); });
    // 排序：有預計中項目的行程在前，未分行程其次，全部取消或完成的行程最後（bindTrips 用同一個順序）
    order.sort(function (a, b) { return tripRank(groups, a) - tripRank(groups, b); });
    return order.map(function (k, gi) {
      var ps = groups[k], done = ps.filter(function (p) { return p.status === "done"; }).length, live = ps.filter(function (p) { return p.status !== "cancelled"; });
      var open = ps.filter(function (p) { return p.status === "planned"; });
      var d1 = live.reduce(function (m, p) { return !m || p.planned_date < m ? p.planned_date : m; }, ""), d2 = live.reduce(function (m, p) { return planEnd(p) > m ? planEnd(p) : m; }, "");
      var rt = routeUrl(open.map(function (p) { return site(p.county_slug, p.site_id); }));
      var county0 = (live[0] || ps[0]).county_slug;
      return '<div class="card trip" data-g="' + gi + '" style="margin-bottom:14px"><div class="visit-h"><h3>' + (k ? esc(k) : "（未分行程）") + '</h3><span class="muted small">' + (k && d1 ? d1 + (d2 !== d1 ? " ～ " + d2.slice(5) : "") + "・" : "") + "完成 " + done + " / " + live.length + "</span></div>" +
        '<div class="bar" style="margin:6px 0 10px"><i style="width:' + pct(done, live.length) + '%"></i></div>' +
        '<div class="btns trip-acts">' +
          '<span class="trip-add">' + countySelect("ta-" + gi, county0) + '<button class="btn btn-sm btn-warm" data-tadd="' + gi + '">＋ 加入更多文資</button></span>' +
          '<button class="btn btn-sm" data-tedit="' + gi + '">' + (k ? "編輯行程" : "編成行程") + "</button>" +
          (rt ? '<a class="btn btn-sm" href="' + rt + '" target="_blank" rel="noopener">Google 地圖路線</a>' : "") +
          (k && open.length ? '<button class="btn btn-sm btn-bad" data-tcancel="' + gi + '">取消整個行程</button>' : "") + "</div>" +
        '<form class="form trip-edit" data-tform="' + gi + '" hidden><div class="row"><label>行程名稱<input type="text" name="name" required maxlength="40" value="' + esc(k) + '"></label>' +
          '<label>開始日<input type="date" name="d1" required value="' + esc(d1) + '"></label><label>結束日<input type="date" name="d2" required value="' + esc(d2 || d1) + '"></label></div>' +
          '<p class="small muted">' + (k ? "名稱與日期會套用到這個行程的所有項目。" : "這些預計到訪會合併成一個行程，套用相同的日期。") + '</p><div class="btns"><button class="btn btn-sm btn-p">儲存</button><button type="button" class="btn btn-sm" data-tclose="' + gi + '">取消</button></div></form>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th>文資</th><th>狀態</th><th></th></tr></thead><tbody>' + ps.map(function (p) {
          var st = p.status === "done" ? '<span class="tag st-published">已完成</span>' : p.status === "cancelled" ? '<span class="tag">已取消</span>' : planEnd(p) < t ? '<span class="tag st-rejected">逾期</span>' : '<span class="tag st-pending">預計中</span>';
          var it = site(p.county_slug, p.site_id) || {};
          return '<tr data-pid="' + p.id + '"><td class="pdate">' + planRange(p) + "</td><td>" + siteLink(p) + " " + kindTag(p) + ' <small class="muted">' + esc(it.town || (it.venue ? it.venue.name : "")) + "</small></td><td>" + st + "</td><td class=\"pacts\">" +
            (p.status === "planned" ? '<a class="btn btn-sm btn-warm" href="#submit/' + p.county_slug + "/" + encodeURIComponent(p.site_id) + '">填寫紀錄</a> <button class="btn btn-sm" data-pdate="' + p.id + '">改日期</button> <button class="btn btn-sm" data-cancel="' + p.id + '">取消</button>'
              : p.status === "cancelled" ? '<button class="btn btn-sm" data-restore="' + p.id + '">恢復</button>'
              : p.visit_id ? '<a class="btn btn-sm" href="#visit/' + p.visit_id + '">看紀錄</a>' : "") + "</td></tr>";
        }).join("") + "</tbody></table></div></div>";
    }).join("");
  }
  function bindTrips(plans) {
    var groups = {}, order = [];
    plans.forEach(function (p) { var k = p.trip || ""; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(p); });
    order.sort(function (a, b) { return tripRank(groups, a) - tripRank(groups, b); });
    function grp(el, attr) { var k = order[+el.getAttribute(attr)]; return { name: k, ps: groups[k] }; }
    $$("[data-tadd]").forEach(function (b) {
      b.onclick = function () {
        var g = grp(b, "data-tadd"), live = g.ps.filter(function (p) { return p.status !== "cancelled"; });
        var d1 = live.reduce(function (m, p) { return !m || p.planned_date < m ? p.planned_date : m; }, ""), d2 = live.reduce(function (m, p) { return planEnd(p) > m ? planEnd(p) : m; }, "");
        startTrip($("#ta-" + b.dataset.tadd).value, g.name ? { trip: g.name, d1: d1, d2: d2 || d1, addTo: true } : {});
      };
    });
    $$("[data-tedit]").forEach(function (b) { b.onclick = function () { $('[data-tform="' + b.dataset.tedit + '"]').hidden = false; }; });
    $$("[data-tclose]").forEach(function (b) { b.onclick = function () { $('[data-tform="' + b.dataset.tclose + '"]').hidden = true; }; });
    $$("[data-tform]").forEach(function (f) {
      f.d1.onchange = function () { if (f.d2.value < f.d1.value) f.d2.value = f.d1.value; f.d2.min = f.d1.value; };
      f.onsubmit = function (e) {
        e.preventDefault();
        var g = grp(f, "data-tform"), name = f.name.value.trim();
        if (f.d2.value < f.d1.value) return toast("結束日不能早於開始日");
        if (name !== g.name && groups[name]) { if (!confirm("已經有一個叫「" + name + "」的行程，要合併在一起嗎？")) return; }
        S.updatePlans(g.ps.map(function (p) { return p.id; }), { trip: name, planned_date: f.d1.value, planned_end: f.d2.value })
          .then(function () { toast("行程已更新", "thumb"); route(); }).catch(fail);
      };
    });
    $$("[data-tcancel]").forEach(function (b) {
      b.onclick = function () {
        var g = grp(b, "data-tcancel"), ids = g.ps.filter(function (p) { return p.status === "planned"; }).map(function (p) { return p.id; });
        if (!confirm("取消「" + g.name + "」裡還沒完成的 " + ids.length + " 筆預計到訪？已完成的紀錄不受影響。")) return;
        S.updatePlans(ids, { status: "cancelled" }).then(function () { toast("已取消行程「" + g.name + "」", "sad"); route(); }).catch(fail);
      };
    });
    $$("[data-cancel]").forEach(function (b) { b.onclick = function () { S.updatePlan(b.dataset.cancel, { status: "cancelled" }).then(function () { toast("已取消這處預計到訪", "sad"); route(); }).catch(fail); }; });
    $$("[data-restore]").forEach(function (b) { b.onclick = function () { S.updatePlan(b.dataset.restore, { status: "planned" }).then(function () { toast("恢復了！", "laugh"); route(); }).catch(fail); }; });
    $$("[data-pdate]").forEach(function (b) {
      b.onclick = function () {
        var p = plans.filter(function (x) { return x.id === b.dataset.pdate; })[0], tr = $('[data-pid="' + p.id + '"]');
        $(".pdate", tr).innerHTML = '<input type="date" class="pd1" value="' + p.planned_date + '"> ～ <input type="date" class="pd2" value="' + planEnd(p) + '">';
        $(".pacts", tr).innerHTML = '<button class="btn btn-sm btn-p psave">儲存</button> <button class="btn btn-sm pcancel">取消</button>';
        $(".pcancel", tr).onclick = route;
        $(".psave", tr).onclick = function () {
          var a = $(".pd1", tr).value, z = $(".pd2", tr).value || a;
          if (!a) return toast("請選日期"); if (z < a) return toast("結束日不能早於開始日");
          S.updatePlan(p.id, { planned_date: a, planned_end: z }).then(function () { toast("日期已更新", "thumb"); route(); }).catch(fail);
        };
      };
    });
  }

  /* ---------- 申請成為達人 ---------- */
  ROUTES.apply = function () {
    if (!ME) return needLogin("申請成為文資達人前，請先以 email 註冊登入。");
    if (isExpert()) { view.innerHTML = ara("laugh", "你已經是文資達人囉！<a href=\"#coverage\">找一處文資去訪查吧 →</a>", { cls: "ara-lg" }); return; }
    return S.myApplications().then(function (apps) {
      var pend = apps.filter(function (a) { return a.status === "pending"; })[0];
      if (pend) { view.innerHTML = "<h1>申請審查中</h1>" + ara("think", "你在 " + pend.created_at.slice(0, 10) + " 送出的申請，審查者正在看喔！核准後就能開始新增訪查紀錄，再等一下下～", { cls: "ara-lg" }); return; }
      view.innerHTML = "<h1>申請成為文資達人</h1>" + ara("present", "<b>歡迎加入文資達人！</b><br>寫下你和文化資產的故事：去過哪些地方、做過導覽或文史調查都可以，審查者會用來認識你～") + "<p>文資達人經審查核准後，可以新增訪查紀錄、上傳實地照片、登記預計到訪。審查重點：對文化資產的熟悉度、過往的走訪或解說經驗、是否願意遵守投稿規範。</p>" +
        (apps.some(function (a) { return a.status === "rejected"; }) ? '<div class="notice">你之前的申請未通過，可以補充資料後再申請。</div>' : "") +
        '<form class="card form" id="af"><div class="row"><label>公開署名<small>顯示在紀錄上</small><input type="text" name="dn" required maxlength="40" value="' + esc(ME.display_name) + '"></label>' +
        '<label>真實姓名<small>僅審查者可見</small><input type="text" name="rn" maxlength="40"></label><label>聯絡方式<small>僅審查者可見</small><input type="text" name="ct" maxlength="100" placeholder="電話或 LINE ID"></label></div>' +
        '<fieldset><legend>擅長／預計走訪的縣市</legend><div class="rate">' + IDX.counties.map(function (c) { return '<label><input type="checkbox" name="rg" value="' + c.slug + '">' + esc(c.label) + "</label>"; }).join("") + "</div></fieldset>" +
        '<label>專長與資歷<small>例如：導覽員、文史工作者、建築背景、走訪過的文資數量</small><textarea name="ex" required minlength="30" maxlength="2000"></textarea></label>' +
        '<label>作品或過往紀錄連結<small>選填：部落格、粉專、相簿</small><input type="url" name="su" maxlength="300"></label>' +
        '<label class="check"><input type="checkbox" name="ag" required><span>我已閱讀並同意<a href="#about" target="_blank">投稿規範與隱私說明</a>：只上傳本人實地拍攝、可公開的內容；尊重私人宅第與宗教場所；本站可審查、退回或下架不符規範的內容。真實姓名與聯絡方式僅供審查聯繫使用。</span></label>' +
        '<div class="btns"><button class="btn btn-p">送出申請</button></div></form>';
      $("#af").onsubmit = function (e) {
        e.preventDefault(); var f = this;
        S.applyExpert({ display_name: f.dn.value.trim(), real_name: f.rn.value.trim(), contact: f.ct.value.trim(),
          regions: $$("[name=rg]:checked", f).map(function (x) { return x.value; }), expertise: f.ex.value.trim(), sample_url: f.su.value.trim(), agree_terms: true })
          .then(function () { toast("申請送出了！審查結果出來我再通知你～", "thumb"); route(); }).catch(fail);
      };
    });
  };

  /* ---------- 登入（正式模式） ---------- */
  ROUTES.login = function () {
    if (S.mode === "demo") { view.innerHTML = '<div class="card"><h2>示範模式</h2><p>尚未連接資料庫，請用頁面上方的黃色列切換身分。正式上線設定方式見 README。</p></div>'; return; }
    if (ME) { location.hash = "#mine"; return; }
    view.innerHTML = '<h1>登入</h1>' + ara("explain", "輸入 email，我寄一封登入連結給你，點一下就登入了，不用記密碼喔！") + '<form class="card form" id="lf" style="max-width:440px"><label>Email<input type="email" name="e" required autocomplete="email"></label><p class="small muted">我們會寄一封登入連結到你的信箱，點連結即可登入，不需要密碼。第一次登入會自動建立會員。</p><div class="btns"><button class="btn btn-p">寄送登入連結</button></div></form>';
    $("#lf").onsubmit = function (e) { e.preventDefault(); S.signIn(this.e.value.trim()).then(function () { view.innerHTML = "<h1>請收信</h1>" + ara("thumb", "登入連結寄出去了！到信箱點連結就會回到這裡。<br><small>幾分鐘內沒收到的話，看一下垃圾郵件匣，或稍後再試一次。</small>", { cls: "ara-lg" }); }).catch(fail); };
  };

  /* ---------- 審查 ---------- */
  ROUTES.admin = function (tab) {
    if (!isReviewer()) return needLogin("只有審查者可以進入。");
    tab = tab || "visits";
    var tabs = { visits: "待審紀錄", apps: "達人申請", users: "會員與角色", audit: "稽核紀錄", corrections: "資料勘誤" };
    view.innerHTML = '<h1>審查</h1><div class="tabs">' + Object.keys(tabs).map(function (k) { return '<button data-t="' + k + '"' + (k === tab ? ' class="on"' : "") + ">" + tabs[k] + "</button>"; }).join("") + '</div><div id="pane"><p class="empty">載入中…</p></div>';
    $$(".tabs button").forEach(function (b) { b.onclick = function () { location.hash = "#admin/" + b.dataset.t; }; });
    var pane = $("#pane");
    if (tab === "visits") return S.listVisits({ status: "pending" }).then(function (list) {
      pane.innerHTML = list.length ? list.map(function (v) {
        return visitCard(v, { showSite: true }) + '<div class="card" style="margin:-6px 0 18px;border-top:0;border-radius:0 0 14px 14px"><div class="row"><input class="search" placeholder="審查意見（退回時必填）" id="n-' + v.id + '"></div><div class="btns" style="margin-top:8px">' +
          '<button class="btn btn-p btn-sm" data-ok="' + v.id + '">核准公開</button><button class="btn btn-sm btn-bad" data-no="' + v.id + '">退回</button></div></div>';
      }).join("") : ara("laugh", "沒有待審紀錄，全部審完了！辛苦了～");
      bindPhotos(pane);
      $$("[data-ok]").forEach(function (b) { b.onclick = function () { S.reviewVisit(b.dataset.ok, "published", $("#n-" + b.dataset.ok).value).then(function () { toast("核准公開了！", "thumb"); renderChrome(); route(); }).catch(fail); }; });
      $$("[data-no]").forEach(function (b) {
        b.onclick = function () { var n = $("#n-" + b.dataset.no).value.trim(); if (!n) return toast("退回請填寫審查意見"); S.reviewVisit(b.dataset.no, "rejected", n).then(function () { toast("已退回"); renderChrome(); route(); }).catch(fail); };
      });
    });
    if (tab === "apps") return S.listApplications().then(function (list) {
      pane.innerHTML = list.length ? list.map(function (a) {
        return '<div class="card" style="margin-bottom:14px"><div class="visit-h"><h3>' + esc(a.display_name) + '</h3><span class="tag st-' + ({ pending: "pending", approved: "published", rejected: "rejected" })[a.status] + '">' + ({ pending: "待審", approved: "已核准", rejected: "未通過" })[a.status] + "</span></div>" +
          '<p class="meta muted">申請日 ' + a.created_at.slice(0, 10) + "・真實姓名 " + esc(a.real_name || "—") + "・聯絡 " + esc(a.contact || "—") + "</p>" +
          "<p>" + (a.regions || []).map(function (r) { return '<span class="tag">' + esc((COUNTY[r] || {}).label || r) + "</span>"; }).join("") + "</p>" +
          '<p class="body" style="white-space:pre-wrap">' + esc(a.expertise) + "</p>" + (a.sample_url ? '<p><a href="' + esc(a.sample_url) + '" target="_blank" rel="noopener noreferrer">作品連結 ↗</a></p>' : "") +
          (a.review_note ? '<p class="muted">審查意見：' + esc(a.review_note) + "</p>" : "") +
          (a.status === "pending" ? '<input class="search" placeholder="審查意見" id="an-' + a.id + '"><div class="btns" style="margin-top:8px"><button class="btn btn-p btn-sm" data-aok="' + a.id + '">核准為達人</button><button class="btn btn-sm btn-bad" data-ano="' + a.id + '">不通過</button></div>' : "") + "</div>";
      }).join("") : ara("think", "目前沒有達人申請。");
      $$("[data-aok]").forEach(function (b) { b.onclick = function () { S.reviewApplication(b.dataset.aok, "approved", $("#an-" + b.dataset.aok).value).then(function () { toast("歡迎新達人加入！", "laugh"); renderChrome(); route(); }).catch(fail); }; });
      $$("[data-ano]").forEach(function (b) {
        b.onclick = function () { var n = $("#an-" + b.dataset.ano).value.trim(); if (!n) return toast("請填寫不通過的原因"); S.reviewApplication(b.dataset.ano, "rejected", n).then(function () { toast("已更新"); renderChrome(); route(); }).catch(fail); };
      });
    });
    if (tab === "users") return S.listProfiles().then(function (list) {
      var admin = roleOf() === "admin";
      pane.innerHTML = '<p class="muted small">「免審」的達人送出紀錄會直接公開。只有管理者能調整角色，每次調整都寫入稽核紀錄。</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>署名</th><th>加入</th><th>角色</th><th>免審</th><th></th></tr></thead><tbody>' +
        list.map(function (p) {
          return "<tr><td>" + esc(p.display_name) + "</td><td>" + (p.created_at || "").slice(0, 10) + '</td><td><select data-role="' + p.id + '"' + (admin ? "" : " disabled") + ">" + ["member", "expert", "reviewer", "admin"].map(function (r) { return '<option value="' + r + '"' + (p.role === r ? " selected" : "") + ">" + ROLE[r] + "</option>"; }).join("") +
            '</select></td><td><input type="checkbox" data-tr="' + p.id + '"' + (p.trusted ? " checked" : "") + (admin ? "" : " disabled") + "></td><td>" + (admin ? '<button class="btn btn-sm" data-save="' + p.id + '">更新</button>' : "") + "</td></tr>";
        }).join("") + "</tbody></table></div>";
      $$("[data-save]").forEach(function (b) {
        b.onclick = function () { var id = b.dataset.save; S.setRole(id, $('[data-role="' + id + '"]').value, $('[data-tr="' + id + '"]').checked).then(function () { toast("已更新"); if (ME && id === ME.id) return S.me().then(function (m) { ME = m; renderChrome(); }); }).catch(fail); };
      });
    });
    if (tab === "audit") return S.auditLog().then(function (list) {
      var A = { role_change: "角色變更", application_approved: "核准達人申請", application_rejected: "退回達人申請", visit_published: "核准紀錄", visit_rejected: "退回紀錄", visit_hidden: "下架紀錄", visit_delete: "刪除紀錄" };
      pane.innerHTML = list.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>時間</th><th>操作者</th><th>動作</th><th>對象</th><th>說明</th></tr></thead><tbody>' + list.map(function (x) {
        return "<tr><td>" + esc((x.at || "").replace("T", " ").slice(0, 19)) + "</td><td>" + esc(x.actor_name) + "</td><td>" + esc(A[x.action] || x.action) + "</td><td>" + esc(x.target_type) + " " + (x.target_type === "visit" ? '<a href="#visit/' + esc(x.target_id) + '">' + esc(x.target_id.slice(0, 8)) + "</a>" : esc(String(x.target_id).slice(0, 8))) + "</td><td><code class=\"small\">" + esc(x.detail ? JSON.stringify(x.detail) : "") + "</code></td></tr>";
      }).join("") + "</tbody></table></div>" : '<p class="empty">尚無稽核紀錄</p>';
    });
    if (tab === "corrections") return S.listVisits({}).then(function (list) {
      list = list.filter(function (v) { return v.correction; });
      pane.innerHTML = '<p class="muted small">達人回報知識網站或官方資料與現場不符的地方。請到 Cultural_Heritage／Cultural_Heritage2 修改對應縣市的 data/*.json。</p>' + (list.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>訪查日</th><th>文資</th><th>縣市</th><th>勘誤內容</th><th>達人</th><th>知識頁</th></tr></thead><tbody>' + list.map(function (v) {
        return "<tr><td>" + v.visit_date + "</td><td>" + siteLink(v) + "</td><td>" + esc((COUNTY[v.county_slug] || {}).label) + "</td><td>" + esc(v.correction) + "</td><td>" + esc(v.author) + '</td><td><a href="' + knowledgeUrl(v.county_slug, v.site_id) + '" target="_blank" rel="noopener">開啟</a></td></tr>';
      }).join("") + "</tbody></table></div>" : '<p class="empty">沒有勘誤回報</p>');
    });
  };

  /* ---------- 關於 ---------- */
  ROUTES.about = function () {
    view.innerHTML = '<div class="card"><h1>關於本站</h1>' +
      "<p>本站是「Allan Lo 和你逛文化」的姊妹站。知識網站整理文化資產的歷史與介紹；本站記錄達人實地走訪看到的現況、心得、照片與推薦指數，涵蓋三類：<b>有形文資</b>（古蹟、歷史建築等，記錄保存與開放現況）、<b>無形文資</b>（祭典、表演、工藝，記錄參與經驗與傳承現況）、<b>古物</b>（記錄展示與保存情形）。三類分開統計。兩邊互相連結：知識網站每處文資的詳情都有「達人實地訪查」按鈕，本站每筆紀錄也連回知識頁。</p>" +
      "<h2>投稿規範</h2><ol><li>只記錄本人實際到訪的經驗，參訪日期需真實。</li><li>照片須為本人拍攝。避免可辨識的路人臉孔、車牌、私宅內部；拍到人物請先取得同意或後製處理。</li><li>私人宅第、仍在使用的宗教場所與宿舍，請只在公共空間觀察，不擅入、不打擾住戶。</li>" +
      "<li>心得以現況觀察為主，不抄錄維基百科、官方網站或他人文章。</li><li>不得含商業廣告、人身攻擊或與文資無關的內容。</li><li>審查者可以要求修改、退回或下架不符規範的紀錄；下架或退回都會留下稽核紀錄。</li></ol>" +
      "<h2>隱私說明</h2><ul><li>蒐集項目：登入 email（僅用於登入與通知）、公開署名與簡介；申請達人時的真實姓名與聯絡方式只供審查者聯繫，不公開。</li>" +
      "<li>照片在你的瀏覽器裡先縮圖並移除 EXIF（拍攝裝置、GPS 位置等）才上傳。</li><li>公開內容：署名、訪查紀錄與照片。待審或退回的紀錄只有作者與審查者看得到。</li>" +
      "<li>你可以隨時修改或刪除尚未公開的紀錄；已公開的紀錄、帳號刪除請聯絡管理者處理。</li><li>審查、核准、角色變更等管理動作都寫入稽核紀錄。</li></ul>" +
      '<p class="muted">資料庫：' + (S.mode === "demo" ? "示範模式（瀏覽器本機）" : "Supabase") + "；文資清單產生日 " + esc(IDX.meta.generated) + "。</p></div>";
  };

  /* ---------- 啟動 ---------- */
  function boot() {
    return Promise.all([loadIndex(), S.init()]).then(function () { return S.me(); }).then(function (m) { ME = m; renderChrome(); route(); })
      .catch(function (e) { view.innerHTML = '<div class="notice bad">網站啟動失敗：' + esc(e.message || e) + "</div>"; console.error(e); });
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("chv-auth", function () { S.me().then(function (m) { ME = m; renderChrome(); route(); }); });
  boot();
})();
