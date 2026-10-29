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
 * Riyasewana changes its search routes and listing markup periodically. The
 * parser below accepts the current category route and both legacy and current
 * listing anchors. If access is blocked, the app shows a link to the search.
 * Answers are cached for 30 minutes.
 ******************************************************/

const VC_CACHE_SECONDS = 1800;
const VC_LIST_CACHE_SECONDS = 21600;   /* ikman make / model / year lists: 6 h (CacheService maximum) */
const VC_MAX_ADS = 25;
const VC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/* App vehicle type -> ikman.lk category (+ body filter). */
const VC_IKMAN_CATS = {
  "Car": { cat: "cars" }, "SUV / Jeep": { cat: "cars", body: "suv-4x4" }, "Cab / Pickup": { cat: "cars" },
  "Van / MPV": { cat: "vans" }, "Three Wheeler": { cat: "three-wheelers" }, "Motorcycle": { cat: "motorbikes-scooters" }
};

function vcKey_(k) {
  k = String(k || "").trim().toLowerCase();
  return /^[a-z0-9-]{1,60}$/.test(k) ? k : "";
}

/* ikman.lk path for a type + brand key + model key ("suzuki", "suzuki-wagonr-fx").
   Returns "" for an unknown type. */
function vcIkmanPath_(type, brandKey, modelKey) {
  const c = VC_IKMAN_CATS[String(type || "")];
  if (!c) return "";
  const b = vcKey_(brandKey), m = vcKey_(modelKey);
  let p = c.cat;
  if (b) p += "/" + b;
  if (b && m && m.indexOf(b + "-") === 0) p += "/" + m.slice(b.length + 1);
  return p;
}

/* vcIkman  args = [ type, brandKey?, modelKey? ]
   The makes (brands), the models of the chosen brand and the years ikman.lk has
   ads for, read from its search page filters. Lets the Vehicle Checking dropdowns
   match ikman exactly. */
function vcIkmanInfo_(type, brandKey, modelKey) {
  const path = vcIkmanPath_(type, brandKey, modelKey);
  if (!path) throw new Error("Unknown vehicle type.");
  const c = VC_IKMAN_CATS[String(type)];
  const url = "https://ikman.lk/en/ads/sri-lanka/" + path + (c.body ? "?enum.body=" + c.body : "");

  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  const ck = "vci1_" + url;
  if (cache) { try { const hit = cache.get(ck); if (hit) return JSON.parse(hit); } catch (e) {} }

  const res = vcFetch_(url);
  if (res.getResponseCode() !== 200) throw new Error("ikman.lk is not answering right now.");
  const html = res.getContentText();
  const i = html.indexOf("window.initialData = ");
  if (i < 0) throw new Error("ikman.lk page format changed.");
  var d;
  try { d = JSON.parse(html.slice(i + 21, html.indexOf("</script>", i)).trim().replace(/;\s*$/, "")); }
  catch (e) { throw new Error("ikman.lk page format changed."); }
  const dyn = (d && d.serp && d.serp.filtersMeta && d.serp.filtersMeta.dynamic) || [];
  const find = function (k) { return dyn.filter(function (f) { return f.key === k; })[0] || null; };

  const list = function (vals) {
    return (vals || []).filter(function (v) { return v.count > 0 && !/(^|-)other-model$/.test(v.key); })
      .map(function (v) { return { key: String(v.key), label: String(v.label), count: Number(v.count) }; });
  };
  const brandF = find("brand"), yearF = find("model_year");
  const b = vcKey_(brandKey);
  const sel = brandF && b ? (brandF.values || []).filter(function (v) { return v.key === b; })[0] : null;
  const out = {
    url: url,
    brands: list(brandF && brandF.values),
    models: sel ? list(sel.children) : [],
    years: yearF && yearF.minimum ? { min: Number(yearF.minimum), max: Number(yearF.maximum) } : null
  };
  if (cache) { try { cache.put(ck, JSON.stringify(out), VC_LIST_CACHE_SECONDS); } catch (e) {} }
  return out;
}

function checkVehicle_(make, model, year, grade, type, brandKey, modelKey) {
  make  = String(make  || "").trim().slice(0, 40);
  model = String(model || "").trim().slice(0, 40);
  year  = String(year  || "").trim();
  grade = String(grade || "").trim().slice(0, 30);
  if (!make || !model) throw new Error("Please select a make and model.");
  if (year && !/^(19|20)\d\d$/.test(year)) throw new Error("Please enter a valid year (e.g. 2015).");
  /* ikman.lk's own path for this model when the app picked it from ikman's list */
  const ikPath = vcKey_(modelKey) ? vcIkmanPath_(type, brandKey, modelKey) : "";
  const ikBody = ikPath ? (VC_IKMAN_CATS[String(type)].body || "") : "";

  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  const ck = "vc5_" + (make + "|" + model + "|" + year + "|" + grade + "|" + ikPath).toLowerCase().replace(/\s+/g, " ");
  if (cache) { try { const hit = cache.get(ck); if (hit) return JSON.parse(hit); } catch (e) {} }

  const out = {
    make: make, model: model, year: year, grade: grade,
    ikman: vcGrade_(vcSafe_(function () { return vcIkman_(make, model, year, ikPath, ikBody); }), grade),
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

function vcIkman_(make, model, year, ikPath, ikBody) {
  const yq = year ? "&numeric.model_year.minimum=" + year + "&numeric.model_year.maximum=" + year : "";
  const q = encodeURIComponent(make + " " + model);
  const tries = [
    "https://ikman.lk/en/ads/sri-lanka/cars/" + vcSlug_(make) + "/" + vcSlug_(model) + "?sort=date&order=desc" + yq,
    "https://ikman.lk/en/ads/sri-lanka/cars?query=" + q + "&sort=date&order=desc" + yq,
    "https://ikman.lk/en/ads/sri-lanka/vehicles?query=" + q + (year ? "%20" + year : "") + "&sort=date&order=desc"
  ];
  /* ikman's own model page first (its slugs differ from ours, e.g. "wagonr-fx") */
  if (ikPath) tries.unshift("https://ikman.lk/en/ads/sri-lanka/" + ikPath + "?sort=date&order=desc" + yq +
                            (ikBody ? "&enum.body=" + ikBody : ""));
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
  /* Current Riyasewana routes include the vehicle category. Keep year filtering
     local: appending a year to the route can send the site to its generic search. */
  const url = "https://riyasewana.com/search/cars/" + vcSlug_(make) + "/" + vcSlug_(model);
  const res = vcFetch_(url);
  const html = res.getResponseCode() === 200 ? res.getContentText() : "";
  if (!html || /Attention Required|cf-browser-verification|challenge-platform/i.test(html)) {
    return { site: "riyasewana.com", searchUrl: url, blocked: true, ads: [], summary: vcSummary_([]) };
  }
  const ads = [];
  /* Legacy cards used <li class="item">; current cards expose /buy/ links.
     Work from each ad link and a bounded surrounding fragment so class-name
     changes do not silently make every result disappear. */
  const links = [];
  const linkRe = /<a\b([^>]*\bhref\s*=\s*["']([^"']*\/buy\/[^"']*)["'][^>]*)>([\s\S]*?)<\/a\s*>/gi;
  var m;
  while ((m = linkRe.exec(html)) && links.length < VC_MAX_ADS * 4) {
    links.push({ start: m.index, end: linkRe.lastIndex, attrs: m[1], href: m[2], body: m[3] });
  }
  /* Keep the old item-based source compatible while also handling /buy/ cards. */
  const legacyItems = html.split(/<li[^>]+class=["'][^"']*\bitem\b[^"']*["']/i).slice(1);
  legacyItems.forEach(function (it) {
    const a = it.match(/<h2[^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*(?:title=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/a>/i);
    if (!a || /\/buy\//i.test(a[1])) return;
    links.push({ start: -1, end: -1, href: a[1], attrs: a[0].slice(0, a[0].indexOf(">") + 1), body: a[3], fragment: it });
  });
  links.forEach(function (a, index) {
    if (ads.length >= VC_MAX_ADS) return;
    const nextLink = links.slice(index + 1).find(function (x) { return x.start >= 0; });
    const end = a.end >= 0 ? Math.min(html.length, a.end + 2200, nextLink ? nextLink.start : html.length) : html.length;
    const fragment = a.fragment || html.slice(a.start >= 0 ? a.start : 0, end);
    const attrTitle = a.attrs.match(/\btitle\s*=\s*(["'])(.*?)\1/i);
    const title = vcText_(attrTitle ? attrTitle[2] : a.body);
    if (!title || !vcFits_(title, model, year)) return;
    const text = vcText_(fragment);
    const priceMatch = text.match(/Rs\.?\s*[\d,]+(?:\.\d+)?(?:\s*(?:million|mn|lakhs?))?/i);
    const kmMatch = text.match(/[\d,.]+\s*km\b/i);
    const yearMatch = text.match(/\b(?:19|20)\d{2}\b/);
    const price = priceMatch ? priceMatch[0].replace(/\s+/g, " ").trim() : "";
    const absoluteUrl = /^https?:\/\//i.test(a.href) ? a.href : "https://riyasewana.com" + (a.href.charAt(0) === "/" ? "" : "/") + a.href;
    ads.push({ title: title, price: price, priceValue: vcPrice_(price),
               details: kmMatch ? kmMatch[0] : (yearMatch ? yearMatch[0] : ""), location: "", when: "", url: absoluteUrl });
  });
  return { site: "riyasewana.com", searchUrl: url, ads: ads, summary: vcSummary_(ads) };
}

/* Decode the HTML entities commonly used in listing titles and card text. */
function vcText_(html) {
  return String(html || "").replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/\s+/g, " ").trim();
}

/* Run once from the Apps Script editor to authorize UrlFetchApp and see a sample answer. */
function testVehicleCheck() {
  const result = checkVehicle_("Toyota", "Aqua", "2015");
  Logger.log(JSON.stringify({
    ikman: result.ikman && result.ikman.summary,
    riyasewana: result.riyasewana
  }));
}
