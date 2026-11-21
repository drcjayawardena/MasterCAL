/* MasterCAL standalone formula engine.
 *
 * Evaluates the formulas of the Google Sheet (exported by tools/extract_model.py) in the browser / Node.
 *  - lazy: only the cells needed for a requested output are computed; IF/IFS/IFERROR/IFNA evaluate only the taken branch
 *    (so "circular looking" formulas that Google resolves by branch work here too)
 *  - Google semantics: "" and blank count as 0 in arithmetic; string compare is case-insensitive
 *  - dynamic arrays: formulas that return arrays (FILTER, UNIQUE, TRANSPOSE, SEQUENCE, QUERY ...) spill down/right
 *  - unsupported functions return #NAME? and are listed in engine.unsupported (never a silent wrong number)
 * No dependencies.
 */
(function (root) {
  "use strict";

  /* ------------------------------------------------------------------ errors & values */
  class XlErr { constructor(code) { this.code = code; } toString() { return this.code; } }
  const E = {
    NA: new XlErr("#N/A"), VALUE: new XlErr("#VALUE!"), DIV0: new XlErr("#DIV/0!"), NUM: new XlErr("#NUM!"),
    REF: new XlErr("#REF!"), NAME: new XlErr("#NAME?"), CYCLE: new XlErr("#CYCLE!"), NULL: new XlErr("#NULL!")
  };
  const ERR_BY_CODE = {}; Object.keys(E).forEach(k => { ERR_BY_CODE[E[k].code] = E[k]; });
  const isErr = v => v instanceof XlErr;

  class Rng { constructor(sheet, r1, c1, r2, c2) { this.sheet = sheet; this.r1 = r1; this.c1 = c1; this.r2 = r2; this.c2 = c2; } }
  class Arr { constructor(rows) { this.rows = rows; } }
  const isRng = v => v instanceof Rng, isArr = v => v instanceof Arr;

  /* ------------------------------------------------------------------ helpers */
  function colToNum(s) { let n = 0; for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n; }
  function numToCol(n) { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function parseAddr(a) { const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(a); if (!m) return null; return { r: +m[2], c: colToNum(m[1].toUpperCase()) }; }
  const KEY = (r, c) => r * 20000 + c;

  function numToStr(n) {
    if (!isFinite(n)) return String(n);
    if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
    let s = Number(n.toPrecision(15)).toString();
    if (/e/i.test(s)) {
      const x = Number(n.toPrecision(15));
      s = Math.abs(x) >= 1 ? x.toFixed(0) : x.toFixed(15).replace(/0+$/, "");
    }
    return s;
  }
  function toStr(v) {
    if (isErr(v)) return v;
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    return numToStr(v);
  }
  function parseNumStr(s) {
    const t = s.trim();
    if (t === "") return 0;
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return parseFloat(t);
    if (/^[+-]?(\d+\.?\d*|\.\d+)%$/.test(t)) return parseFloat(t) / 100;
    if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return parseFloat(t.replace(/,/g, ""));
    return null;
  }
  function toNum(v) {
    if (isErr(v)) return v;
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") { const n = parseNumStr(v); return n === null ? E.VALUE : n; }
    return E.VALUE;
  }
  function toBool(v) {
    if (isErr(v)) return v;
    if (v === null || v === undefined) return false;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") { const u = v.toUpperCase(); if (u === "TRUE") return true; if (u === "FALSE") return false; return E.VALUE; }
    return E.VALUE;
  }
  const typeRank = v => typeof v === "number" ? 1 : typeof v === "string" ? 2 : typeof v === "boolean" ? 3 : 0;
  function cmp(a, b) { // returns <0, 0, >0 or null (incomparable)
    if (a === null || a === undefined) a = (typeof b === "string") ? "" : (typeof b === "boolean") ? false : 0;
    if (b === null || b === undefined) b = (typeof a === "string") ? "" : (typeof a === "boolean") ? false : 0;
    if (a === "" && typeof b === "number") a = 0; else if (b === "" && typeof a === "number") b = 0; // Google: "" compares as 0 against numbers (Excel: text > number)
    const ra = typeRank(a), rb = typeRank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 2) { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function roundShift(x, d) { // x * 10^d with float noise removed
    return Number((x * Math.pow(10, d)).toPrecision(15));
  }
  function xRound(x, d, mode) { // mode: 0 half-away, 1 up(away), 2 down(toward zero)
    const s = x < 0 ? -1 : 1, a = Math.abs(x);
    let t = roundShift(a, d);
    t = mode === 0 ? Math.floor(t + 0.5) : mode === 1 ? Math.ceil(t) : Math.floor(t);
    const r = d >= 0 ? t / Math.pow(10, d) : t * Math.pow(10, -d);
    return s * Number(r.toPrecision(15));
  }

  /* ------------------------------------------------------------------ TEXT() number formats */
  function formatText(value, fmt) {
    if (fmt === "") return "";
    const sections = splitSections(fmt);
    let num = value, sec = sections[0];
    if (typeof num === "number") {
      if (num < 0 && sections.length > 1) { sec = sections[1]; num = -num; }
      else if (num === 0 && sections.length > 2) sec = sections[2];
    }
    if (/(^|[^\\"])[ymdhs]/i.test(stripQuoted(sec)) && !/[#0?]/.test(stripQuoted(sec))) return formatDate(num, sec);
    return formatNumber(num, sec, sections.length > 1 && value < 0);
  }
  function stripQuoted(s) { return s.replace(/"[^"]*"/g, "").replace(/\\./g, ""); }
  function splitSections(f) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < f.length; i++) { const ch = f[i]; if (ch === '"') q = !q; if (ch === ";" && !q) { out.push(cur); cur = ""; } else cur += ch; }
    out.push(cur); return out;
  }
  function formatNumber(num, fmt, signHandled) {
    let neg = num < 0; if (neg) num = -num;
    // tokenise
    let pre = "", post = "", pat = "", seenDigit = false, pct = 0;
    for (let i = 0; i < fmt.length; i++) {
      const ch = fmt[i];
      if (ch === '"') { let j = fmt.indexOf('"', i + 1); if (j < 0) j = fmt.length; const lit = fmt.slice(i + 1, j); if (seenDigit && /[#0?]/.test(pat.slice(-1)) || seenDigit) post += lit; else pre += lit; i = j; continue; }
      if (ch === "\\") { const lit = fmt[i + 1] || ""; if (seenDigit) post += lit; else pre += lit; i++; continue; }
      if (ch === "%") { pct++; if (seenDigit) post += "%"; else pre += "%"; continue; }
      if ("#0?.,".indexOf(ch) >= 0) { if (post !== "") { post += ch; } else { pat += ch; seenDigit = true; } continue; }
      if (seenDigit) post += ch; else pre += ch;
    }
    if (pct) num = num * Math.pow(100, pct) / (pct > 0 ? 1 : 1);
    const dot = pat.indexOf(".");
    let ip = dot >= 0 ? pat.slice(0, dot) : pat, fp = dot >= 0 ? pat.slice(dot + 1) : "";
    // trailing commas in the integer part scale by 1000
    let scale = 0; while (ip.endsWith(",")) { ip = ip.slice(0, -1); scale++; }
    num = num / Math.pow(1000, scale);
    const group = ip.indexOf(",") >= 0;
    const ipd = ip.replace(/,/g, "");
    const minInt = (ipd.match(/0/g) || []).length;
    const decs = fp.replace(/,/g, "").length;
    const minDec = (fp.match(/0/g) || []).length;
    let r = xRound(num, decs, 0);
    let s = r.toFixed(decs);
    let [i, f = ""] = s.split(".");
    while (f.length > minDec && f.endsWith("0")) f = f.slice(0, -1);
    if (i === "0" && minInt === 0 && (ipd.length > 0 || decs > 0) && f.length > 0) i = "";
    else if (i === "0" && minInt === 0 && ipd.length > 0) i = "";
    while (i.length < minInt) i = "0" + i;
    if (group) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    let body = i + (f.length || fp.indexOf("0") >= 0 && minDec > 0 ? "." + f : (dot >= 0 && f.length ? "." + f : ""));
    if (minDec > 0 && f.length < minDec) body = i + "." + f.padEnd(minDec, "0");
    if (r === 0 && neg) neg = false;
    return (neg && !signHandled ? "-" : "") + pre + body + post;
  }
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  function serialToDate(n) { return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000); }
  function dateToSerial(d) { return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(1899, 11, 30)) / 86400000); }
  function formatDate(n, fmt) {
    if (typeof n !== "number") return toStr(n);
    const d = serialToDate(n);
    return fmt.replace(/"([^"]*)"|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d/gi, (m, lit) => {
      if (lit !== undefined) return lit;
      switch (m.toLowerCase()) {
        case "yyyy": return String(d.getUTCFullYear());
        case "yy": return String(d.getUTCFullYear()).slice(-2);
        case "mmmm": return MONTHS[d.getUTCMonth()];
        case "mmm": return MONTHS[d.getUTCMonth()].slice(0, 3);
        case "mm": return String(d.getUTCMonth() + 1).padStart(2, "0");
        case "m": return String(d.getUTCMonth() + 1);
        case "dddd": return DAYS[d.getUTCDay()];
        case "ddd": return DAYS[d.getUTCDay()].slice(0, 3);
        case "dd": return String(d.getUTCDate()).padStart(2, "0");
        case "d": return String(d.getUTCDate());
      }
      return m;
    });
  }

  /* ------------------------------------------------------------------ tokenizer + parser */
  const ERR_LITERALS = ["#N/A", "#REF!", "#VALUE!", "#DIV/0!", "#NAME?", "#NUM!", "#NULL!"];
  function parseFormula(src) {
    let p = 0; const n = src.length;
    const ws = () => { while (p < n && /\s/.test(src[p])) p++; };
    const peek = s => src.startsWith(s, p);
    function fail(msg) { throw new Error("Parse error: " + msg + " at " + p + " in: " + src); }

    function parseCompare() {
      let l = parseConcat();
      for (;;) {
        ws();
        let op = null;
        for (const o of ["<>", "<=", ">=", "=", "<", ">"]) if (peek(o)) { op = o; break; }
        if (!op) return l;
        p += op.length; const r = parseConcat(); l = { t: "bin", op, a: l, b: r };
      }
    }
    function parseConcat() {
      let l = parseAdd();
      for (;;) { ws(); if (src[p] === "&") { p++; const r = parseAdd(); l = { t: "bin", op: "&", a: l, b: r }; } else return l; }
    }
    function parseAdd() {
      let l = parseMul();
      for (;;) { ws(); const c = src[p]; if (c === "+" || c === "-") { p++; const r = parseMul(); l = { t: "bin", op: c, a: l, b: r }; } else return l; }
    }
    function parseMul() {
      let l = parsePow();
      for (;;) { ws(); const c = src[p]; if (c === "*" || c === "/") { p++; const r = parsePow(); l = { t: "bin", op: c, a: l, b: r }; } else return l; }
    }
    function parsePow() {
      let l = parseUnary();
      for (;;) { ws(); if (src[p] === "^") { p++; const r = parseUnary(); l = { t: "bin", op: "^", a: l, b: r }; } else return l; }
    }
    function parseUnary() {
      ws();
      const c = src[p];
      if (c === "-" || c === "+") { p++; const a = parseUnary(); return c === "-" ? { t: "neg", a } : { t: "pos", a }; }
      return parsePostfix();
    }
    function parsePostfix() {
      let a = parsePrimary();
      for (;;) { ws(); if (src[p] === "%") { p++; a = { t: "pct", a }; } else return a; }
    }
    const REF_PART = /^(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d+:\$?\d+)/;
    function makeRef(sheet, part) {
      let m;
      if ((m = /^\$?([A-Za-z]{1,3})\$?(\d+):\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(part))) {
        const a = colToNum(m[1].toUpperCase()), b = colToNum(m[3].toUpperCase()), r1 = +m[2], r2 = +m[4];
        return { t: "ref", sheet, r1: Math.min(r1, r2), c1: Math.min(a, b), r2: Math.max(r1, r2), c2: Math.max(a, b) };
      }
      if ((m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(part))) { const c = colToNum(m[1].toUpperCase()); return { t: "ref", sheet, r1: +m[2], c1: c, r2: +m[2], c2: c }; }
      if ((m = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})$/.exec(part))) {
        const a = colToNum(m[1].toUpperCase()), b = colToNum(m[2].toUpperCase());
        return { t: "ref", sheet, r1: 1, c1: Math.min(a, b), r2: Infinity, c2: Math.max(a, b) };
      }
      if ((m = /^\$?(\d+):\$?(\d+)$/.exec(part))) return { t: "ref", sheet, r1: +m[1], c1: 1, r2: +m[2], c2: Infinity };
      fail("bad reference " + part);
    }
    function parsePrimary() {
      ws();
      const c = src[p];
      if (c === undefined) fail("unexpected end");
      if (c === "(") { p++; const e = parseCompare(); ws(); if (src[p] !== ")") fail("expected )"); p++; return e; }
      if (c === '"') {
        let s = ""; p++;
        for (;;) { if (p >= n) fail("unterminated string"); if (src[p] === '"') { if (src[p + 1] === '"') { s += '"'; p += 2; continue; } p++; break; } s += src[p++]; }
        return { t: "str", v: s };
      }
      if (c === "{") { // array constant
        p++; const rows = [[]];
        for (;;) {
          ws(); const e = parseCompare(); rows[rows.length - 1].push(e); ws();
          if (src[p] === ",") { p++; continue; } if (src[p] === ";") { p++; rows.push([]); continue; }
          if (src[p] === "}") { p++; break; } fail("bad array constant");
        }
        return { t: "arrc", rows };
      }
      if (c === "#") { for (const e of ERR_LITERALS) if (src.startsWith(e, p)) { p += e.length; return { t: "err", v: ERR_BY_CODE[e] }; } fail("bad error literal"); }
      const num = /^(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)/.exec(src.slice(p, p + 40));
      if (num && !/^\d+:/.test(src.slice(p, p + 12))) { p += num[0].length; return { t: "num", v: parseFloat(num[0]) }; }
      // sheet-qualified reference
      let sheet = null, save = p;
      if (c === "'") {
        let j = p + 1, name = "";
        for (;;) { if (j >= n) fail("unterminated sheet name"); if (src[j] === "'") { if (src[j + 1] === "'") { name += "'"; j += 2; continue; } break; } name += src[j++]; }
        if (src[j + 1] === "!") { sheet = name; p = j + 2; } else fail("bad quoted name");
      } else {
        const m = /^([A-Za-z_][A-Za-z0-9_\.]*)!/.exec(src.slice(p, p + 80));
        if (m) { sheet = m[1]; p += m[0].length; }
      }
      if (sheet !== null) {
        const m = REF_PART.exec(src.slice(p, p + 40)); if (!m) fail("bad reference after sheet");
        p += m[0].length; return makeRef(sheet, m[0]);
      }
      p = save;
      const id = /^([A-Za-z_\\][A-Za-z0-9_\.]*)/.exec(src.slice(p, p + 80));
      if (id) {
        const name = id[1];
        // function call?
        if (src[p + name.length] === "(") {
          p += name.length + 1; const args = [];
          ws();
          if (src[p] === ")") { p++; return { t: "call", name: name.toUpperCase().replace(/^_XLFN\._XLWS\.|^_XLFN\./, ""), args }; }
          for (;;) {
            ws();
            if (src[p] === "," || src[p] === ")") args.push({ t: "missing" }); else args.push(parseCompare());
            ws();
            if (src[p] === ",") { p++; continue; }
            if (src[p] === ")") { p++; break; }
            fail("expected , or )");
          }
          return { t: "call", name: name.toUpperCase().replace(/^_XLFN\._XLWS\.|^_XLFN\./, ""), args };
        }
        const u = name.toUpperCase();
        if (u === "TRUE") { p += name.length; return { t: "bool", v: true }; }
        if (u === "FALSE") { p += name.length; return { t: "bool", v: false }; }
        const m = REF_PART.exec(src.slice(p, p + 40));
        if (m && m[0].length >= name.length) { p += m[0].length; return makeRef(null, m[0]); }
        p += name.length; return { t: "name", v: name };
      }
      const m = REF_PART.exec(src.slice(p, p + 40));
      if (m) { p += m[0].length; return makeRef(null, m[0]); }
      fail("unexpected character '" + c + "'");
    }
    const ast = parseCompare(); ws();
    if (p < n) fail("trailing characters");
    return ast;
  }

  /* ------------------------------------------------------------------ engine */
  const ARRAY_FUNCS = /\b(FILTER|UNIQUE|TRANSPOSE|SEQUENCE|QUERY|ARRAYFORMULA|SORT|CHOOSECOLS|CHOOSEROWS|FLATTEN|SPLIT|TOCOL|TOROW|HSTACK|VSTACK)\s*\(/i;

  class Engine {
    constructor(model, opts) {
      opts = opts || {};
      this.now = opts.now || new Date();
      this.names = model.order.slice();
      this.sheets = {}; this.lc = {};
      this.unsupported = new Set(); this.parseErrors = [];
      for (const nm of this.names) {
        const s = model.sheets[nm];
        const sh = { name: nm, f: new Map(), v: new Map(), maxR: 1, maxC: 1, anchors: [] };
        for (const a in s.v) { const p = parseAddr(a); if (!p) continue; sh.v.set(KEY(p.r, p.c), s.v[a]); if (p.r > sh.maxR) sh.maxR = p.r; if (p.c > sh.maxC) sh.maxC = p.c; }
        for (const a in s.f) {
          const p = parseAddr(a); if (!p) continue;
          let ast = null;
          try { ast = parseFormula(s.f[a]); } catch (e) { this.parseErrors.push(nm + "!" + a + ": " + e.message); ast = { t: "err", v: E.NAME }; }
          sh.f.set(KEY(p.r, p.c), { ast, src: s.f[a], r: p.r, c: p.c });
          if (p.r > sh.maxR) sh.maxR = p.r; if (p.c > sh.maxC) sh.maxC = p.c;
          if (ARRAY_FUNCS.test(s.f[a])) sh.anchors.push({ r: p.r, c: p.c });
        }
        this.sheets[nm] = sh; this.lc[nm.toLowerCase()] = nm;
      }
      this.cache = {}; this.raw = {}; this.visiting = new Set(); this.stack = [];
      this.prev = new Map(); this.cycHit = new Set(); this.top = 0; this.iterPasses = 0;
      this.scope = [];
    }
    /* ---- public API */
    recalc() { this.cache = {}; this.raw = {}; this.visiting = new Set(); this.stack = []; this.cycleLog = null; this.prev = new Map(); this.cycHit = new Set(); this.top = 0; this.iterPasses = 0; }
    /* Run a read; when it touched a circular reference, repeat it with the previous pass's values of the
       cycle cells until they stop changing (iterative calculation, like Google's "Iterative calculation"). */
    _top(fn) {
      if (this.top > 0) return fn();
      this.top++;
      try {
        this.cycHit = new Set();
        let res = fn();
        for (let it = 0; it < 100 && this.cycHit.size; it++) {
          let changed = false; const nxt = new Map();
          for (const vk of this.cycHit) {
            const i = vk.lastIndexOf("!"), cs = this.cache[vk.slice(0, i)], v = cs ? cs.get(+vk.slice(i + 1)) : undefined;
            const nv = v === undefined ? 0 : v, pv = this.prev.has(vk) ? this.prev.get(vk) : 0;
            const same = typeof nv === "number" && typeof pv === "number" ? Math.abs(nv - pv) <= 1e-9 * Math.max(1, Math.abs(pv))
              : (isErr(nv) && isErr(pv) ? nv.code === pv.code : nv === pv);
            if (!same) changed = true; nxt.set(vk, nv);
          }
          if (!changed) break;
          for (const [k, v] of nxt) this.prev.set(k, v);
          this.cache = {}; this.raw = {}; this.cycHit = new Set(); this.iterPasses++;
          res = fn();
        }
        return res;
      } finally { this.top--; }
    }
    setNow(d) { this.now = d; this.recalc(); }
    setInput(sheet, addr, value) {
      const sh = this._sheet(sheet), p = parseAddr(addr); if (!sh || !p) throw new Error("bad input " + sheet + "!" + addr);
      const k = KEY(p.r, p.c); sh.f.delete(k);
      if (value === null || value === undefined || value === "") sh.v.delete(k); else sh.v.set(k, value);
      if (p.r > sh.maxR) sh.maxR = p.r; if (p.c > sh.maxC) sh.maxC = p.c;
      this.recalc();
    }
    get(sheet, addr) { const p = parseAddr(addr); return this._top(() => this.cell(this._sheet(sheet), p.r, p.c)); }
    range(sheet, a1) {
      const [a, b] = a1.split(":"); const p = parseAddr(a), q = parseAddr(b || a), sh = this._sheet(sheet);
      return this._top(() => { const out = []; for (let r = p.r; r <= q.r; r++) { const row = []; for (let c = p.c; c <= q.c; c++) row.push(this.cell(sh, r, c)); out.push(row); } return out; });
    }
    spillValues() { // every multi-cell array result: [{sheet, cells:{A1: value}}]
      const out = [];
      for (const nm of this.names) { const sh = this.sheets[nm]; for (const a of sh.anchors) {
        const fx = sh.f.get(KEY(a.r, a.c)); if (!fx) continue;
        const res = this.rawOf(sh, fx); if (!isArr(res)) continue;
        const cells = {}; res.rows.forEach((row, i) => row.forEach((v, j) => { cells[numToCol(a.c + j) + (a.r + i)] = v; }));
        out.push({ sheet: nm, anchor: numToCol(a.c) + a.r, cells });
      } }
      return out;
    }
    formulaCells(sheet) { const sh = this._sheet(sheet); return Array.from(sh.f.values()).map(x => ({ r: x.r, c: x.c })); }
    _sheet(name) { if (name && typeof name === "object") return name; const n = this.lc[String(name).toLowerCase()]; return n ? this.sheets[n] : null; }

    /* ---- cell access */
    cell(sh, r, c) {
      const k = KEY(r, c);
      let cs = this.cache[sh.name]; if (!cs) cs = this.cache[sh.name] = new Map();
      if (cs.has(k)) return cs.get(k);
      const fx = sh.f.get(k);
      let v;
      if (fx) {
        const vk = sh.name + "!" + k;
        if (this.visiting.has(vk)) { // circular reference: iterative calculation (the Google Sheet has it switched on)
          if (!this.cycleLog) this.cycleLog = this.stack.slice(this.stack.indexOf(vk)).concat([vk]);
          this.cycHit.add(vk); return this.prev.has(vk) ? this.prev.get(vk) : 0;
        }
        this.visiting.add(vk); this.stack.push(vk);
        try { v = this.firstOf(this.rawOf(sh, fx)); } finally { this.visiting.delete(vk); this.stack.pop(); }
      } else {
        v = this.spillAt(sh, r, c);
        if (v === undefined) { const cv = sh.v.get(k); v = cv === undefined ? null : cv; }
      }
      cs.set(k, v); return v;
    }
    rawOf(sh, fx) {
      const key = sh.name + "!" + fx.r + "," + fx.c;
      if (key in this.raw) return this.raw[key];
      const v = this.ev(fx.ast, sh);
      let out = v;
      if (isRng(v)) out = this.rngToArr(v);
      if (isArr(out) && out.rows.length === 1 && out.rows[0].length === 1) out = out.rows[0][0];
      else if (isArr(out) && this.blocked(sh, fx, out)) out = E.REF; // spill would overwrite data (Google: #REF!)
      this.raw[key] = out; return out;
    }
    blocked(sh, fx, arr) {
      const R = arr.rows.length, C = arr.rows.reduce((m, r) => Math.max(m, r.length), 0);
      if (R * C > 200000) return false;
      for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
        if (i === 0 && j === 0) continue;
        const k = KEY(fx.r + i, fx.c + j);
        if (sh.f.has(k)) return true;
        const cv = sh.v.get(k); if (cv !== undefined && cv !== null && cv !== "") return true;
      }
      return false;
    }
    firstOf(v) { if (isArr(v)) { const x = v.rows[0] && v.rows[0][0]; return x === undefined ? null : x; } if (isRng(v)) return this.scalar(v); return v; }
    spillAt(sh, r, c) {
      for (const a of sh.anchors) {
        if (a.r > r || a.c > c || (a.r === r && a.c === c)) continue;
        const fx = sh.f.get(KEY(a.r, a.c)); if (!fx) continue;
        const vk = sh.name + "!" + KEY(a.r, a.c);
        if (this.visiting.has(vk)) continue;
        this.visiting.add(vk);
        let res; try { res = this.rawOf(sh, fx); } finally { this.visiting.delete(vk); }
        if (isArr(res)) {
          const row = res.rows[r - a.r];
          if (row && c - a.c < row.length) { const x = row[c - a.c]; return x === undefined ? null : x; }
          if (row || r - a.r < res.rows.length) { /* inside bounding box but jagged */ }
        }
      }
      return undefined;
    }
    extent(rg) { // clip Infinity bounds
      const sh = this._sheet(rg.sheet);
      return { r2: rg.r2 === Infinity ? sh.maxR : Math.min(rg.r2, Math.max(sh.maxR, rg.r2 === Infinity ? 1 : 0) || rg.r2), c2: rg.c2 === Infinity ? sh.maxC : rg.c2 };
    }
    rngToArr(rg) {
      const sh = this._sheet(rg.sheet); const rows = [];
      const r2 = rg.r2 === Infinity ? sh.maxR : rg.r2, c2 = rg.c2 === Infinity ? sh.maxC : rg.c2;
      for (let r = rg.r1; r <= r2; r++) { const row = []; for (let c = rg.c1; c <= c2; c++) row.push(this.cell(sh, r, c)); rows.push(row); }
      return new Arr(rows);
    }
    scalar(v) {
      if (isRng(v)) { const sh = this._sheet(v.sheet); return this.cell(sh, v.r1, v.c1); }
      if (isArr(v)) { const x = v.rows[0] && v.rows[0][0]; return x === undefined ? null : x; }
      return v;
    }
    arr(v) { return isRng(v) ? this.rngToArr(v) : isArr(v) ? v : new Arr([[v]]); }

    /* ---- evaluation */
    ev(node, sh) {
      switch (node.t) {
        case "num": case "str": case "bool": case "err": return node.v;
        case "missing": return null;
        case "ref": { const s = node.sheet ? this._sheet(node.sheet) : sh; if (!s) return E.REF; return new Rng(s, node.r1, node.c1, node.r2, node.c2); }
        case "name": { for (let i = this.scope.length - 1; i >= 0; i--) if (node.v.toLowerCase() in this.scope[i]) return this.scope[i][node.v.toLowerCase()]; return E.NAME; }
        case "neg": { const a = this.ev(node.a, sh); return this.map1(a, x => { const n = toNum(x); return isErr(n) ? n : -n; }); }
        case "pos": return this.ev(node.a, sh);
        case "pct": { const a = this.ev(node.a, sh); return this.map1(a, x => { const n = toNum(x); return isErr(n) ? n : n / 100; }); }
        case "bin": return this.binary(node.op, this.ev(node.a, sh), this.ev(node.b, sh));
        case "arrc": return new Arr(node.rows.map(r => r.map(e => this.scalar(this.ev(e, sh)))));
        case "call": return this.call(node, sh);
      }
      throw new Error("bad node " + node.t);
    }
    map1(a, f) { if (isRng(a)) a = this.rngToArr(a); if (isArr(a)) return new Arr(a.rows.map(r => r.map(f))); return f(a); }
    binary(op, a, b) {
      if (isRng(a)) { if (a.r1 === a.r2 && a.c1 === a.c2) a = this.scalar(a); else a = this.rngToArr(a); }
      if (isRng(b)) { if (b.r1 === b.r2 && b.c1 === b.c2) b = this.scalar(b); else b = this.rngToArr(b); }
      if (isArr(a) || isArr(b)) {
        const A = isArr(a) ? a.rows : null, B = isArr(b) ? b.rows : null;
        const R = Math.max(A ? A.length : 1, B ? B.length : 1), C = Math.max(A ? A[0].length : 1, B ? B[0].length : 1);
        const out = [];
        for (let i = 0; i < R; i++) { const row = []; for (let j = 0; j < C; j++) {
          const x = A ? (A[A.length === 1 ? 0 : i] || [])[A[0].length === 1 ? 0 : j] : a;
          const y = B ? (B[B.length === 1 ? 0 : i] || [])[B[0].length === 1 ? 0 : j] : b;
          row.push(this.binary1(op, x === undefined ? null : x, y === undefined ? null : y));
        } out.push(row); }
        return new Arr(out);
      }
      return this.binary1(op, a, b);
    }
    binary1(op, a, b) {
      if (isErr(a)) return a; if (isErr(b)) return b;
      switch (op) {
        case "+": case "-": case "*": case "/": case "^": {
          const x = toNum(a), y = toNum(b); if (isErr(x)) return x; if (isErr(y)) return y;
          switch (op) {
            case "+": return x + y; case "-": return x - y; case "*": return x * y;
            case "/": return y === 0 ? E.DIV0 : x / y;
            case "^": { if (x === 0 && y === 0) return E.NUM; const r = Math.pow(x, y); return isNaN(r) ? E.NUM : r; }
          }
          break;
        }
        case "&": return toStr(a) + toStr(b);
        default: {
          const c = cmp(a, b);
          switch (op) {
            case "=": return c === 0; case "<>": return c !== 0; case "<": return c < 0; case ">": return c > 0; case "<=": return c <= 0; case ">=": return c >= 0;
          }
        }
      }
      return E.VALUE;
    }
    call(node, sh) {
      const fn = FUNCS[node.name];
      if (!fn) { this.unsupported.add(node.name); return E.NAME; }
      if (fn.lazy) return fn.f(this, node.args, sh);
      const args = node.args.map(a => this.ev(a, sh));
      return fn.f(this, args, sh);
    }
  }

  /* ------------------------------------------------------------------ function library */
  const FUNCS = {};
  const def = (names, f, lazy) => { for (const n of names.split(" ")) FUNCS[n] = { f, lazy: !!lazy }; };

  // argument helpers
  const S = (en, v) => en.scalar(v);
  function numArg(en, v, dflt) { if (v === undefined || (v === null && dflt !== undefined)) return dflt; return toNum(S(en, v)); }
  function* leaves(en, v, direct) { // yield scalar leaves from args; ranges/arrays flattened (direct=false for range items)
    if (isRng(v)) { const a = en.rngToArr(v); for (const row of a.rows) for (const x of row) yield { v: x, direct: false }; }
    else if (isArr(v)) { for (const row of v.rows) for (const x of row) yield { v: x, direct: false }; }
    else yield { v, direct: true };
  }
  function collectNums(en, args) {
    const out = [];
    for (const a of args) for (const it of leaves(en, a)) {
      const x = it.v;
      if (isErr(x)) return x;
      if (it.direct) { if (x === null) { out.push(0); continue; } const n = toNum(x); if (isErr(n)) return n; out.push(n); }
      else if (typeof x === "number") out.push(x);
    }
    return out;
  }
  function firstErr(...vs) { for (const v of vs) if (isErr(v)) return v; return null; }

  def("SUM", (en, a) => { const n = collectNums(en, a); return isErr(n) ? n : n.reduce((s, x) => s + x, 0); });
  def("PRODUCT", (en, a) => { const n = collectNums(en, a); return isErr(n) ? n : n.length ? n.reduce((s, x) => s * x, 1) : 0; });
  def("MIN", (en, a) => { const n = collectNums(en, a); return isErr(n) ? n : n.length ? Math.min(...n) : 0; });
  def("MAX", (en, a) => { const n = collectNums(en, a); return isErr(n) ? n : n.length ? Math.max(...n) : 0; });
  def("AVERAGE", (en, a) => { const n = collectNums(en, a); if (isErr(n)) return n; return n.length ? n.reduce((s, x) => s + x, 0) / n.length : E.DIV0; });
  def("COUNT", (en, a) => { let c = 0; for (const x of a) for (const it of leaves(en, x)) { if (typeof it.v === "number") c++; } return c; });
  def("COUNTA", (en, a) => { let c = 0; for (const x of a) for (const it of leaves(en, x)) { if (it.v !== null && it.v !== undefined) c++; } return c; });
  def("ABS", (en, a) => { const n = numArg(en, a[0]); return isErr(n) ? n : Math.abs(n); });
  def("INT", (en, a) => { const n = numArg(en, a[0]); return isErr(n) ? n : Math.floor(n); });
  def("SQRT", (en, a) => { const n = numArg(en, a[0]); return isErr(n) ? n : n < 0 ? E.NUM : Math.sqrt(n); });
  def("EXP", (en, a) => { const n = numArg(en, a[0]); return isErr(n) ? n : Math.exp(n); });
  def("LN", (en, a) => { const n = numArg(en, a[0]); return isErr(n) ? n : n <= 0 ? E.NUM : Math.log(n); });
  def("LOG10", (en, a) => { const n = numArg(en, a[0]); return isErr(n) ? n : n <= 0 ? E.NUM : Math.log10(n); });
  def("POWER", (en, a) => en.binary1("^", S(en, a[0]), S(en, a[1])));
  def("MOD", (en, a) => { const x = numArg(en, a[0]), y = numArg(en, a[1]); const e = firstErr(x, y); if (e) return e; if (y === 0) return E.DIV0; return x - y * Math.floor(x / y); });
  def("SIGN", (en, a) => { const n = numArg(en, a[0]); return isErr(n) ? n : Math.sign(n); });
  def("PI", () => Math.PI);
  const rounder = mode => (en, a) => { const x = numArg(en, a[0]), d = numArg(en, a[1], 0); const e = firstErr(x, d); if (e) return e; return xRound(x, Math.trunc(d), mode); };
  def("ROUND", rounder(0)); def("ROUNDUP", rounder(1)); def("ROUNDDOWN", rounder(2)); def("TRUNC", rounder(2));
  def("CEILING", (en, a) => { const x = numArg(en, a[0]), s = a.length > 1 ? numArg(en, a[1]) : 1; const e = firstErr(x, s); if (e) return e; if (s === 0) return 0; return Number((Math.ceil(Number((x / s).toPrecision(15))) * s).toPrecision(15)); });
  def("FLOOR", (en, a) => { const x = numArg(en, a[0]), s = a.length > 1 ? numArg(en, a[1]) : 1; const e = firstErr(x, s); if (e) return e; if (s === 0) return E.DIV0; return Number((Math.floor(Number((x / s).toPrecision(15))) * s).toPrecision(15)); });
  def("MROUND", (en, a) => { const x = numArg(en, a[0]), s = numArg(en, a[1]); const e = firstErr(x, s); if (e) return e; if (s === 0) return 0; return Math.round(x / s) * s; });
  def("SUMPRODUCT", (en, a) => {
    const arrs = a.map(x => en.arr(x)); const R = arrs[0].rows.length, C = arrs[0].rows[0].length; let t = 0;
    for (const x of arrs) if (x.rows.length !== R || x.rows[0].length !== C) return E.VALUE;
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) { let p = 1; for (const x of arrs) { const v = x.rows[i][j]; if (isErr(v)) return v; p *= typeof v === "number" ? v : 0; } t += p; }
    return t;
  });

  // logical
  def("IF", (en, args, sh) => {
    const c = en.ev(args[0], sh);
    if (isRng(c) || isArr(c)) {
      const cond = en.arr(c), tv = args[1] ? en.ev(args[1], sh) : true, fv = args[2] ? en.ev(args[2], sh) : false;
      const T = en.arr(tv), F = en.arr(fv);
      return new Arr(cond.rows.map((row, i) => row.map((x, j) => { const b = toBool(x); if (isErr(b)) return b; const src = b ? T : F; const r = src.rows[src.rows.length === 1 ? 0 : i] || []; const v = r[r.length === 1 ? 0 : j]; return v === undefined ? null : v; })));
    }
    const b = toBool(c); if (isErr(b)) return b;
    if (b) return args.length > 1 ? (args[1].t === "missing" ? 0 : en.ev(args[1], sh)) : true;
    return args.length > 2 ? (args[2].t === "missing" ? 0 : en.ev(args[2], sh)) : false;
  }, true);
  def("IFS", (en, args, sh) => {
    for (let i = 0; i + 1 < args.length; i += 2) { const b = toBool(en.scalar(en.ev(args[i], sh))); if (isErr(b)) return b; if (b) return en.ev(args[i + 1], sh); }
    return E.NA;
  }, true);
  def("IFERROR", (en, args, sh) => { const v = en.ev(args[0], sh); const s = en.scalar(v); if (isErr(s)) return args.length > 1 ? en.ev(args[1], sh) : ""; return v; }, true);
  def("IFNA", (en, args, sh) => { const v = en.ev(args[0], sh); const s = en.scalar(v); if (s === E.NA) return en.ev(args[1], sh); return v; }, true);
  def("AND", (en, a) => { let r = true, any = false; for (const x of a) for (const it of leaves(en, x)) { if (isErr(it.v)) return it.v; if (it.v === null || (typeof it.v === "string" && !it.direct)) continue; const b = toBool(it.v); if (isErr(b)) return b; any = true; if (!b) r = false; } return any ? r : E.VALUE; });
  def("OR", (en, a) => { let r = false, any = false; for (const x of a) for (const it of leaves(en, x)) { if (isErr(it.v)) return it.v; if (it.v === null || (typeof it.v === "string" && !it.direct)) continue; const b = toBool(it.v); if (isErr(b)) return b; any = true; if (b) r = true; } return any ? r : E.VALUE; });
  def("NOT", (en, a) => { const b = toBool(S(en, a[0])); return isErr(b) ? b : !b; });
  def("TRUE", () => true); def("FALSE", () => false);
  def("ISERROR", (en, a) => isErr(S(en, a[0])));
  def("ISERR", (en, a) => { const v = S(en, a[0]); return isErr(v) && v !== E.NA; });
  def("ISNA", (en, a) => S(en, a[0]) === E.NA);
  def("ISBLANK", (en, a) => S(en, a[0]) === null);
  def("ISNUMBER", (en, a) => typeof S(en, a[0]) === "number");
  def("ISTEXT", (en, a) => typeof S(en, a[0]) === "string");
  def("N", (en, a) => { const v = S(en, a[0]); return typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : isErr(v) ? v : 0; });
  def("CHOOSE", (en, args, sh) => { const i = toNum(en.scalar(en.ev(args[0], sh))); if (isErr(i)) return i; const k = Math.trunc(i); if (k < 1 || k >= args.length) return E.VALUE; return en.ev(args[k], sh); }, true);
  def("SWITCH", (en, args, sh) => {
    const x = en.scalar(en.ev(args[0], sh)); if (isErr(x)) return x;
    for (let i = 1; i + 1 < args.length; i += 2) { const y = en.scalar(en.ev(args[i], sh)); if (cmp(x, y) === 0) return en.ev(args[i + 1], sh); }
    return args.length % 2 === 0 ? en.ev(args[args.length - 1], sh) : E.NA;
  }, true);
  def("LET", (en, args, sh) => {
    const scope = {}; en.scope.push(scope);
    try {
      for (let i = 0; i + 1 < args.length; i += 2) scope[args[i].v.toLowerCase()] = en.ev(args[i + 1], sh);
      return en.ev(args[args.length - 1], sh);
    } finally { en.scope.pop(); }
  }, true);

  // text
  def("CONCATENATE CONCAT", (en, a) => { let s = ""; for (const x of a) for (const it of leaves(en, x)) { const t = toStr(it.v); if (isErr(t)) return t; s += t; } return s; });
  def("TEXT", (en, a) => {
    let v = S(en, a[0]), f = toStr(S(en, a[1])); const e = firstErr(v, f); if (e) return e;
    if (v === null) v = 0;
    if (typeof v === "string") { const n = parseNumStr(v); if (n === null) return v; v = n; }
    if (typeof v === "boolean") return toStr(v);
    return formatText(v, f);
  });
  def("LEN", (en, a) => { const s = toStr(S(en, a[0])); return isErr(s) ? s : s.length; });
  def("UPPER", (en, a) => { const s = toStr(S(en, a[0])); return isErr(s) ? s : s.toUpperCase(); });
  def("LOWER", (en, a) => { const s = toStr(S(en, a[0])); return isErr(s) ? s : s.toLowerCase(); });
  def("TRIM", (en, a) => { const s = toStr(S(en, a[0])); return isErr(s) ? s : s.trim().replace(/\s+/g, " "); });
  def("LEFT", (en, a) => { const s = toStr(S(en, a[0])), n = numArg(en, a[1], 1); const e = firstErr(s, n); return e || s.slice(0, Math.max(0, Math.trunc(n))); });
  def("RIGHT", (en, a) => { const s = toStr(S(en, a[0])), n = numArg(en, a[1], 1); const e = firstErr(s, n); return e || (n <= 0 ? "" : s.slice(-Math.trunc(n))); });
  def("MID", (en, a) => { const s = toStr(S(en, a[0])), st = numArg(en, a[1]), n = numArg(en, a[2]); const e = firstErr(s, st, n); return e || s.substr(Math.max(0, Math.trunc(st) - 1), Math.max(0, Math.trunc(n))); });
  def("VALUE", (en, a) => { const v = S(en, a[0]); if (typeof v === "number") return v; const s = toStr(v); if (isErr(s)) return s; const n = parseNumStr(s); return n === null ? E.VALUE : n; });
  def("SUBSTITUTE", (en, a) => { const s = toStr(S(en, a[0])), o = toStr(S(en, a[1])), n = toStr(S(en, a[2])); const e = firstErr(s, o, n); return e || (o === "" ? s : s.split(o).join(n)); });
  def("REPT", (en, a) => { const s = toStr(S(en, a[0])), n = numArg(en, a[1]); const e = firstErr(s, n); return e || s.repeat(Math.max(0, Math.trunc(n))); });
  def("FIND", (en, a) => { const f = toStr(S(en, a[0])), s = toStr(S(en, a[1])), st = numArg(en, a[2], 1); const e = firstErr(f, s, st); if (e) return e; const i = s.indexOf(f, st - 1); return i < 0 ? E.VALUE : i + 1; });
  def("SEARCH", (en, a) => { const f = toStr(S(en, a[0])), s = toStr(S(en, a[1])), st = numArg(en, a[2], 1); const e = firstErr(f, s, st); if (e) return e; const i = s.toLowerCase().indexOf(f.toLowerCase(), st - 1); return i < 0 ? E.VALUE : i + 1; });

  // dates (1900 date system, like Google/Excel)
  def("TODAY", en => dateToSerial(en.now));
  def("NOW", en => (en.now.getTime() - Date.UTC(1899, 11, 30)) / 86400000 - en.now.getTimezoneOffset() / 1440);
  def("DATE", (en, a) => { const y = numArg(en, a[0]), m = numArg(en, a[1]), d = numArg(en, a[2]); const e = firstErr(y, m, d); if (e) return e; return dateToSerial(new Date(Date.UTC(Math.trunc(y), Math.trunc(m) - 1, Math.trunc(d)))); });
  def("YEAR", (en, a) => { const n = numArg(en, a[0]); return isErr(n) ? n : serialToDate(n).getUTCFullYear(); });
  def("MONTH", (en, a) => { const n = numArg(en, a[0]); return isErr(n) ? n : serialToDate(n).getUTCMonth() + 1; });
  def("DAY", (en, a) => { const n = numArg(en, a[0]); return isErr(n) ? n : serialToDate(n).getUTCDate(); });
  def("EDATE", (en, a) => { const n = numArg(en, a[0]), m = numArg(en, a[1]); const e = firstErr(n, m); if (e) return e; const d = serialToDate(n); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Math.trunc(m), 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(d.getUTCDate(), last)); return dateToSerial(t); });
  def("EOMONTH", (en, a) => { const n = numArg(en, a[0]), m = numArg(en, a[1]); const e = firstErr(n, m); if (e) return e; const d = serialToDate(n); return dateToSerial(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Math.trunc(m) + 1, 0))); });

  // financial
  function pmtF(r, n, pv, fv, t) { if (r === 0) return -(pv + fv) / n; const p = Math.pow(1 + r, n); return -(r * (pv * p + fv)) / ((1 + r * t) * (p - 1)); }
  def("PMT", (en, a) => { const r = numArg(en, a[0]), n = numArg(en, a[1]), pv = numArg(en, a[2]), fv = numArg(en, a[3], 0), t = numArg(en, a[4], 0); const e = firstErr(r, n, pv, fv, t); if (e) return e; if (n === 0) return E.NUM; return pmtF(r, n, pv, fv, t ? 1 : 0); });
  def("PV", (en, a) => { const r = numArg(en, a[0]), n = numArg(en, a[1]), pm = numArg(en, a[2]), fv = numArg(en, a[3], 0), t = numArg(en, a[4], 0); const e = firstErr(r, n, pm, fv, t); if (e) return e; if (r === 0) return -(fv + pm * n); const p = Math.pow(1 + r, n); return -(fv + pm * (1 + r * (t ? 1 : 0)) * (p - 1) / r) / p; });
  def("FV", (en, a) => { const r = numArg(en, a[0]), n = numArg(en, a[1]), pm = numArg(en, a[2]), pv = numArg(en, a[3], 0), t = numArg(en, a[4], 0); const e = firstErr(r, n, pm, pv, t); if (e) return e; if (r === 0) return -(pv + pm * n); const p = Math.pow(1 + r, n); return -(pv * p + pm * (1 + r * (t ? 1 : 0)) * (p - 1) / r); });
  def("NPER", (en, a) => { const r = numArg(en, a[0]), pm = numArg(en, a[1]), pv = numArg(en, a[2]), fv = numArg(en, a[3], 0), t = numArg(en, a[4], 0); const e = firstErr(r, pm, pv, fv, t); if (e) return e; const tt = t ? 1 : 0; if (r === 0) { return pm === 0 ? E.NUM : -(pv + fv) / pm; } const x = (pm * (1 + r * tt) - fv * r) / (pm * (1 + r * tt) + pv * r); if (!(x > 0)) return E.NUM; return Math.log(x) / Math.log(1 + r); });
  def("RATE", (en, a) => {
    const n = numArg(en, a[0]), pm = numArg(en, a[1]), pv = numArg(en, a[2]), fv = numArg(en, a[3], 0), t = numArg(en, a[4], 0), g = numArg(en, a[5], 0.1); const e = firstErr(n, pm, pv, fv, t, g); if (e) return e;
    const tt = t ? 1 : 0;
    const f = r => r === 0 ? pv + pm * n + fv : pv * Math.pow(1 + r, n) + pm * (1 + r * tt) * (Math.pow(1 + r, n) - 1) / r + fv;
    return solveRoot(f, g);
  });
  function solveRoot(f, guess) { // Newton with numeric derivative, then bracketed bisection fallback
    let r = guess;
    for (let i = 0; i < 200; i++) {
      const y = f(r); if (!isFinite(y)) break;
      const h = Math.max(1e-7, Math.abs(r) * 1e-7), d = (f(r + h) - f(r - h)) / (2 * h);
      if (!isFinite(d) || d === 0) break;
      const nr = r - y / d; if (!isFinite(nr)) break;
      if (Math.abs(nr - r) < 1e-12) return nr; r = nr;
    }
    let lo = -0.99, hi = 10, flo = f(lo), fhi = f(hi);
    if (isFinite(flo) && isFinite(fhi) && flo * fhi < 0) {
      for (let i = 0; i < 300; i++) { const mid = (lo + hi) / 2, fm = f(mid); if (fm * flo <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; } if (hi - lo < 1e-14) break; }
      return (lo + hi) / 2;
    }
    return E.NUM;
  }
  def("IRR", (en, a) => {
    const n = collectNums(en, [a[0]]); if (isErr(n)) return n; const g = numArg(en, a[1], 0.1);
    if (!n.some(x => x > 0) || !n.some(x => x < 0)) return E.NUM;
    const f = r => { let s = 0; for (let i = 0; i < n.length; i++) s += n[i] / Math.pow(1 + r, i); return s; };
    return solveRoot(f, g);
  });
  def("NPV", (en, a) => { const r = numArg(en, a[0]); if (isErr(r)) return r; const n = collectNums(en, a.slice(1)); if (isErr(n)) return n; let s = 0; for (let i = 0; i < n.length; i++) s += n[i] / Math.pow(1 + r, i + 1); return s; });

  // lookup & arrays
  function lookupKeyCmp(a, b) { return cmp(a, b); }
  // lookups read only the cells they need (like Excel/Google): the key column, then ONE result cell.
  // (Reading the whole table would create false circular references.)
  function tableOf(en, v) { // -> {R, C, at(i,j)}
    if (isRng(v)) {
      const sh = en._sheet(v.sheet), r2 = v.r2 === Infinity ? sh.maxR : v.r2, c2 = v.c2 === Infinity ? sh.maxC : v.c2;
      return { R: Math.max(0, r2 - v.r1 + 1), C: Math.max(0, c2 - v.c1 + 1), at: (i, j) => en.cell(sh, v.r1 + i, v.c1 + j) };
    }
    const x = isArr(v) ? v : new Arr([[v]]);
    return { R: x.rows.length, C: x.rows[0].length, at: (i, j) => { const q = x.rows[i][j]; return q === undefined ? null : q; } };
  }
  function findIn(key, n, get, approxMode) { // approxMode: 0 exact, 1 largest<=key (ascending), -1 smallest>=key (descending)
    let hit = -1;
    if (approxMode === 0) { for (let i = 0; i < n; i++) { const v = get(i); if (isErr(v)) continue; if (v !== null && key !== null && typeRank(v) === typeRank(key) && cmp(v, key) === 0) return i; } return -1; }
    const k = key === null ? 0 : key;
    for (let i = 0; i < n; i++) {
      const v = get(i); if (v === null || isErr(v) || typeRank(v) !== typeRank(k)) continue;
      const c = cmp(v, k);
      if (approxMode > 0) { if (c <= 0) hit = i; else break; } else { if (c >= 0) hit = i; else break; }
    }
    return hit;
  }
  def("VLOOKUP", (en, a) => {
    const key = S(en, a[0]); if (isErr(key)) return key;
    const t = tableOf(en, a[1]), idx = numArg(en, a[2]); if (isErr(idx)) return idx;
    const approx = a.length > 3 && a[3] !== null ? toBool(S(en, a[3])) : true; if (isErr(approx)) return approx;
    if (idx < 1) return E.VALUE; if (t.R && idx > t.C) return E.REF;
    const hit = findIn(key, t.R, i => t.at(i, 0), approx ? 1 : 0);
    if (hit < 0) return E.NA;
    const out = t.at(hit, Math.trunc(idx) - 1); return out === undefined ? null : out;
  });
  def("HLOOKUP", (en, a) => {
    const key = S(en, a[0]); if (isErr(key)) return key;
    const t = tableOf(en, a[1]), idx = numArg(en, a[2]); if (isErr(idx)) return idx;
    const approx = a.length > 3 && a[3] !== null ? toBool(S(en, a[3])) : true;
    if (idx > t.R) return E.REF;
    const hit = findIn(key, t.C, j => t.at(0, j), approx ? 1 : 0);
    return hit < 0 ? E.NA : t.at(Math.trunc(idx) - 1, hit);
  });
  def("MATCH", (en, a) => {
    const key = S(en, a[0]); if (isErr(key)) return key;
    const t = tableOf(en, a[1]); const type = numArg(en, a[2], 1);
    const n = t.R === 1 ? t.C : t.R, get = t.R === 1 ? (j => t.at(0, j)) : (i => t.at(i, 0));
    const hit = findIn(key, n, get, type === 0 ? 0 : type > 0 ? 1 : -1);
    return hit < 0 ? E.NA : hit + 1;
  });
  def("INDEX", (en, a) => {
    const t = tableOf(en, a[0]); const r = numArg(en, a[1], 0), c = numArg(en, a[2], 0); const e = firstErr(r, c); if (e) return e;
    let rr = Math.trunc(r), cc = Math.trunc(c);
    if (t.R === 1 && a.length === 2) { cc = rr; rr = 1; }
    if (rr < 0 || cc < 0 || rr > t.R || cc > t.C) return E.REF;
    if (rr === 0 && cc === 0) return en.arr(a[0]);
    if (rr === 0) { const out = []; for (let i = 0; i < t.R; i++) out.push([t.at(i, cc - 1)]); return new Arr(out); }
    if (cc === 0) { const row = []; for (let j = 0; j < t.C; j++) row.push(t.at(rr - 1, j)); return new Arr([row]); }
    const v = t.at(rr - 1, cc - 1); return v === undefined ? null : v;
  });
  def("OFFSET", (en, a) => {
    const ref = a[0]; if (!isRng(ref)) return E.VALUE;
    const dr = numArg(en, a[1], 0), dc = numArg(en, a[2], 0); const e = firstErr(dr, dc); if (e) return e;
    const h = a.length > 3 && a[3] !== null ? numArg(en, a[3]) : ref.r2 - ref.r1 + 1, w = a.length > 4 && a[4] !== null ? numArg(en, a[4]) : ref.c2 - ref.c1 + 1;
    const e2 = firstErr(h, w); if (e2) return e2;
    const r1 = ref.r1 + Math.trunc(dr), c1 = ref.c1 + Math.trunc(dc);
    if (r1 < 1 || c1 < 1 || h < 1 || w < 1) return E.REF;
    return new Rng(ref.sheet, r1, c1, r1 + Math.trunc(h) - 1, c1 + Math.trunc(w) - 1);
  });
  def("ROW", (en, a, sh) => isRng(a[0]) ? a[0].r1 : E.VALUE);
  def("COLUMN", (en, a) => isRng(a[0]) ? a[0].c1 : E.VALUE);
  def("ROWS", (en, a) => tableOf(en, a[0]).R);
  def("COLUMNS", (en, a) => tableOf(en, a[0]).C);
  def("TRANSPOSE", (en, a) => { const x = en.arr(a[0]); const R = x.rows.length, C = x.rows[0].length, out = []; for (let j = 0; j < C; j++) { const row = []; for (let i = 0; i < R; i++) row.push(x.rows[i][j]); out.push(row); } return new Arr(out); });
  def("SEQUENCE", (en, a) => {
    const r = numArg(en, a[0]), c = numArg(en, a[1], 1), s = numArg(en, a[2], 1), st = numArg(en, a[3], 1); const e = firstErr(r, c, s, st); if (e) return e;
    if (r < 1 || c < 1) return E.NUM; const out = []; let v = s;
    for (let i = 0; i < Math.trunc(r); i++) { const row = []; for (let j = 0; j < Math.trunc(c); j++) { row.push(v); v += st; } out.push(row); }
    return new Arr(out);
  });
  def("FILTER", (en, a) => {
    const src = en.arr(a[0]); const R = src.rows.length, C = src.rows[0].length;
    let keepRows = null, keepCols = null;
    for (let k = 1; k < a.length; k++) {
      const cond = en.arr(a[k]);
      if (cond.rows.length === R && cond.rows[0].length === 1) { keepRows = keepRows || new Array(R).fill(true); for (let i = 0; i < R; i++) { const x = cond.rows[i][0]; if (isErr(x)) return x; const b = typeof x === "boolean" ? x : (typeof x === "number" ? x !== 0 : false); if (!b) keepRows[i] = false; } }
      else if (cond.rows.length === 1 && cond.rows[0].length === C) { keepCols = keepCols || new Array(C).fill(true); for (let j = 0; j < C; j++) { const x = cond.rows[0][j]; if (isErr(x)) return x; const b = typeof x === "boolean" ? x : (typeof x === "number" ? x !== 0 : false); if (!b) keepCols[j] = false; } }
      else if (cond.rows.length === 1 && cond.rows[0].length === 1 && R === 1 && C === 1) { /* scalar */ }
      else return E.VALUE;
    }
    const rows = []; for (let i = 0; i < R; i++) { if (keepRows && !keepRows[i]) continue; const row = []; for (let j = 0; j < C; j++) if (!keepCols || keepCols[j]) row.push(src.rows[i][j]); rows.push(row); }
    if (!rows.length || !rows[0].length) return E.NA; return new Arr(rows);
  });
  def("UNIQUE", (en, a) => {
    const src = en.arr(a[0]); const seen = new Set(), out = [];
    for (const row of src.rows) {
      const k = row.map(x => x === null ? "b" : typeof x === "string" ? "s" + x.toLowerCase() : typeof x + String(x)).join("\u0001");
      if (seen.has(k)) continue; seen.add(k); out.push(row.slice());
    }
    return out.length ? new Arr(out) : E.NA;
  });
  def("CHOOSECOLS", (en, a) => { const x = en.arr(a[0]); const idx = []; for (let k = 1; k < a.length; k++) { const n = numArg(en, a[k]); if (isErr(n)) return n; idx.push(Math.trunc(n) - 1); } return new Arr(x.rows.map(r => idx.map(j => r[j] === undefined ? E.VALUE : r[j]))); });
  def("ARRAYFORMULA", (en, a) => a[0]);
  def("QUERY", (en, a, sh) => { // supports: "SELECT A,B,C" (column letters of the sheet, or Col1..) with optional header row count
    const rg = a[0]; const q = toStr(S(en, a[1])); if (isErr(q)) return q;
    const m = /^\s*select\s+(.+?)\s*$/i.exec(q); if (!m) { en.unsupported.add("QUERY(" + q.slice(0, 30) + ")"); return E.VALUE; }
    const data = en.arr(rg); const firstCol = isRng(rg) ? rg.c1 : 1;
    const cols = m[1].split(",").map(s => s.trim());
    const idx = [];
    for (const c of cols) {
      let j;
      if (/^col\d+$/i.test(c)) j = parseInt(c.slice(3), 10) - 1;
      else if (/^[A-Za-z]{1,3}$/.test(c)) j = colToNum(c.toUpperCase()) - firstCol;
      else { en.unsupported.add("QUERY(" + q.slice(0, 30) + ")"); return E.VALUE; }
      if (j < 0 || j >= (data.rows[0] || []).length) return E.VALUE;
      idx.push(j);
    }
    return new Arr(data.rows.map(r => idx.map(j => r[j] === undefined ? null : isErr(r[j]) ? r[j].code : r[j])));
  });

  const api = { Engine, parseFormula, formatText, XlErr, E, isErr, Rng, Arr, numToCol, colToNum, parseAddr, FUNCS };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MasterEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
