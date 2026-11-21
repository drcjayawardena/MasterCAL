/* MasterCAL Pro standalone: username + password registration/login (offline).
 * Users live in this browser's localStorage (this PC only). Only @cf.lk addresses may register.
 * Passwords are never stored: PBKDF2-SHA256 (salted) when crypto.subtle exists, else salted SHA-256 fallback.
 * NOTE: this is a convenience gate, not strong security: the file itself holds the rates. */
(function () {
  "use strict";
  if (window.__mcRemote) return;   /* online mode uses the MasterCAL login instead */
  var DOMAIN = "@cf.lk", KEY = "mc_sa_users", SESS = "mc_sa_session";
  var mem = {};
  function lg(k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] || null; } }
  function ls(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } }
  function sg(k) { try { return sessionStorage.getItem(k); } catch (e) { return mem["s" + k] || null; } }
  function ss(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { mem["s" + k] = v; } }
  function users() { try { return JSON.parse(lg(KEY) || "{}"); } catch (e) { return {}; } }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function rnd() { var a = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.floor(Math.random() * 256); }); return hex(a); }
  /* tiny SHA-256 fallback (only when crypto.subtle is unavailable) */
  function sha256(s) {
    function r(n, x) { return (x >>> n) | (x << (32 - n)); }
    var K = [], p = 2, c = 0; while (c < 64) { var pr = true; for (var d = 2; d * d <= p; d++) if (p % d === 0) { pr = false; break; } if (pr) { K[c++] = (Math.pow(p, 1 / 3) % 1) * 4294967296 | 0; } p++; }
    var H = [], q = 2; c = 0; while (c < 8) { var pr2 = true; for (var e = 2; e * e <= q; e++) if (q % e === 0) { pr2 = false; break; } if (pr2) { H[c++] = (Math.sqrt(q) % 1) * 4294967296 | 0; } q++; }
    var b = unescape(encodeURIComponent(s)), l = b.length, w = [];
    for (var i = 0; i < l; i++) w[i >> 2] |= b.charCodeAt(i) << (24 - (i % 4) * 8);
    w[l >> 2] |= 0x80 << (24 - (l % 4) * 8); w[(((l + 8) >> 6) + 1) * 16 - 1] = l * 8;
    for (var j = 0; j < w.length; j += 16) {
      var W = w.slice(j, j + 16), a = H.slice();
      for (var t = 16; t < 64; t++) { var s0 = r(7, W[t - 15]) ^ r(18, W[t - 15]) ^ (W[t - 15] >>> 3), s1 = r(17, W[t - 2]) ^ r(19, W[t - 2]) ^ (W[t - 2] >>> 10); W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0; }
      for (t = 0; t < 64; t++) {
        var S1 = r(6, a[4]) ^ r(11, a[4]) ^ r(25, a[4]), ch = (a[4] & a[5]) ^ (~a[4] & a[6]), t1 = (a[7] + S1 + ch + K[t] + W[t]) | 0,
            S0 = r(2, a[0]) ^ r(13, a[0]) ^ r(22, a[0]), mj = (a[0] & a[1]) ^ (a[0] & a[2]) ^ (a[1] & a[2]), t2 = (S0 + mj) | 0;
        a = [(t1 + t2) | 0, a[0], a[1], a[2], (a[3] + t1) | 0, a[4], a[5], a[6]];
      }
      for (t = 0; t < 8; t++) H[t] = (H[t] + a[t]) | 0;
    }
    return H.map(function (x) { return ("00000000" + (x >>> 0).toString(16)).slice(-8); }).join("");
  }
  function hash(pw, salt) {
    var sub = window.crypto && crypto.subtle;
    if (!sub) { var h = pw + salt; for (var i = 0; i < 2000; i++) h = sha256(h + salt); return Promise.resolve("s" + h); }
    var enc = new TextEncoder();
    return sub.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]).then(function (k) {
      return sub.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" }, k, 256);
    }).then(function (b) { return "p" + hex(b); });
  }

  var css = "#mcGate{position:fixed;inset:0;z-index:99999;background:#f3f5f9;display:flex;align-items:center;justify-content:center;font-family:Inter,Segoe UI,Arial,sans-serif}" +
    "#mcGate .box{background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.12);padding:28px;width:min(380px,92vw)}" +
    "#mcGate h1{margin:0 0 2px;color:#1c5e3a;font-size:24px}#mcGate p.s{margin:0 0 16px;color:#667;font-size:13px}" +
    "#mcGate .t{display:flex;gap:8px;margin-bottom:14px}#mcGate .t button{flex:1;padding:9px;border:1px solid #d5dbe3;background:#fff;border-radius:8px;font-weight:600;cursor:pointer}" +
    "#mcGate .t button.on{background:#1c5e3a;color:#fff;border-color:#1c5e3a}" +
    "#mcGate label{display:block;font-size:12px;font-weight:600;color:#445;margin:10px 0 4px}" +
    "#mcGate input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #c9d1db;border-radius:8px;font-size:15px}" +
    "#mcGate .go{width:100%;margin-top:16px;padding:11px;background:#1c5e3a;color:#fff;border:0;border-radius:8px;font-weight:700;font-size:15px;cursor:pointer}" +
    "#mcGate .m{margin-top:12px;font-size:13px;min-height:18px;color:#c62828}#mcGate .m.ok{color:#1c5e3a}" +
    "#mcVer{position:fixed;left:10px;bottom:8px;z-index:9999;font-size:11px;color:#778}#mcOut{position:fixed;right:10px;bottom:8px;z-index:9999;font-size:12px;color:#556;background:#fff;border:1px solid #d5dbe3;border-radius:16px;padding:4px 10px;cursor:pointer}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var gate, mode = "login";
  function build() {
    gate = document.createElement("div"); gate.id = "mcGate";
    gate.innerHTML = '<div class="box"><h1>MasterCAL</h1><p class="s">Vehicle Leasing Rental Calculator</p>' +
      '<div class="t"><button type="button" id="gL">Login</button><button type="button" id="gR">Register</button></div>' +
      '<label>Username</label><input id="gU" autocomplete="username" maxlength="30">' +
      '<div id="gEW"><label>Company email (' + DOMAIN + ')</label><input id="gE" type="email" autocomplete="email" maxlength="80" placeholder="name' + DOMAIN + '"></div>' +
      '<label>Password</label><input id="gP" type="password" autocomplete="current-password" maxlength="64">' +
      '<div id="gCW"><label>Confirm password</label><input id="gC" type="password" autocomplete="new-password" maxlength="64"></div>' +
      '<button type="button" class="go" id="gGo">Login</button><div class="m" id="gM"></div></div>';
    document.body.appendChild(gate);
    gate.querySelector("#gL").onclick = function () { setMode("login"); };
    gate.querySelector("#gR").onclick = function () { setMode("register"); };
    gate.querySelector("#gGo").onclick = submit;
    gate.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
    setMode("login");
  }
  function $(id) { return gate.querySelector("#" + id); }
  function msg(t, ok) { var m = $("gM"); m.textContent = t || ""; m.className = "m" + (ok ? " ok" : ""); }
  function setMode(m) {
    mode = m; var reg = m === "register";
    $("gEW").style.display = $("gCW").style.display = reg ? "" : "none";
    $("gL").className = reg ? "" : "on"; $("gR").className = reg ? "on" : "";
    $("gGo").textContent = reg ? "Register" : "Login"; $("gP").autocomplete = reg ? "new-password" : "current-password"; msg("");
  }
  var fails = 0, lockUntil = 0;
  function submit() {
    var u = $("gU").value.trim(), pw = $("gP").value, key = u.toLowerCase(), db = users();
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(u)) return msg("Username: 3–30 letters, numbers . _ - only.");
    if (mode === "register") {
      var em = $("gE").value.trim().toLowerCase();
      if (!/^[a-z0-9._%+-]+@cf\.lk$/.test(em)) return msg("Only company email addresses (" + DOMAIN + ") can register.");
      if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return msg("Password: at least 8 characters, with letters and numbers.");
      if (pw !== $("gC").value) return msg("Passwords do not match.");
      if (db[key]) return msg("That username is already taken.");
      for (var k in db) if (db[k].email === em) return msg("That email is already registered.");
      var salt = rnd();
      hash(pw, salt).then(function (h) {
        db = users(); db[key] = { name: u, email: em, salt: salt, hash: h, created: new Date().toISOString() }; ls(KEY, JSON.stringify(db));
        ss(SESS, key); open();
      });
    } else {
      if (Date.now() < lockUntil) return msg("Too many attempts. Wait a minute and try again.");
      var rec = db[key];
      hash(pw, rec ? rec.salt : "x").then(function (h) {
        if (rec && h === rec.hash) { fails = 0; ss(SESS, key); open(); return; }
        if (++fails >= 5) { lockUntil = Date.now() + 60000; fails = 0; }
        msg("Wrong username or password.");
      });
    }
  }
  function open() {
    if (gate) { gate.remove(); gate = null; }
    if (document.getElementById("mcOut")) return;
    var b = document.createElement("div"); b.id = "mcOut";
    var rec = users()[sg(SESS)]; b.textContent = (rec ? rec.name : "User") + " · Logout";
    b.onclick = function () { ss(SESS, null); b.remove(); build(); };
    document.body.appendChild(b);
    if (window.__mcPublished && !document.getElementById("mcVer")) {
      var v = document.createElement("div"); v.id = "mcVer"; v.textContent = "Rates updated: " + String(window.__mcPublished).slice(0, 10);
      document.body.appendChild(v);
    }
  }
  function start() { if (users()[sg(SESS)]) open(); else build(); }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
