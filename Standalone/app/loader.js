/* Inline loader (kept free of backslashes and angle brackets on purpose).
 * The code parts are stored as base64 text and run from here, so Google's page serving cannot alter them. */
(function () {
  var BUILD = "online-4", list = [], NL = String.fromCharCode(10);
  function show(msg) {
    try {
      if (list.length < 6) list.push(msg);
      var b = document.getElementById("mcErr");
      if (!b) {
        b = document.createElement("div"); b.id = "mcErr";
        b.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:100000;background:#fff3cd;color:#7a1c1c;font:12px/1.4 Arial;padding:6px 10px;border-bottom:1px solid #d9b;max-height:40vh;overflow:auto;white-space:pre-wrap";
        (document.body || document.documentElement).appendChild(b);
      }
      b.textContent = "Page errors (" + BUILD + "):" + NL + list.map(function (m, i) { return (i + 1) + ") " + m; }).join(NL);
    } catch (e) {}
  }
  window.addEventListener("error", function (e) {
    var src = String(e.filename || "").split("/").pop().slice(0, 40);
    show((e.message || "error") + " [line " + (e.lineno || "?") + ":" + (e.colno || "?") + (src ? " " + src : "") + "]");
  });
  window.addEventListener("unhandledrejection", function (e) { show(String(e.reason && e.reason.message || e.reason)); });
  function decode(b64) {
    var bin = atob(b64.replace(/[^A-Za-z0-9+/=]/g, "")), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(u);
  }
  var parts = document.querySelectorAll("script.mcCode");
  for (var k = 0; k < parts.length; k++) {
    try {
      var s = document.createElement("script");
      s.text = decode(parts[k].textContent);
      document.head.appendChild(s);
    } catch (e) { show("part " + (k + 1) + ": " + (e && e.message || e)); }
  }
  if (typeof getToken === "undefined") show("app code did not load (getToken missing)");
})();
