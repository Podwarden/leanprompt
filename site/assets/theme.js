// Runs in <head>, before the page paints: the visitor's chosen theme, if any.
// Dark is the default, as on the rest of lmwarden.com; the toggle in the bar switches to light.
(function () {
  "use strict";
  var root = document.documentElement;
  root.classList.add("js");
  try {
    var t = localStorage.getItem("lp-theme");
    if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
  } catch (e) { /* storage blocked: stay dark */ }
})();
