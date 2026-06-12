// Boot script — applies theme attributes before the React app module runs.
// The renderer entry URL carries them via `?theme=` and `?colorTheme=`.
//
// This file lives under `public/` so vite copies it as-is into the
// dist root rather than bundling it into main.js. Keep the color theme
// allowlist below in sync with `COLOR_THEMES` in `src/shared/color-theme.ts`.
;(function () {
  var qs = new URLSearchParams(window.location.search)
  var theme = qs.get('theme')
  if (theme !== 'light' && theme !== 'dark') theme = 'light'
  var colorTheme = qs.get('colorTheme')
  var colorThemes = ['macos', 'mono', 'github']
  if (colorThemes.indexOf(colorTheme) === -1) colorTheme = 'macos'
  document.documentElement.setAttribute('data-host', window.goblinNative ? 'electron' : 'web')
  if (window.goblinNative && !/Mac/i.test(navigator.platform))
    document.documentElement.setAttribute('data-chrome', 'overlay')
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.setAttribute('data-color-theme', colorTheme)
})()
