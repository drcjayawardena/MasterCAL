/******************************************************
 * MasterCAL Pro
 * VehicleCheck.gs — "Vehicle Checking" tab
 *
 * checkVehicle  args = [ make, model, year, grade? ]
 * A grade (e.g. "S", "Hybrid Z") keeps only the ads whose title names it.
 * Looks up ads for that vehicle on ikman.lk and riyasewana.com and returns
 * a short summary (how many ads, lowest / middle / highest price) plus the
 * ads themselves, newest first as the sites list them.
 *
 * ikman.lk: the search page carries its results as JSON (window.initialData).
 * riyasewana.com sits behind Cloudflare and may refuse Google's servers; then
 * { blocked: true } is returned and the app only shows a link to the search.
 * Answers are cached for 30 minutes.
 ******************************************************/

const VC_CACHE_SECONDS = 1800;
const VC_MAX_ADS = 25;
const VC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function checkVehicle_(make, model, year, grade) {
  make  = String(make  || "").trim().slice(0, 40);
  model = String(model || "").trim().slice(0, 40);
  year  = String(year  || "").trim();
  grade = String(grade || "").trim().slice(0, 30);
  if (!make || !model) throw new Error("Make සහ model දාන්න.");
  if (year && !/^(19|20)\d\d$/.test(year)) throw new Error("හරි අවුරුද්දක් දාන්න (e.g. 2015).");

  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  const ck = "vc3_" + (make + "|" + model + "|" + year + "|" + grade).toLowerCase().replace(/\s+/g, " ");
  if (cache) { try { const hit = cache.get(ck); if (hit) return JSON.parse(hit); } catch (e) {} }

  const out = {
    make: make, model: model, year: year, grade: grade,
    ikman: vcGrade_(vcSafe_(function () { return vcIkman_(make, model, year); }), grade),
    riyasewana: vcGrade_(vcSafe_(function () { return vcRiyasewana_(make, model, year); }), grade)
  };
  if (cache) { try { cache.put(ck, JSON.stringify(out), VC_CACHE_SECONDS); } catch (e) {} }
  return out;
}

function vcSafe_(fn) {
  try { return fn(); }
  catch (e) { return { error: String(e && e.message ? e.message : e), ads: [] }; }
}

function vcSlug_(s) { return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

function vcFetch_(url) {
  return UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true,
    headers: { "User-Agent": VC_UA, "Accept-Language": "en-US,en;q=0.9" } });
}

/* "Rs 8,550,000" -> 8550000 (0 when there is no price) */
function vcPrice_(t) {
  const d = String(t || "").replace(/[^\d]/g, "");
  return d ? Number(d) : 0;
}

/* Does an ad title fit the search? (model words and, when given, the year) */
function vcFits_(title, model, year) {
  const t = " " + String(title).toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
  if (year && t.indexOf(" " + year + " ") < 0) return false;
  return vcSlug_(model).split("-").every(function (w) { return t.indexOf(w) >= 0; });
}

/* Keep only the ads whose title names the grade as whole words: "S" matches
   "Aqua S Grade" and "Aqua S-Grade" but not the s inside "Prius". */
function vcGrade_(r, grade) {
  if (!grade || !r || !r.ads) return r;
  const g = String(grade).toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();
  if (!g) return r;
  r.ads = r.ads.filter(function (a) {
    const t = " " + String(a.title).toLowerCase().replace(/[^a-z0-9+]+/g, " ") + " ";
    return t.indexOf(" " + g + " ") >= 0;
  });
  r.summary = vcSummary_(r.ads);
  return r;
}

/* Count + lowest / middle / highest price of a list of ads. */
function vcSummary_(ads) {
  const p = ads.map(function (a) { return a.priceValue; }).filter(function (v) { return v > 0; })
               .sort(function (a, b) { return a - b; });
  return { count: ads.length, priced: p.length,
           min: p.length ? p[0] : 0, max: p.length ? p[p.length - 1] : 0,
           median: p.length ? (p.length % 2 ? p[(p.length - 1) / 2] : Math.round((p[p.length / 2 - 1] + p[p.length / 2]) / 2)) : 0 };
}

/* ---------- ikman.lk ---------- */

function vcIkmanData_(url) {
  const res = vcFetch_(url);
  if (res.getResponseCode() !== 200) return null;
  const html = res.getContentText();
  const i = html.indexOf("window.initialData = ");
  if (i < 0) return null;
  const j = html.indexOf("</script>", i);
  var d;
  try { d = JSON.parse(html.slice(i + 21, j).trim().replace(/;\s*$/, "")); } catch (e) { return null; }
  const data = d && d.serp && d.serp.ads && d.serp.ads.data;
  return data && data.ads ? data : null;
}

function vcIkman_(make, model, year) {
  const yq = year ? "&numeric.model_year.minimum=" + year + "&numeric.model_year.maximum=" + year : "";
  const q = encodeURIComponent(make + " " + model);
  const tries = [
    "https://ikman.lk/en/ads/sri-lanka/cars/" + vcSlug_(make) + "/" + vcSlug_(model) + "?sort=date&order=desc" + yq,
    "https://ikman.lk/en/ads/sri-lanka/cars?query=" + q + "&sort=date&order=desc" + yq,
    "https://ikman.lk/en/ads/sri-lanka/vehicles?query=" + q + (year ? "%20" + year : "") + "&sort=date&order=desc"
  ];
  var data = null, used = tries[tries.length - 1];
  for (var k = 0; k < tries.length && !data; k++) {
    const d = vcIkmanData_(tries[k]);
    if (d && d.ads.some(function (a) { return vcFits_(a.title, model, year); })) { data = d; used = tries[k]; }
  }
  const ads = [];
  ((data && data.ads) || []).forEach(function (a) {
    if (ads.length >= VC_MAX_ADS || !vcFits_(a.title, model, year)) return;   /* drops featured ads of other years */
    const when = vcWhen_(a);
    ads.push({ title: String(a.title || ""), price: String(a.price || ""), priceValue: vcPrice_(a.price),
               details: String(a.details || ""), location: String(a.location || ""), when: when,
               age: vcAgeMinutes_(when),
               url: "https://ikman.lk/en/ad/" + encodeURIComponent(String(a.slug || "")) });
  });
  /* newest first: featured / top ads come first on ikman even when they are old */
  ads.sort(function (x, y) { return x.age - y.age; });
  return { site: "ikman.lk", searchUrl: used, ads: ads, summary: vcSummary_(ads) };
}

/* How long ago an ikman ad was posted or bumped up: "7 hours", "just now", "2 days".
   timeStamp is "bump_up" for a bumped ad; then lastBumpUpDate holds the age. */
function vcWhen_(a) {
  const t = String(a.timeStamp || "");
  return /_/.test(t) ? String(a.lastBumpUpDate || "") : t;
}

/* "7 hours" -> 420 minutes (unknown -> very old, so it sorts last) */
function vcAgeMinutes_(when) {
  const t = String(when || "").toLowerCase();
  if (/just now|now/.test(t)) return 0;
  const m = t.match(/(\d+)\s*(min|hour|day|week|month|year)/);
  if (!m) return 1e9;
  const per = { min: 1, hour: 60, day: 1440, week: 10080, month: 43200, year: 525600 };
  return Number(m[1]) * per[m[2]];
}

/* ---------- riyasewana.com ---------- */

function vcRiyasewana_(make, model, year) {
  const url = "https://riyasewana.com/search/" + vcSlug_(make) + "/" + vcSlug_(model) + (year ? "/" + year : "");
  const res = vcFetch_(url);
  const html = res.getResponseCode() === 200 ? res.getContentText() : "";
  if (!html || /Attention Required|cf-browser-verification|challenge-platform/i.test(html)) {
    return { site: "riyasewana.com", searchUrl: url, blocked: true, ads: [], summary: vcSummary_([]) };
  }
  /* each ad: <li class="item round"> ... <h2 class="more"><a href="URL" title="TITLE"> ... <div class="boxintxt b">Rs. 8,500,000</div> */
  const ads = [];
  const items = html.split(/<li[^>]+class="[^"]*\bitem\b[^"]*"/i).slice(1);
  items.forEach(function (it) {
    if (ads.length >= VC_MAX_ADS) return;
    const a = it.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*(?:title="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) return;
    const title = (a[2] || a[3] || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const boxes = (it.match(/<div[^>]*class="[^"]*boxintxt[^"]*"[^>]*>([\s\S]*?)<\/div>/gi) || [])
      .map(function (b) { return b.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); });
    const price = boxes.filter(function (b) { return /^Rs/i.test(b); })[0] || "";
    const km = boxes.filter(function (b) { return /km/i.test(b); })[0] || "";
    if (!vcFits_(title, model, "")) return;
    ads.push({ title: title, price: price, priceValue: vcPrice_(price), details: km,
               location: boxes[0] && !/^Rs|km/i.test(boxes[0]) ? boxes[0] : "", when: "",
               url: /^https?:/i.test(a[1]) ? a[1] : "https://riyasewana.com" + a[1] });
  });
  return { site: "riyasewana.com", searchUrl: url, ads: ads, summary: vcSummary_(ads) };
}

/* Run once from the Apps Script editor to authorize UrlFetchApp and see a sample answer. */
function testVehicleCheck() { Logger.log(JSON.stringify(checkVehicle_("Toyota", "Aqua", "2015")).slice(0, 1500)); }
