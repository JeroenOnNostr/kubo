// Reads the saved theme from localStorage and applies the theme class to
// <html> before first paint, so the app renders in the right theme with no
// flash of the wrong one. Runs as a blocking <script>.
//
// Note: this intentionally does NOT recolor the #preloader or <body>. Kubo
// is the kid app, so the pre-React splash is the blue KuboLoadingScreen look
// (#1E3A8A + white spinner, set statically in index.html) regardless of the
// app theme — that way launch is one continuous blue screen through to the
// feed, instead of a white-theme preloader followed by the blue kid screen.
(function () {
  var theme = 'dark';
  try {
    var cfg = JSON.parse(localStorage.getItem('nostr:app-config') || '{}');
    if (cfg.theme) theme = cfg.theme;
  } catch (e) {}

  // Resolve "system" to light or dark based on OS preference
  if (theme === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  document.documentElement.className = theme;
})();
