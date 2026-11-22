/* Online mode only (page opened from the staff link): Logout pill + the Admin tab (approve / block users).
 * The Admin tab is shown only when the server says this login is an administrator. Every action is checked on the server again. */
(function () {
  "use strict";
  if (!window.__mcRemote) return;

  var css = "#mcOut{position:fixed;right:10px;bottom:8px;z-index:9999;font-size:12px;color:#556;background:#fff;border:1px solid #d5dbe3;border-radius:16px;padding:4px 10px;cursor:pointer}" +
    "#mcVer{position:fixed;left:10px;bottom:8px;z-index:9999;font-size:11px;color:#778}" +
    "#adminPanel .adHead{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}" +
    "#adminPanel .adHead h2{margin:0 auto 0 0;font-size:16px;letter-spacing:.04em;text-transform:uppercase}" +
    "#adminPanel select,#adminPanel input{padding:8px;border:1px solid #c9d1db;border-radius:8px;font-size:14px}" +
    "#adminPanel table{width:100%;border-collapse:collapse;font-size:14px;background:#fff;border-radius:10px;overflow:hidden}" +
    "#adminPanel th{background:#1c5e3a;color:#fff;text-align:left;padding:8px 10px;font-size:12px;text-transform:uppercase}" +
    "#adminPanel td{padding:8px 10px;border-bottom:1px solid #eef1f5;vertical-align:middle}" +
    "#adminPanel .st{font-weight:700;font-size:12px}#adminPanel .st.PENDING{color:#b26a00}#adminPanel .st.APPROVED{color:#1c5e3a}#adminPanel .st.BLOCKED{color:#c62828}" +
    "#adminPanel button.ab{padding:6px 12px;border:0;border-radius:6px;font-weight:700;cursor:pointer;margin-right:6px;color:#fff}" +
    "#adminPanel button.ab.ok{background:#1c5e3a}#adminPanel button.ab.no{background:#d8261c}#adminPanel button.ref{background:#fff;border:1px solid #c9d1db;border-radius:8px;padding:8px 12px;cursor:pointer}" +
    "#adminPanel .adMsg{margin:8px 0;font-size:13px;color:#c62828}" +
    "#adminPanel .adQuick{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;padding:10px;background:#f3f8f5;border:1px solid #d3e6da;border-radius:10px}" +
    "#adminPanel .adQuick b{font-size:13px;color:#1c5e3a;margin-right:4px}#adminPanel .adQuick input{flex:1 1 180px;min-width:0}" +
    "#adminPanel .adQuick button.ab{padding:8px 14px;margin:0}#adminPanel button.ab:disabled{opacity:.6;cursor:default}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var tab = document.querySelector('.tab[data-tab=admin]'), panel = document.getElementById("adminPanel");
  var users = [], filter = "PENDING", q = "";

  function el(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) { if (k === "text") e.textContent = props[k]; else if (k === "on") e.addEventListener(props[k][0], props[k][1]); else e[k] = props[k]; });
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function fmt(d) { return d ? String(d).slice(0, 10) : ""; }

  function render(msg) {
    panel.textContent = "";
    var sel = el("select", { on: ["change", function () { filter = this.value; render(); }] },
      ["PENDING", "APPROVED", "BLOCKED", "ALL"].map(function (v) { var o = el("option", { value: v, text: v === "ALL" ? "All users" : v.charAt(0) + v.slice(1).toLowerCase() }); if (v === filter) o.selected = true; return o; }));
    var search = el("input", { type: "search", placeholder: "Search name / number", value: q, on: ["input", function () { q = this.value; renderRows(); }] });
    var pending = users.filter(function (u) { return u.status === "PENDING"; }).length;
    panel.appendChild(el("div", { className: "adHead" }, [
      el("h2", { text: "Users" + (pending ? " · " + pending + " waiting" : "") }), sel, search,
      el("button", { className: "ref", text: "Refresh", on: ["click", load] })]));
    /* approve by typing the WhatsApp number (= the username) */
    var num = el("input", { type: "tel", id: "adNum", placeholder: "WhatsApp number, e.g. 0771234567", autocomplete: "off", maxLength: 20,
                            on: ["keydown", function (e) { if (e.key === "Enter") quickApprove(go); }] });
    var go = el("button", { className: "ab ok", type: "button", text: "Approve", on: ["click", function () { quickApprove(this); }] });
    panel.appendChild(el("div", { className: "adQuick" }, [el("b", { text: "Approve by number:" }), num, go]));
    panel.appendChild(el("div", { className: "adMsg", id: "adMsg", text: msg || "" }));
    var tbl = el("table", {}, [el("thead", {}, [el("tr", {}, ["Name", "WhatsApp", "Status", "Requested", ""].map(function (h) { return el("th", { text: h }); }))]), el("tbody", { id: "adRows" })]);
    panel.appendChild(el("div", { style: "overflow-x:auto" }, [tbl]));
    renderRows();
  }
  function renderRows() {
    var body = document.getElementById("adRows"); if (!body) return; body.textContent = "";
    var needle = q.trim().toLowerCase(), n = 0;
    users.forEach(function (u) {
      if (filter !== "ALL" && u.status !== filter) return;
      if (needle && (u.name + " " + u.phone).toLowerCase().indexOf(needle) < 0) return;
      n++;
      var acts = el("td");
      if (u.status !== "APPROVED") acts.appendChild(el("button", { className: "ab ok", text: u.status === "BLOCKED" ? "Unblock" : "Approve", on: ["click", function () { setStatus(u, "APPROVED", this); }] }));
      if (u.status !== "BLOCKED" && !u.admin) acts.appendChild(el("button", { className: "ab no", text: "Block", on: ["click", function () { setStatus(u, "BLOCKED", this); }] }));
      body.appendChild(el("tr", {}, [el("td", { text: u.name + (u.admin ? "  (admin)" : "") }), el("td", { text: u.phone }),
        el("td", {}, [el("span", { className: "st " + u.status, text: u.status })]), el("td", { text: fmt(u.requested) }), acts]));
    });
    if (!n) body.appendChild(el("tr", {}, [el("td", { colSpan: 5, text: "No users to show.", style: "color:#778" })]));
  }
  function setStatus(u, status, btn) {
    btn.disabled = true;
    api("adminSetStatus", [u.key, status]).then(function () { u.status = status; render(u.name + " → " + status); })
      .catch(function (e) { btn.disabled = false; var m = document.getElementById("adMsg"); if (m) m.textContent = e.message || "Failed."; });
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
  function load() {
    api("adminUsers").then(function (r) { users = r || []; render(); }).catch(function (e) { render(e.message || "Could not load users."); });
  }

  function probe() {
    if (!getToken()) return;
    api("adminWho").then(function (r) {
      var admin = !!(r && r.admin);
      if (tab) tab.hidden = !admin;
      if (admin) load();
    }).catch(function () { if (tab) tab.hidden = true; });
  }
  function pill() {
    if (document.getElementById("mcOut")) return;
    var b = el("div", { id: "mcOut", text: "Logout", on: ["click", function () { setToken(""); location.reload(); }] });
    document.body.appendChild(b);
  }
  window.__mcAfterLogin = function () { pill(); probe(); };
  if (getToken()) { pill(); setTimeout(probe, 600); }
})();
