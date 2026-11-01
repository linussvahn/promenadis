// Apply only the non-sensitive appearance preference before the first paint.
try {
  const theme = localStorage.getItem("promenadis-theme");
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  }
} catch {
  // CSS follows the device preference without storage or JavaScript.
}
