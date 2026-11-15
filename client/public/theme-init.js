(function () {
  try {
    var theme = localStorage.getItem("altair-theme") || "system";
    var dark = theme === "dark" || (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#080c18" : "#e6fff5");
  } catch (error) {
    /* тема по умолчанию */
  }
})();
