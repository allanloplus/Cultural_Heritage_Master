"""產生 data/heritage-index.json：兩個文資知識網站（Cultural_Heritage、Cultural_Heritage2）的全部文化資產清單
（有形文化資產 sites、無形文化資產 ich、古物 anti，以及無形文資／古物的展示點 venues）

訪查網站用這份清單做「查核資訊」（各縣市有多少文資、多少已有訪查紀錄），
並用 id 對應回文資知識網站的景點頁：<網站網址><縣市資料夾>/#map/<景點 id>。

用法：
  python3 tools/build_index.py
兩個 repo 的位置：環境變數 CH1_DIR、CH2_DIR，沒設就找本 repo 旁邊的 Cultural_Heritage、Cultural_Heritage2。
縣市清單、哪個縣市在哪個網站、網站網址，都以 Cultural_Heritage/assets/js/cities.js 為準。
"""
import json, os, re, sys, datetime, hashlib

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARENT = os.path.dirname(HERE)


def find(env, names):
    d = os.environ.get(env)
    if d:
        return os.path.abspath(d)
    for n in names:
        p = os.path.join(PARENT, n)
        if os.path.isdir(p):
            return p
    sys.exit("找不到 %s，請設定環境變數 %s" % (names[0], env))


CH1 = find("CH1_DIR", ["Cultural_Heritage", "cultural_heritage"])
CH2 = find("CH2_DIR", ["Cultural_Heritage2", "cultural_heritage2"])

txt = open(os.path.join(CH1, "assets", "js", "cities.js"), encoding="utf-8").read()
urls = {int(k): v for k, v in re.findall(r'(\d+):\s*"([^"]+)"', re.search(r"var SITES = \{([^}]*)\}", txt).group(1))}
site2 = re.findall(r'"([^"]+)"', re.search(r"var SITE2 = \[([^\]]*)\]", txt).group(1))

NCH = "https://nchdb.boch.gov.tw/assets/advanceSearch/"  # 官方連結共同前綴，存檔時縮寫成 "~"
counties = []
for m in re.finditer(r"\{\s*slug:\s*\"([^\"]+)\",\s*name:\s*\"([^\"]+)\"(.*?)\}", txt, re.S):
    slug, name, rest = m.group(1), m.group(2), m.group(3)
    if not re.search(r"on:\s*true", rest):
        continue
    sm = re.search(r"site:\s*(\d)", rest)
    site = int(sm.group(1)) if sm else (2 if name in site2 else 1)
    lm = re.search(r'label:\s*"([^"]+)"', rest)
    la, ln = re.search(r"lat:\s*([\d.]+)", rest), re.search(r"lng:\s*([\d.]+)", rest)
    base = CH1 if site == 1 else CH2
    off_p = os.path.join(base, slug, "data", "sites-official.json")
    con_p = os.path.join(base, slug, "data", "sites-content.json")
    if not os.path.exists(off_p):
        print("略過（沒有資料）：", slug)
        continue
    off = json.load(open(off_p, encoding="utf-8"))
    con = {c["id"]: c for c in json.load(open(con_p, encoding="utf-8"))} if os.path.exists(con_p) else {}
    sites = []
    for s in off:
        c = con.get(s["id"], {})
        lat, lng = c.get("lat", s.get("lat")), c.get("lng", s.get("lng"))
        # [id, 名稱, 類別, 鄉鎮, 緯度, 經度, 簡稱, 文資局連結]
        sites.append([s["id"], s["name"], s["category"], s.get("town") or "",
                      round(lat, 5) if lat else None, round(lng, 5) if lng else None,
                      c.get("short") or "", (s.get("url") or "").replace(NCH, "~")])
    # 無形文化資產與古物（<縣市>/data/ich.json）：展示點 venues 收錄無形文資（ichIds）與古物（antiquities）
    ich_p = os.path.join(base, slug, "data", "ich.json")
    ich, anti, venues = [], [], []
    if os.path.exists(ich_p):
        d = json.load(open(ich_p, encoding="utf-8"))
        at = {}
        for v in d.get("venues", []):
            # [id, 名稱, 緯度, 經度, 同址的有形文資 id, 地址]
            venues.append([v["id"], v["name"], v.get("lat"), v.get("lng"), v.get("relatedSiteId") or "", v.get("address") or ""])
            for i in v.get("ichIds", []):
                at.setdefault(i, v["id"])
            for a in v.get("antiquities") or []:
                # 古物沒有官方編號：用「展示點＋名稱」產生固定 id
                aid = "a-" + hashlib.sha1((v["id"] + "|" + a["name"]).encode("utf-8")).hexdigest()[:10]
                # [id, 名稱, 等級, 展示點 id]
                anti.append([aid, a["name"], a.get("level") or "古物", v["id"]])
        for i in d.get("items", []):
            # [id, 名稱, 類別, 展示點 id（空白＝沒有固定地點）]
            ich.append([i["id"], i["name"], i.get("type") or "無形文資", at.get(i["id"]) or i.get("venueId") or ""])
    counties.append({"slug": slug, "name": name, "label": lm.group(1) if lm else name, "site": site,
                     "base": urls[site] + slug + "/", "lat": float(la.group(1)), "lng": float(ln.group(1)),
                     "sites": sites, "ich": ich, "anti": anti, "venues": venues})

# 依地區排列：北、中、南、東、離島
ORDER = ["keelung-city", "taipei-city", "new-taipei-city", "taoyuan-city", "hsinchu-city", "hsinchu-county", "miaoli-county",
         "taichung-city", "changhua-county", "nantou-county", "yunlin-county", "chiayi-city", "chiayi-county", "tainan-city",
         "kaohsiung-city", "pingtung-county", "yilan-county", "hualien-county", "taitung-county", "penghu-county",
         "kinmen-county", "lienchiang-county"]
counties.sort(key=lambda c: ORDER.index(c["slug"]) if c["slug"] in ORDER else 99)
out = {"meta": {"generated": datetime.date.today().isoformat(),
                "source": "allanloplus/Cultural_Heritage、allanloplus/Cultural_Heritage2 的 <縣市>/data/sites-official.json",
                "fields": {"sites": ["id", "name", "category", "town", "lat", "lng", "short", "officialUrl"],
                           "ich": ["id", "name", "type", "venueId"], "anti": ["id", "name", "level", "venueId"],
                           "venues": ["id", "name", "lat", "lng", "relatedSiteId", "address"]},
                "officialPrefix": NCH, "total": sum(len(c["sites"]) for c in counties),
                "totalIch": sum(len(c["ich"]) for c in counties), "totalAnti": sum(len(c["anti"]) for c in counties)},
       "counties": counties}
p = os.path.join(HERE, "data", "heritage-index.json")
with open(p, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print("寫入 %s：%d 個縣市、有形 %d 處、無形 %d 項、古物 %d 件（%d KB）" % (p, len(counties), out["meta"]["total"],
      out["meta"]["totalIch"], out["meta"]["totalAnti"], os.path.getsize(p) // 1024))
# 網站以「縣市＋id」識別每一筆（同名的無形文資在不同縣市各自登錄，id 可能相同），檢查同一縣市內不重複
for c in counties:
    ids = [x[0] for k in ("sites", "ich", "anti") for x in c[k]]
    if len(ids) != len(set(ids)):
        sys.exit("錯誤：%s 有重複的 id" % c["slug"])
