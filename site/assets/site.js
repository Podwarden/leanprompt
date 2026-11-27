// The site's only behaviour: the menu (lmwarden.com's), the theme toggle and copy buttons.
// Everything works without it: the menu is a <details>, the toggle and copy buttons stay hidden.
(function () {
  "use strict";
  var root = document.documentElement;

  // Menu: a <details>. From 1280px its links sit in the bar, so it is kept open there; below, it is
  // the Menu button and its full-screen sheet, which a chosen link or Escape closes.
  var menu = document.querySelector(".menu");
  if (menu) {
    var wide = window.matchMedia("(min-width: 1280px)");
    var fit = function () { menu.open = wide.matches; };
    fit();
    if (wide.addEventListener) wide.addEventListener("change", fit);
    menu.querySelector(".panel").addEventListener("click", function (ev) {
      if (!wide.matches && ev.target.closest && ev.target.closest("a")) menu.open = false;
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && menu.open && !wide.matches) {
        menu.open = false; menu.querySelector("summary").focus();
      }
    });
  }

  // Theme toggle: dark (default) or light, remembered in this browser only.
  var toggle = document.querySelector("button.theme");
  if (toggle) {
    var label = function () {
      var light = root.getAttribute("data-theme") === "light";
      toggle.setAttribute("aria-label", light ? toggle.dataset.labelDark : toggle.dataset.labelLight);
      toggle.setAttribute("aria-pressed", light ? "true" : "false");
    };
    label();
    toggle.hidden = false;
    toggle.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("lp-theme", next); } catch (e) { /* not remembered */ }
      label();
    });
  }

  // Copy buttons: the text of the element named by data-copy.
  document.querySelectorAll("button[data-copy]").forEach(function (btn) {
    var span = btn.querySelector("span"), idle = span.textContent;
    btn.hidden = false;
    btn.addEventListener("click", function () {
      var src = document.getElementById(btn.getAttribute("data-copy"));
      var done = function () {
        btn.setAttribute("data-state", "done"); span.textContent = "Copied";
        setTimeout(function () { btn.removeAttribute("data-state"); span.textContent = idle; }, 1800);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(src.textContent).then(done, function () { span.textContent = "Press Ctrl+C"; });
      } else {
        span.textContent = "Press Ctrl+C";
      }
    });
  });
})();
