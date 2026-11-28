/* Online mode only (page opened from the staff link): Logout pill + the Admin tab (approve / block users).
 * The Admin tab is shown only when the server says this login is an administrator. Every action is checked on the server again. */
(function () {
  "use strict";
  if (!window.__mcRemote) return;

  var css = "#mcOut{position:fixed;right:10px;bottom:8px;z-index:9999;font-size:12px;color:#556;background:#fff;border:1px solid #d5dbe3;border-radius:16px;padding:4px 10px;cursor:pointer}" +
    "#mcVer{position:fixed;left:10px;bottom:8px;z-index:9999;font-size:11px;color:#778}" +
    "#adminPanel .adHead{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}" +
    "#adminPanel .adHead h2{margin:0 auto 0 0;font-size:16px;letter-spacing:.04em;text-transform:uppercase}" +
    /* the website styles give every input/select width:100% and a small fixed height: undo that here */
    "#adminPanel select,#adminPanel input{width:auto;height:38px;line-height:normal;padding:0 10px;border:1px solid #c9d1db;border-radius:8px;font-size:14px;background:#fff;box-sizing:border-box}" +
    "#adminPanel .adHead select{flex:0 0 200px}#adminPanel .adHead input{flex:1 1 200px;min-width:0;max-width:340px}" +
    "#adminPanel button.ref{height:38px}#adminPanel .adHead h2{flex:1 1 auto}" +
    "#adminPanel a.sheet{display:inline-flex;align-items:center;height:38px;padding:0 14px;border:1px solid #1c5e3a;border-radius:6px;color:#1c5e3a;font-weight:700;font-size:14px;text-decoration:none;white-space:nowrap}" +
    "#adminPanel a.sheet:hover{background:#f3f8f5}#adminPanel .adPubBtns{display:flex;flex-wrap:wrap;gap:8px}" +
    "#adminPanel table{width:100%;border-collapse:collapse;font-size:14px;background:#fff;border-radius:10px;overflow:hidden}" +
    "#adminPanel th{background:#1c5e3a;color:#fff;text-align:left;padding:8px 10px;font-size:12px;text-transform:uppercase}" +
    "#adminPanel td{padding:8px 10px;border-bottom:1px solid #eef1f5;vertical-align:middle;white-space:nowrap}" +
    "#adminPanel table{min-width:760px}" +   /* phones: the table scrolls sideways instead of squeezing the columns */
    "#adminPanel .st.RESET{color:#6a3fb5}#adminPanel .rl{font-size:12px;color:#556}#adminPanel .rl.adm{color:#8a6100;font-weight:700}" +
    "#adminPanel button.ab.role{background:#fff;color:#8a6100;border:1px solid #d9b24c}" +
    "#adminPanel .st{font-weight:700;font-size:12px}#adminPanel .st.PENDING{color:#b26a00}#adminPanel .st.APPROVED{color:#1c5e3a}#adminPanel .st.BLOCKED{color:#c62828}" +
    "#adminPanel button.ab{padding:6px 12px;border:0;border-radius:6px;font-weight:700;cursor:pointer;margin-right:6px;color:#fff}" +
    "#adminPanel button.ab.ok{background:#1c5e3a}#adminPanel button.ab.no{background:#d8261c}#adminPanel button.ref{background:#fff;border:1px solid #c9d1db;border-radius:8px;padding:8px 12px;cursor:pointer}" +
    "#adminPanel .adMsg{margin:8px 0;font-size:13px;color:#c62828}" +
    "#adminPanel .adQuick{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;padding:10px;background:#f3f8f5;border:1px solid #d3e6da;border-radius:10px}" +
    "#adminPanel .adQuick b{font-size:13px;color:#1c5e3a;margin-right:4px}#adminPanel .adQuick input{flex:1 1 180px;min-width:0}" +
    "#adminPanel .adPub{margin-bottom:14px;padding:12px;background:#fff;border:1px solid #d5dbe3;border-radius:10px}" +
    "#adminPanel .adPub{display:flex;flex-wrap:wrap;gap:10px;align-items:center}#adminPanel .adPubTxt{flex:1 1 260px;font-size:13px;color:#556}" +
    "#adminPanel .adPubTxt b{display:block;font-size:14px;color:#1c5e3a;margin-bottom:2px}#adminPanel .adPub button.ab{padding:9px 16px;margin:0}" +
    "#adminPanel .adPubMsg{flex-basis:100%;font-size:13px;color:#c62828}#adminPanel .adPubMsg:empty{display:none}" +
    "#adminPanel .adPubMsg.ok{color:#1c5e3a}#adminPanel .adPubMsg button,#adminPanel .adPubMsg a{margin:6px 10px 0 0;font-size:13px}" +
    "#adminPanel .adQuick button.ab{padding:8px 14px;margin:0}#adminPanel button.ab:disabled{opacity:.6;cursor:default}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var tab = document.querySelector('.tab[data-tab=admin]'), panel = document.getElementById("adminPanel");
  var users = [], filter = "WAITING", q = "", pub = { busy: false, ok: false, text: "" }, sheetUrl = "";

  var FILTERS = { WAITING: "Waiting (new + resets)", PENDING: "New (pending)", RESET: "Reset requests", APPROVED: "Approved",
                  ADMIN: "Admins", BLOCKED: "Blocked", ALL: "All users" };
  var FILTER_OK = {
    WAITING: function (u) { return u.status === "PENDING" || !!u.resetAt; },
    PENDING: function (u) { return u.status === "PENDING"; },
    RESET: function (u) { return !!u.resetAt; },
    APPROVED: function (u) { return u.status === "APPROVED"; },
    ADMIN: function (u) { return !!u.admin; },
    BLOCKED: function (u) { return u.status === "BLOCKED"; },
    ALL: function () { return true; }
  };

  function el(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) { if (k === "text") e.textContent = props[k]; else if (k === "on") e.addEventListener(props[k][0], props[k][1]); else e[k] = props[k]; });
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function fmt(d) { return d ? String(d).slice(0, 10) : ""; }

  function render(msg) {
    panel.textContent = "";
    /* "Update app" = Sheet menu "Publish Standalone app" */
    var pubKids = [
      el("div", { className: "adPubTxt" }, [el("b", { text: "App update" }),
        el("span", { text: "Takes the current rates from the Google Sheet and the latest app code, then updates both staff links." })]),
      el("div", { className: "adPubBtns" }, [
        /* link from the server, admins only */
        sheetUrl ? el("a", { className: "sheet", href: sheetUrl, target: "_blank", rel: "noopener", text: "📊 Open Google Sheet" }) : el("span"),
        el("button", { className: "ab ok", type: "button", id: "adPubGo", disabled: pub.busy, text: pub.busy ? "Updating…" : "🔄 Update app", on: ["click", publish] })])];
    var pubMsg = el("div", { className: "adPubMsg" + (pub.ok ? " ok" : ""), id: "adPubMsg", text: pub.text || "" });
    if (pub.ok) {
      pubMsg.appendChild(el("button", { className: "ref", type: "button", text: "Reload this page", on: ["click", function () { location.reload(); }] }));
    }
    panel.appendChild(el("div", { className: "adPub" }, pubKids.concat([pubMsg])));
    var sel = el("select", { on: ["change", function () { filter = this.value; render(); }] },
      ["WAITING", "PENDING", "RESET", "APPROVED", "ADMIN", "BLOCKED", "ALL"].map(function (v) { var o = el("option", { value: v, text: FILTERS[v] }); if (v === filter) o.selected = true; return o; }));
    var search = el("input", { type: "search", placeholder: "Search name / number", value: q, on: ["input", function () { q = this.value; renderRows(); }] });
    var pending = users.filter(function (u) { return u.status === "PENDING"; }).length,
        resets = users.filter(function (u) { return u.resetAt; }).length;
    /* approve by typing the WhatsApp number (= the username) */
    var num = el("input", { type: "tel", id: "adNum", placeholder: "WhatsApp number, e.g. 0771234567", autocomplete: "off", maxLength: 20,
                            on: ["keydown", function (e) { if (e.key === "Enter") quickApprove(go); }] });
    var go = el("button", { className: "ab ok", type: "button", text: "Approve", on: ["click", function () { quickApprove(this); }] });
    panel.appendChild(el("div", { className: "adQuick" }, [el("b", { text: "Approve by number:" }), num, go]));
    panel.appendChild(el("div", { className: "adMsg", id: "adMsg", text: msg || "" }));
    panel.appendChild(el("div", { className: "adHead" }, [
      el("h2", { text: "Users" + (pending ? " · " + pending + " waiting" : "") + (resets ? " · " + resets + " password reset" + (resets > 1 ? "s" : "") : "") }), sel, search,
      el("button", { className: "ref", text: "Refresh", on: ["click", load] })]));
    var tbl = el("table", {}, [el("thead", {}, [el("tr", {}, ["Name", "WhatsApp", "Status", "Role", "Requested", ""].map(function (h) { return el("th", { text: h }); }))]), el("tbody", { id: "adRows" })]);
    panel.appendChild(el("div", { style: "overflow-x:auto" }, [tbl]));
    renderRows();
  }
  function renderRows() {
    var body = document.getElementById("adRows"); if (!body) return; body.textContent = "";
    var needle = q.trim().toLowerCase(), n = 0;
    users.forEach(function (u) {
      if (!FILTER_OK[filter](u)) return;
      if (needle && (u.name + " " + u.phone).toLowerCase().indexOf(needle) < 0) return;
      n++;
      var acts = el("td");
      if (u.status !== "APPROVED") acts.appendChild(el("button", { className: "ab ok", text: u.status === "BLOCKED" ? "Unblock" : "Approve", on: ["click", function () { setStatus(u, "APPROVED", this); }] }));
      if (u.status !== "BLOCKED" && !u.admin) acts.appendChild(el("button", { className: "ab no", text: "Block", on: ["click", function () { setStatus(u, "BLOCKED", this); }] }));
      if (u.resetAt) {
        acts.appendChild(el("button", { className: "ab ok", text: "Approve reset", on: ["click", function () { decideReset(u, true, this); }] }));
        acts.appendChild(el("button", { className: "ab no", text: "Reject reset", on: ["click", function () { decideReset(u, false, this); }] }));
      }
      if (u.status === "APPROVED") acts.appendChild(el("button", { className: "ab role", text: u.admin ? "Remove admin" : "Make admin", on: ["click", function () { setRole(u, !u.admin, this); }] }));
      var stCell = el("td", {}, [el("span", { className: "st " + u.status, text: u.status })]);
      if (u.resetAt) stCell.appendChild(el("span", { className: "st RESET", text: " · 🔑 reset " + fmt(u.resetAt) }));
      body.appendChild(el("tr", {}, [el("td", { text: u.name }), el("td", { text: u.phone }), stCell,
        el("td", {}, [el("span", { className: u.admin ? "rl adm" : "rl", text: u.admin ? "👑 Admin" : "User" })]), el("td", { text: fmt(u.requested) }), acts]));
    });
    if (!n) body.appendChild(el("tr", {}, [el("td", { colSpan: 6, text: "No users to show.", style: "color:#778" })]));
  }
  function setStatus(u, status, btn) {
    btn.disabled = true;
    api("adminSetStatus", [u.key, status]).then(function () { u.status = status; render(u.name + " → " + status); })
      .catch(function (e) { btn.disabled = false; var m = document.getElementById("adMsg"); if (m) m.textContent = e.message || "Failed."; });
  }
  function say(t) { var m = document.getElementById("adMsg"); if (m) m.textContent = t; }
  /* "Forgot password" request: the user's new password starts working only when approved here. */
  function decideReset(u, approve, btn) {
    if (approve && !window.confirm("Approve the password reset for " + u.name + " (" + u.phone + ")?\n\n" +
        "The number is not verified: phone the user first and make sure they asked for it.\n" +
        "Their new password starts working now and their old password stops working.")) return;
    if (!approve && !window.confirm("Reject the password reset for " + u.name + " (" + u.phone + ")?\nTheir old password keeps working.")) return;
    btn.disabled = true;
    api("adminReset", [u.key, approve]).then(function () { u.resetAt = ""; render(u.name + ": password reset " + (approve ? "approved ✅" : "rejected")); })
      .catch(function (e) { btn.disabled = false; say(e.message || "Failed."); });
  }
  /* Admin role = the Admin tab (USERS "Role" column). The server refuses to remove your own role. */
  function setRole(u, admin, btn) {
    if (!window.confirm(admin ? "Make " + u.name + " (" + u.phone + ") an Admin?\n\nThey will see this Admin tab: approve / block users, reset passwords, update the app and open the Google Sheet."
                              : "Remove the Admin role from " + u.name + " (" + u.phone + ")?")) return;
    btn.disabled = true;
    api("adminSetRole", [u.key, admin]).then(function () { u.admin = admin; render(u.name + (admin ? " is now an Admin 👑" : " is no longer an Admin")); })
      .catch(function (e) { btn.disabled = false; say(e.message || "Failed."); });
  }
  /* Same rules as normPhone_ / phoneKey_ in BackEND (Register.gs, Access.gs): 077... -> 9477..., "" when not valid. */
  function normPhone(raw) {
    var d = String(raw || "").replace(/^\s*wa:/i, "").replace(/[^\d]/g, "");
    if (!d) return "";
    if (d.indexOf("00") === 0) d = d.slice(2);
    if (!(d.indexOf("94") === 0 && d.length >= 10)) {
      if (d.charAt(0) === "0") d = "94" + d.slice(1);
      else if (d.length <= 10) d = "94" + d;
    }
    return (d.length >= 10 && d.length <= 15) ? d : "";
  }
  function quickApprove(btn) {
    var inp = document.getElementById("adNum"), m = document.getElementById("adMsg");
    function say(t) { if (m) m.textContent = t; }
    var d = normPhone(inp && inp.value);
    if (!d) { say("Enter a valid WhatsApp number."); return; }
    btn.disabled = true; say("Checking +" + d + " …");
    /* fresh list: the user may have registered after this tab was opened */
    api("adminUsers").then(function (r) {
      users = r || [];
      var u = null;
      for (var i = 0; i < users.length; i++) if (users[i].key === "wa:" + d) { u = users[i]; break; }
      if (!u) { render("+" + d + " has not registered yet. Ask them to Register first, then try again."); return; }
      if (u.status === "APPROVED") { render(u.name + " (+" + d + ") is already approved."); return; }
      setStatus(u, "APPROVED", btn);
    }).catch(function (e) { btn.disabled = false; say(e.message || "Could not load users."); });
  }
  function publish() {
    if (pub.busy) return;
    if (!window.confirm("Update the app now?\n\nThis takes the CURRENT rates from the Google Sheet and the latest app code, " +
                        "and updates both staff links. It takes about 20-40 seconds.")) return;
    pub = { busy: true, ok: false, text: "Updating… keep this tab open (about 20-40 seconds)." };
    render();
    var started = Date.now();
    api("adminPublish").then(function (r) {
      r = r || {};
      pub = { busy: false, ok: true,
              text: "Done ✅ " + r.sheets + " sheets, " + r.formulas + " formulas in " + r.seconds + " s. Rates updated: " + String(r.when || "").slice(0, 10) + ". " +
                    "Staff get the new version the next time they open the link. " };
      render();
    }).catch(function (e) {
      /* "already running": the same request often reaches Google twice; the first one is doing the update.
         Watch the time of the last update for up to 90 s instead of reporting a failure. */
      if (/already running/i.test(e.message || "")) { waitPublished(started); return; }
      pub = { busy: false, ok: false, text: "Update failed: " + (e.message || "unknown error") };
      render();
    });
  }
  function waitPublished(started, tries) {
    tries = tries || 0;
    pub = { busy: true, ok: false, text: "An update is running… keep this tab open." };
    render();
    setTimeout(function () {
      api("appVersion").then(function (r) {
        var p = r && r.published ? Date.parse(r.published) : 0;
        if (p && p >= started - 5000) {
          pub = { busy: false, ok: true, text: "Done ✅ Rates updated: " + String(r.published).slice(0, 10) + ". Staff see \"MasterCAL updated\" in their app. " };
          render();
        } else if (tries < 9) waitPublished(started, tries + 1);
        else { pub = { busy: false, ok: false, text: "The update is taking longer than usual. Wait a minute, then reload this page to check \"Rates updated\" (bottom left)." }; render(); }
      }).catch(function () { if (tries < 9) waitPublished(started, tries + 1); });
    }, 10000);
  }
  function load() {
    api("adminUsers").then(function (r) { users = r || []; render(); }).catch(function (e) { render(e.message || "Could not load users."); });
  }

  function probe() {
    if (!getToken()) return;
    api("adminWho").then(function (r) {
      var admin = !!(r && r.admin);
      sheetUrl = admin && r.sheetUrl && /^https:\/\/docs\.google\.com\//.test(r.sheetUrl) ? r.sheetUrl : "";
      if (tab) tab.hidden = !admin;
      if (admin) load();
    }).catch(function () { if (tab) tab.hidden = true; });
  }
  function pill() {
    if (document.getElementById("mcOut")) return;
    var b = el("div", { id: "mcOut", text: "Logout", on: ["click", function () {
      setToken("");   /* the rates saved for offline use are deleted too */
      Promise.resolve(window.__mcForget ? window.__mcForget() : null).then(function () { location.reload(); });
    }] });
    document.body.appendChild(b);
  }
  window.__mcAfterLogin = function () { pill(); probe(); };
  if (getToken()) { pill(); setTimeout(probe, 600); }
})();
