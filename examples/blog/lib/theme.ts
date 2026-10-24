export const themeStorageKey = "theme";

/** Applies the saved (or system) theme before the page paints, so there's no flash. */
export const themeInitScript = `(() => {
  let preference;
  try { preference = localStorage.getItem("${themeStorageKey}"); } catch {}
  const dark = preference === "dark" ||
    (preference !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();`;
