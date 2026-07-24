import { readFileSync } from 'node:fs'
import path from 'node:path'

const macosThemeCss = readFileSync(path.resolve(import.meta.dirname, '../theme/themes/macos.css'), 'utf8')

// jsdom does not load the app stylesheet, so terminal tests inject the real
// macOS theme source to exercise the same token definitions as production.
export function installTerminalThemeStyles(): void {
  document.getElementById('terminal-theme-test-styles')?.remove()
  const style = document.createElement('style')
  style.id = 'terminal-theme-test-styles'
  style.textContent = macosThemeCss
  document.head.appendChild(style)
}
