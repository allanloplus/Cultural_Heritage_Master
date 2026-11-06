/* 文資達人訪查 — 單頁應用
 * 路由（網址 # 後面）：
 *   home                     總覽
 *   coverage                 查核資訊：各縣市文資數、已訪查數、覆蓋率
 *   county/<縣市>            縣市文資清單（可篩選未訪查、需回訪）
 *   site/<縣市>/<景點 id>     單一文資的現況與所有訪查紀錄（對應文資知識網站 <網站>/<縣市>/#map/<景點 id>）
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
  function toast(msg) { var t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3200); }
  function fail(e) { console.error(e); toast("⚠ " + (e && e.message || e)); }
  function roleOf() { return ME ? ME.role : "anon"; }
  function isExpert() { return ["expert", "reviewer", "admin"].indexOf(roleOf()) >= 0; }
  function isReviewer() { return roleOf() === "reviewer" || roleOf() === "admin"; }
  var ROLE = { anon: "訪客", member: "會員", expert: "文資達人", reviewer: "審查者", admin: "管理者" };
  var STATUS = { published: "已公開", pending: "待審", rejected: "退回", hidden: "已下架" };
  var CONDS = ["良好", "尚可", "待修繕", "修復施工中", "閉館或封閉", "已消失或拆除"];
  var OPENS = ["正常開放", "限時或預約", "僅能看外觀", "未開放"];
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

  function knowledgeUrl(slug, id) { var c = COUNTY[slug]; return c ? c.base + (id ? "#map/" + encodeURIComponent(id) : "") : CFG.knowledgeHome; }
  function officialUrl(u) { return u && u.charAt(0) === "~" ? IDX.meta.officialPrefix + u.slice(1) : u; }
  function site(slug, id) { return SITE[slug + "/" + id]; }
  function siteLink(v) { return '<a href="#site/' + v.county_slug + "/" + encodeURIComponent(v.site_id) + '">' + esc(v.site_name) + "</a>"; }
  function stTag(s) { return '<span class="tag st-' + s + '">' + STATUS[s] + "</span>"; }

  /* ---------- 文資清單 ---------- */
  function loadIndex() {
    return fetch("data/heritage-index.json").then(function (r) { return r.json(); }).then(function (d) {
      IDX = d;
      d.counties.forEach(function (c) {
        COUNTY[c.slug] = c;
        c.list = c.sites.map(function (a) {
          var s = { slug: c.slug, id: a[0], name: a[1], category: a[2], town: a[3], lat: a[4], lng: a[5], short: a[6] || a[1], url: officialUrl(a[7]) };
          SITE[c.slug + "/" + s.id] = s; return s;
        });
      });
    });
  }
  function refreshStats() { return S.siteStats().then(function (m) { STATS = m; }); }

  /* 縣市覆蓋統計 */
  function coverage(c, plans) {
    var r = { total: c.list.length, visited: 0, fresh: 0, stale: 0, visits: 0, planned: 0, cats: {} };
    var plannedSet = {};
    (plans || []).forEach(function (p) { if (p.county_slug === c.slug && p.status === "planned") plannedSet[p.site_id] = 1; });
    c.list.forEach(function (s) {
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
    view.innerHTML = '<p class="empty">載入中…</p>';
    window.scrollTo(0, 0);
    Promise.resolve().then(function () { return fn.apply(null, h.slice(1)); }).catch(function (e) {
      view.innerHTML = '<div class="notice bad">發生錯誤：' + esc(e.message || e) + "</div>"; console.error(e);
    });
  }

  /* ---------- 共用片段 ---------- */
  function visitCard(v, opt) {
    opt = opt || {};
    var s = site(v.county_slug, v.site_id), c = COUNTY[v.county_slug];
    var mine = ME && v.user_id === ME.id;
    return '<article class="visit" id="v-' + v.id + '">' +
      '<div class="visit-h"><h3>' + (opt.showSite ? siteLink(v) + ' <small class="muted">' + esc(c ? c.label : "") + "</small>" : "訪查 " + esc(v.visit_date)) + "</h3>" +
      "<div>" + stars(v.recommend) + " " + (v.status !== "published" ? stTag(v.status) : "") + (v.demo ? '<span class="tag">示範</span>' : "") + "</div></div>" +
      '<p class="meta">' + (opt.showSite ? "訪查日 " + esc(v.visit_date) + "・" : "") + '達人 <a href="#expert/' + v.user_id + '">' + esc(v.author) + "</a>" +
      (v.updated_at && v.updated_at.slice(0, 10) !== v.created_at.slice(0, 10) ? "・更新於 " + v.updated_at.slice(0, 10) : "") + "</p>" +
      '<div class="facts"><span><b>現況</b><span class="cond-' + esc(v.condition) + '">' + esc(v.condition) + "</span></span><span><b>開放</b>" + esc(v.open_status) + "</span>" +
      (v.duration_min ? "<span><b>停留</b>約 " + v.duration_min + " 分</span>" : "") + (v.fee ? "<span><b>費用</b>" + esc(v.fee) + "</span>" : "") +
      (v.crowd ? "<span><b>人潮</b>" + esc(v.crowd) + "</span>" : "") + (v.accessible ? "<span><b>無障礙</b>" + esc(v.accessible) + "</span>" : "") + "</div>" +
      '<p class="body">' + (v.mood ? '<span class="mood" title="心情">' + (MOODS[v.mood] || "") + " " + esc(v.mood) + "</span>　" : "") + esc(opt.short && v.body.length > 160 ? v.body.slice(0, 160) + "…" : v.body) + "</p>" +
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
      (s ? '<a class="btn btn-sm" href="' + knowledgeUrl(v.county_slug, v.site_id) + '" target="_blank" rel="noopener">文資知識頁</a>' : "") +
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
    view.innerHTML = '<div class="card"><h2>需要登入</h2><p>' + esc(msg) + "</p>" +
      (S.mode === "demo" ? "<p>示範模式：請在頁面上方黃色列切換身分。</p>" : '<a class="btn btn-p" href="#login">登入</a>') + "</div>";
  }

  /* ---------- 總覽 ---------- */
  ROUTES.home = function () {
    return Promise.all([refreshStats(), S.listVisits({ status: "published", limit: 6 }), S.expertStats(), S.listPlans({})]).then(function (r) {
      var latest = r[1], experts = r[2], plans = r[3];
      var tot = 0, vis = 0, visits = 0, fresh = 0;
      var rows = IDX.counties.map(function (c) { var k = coverage(c, plans); tot += k.total; vis += k.visited; visits += k.visits; fresh += k.fresh; return { c: c, k: k }; });
      var upcoming = plans.filter(function (p) { return p.status === "planned" && planEnd(p) >= today(); });
      view.innerHTML =
        '<section><h1>文化資產的實地現況與推薦</h1>' +
        '<p class="muted">「<a href="' + CFG.knowledgeHome + '" target="_blank" rel="noopener">Allan Lo 和你逛文化</a>」整理了來自文化部文化資產局與維基百科的文資知識；這裡則由經過審查核准的<b>文資達人</b>親自走訪，記錄每一處文化資產現在的樣子：到訪日期、保存現況、開放情形、參訪心得、實地照片與推薦指數。</p>' +
        '<div class="kpis">' +
        kpi(tot.toLocaleString(), "全臺文化資產（處）") + kpi(vis.toLocaleString(), "已有訪查紀錄（處）") + kpi(pct(vis, tot) + "%", "訪查覆蓋率") +
        kpi(fresh.toLocaleString(), "近一年內更新（處）") + kpi(visits.toLocaleString(), "公開訪查紀錄（筆）") + kpi(experts.length, "核准達人（位）") + "</div>" +
        '<div class="btns">' + (isExpert() ? '<a class="btn btn-warm" href="#coverage">挑一處文資去訪查</a>' : '<a class="btn btn-warm" href="#apply">申請成為文資達人</a>') +
        '<a class="btn" href="#coverage">看各縣市查核資訊</a></div></section>' +
        '<section class="sec"><div class="sec-h"><h2>最新訪查</h2><a href="#latest">全部紀錄 →</a></div>' +
        (latest.length ? latest.map(function (v) { return visitCard(v, { showSite: true, short: true }); }).join("") : '<p class="empty">還沒有公開的訪查紀錄。</p>') + "</section>" +
        '<section class="sec"><div class="sec-h"><h2>各縣市訪查覆蓋率</h2><a href="#coverage">詳細查核資訊 →</a></div>' +
        '<div class="tbl-wrap"><table class="tbl"><tbody>' + rows.map(function (x) {
          return '<tr><td><a href="#county/' + x.c.slug + '">' + esc(x.c.label) + '</a></td><td class="n">' + x.k.visited + " / " + x.k.total + '</td><td style="width:50%"><div class="bar"><i style="width:' + pct(x.k.visited, x.k.total) + '%"></i></div></td><td class="n">' + pct(x.k.visited, x.k.total) + "%</td></tr>";
        }).join("") + "</tbody></table></div></section>" +
        (upcoming.length ? '<section class="sec"><h2>達人即將到訪</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>預計日期</th><th>文資</th><th>縣市</th><th>行程</th><th>達人</th></tr></thead><tbody>' +
          upcoming.slice(0, 12).map(function (p) { return "<tr><td>" + planRange(p) + "</td><td>" + siteLink(p) + "</td><td>" + esc((COUNTY[p.county_slug] || {}).label) + "</td><td>" + esc(p.trip || "") + '</td><td><a href="#expert/' + p.user_id + '">' + esc(p.author) + "</a></td></tr>"; }).join("") +
          "</tbody></table></div></section>" : "");
      bindPhotos(view);
    });
  };
  function kpi(v, l) { return '<div class="kpi"><div class="v">' + v + '</div><div class="l">' + l + "</div></div>"; }

  /* ---------- 查核資訊 ---------- */
  ROUTES.coverage = function () {
    return Promise.all([refreshStats(), S.listPlans({})]).then(function (r) {
      var plans = r[1], T = { total: 0, visited: 0, fresh: 0, stale: 0, visits: 0, planned: 0 }, cats = {};
      var rows = IDX.counties.map(function (c) {
        var k = coverage(c, plans);
        Object.keys(T).forEach(function (f) { T[f] += k[f]; });
        Object.keys(k.cats).forEach(function (n) { var x = cats[n] || (cats[n] = { total: 0, visited: 0 }); x.total += k.cats[n].total; x.visited += k.cats[n].visited; });
        return { c: c, k: k };
      });
      var catOrder = ["國定古蹟", "直轄市定古蹟", "市定古蹟", "縣定古蹟", "歷史建築", "紀念建築", "聚落建築群", "考古遺址", "文化景觀"];
      var catNames = Object.keys(cats).sort(function (a, b) { return (catOrder.indexOf(a) + 99) % 99 - (catOrder.indexOf(b) + 99) % 99; });
      view.innerHTML = '<h1>查核資訊</h1><p class="muted">對照文資知識網站收錄的 ' + T.total.toLocaleString() + ' 處有形文化資產（資料產生日 ' + esc(IDX.meta.generated) +
        '），統計各縣市已有多少處有實地訪查紀錄。「近一年」指最近一次公開訪查在 365 天內；「需回訪」指最近一次訪查已超過 ' + Math.round(CFG.staleDays / 365) + ' 年；「預計到訪」為達人已登記但尚未完成的處數。</p>' +
        '<div class="kpis">' + kpi(T.total.toLocaleString(), "文化資產（處）") + kpi(T.visited.toLocaleString(), "已訪查（處）") + kpi(pct(T.visited, T.total) + "%", "覆蓋率") +
        kpi((T.total - T.visited).toLocaleString(), "尚未訪查（處）") + kpi(T.fresh.toLocaleString(), "近一年更新（處）") + kpi(T.planned.toLocaleString(), "預計到訪（處）") + "</div>" +
        '<div class="legend"><span><i style="background:var(--teal)"></i>已訪查</span><span><i style="background:var(--sun)"></i>預計到訪（未訪查部分不重複計算時以實際為準）</span></div>' +
        '<div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>縣市</th><th>知識網站</th><th class="n">文資數</th><th class="n">已訪查</th><th class="n">覆蓋率</th><th style="min-width:140px">進度</th><th class="n">近一年</th><th class="n">需回訪</th><th class="n">預計到訪</th><th class="n">紀錄筆數</th></tr></thead><tbody>' +
        rows.map(function (x) {
          var k = x.k, p1 = pct(k.visited, k.total), p2 = Math.min(100 - p1, pct(k.planned, k.total));
          return '<tr><td><a href="#county/' + x.c.slug + '">' + esc(x.c.label) + '</a></td><td><a href="' + x.c.base + '" target="_blank" rel="noopener">第' + (x.c.site === 2 ? "二" : "一") + "網站</a></td>" +
            '<td class="n">' + k.total + '</td><td class="n">' + k.visited + '</td><td class="n">' + p1 + "%</td>" +
            '<td><div class="bar two"><i style="width:' + p1 + '%"></i><i style="width:' + p2 + '%"></i></div></td>' +
            '<td class="n">' + k.fresh + '</td><td class="n">' + k.stale + '</td><td class="n">' + k.planned + '</td><td class="n">' + k.visits + "</td></tr>";
        }).join("") + '</tbody><tfoot><tr><td>合計</td><td></td><td class="n">' + T.total + '</td><td class="n">' + T.visited + '</td><td class="n">' + pct(T.visited, T.total) + '%</td><td></td><td class="n">' + T.fresh + '</td><td class="n">' + T.stale + '</td><td class="n">' + T.planned + '</td><td class="n">' + T.visits + "</td></tr></tfoot></table></div>" +
        '<section class="sec"><h2>依文資類別</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>類別</th><th class="n">文資數</th><th class="n">已訪查</th><th class="n">覆蓋率</th><th style="width:40%">進度</th></tr></thead><tbody>' +
        catNames.map(function (n) { var x = cats[n]; return "<tr><td>" + esc(n) + '</td><td class="n">' + x.total + '</td><td class="n">' + x.visited + '</td><td class="n">' + pct(x.visited, x.total) + '%</td><td><div class="bar"><i style="width:' + pct(x.visited, x.total) + '%"></i></div></td></tr>'; }).join("") +
        "</tbody></table></div></section>" +
        '<p><button class="btn" id="csv">下載查核資訊 CSV</button></p>';
      $("#csv").onclick = function () {
        var lines = [["縣市", "網站", "文資數", "已訪查", "覆蓋率%", "近一年", "需回訪", "預計到訪", "紀錄筆數"]].concat(rows.map(function (x) {
          return [x.c.label, x.c.site, x.k.total, x.k.visited, pct(x.k.visited, x.k.total), x.k.fresh, x.k.stale, x.k.planned, x.k.visits];
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
  ROUTES.county = function (slug) {
    var c = COUNTY[slug]; if (!c) { location.hash = "#coverage"; return; }
    return Promise.all([refreshStats(), S.listPlans({ county: slug })]).then(function (r) {
      var plans = r[1], k = coverage(c, plans), planned = {};
      plans.forEach(function (p) { if (p.status === "planned") (planned[p.site_id] = planned[p.site_id] || []).push(p); });
      var towns = [], cats = [];
      c.list.forEach(function (s) { if (s.town && towns.indexOf(s.town) < 0) towns.push(s.town); if (cats.indexOf(s.category) < 0) cats.push(s.category); });
      view.innerHTML = '<p class="crumb"><a href="#coverage">查核資訊</a> › ' + esc(c.label) + "</p>" +
        "<h1>" + esc(c.label) + '的文化資產訪查</h1><div class="btns"><a class="btn" href="' + c.base + '" target="_blank" rel="noopener">' + esc(c.label) + "文資知識網站 ↗</a>" +
        (isExpert() ? '<button class="btn btn-warm" id="tripBtn">規劃訪查行程</button>' : "") + "</div>" +
        '<form class="card form" id="tripForm" hidden style="margin-top:12px"><h3>規劃訪查行程</h3><p class="small muted">在下方清單勾選這趟要去的文化資產（可用鄉鎮、類別篩選，例如先篩「尚未訪查」），再填行程名稱與日期，一次登記成預計到訪。到現場後在「我的訪查」逐一填寫紀錄。</p>' +
        '<div class="row"><label>行程名稱<input type="text" name="trip" required maxlength="40" placeholder="例如：2026 ' + esc(c.label.replace(/（.*）/, "")) + '行"></label><label>開始日<input type="date" name="d1" required></label><label>結束日<input type="date" name="d2" required></label></div>' +
        '<p><b id="pickCnt">已勾選 0 處</b>　<button type="button" class="btn btn-sm" id="pickClr">清除勾選</button></p><div class="btns"><button class="btn btn-p">登記行程</button><button type="button" class="btn" id="tripCancel">取消</button></div></form>' +
        '<div class="kpis">' + kpi(k.total, "文資（處）") + kpi(k.visited, "已訪查") + kpi(pct(k.visited, k.total) + "%", "覆蓋率") + kpi(k.total - k.visited, "尚未訪查") + kpi(k.stale, "需回訪") + kpi(k.planned, "預計到訪") + "</div>" +
        '<div class="filters"><input class="search" id="q" type="search" placeholder="搜尋名稱" style="max-width:220px">' +
        '<select id="fs"><option value="">全部狀態</option><option value="none">尚未訪查</option><option value="done">已訪查</option><option value="stale">需回訪</option><option value="plan">預計到訪</option></select>' +
        '<select id="fc"><option value="">全部類別</option>' + cats.map(function (x) { return "<option>" + esc(x) + "</option>"; }).join("") + "</select>" +
        (towns.length ? '<select id="ft"><option value="">全部鄉鎮市區</option>' + towns.map(function (x) { return "<option>" + esc(x) + "</option>"; }).join("") + "</select>" : "") +
        '</div><p class="muted small" id="cnt"></p><div class="tbl-wrap"><table class="tbl"><thead><tr><th class="pick" hidden>選</th><th>文化資產</th><th>類別</th><th>鄉鎮</th><th>最近訪查</th><th>現況</th><th>推薦</th><th class="n">紀錄</th><th>連結</th></tr></thead><tbody id="rows"></tbody></table></div>';
      var picking = false, picked = {};
      function draw() {
        var q = $("#q").value.trim(), fs = $("#fs").value, fc = $("#fc").value, ft = $("#ft") ? $("#ft").value : "";
        var list = c.list.filter(function (s) {
          var st = STATS[slug + "/" + s.id];
          if (q && s.name.indexOf(q) < 0) return false;
          if (fc && s.category !== fc) return false;
          if (ft && s.town !== ft) return false;
          if (fs === "none" && st) return false;
          if (fs === "done" && !st) return false;
          if (fs === "stale" && !(st && daysAgo(st.last_visit) > CFG.staleDays)) return false;
          if (fs === "plan" && !planned[s.id]) return false;
          return true;
        });
        $("#cnt").textContent = "共 " + list.length + " 處";
        $("#rows").innerHTML = list.map(function (s) {
          var st = STATS[slug + "/" + s.id];
          return "<tr>" + (picking ? '<td><input type="checkbox" data-pick="' + esc(s.id) + '"' + (picked[s.id] ? " checked" : "") + ' aria-label="選擇 ' + esc(s.name) + '"></td>' : "") +
            '<td><a href="#site/' + slug + "/" + encodeURIComponent(s.id) + '">' + esc(s.name) + "</a>" + (planned[s.id] ? ' <span class="tag st-pending">預計 ' + planRange(planned[s.id][0]) + "</span>" : "") + "</td><td>" + esc(s.category) + "</td><td>" + esc(s.town) + "</td>" +
            (st ? "<td>" + st.last_visit + '</td><td class="cond-' + esc(st.last_condition) + '">' + esc(st.last_condition) + "</td><td>" + stars(st.avg_recommend) + '</td><td class="n">' + st.visits + "</td>"
              : '<td class="muted">尚未訪查</td><td></td><td></td><td class="n">0</td>') +
            '<td><a href="' + knowledgeUrl(slug, s.id) + '" target="_blank" rel="noopener">知識頁</a></td></tr>';
        }).join("") || '<tr><td colspan="9" class="empty">沒有符合條件的文資</td></tr>';
        $$("th.pick").forEach(function (th) { th.hidden = !picking; });
        $$("[data-pick]").forEach(function (cb) { cb.onchange = function () { if (cb.checked) picked[cb.dataset.pick] = 1; else delete picked[cb.dataset.pick]; cntPick(); }; });
      }
      function cntPick() { var e = $("#pickCnt"); if (e) e.textContent = "已勾選 " + Object.keys(picked).length + " 處"; }
      var tb = $("#tripBtn"), tf = $("#tripForm");
      if (tb) {
        tb.onclick = function () { picking = true; tf.hidden = false; tb.hidden = true; draw(); };
        $("#tripCancel").onclick = function () { picking = false; picked = {}; tf.hidden = true; tb.hidden = false; draw(); cntPick(); };
        $("#pickClr").onclick = function () { picked = {}; draw(); cntPick(); };
        tf.d1.onchange = function () { if (!tf.d2.value || tf.d2.value < tf.d1.value) tf.d2.value = tf.d1.value; tf.d2.min = tf.d1.value; };
        tf.onsubmit = function (e) {
          e.preventDefault();
          var ids = Object.keys(picked);
          if (!ids.length) return toast("請在清單勾選至少一處文化資產");
          if (tf.d2.value < tf.d1.value) return toast("結束日不能早於開始日");
          S.savePlans(ids.map(function (sid) { var x = site(slug, sid); return { county_slug: slug, site_id: sid, site_name: x.name, planned_date: tf.d1.value, planned_end: tf.d2.value, trip: tf.trip.value.trim() }; }))
            .then(function () { toast("已登記行程：" + ids.length + " 處"); location.hash = "#mine"; }).catch(fail);
        };
      }
      ["q", "fs", "fc", "ft"].forEach(function (id) { var el = $("#" + id); if (el) el.oninput = draw; });
      draw();
    });
  };

  /* ---------- 單一文資 ---------- */
  ROUTES.site = function (slug, id) {
    var s = site(slug, id), c = COUNTY[slug];
    if (!s) { view.innerHTML = '<div class="notice bad">找不到這處文化資產（' + esc(slug + "/" + id) + '）。可能是文資知識網站已更新編號，請回<a href="#coverage">查核資訊</a>查詢。</div>'; return; }
    return Promise.all([S.listVisits({ county: slug, site: id }), S.listPlans({ county: slug, site: id })]).then(function (r) {
      var visits = r[0], plans = r[1].filter(function (p) { return p.status === "planned"; });
      var pub = visits.filter(function (v) { return v.status === "published"; });
      var last = pub[0], avg = pub.length ? pub.reduce(function (a, v) { return a + v.recommend; }, 0) / pub.length : 0;
      var myPlan = ME && plans.filter(function (p) { return p.user_id === ME.id; })[0];
      var near = [];
      pub.forEach(function (v) { (v.nearby || []).forEach(function (n) { near.push(Object.assign({ src: esc(v.author) + "，" + v.visit_date }, n)); }); });
      near.sort(function (a, b) { return NEARBY.indexOf(a.type) - NEARBY.indexOf(b.type); });
      view.innerHTML = '<p class="crumb"><a href="#coverage">查核資訊</a> › <a href="#county/' + slug + '">' + esc(c.label) + "</a> › " + esc(s.name) + "</p>" +
        "<h1>" + esc(s.name) + '</h1><p><span class="tag">' + esc(s.category) + "</span>" + (s.town ? '<span class="tag">' + esc(s.town) + "</span>" : "") + "</p>" +
        '<div class="linkpair"><a class="k" href="' + knowledgeUrl(slug, id) + '" target="_blank" rel="noopener"><b>文資知識資料 ↗</b><span class="muted small">歷史、介紹、語音導覽、照片與官方資訊（Allan Lo 和你逛文化）</span></a>' +
        '<a class="v" href="#site/' + slug + "/" + encodeURIComponent(id) + '"><b>現況與推薦（本頁）</b><span class="muted small">達人實地訪查的心得、照片與推薦指數</span></a></div>' +
        '<div class="kpis">' + kpi(pub.length, "公開訪查紀錄") + kpi(last ? last.visit_date : "—", "最近訪查日") +
        kpi(last ? '<span class="cond-' + esc(last.condition) + '">' + esc(last.condition) + "</span>" : "—", "最新現況") + kpi(last ? esc(last.open_status) : "—", "開放情形") +
        kpi(pub.length ? avg.toFixed(1) + " " + stars(avg) : "—", "平均推薦指數") + "</div>" +
        (last && daysAgo(last.visit_date) > CFG.staleDays ? '<div class="notice">最近一次訪查已超過 ' + Math.round(CFG.staleDays / 365) + " 年，現況可能已改變，歡迎達人回訪更新。</div>" : "") +
        '<div class="btns">' + (isExpert() ? '<a class="btn btn-warm" href="#submit/' + slug + "/" + encodeURIComponent(id) + '">新增訪查紀錄</a>' +
          (myPlan ? '<span class="tag st-pending">你預計 ' + planRange(myPlan) + " 到訪" + (myPlan.trip ? "（" + esc(myPlan.trip) + "）" : "") + "</span>" : '<button class="btn" id="planBtn">登記預計到訪</button>') :
          '<a class="btn" href="#apply">成為達人來更新這裡</a>') +
        (s.url ? '<a class="btn" href="' + esc(s.url) + '" target="_blank" rel="noopener">文資局官方資料 ↗</a>' : "") +
        (s.lat ? '<a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=' + s.lat + "," + s.lng + '" target="_blank" rel="noopener">導航</a>' : "") + "</div>" +
        '<form class="card form" id="planForm" hidden style="margin-top:12px"><h3>登記預計到訪</h3><div class="row"><label>預計日期<input type="date" name="d" required min="' + today() + '"></label><label>備註<input type="text" name="n" maxlength="200" placeholder="例如：配合週末導覽場次"></label></div><div class="btns"><button class="btn btn-p">登記</button></div></form>' +
        (plans.length ? '<p class="muted small" style="margin-top:10px">已登記預計到訪：' + plans.map(function (p) { return '<a href="#expert/' + p.user_id + '">' + esc(p.author) + "</a>（" + planRange(p) + "）"; }).join("、") + "</p>" : "") +
        (near.length ? '<section class="sec"><h2>達人的附近推薦</h2><p class="muted small">美食、住宿、交通等資訊來自達人訪查當時的經驗，可能已有變動。</p>' + nearbyList(near, true) + "</section>" : "") +
        '<section class="sec"><h2>訪查紀錄</h2>' + (visits.length ? visits.map(function (v) { return visitCard(v); }).join("") : '<p class="empty">這裡還沒有訪查紀錄，等你來當第一位！</p>') + "</section>";
      bindPhotos(view);
      var pb = $("#planBtn"), pf = $("#planForm");
      if (pb) pb.onclick = function () { pf.hidden = false; pb.hidden = true; };
      if (pf) pf.onsubmit = function (e) {
        e.preventDefault();
        S.savePlan({ county_slug: slug, site_id: id, site_name: s.name, planned_date: pf.d.value, note: pf.n.value }).then(function () { toast("已登記預計到訪"); route(); }).catch(fail);
      };
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
        $("#list").innerHTML = l.length ? l.map(function (v) { return visitCard(v, { showSite: true, short: true }); }).join("") : '<p class="empty">沒有紀錄</p>';
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
      view.innerHTML = '<h1>文資達人</h1><p class="muted">文資達人須經申請與審查核准，才能新增訪查紀錄。下表統計每位達人的公開紀錄，以及「預計到訪」與實際完成的情形。</p>' +
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
        '<section class="sec"><h2>訪查紀錄</h2>' + (visits.length ? visits.map(function (v) { return visitCard(v, { showSite: true, short: true }); }).join("") : '<p class="empty">還沒有紀錄。</p>') + "</section>";
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
      view.innerHTML = '<p class="crumb">' + (s ? '<a href="#site/' + slug + "/" + encodeURIComponent(id) + '">' + esc(s.name) + "</a> › " : "") + (v.id ? "修改訪查紀錄" : "新增訪查紀錄") + "</p>" +
        "<h1>" + (v.id ? "修改訪查紀錄" : "新增訪查紀錄") + "</h1>" +
        (!ME.trusted && !isReviewer() ? '<div class="notice">送出後會先進入審查，審查者核准後才會公開。修改已公開的紀錄也會重新送審。</div>' : "") +
        '<form class="form" id="vf">' +
        '<fieldset><legend>訪查地點</legend><div class="row"><label>縣市<select name="county" required>' + IDX.counties.map(function (c) { return '<option value="' + c.slug + '"' + (c.slug === slug ? " selected" : "") + ">" + esc(c.label) + "</option>"; }).join("") + "</select></label>" +
        '<label>文化資產<input type="text" name="siteq" list="siteopts" placeholder="輸入名稱搜尋" required autocomplete="off" value="' + esc(s ? s.name : "") + '"><datalist id="siteopts"></datalist></label></div>' +
        '<p class="small muted" id="siteHint"></p>' +
        (plans.length && !v.id ? '<label>對應我的預計到訪<select name="plan"><option value="">（無）</option>' + plans.map(function (p) { return '<option value="' + p.id + '"' + (p.county_slug === slug && p.site_id === id ? " selected" : "") + ">" + planRange(p) + " " + (p.trip ? "［" + esc(p.trip) + "］" : "") + esc(p.site_name) + "</option>"; }).join("") + "</select></label>" : "") + "</fieldset>" +
        '<fieldset><legend>現況</legend><div class="row">' +
        '<label>實際參訪日期<input type="date" name="visit_date" required max="' + today() + '" value="' + esc(v.visit_date || today()) + '"></label>' +
        '<label>文資現況<select name="condition" required>' + CONDS.map(function (x) { return "<option" + (v.condition === x ? " selected" : "") + ">" + x + "</option>"; }).join("") + "</select></label>" +
        '<label>開放情形<select name="open_status" required>' + OPENS.map(function (x) { return "<option" + (v.open_status === x ? " selected" : "") + ">" + x + "</option>"; }).join("") + "</select></label>" +
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
      function fillOpts() {
        var c = COUNTY[f.county.value];
        $("#siteopts").innerHTML = c.list.map(function (x) { return '<option value="' + esc(x.name) + '">' + esc(x.category + (x.town ? "・" + x.town : "")) + "</option>"; }).join("");
      }
      function pick() {
        var c = COUNTY[f.county.value], n = f.siteq.value.trim();
        chosen = c.list.filter(function (x) { return x.name === n; })[0] || null;
        $("#siteHint").innerHTML = chosen ? "對應知識頁：" + '<a href="' + knowledgeUrl(c.slug, chosen.id) + '" target="_blank" rel="noopener">' + esc(chosen.name) + " ↗</a>" : (n ? "請從清單選擇一處文化資產" : "");
      }
      f.county.onchange = function () { f.siteq.value = ""; fillOpts(); pick(); };
      f.siteq.oninput = pick;
      if (f.plan) f.plan.onchange = function () {
        var p = plans.filter(function (x) { return x.id === f.plan.value; })[0];
        if (p) { f.county.value = p.county_slug; fillOpts(); f.siteq.value = p.site_name; pick(); }
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
      if (del) del.onclick = function () { if (confirm("確定刪除這筆紀錄？")) S.deleteVisit(v.id).then(function () { toast("已刪除"); location.hash = "#mine"; }).catch(fail); };
      f.onsubmit = function (e) {
        e.preventDefault();
        pick();
        if (!chosen) return toast("請從清單選擇一處文化資產");
        if (!f.querySelector('[name=recommend]:checked')) return toast("請選擇推薦指數");
        var scores = {};
        Object.keys(SCORE).forEach(function (k) { var x = f.querySelector('[name=s_' + k + ']:checked'); if (x) scores[k] = +x.value; });
        var data = {
          county_slug: f.county.value, site_id: chosen.id, site_name: chosen.name, category: chosen.category,
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
          toast(ME.trusted || isReviewer() ? "已儲存並公開" : "已送出，等待審查");
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
      view.innerHTML = "<h1>我的訪查</h1>" +
        (isExpert() ? '<div class="btns"><a class="btn btn-warm" href="#coverage">找文資去訪查</a></div>' +
          '<section class="sec"><h2>我的訪查行程與預計到訪</h2>' + (plans.length ? tripGroups(plans, t) : '<p class="muted">還沒有登記。到縣市頁按「規劃訪查行程」一次勾選多處，或在文資頁按「登記預計到訪」。</p>') + "</section>" +
          '<section class="sec"><h2>我的紀錄（' + visits.length + "）</h2>" + (visits.length ? visits.map(function (v) { return visitCard(v, { showSite: true, short: true }); }).join("") : '<p class="empty">還沒有紀錄</p>') + "</section>"
          : '<div class="card"><p>你目前是一般會員。成為文資達人後才能新增訪查紀錄。</p>' + (apps.length ? "<p>申請狀態：" + apps.map(function (a) { return a.created_at.slice(0, 10) + " " + ({ pending: "審查中", approved: "已核准", rejected: "未通過" })[a.status] + (a.review_note ? "（" + esc(a.review_note) + "）" : ""); }).join("；") + "</p>" : "") + '<a class="btn btn-warm" href="#apply">申請成為達人</a></div>') +
        '<section class="sec"><h2>個人資料</h2><form class="card form" id="pf"><label>公開署名<input type="text" name="n" required maxlength="40" value="' + esc(ME.display_name) + '"></label>' +
        '<label>簡介<input type="text" name="b" maxlength="300" value="' + esc(ME.bio || "") + '"></label><div class="btns"><button class="btn btn-p">儲存</button></div></form></section>';
      bindPhotos(view);
      $$("[data-cancel]").forEach(function (b) { b.onclick = function () { S.updatePlan(b.dataset.cancel, { status: "cancelled" }).then(route).catch(fail); }; });
      $("#pf").onsubmit = function (e) { e.preventDefault(); S.updateProfile({ display_name: this.n.value.trim(), bio: this.b.value.trim(), regions: ME.regions || [] }).then(function (m) { ME = m; renderChrome(); toast("已儲存"); }).catch(fail); };
    });
  };

  function tripGroups(plans, t) {
    var groups = {}, order = [];
    plans.forEach(function (p) { var k = p.trip || "（未分行程）"; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(p); });
    return order.map(function (k) {
      var ps = groups[k], done = ps.filter(function (p) { return p.status === "done"; }).length, live = ps.filter(function (p) { return p.status !== "cancelled"; });
      var first = ps[0], rt = routeUrl(live.filter(function (p) { return p.status === "planned"; }).map(function (p) { return site(p.county_slug, p.site_id); }));
      return '<div class="card" style="margin-bottom:14px"><div class="visit-h"><h3>' + esc(k) + '</h3><span class="muted small">' + (first.trip ? planRange(first) + "・" : "") + "完成 " + done + " / " + live.length + "</span></div>" +
        '<div class="bar" style="margin:6px 0 10px"><i style="width:' + pct(done, live.length) + '%"></i></div>' +
        (rt ? '<p><a class="btn btn-sm" href="' + rt + '" target="_blank" rel="noopener">在 Google 地圖開啟未完成景點的路線</a></p>' : "") +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th>文資</th><th>狀態</th><th></th></tr></thead><tbody>' + ps.map(function (p) {
          var st = p.status === "done" ? '<span class="tag st-published">已完成</span>' : p.status === "cancelled" ? '<span class="tag">已取消</span>' : planEnd(p) < t ? '<span class="tag st-rejected">逾期</span>' : '<span class="tag st-pending">預計中</span>';
          return "<tr><td>" + planRange(p) + "</td><td>" + siteLink(p) + ' <small class="muted">' + esc((site(p.county_slug, p.site_id) || {}).town || "") + "</small></td><td>" + st + "</td><td>" +
            (p.status === "planned" ? '<a class="btn btn-sm btn-warm" href="#submit/' + p.county_slug + "/" + encodeURIComponent(p.site_id) + '">填寫紀錄</a> <button class="btn btn-sm" data-cancel="' + p.id + '">取消</button>' : p.visit_id ? '<a class="btn btn-sm" href="#visit/' + p.visit_id + '">看紀錄</a>' : "") + "</td></tr>";
        }).join("") + "</tbody></table></div></div>";
    }).join("");
  }

  /* ---------- 申請成為達人 ---------- */
  ROUTES.apply = function () {
    if (!ME) return needLogin("申請成為文資達人前，請先以 email 註冊登入。");
    if (isExpert()) { view.innerHTML = '<div class="card"><h2>你已經是文資達人</h2><a class="btn btn-warm" href="#coverage">找文資去訪查</a></div>'; return; }
    return S.myApplications().then(function (apps) {
      var pend = apps.filter(function (a) { return a.status === "pending"; })[0];
      if (pend) { view.innerHTML = '<div class="card"><h2>申請審查中</h2><p>你在 ' + pend.created_at.slice(0, 10) + " 送出的申請正在審查，核准後就能開始新增訪查紀錄。</p></div>"; return; }
      view.innerHTML = "<h1>申請成為文資達人</h1><p>文資達人經審查核准後，可以新增訪查紀錄、上傳實地照片、登記預計到訪。審查重點：對文化資產的熟悉度、過往的走訪或解說經驗、是否願意遵守投稿規範。</p>" +
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
          .then(function () { toast("已送出申請"); route(); }).catch(fail);
      };
    });
  };

  /* ---------- 登入（正式模式） ---------- */
  ROUTES.login = function () {
    if (S.mode === "demo") { view.innerHTML = '<div class="card"><h2>示範模式</h2><p>尚未連接資料庫，請用頁面上方的黃色列切換身分。正式上線設定方式見 README。</p></div>'; return; }
    if (ME) { location.hash = "#mine"; return; }
    view.innerHTML = '<h1>登入</h1><form class="card form" id="lf" style="max-width:440px"><label>Email<input type="email" name="e" required autocomplete="email"></label><p class="small muted">我們會寄一封登入連結到你的信箱，點連結即可登入，不需要密碼。第一次登入會自動建立會員。</p><div class="btns"><button class="btn btn-p">寄送登入連結</button></div></form>';
    $("#lf").onsubmit = function (e) { e.preventDefault(); S.signIn(this.e.value.trim()).then(function () { view.innerHTML = '<div class="card"><h2>請收信</h2><p>登入連結已寄出，請到信箱點連結回到本站。</p></div>'; }).catch(fail); };
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
      }).join("") : '<p class="empty">沒有待審紀錄 🎉</p>';
      bindPhotos(pane);
      $$("[data-ok]").forEach(function (b) { b.onclick = function () { S.reviewVisit(b.dataset.ok, "published", $("#n-" + b.dataset.ok).value).then(function () { toast("已核准"); renderChrome(); route(); }).catch(fail); }; });
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
      }).join("") : '<p class="empty">沒有申請</p>';
      $$("[data-aok]").forEach(function (b) { b.onclick = function () { S.reviewApplication(b.dataset.aok, "approved", $("#an-" + b.dataset.aok).value).then(function () { toast("已核准"); renderChrome(); route(); }).catch(fail); }; });
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
      "<p>本站是「Allan Lo 和你逛文化」的姊妹站。知識網站整理文化資產的歷史與介紹；本站記錄達人實地走訪看到的現況、心得、照片與推薦指數。兩邊互相連結：知識網站每處文資的詳情都有「達人實地訪查」按鈕，本站每筆紀錄也連回知識頁。</p>" +
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
