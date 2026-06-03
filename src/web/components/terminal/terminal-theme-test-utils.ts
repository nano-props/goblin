export function installTerminalThemeStyles() {
  document.getElementById('terminal-theme-test-styles')?.remove()
  const style = document.createElement('style')
  style.id = 'terminal-theme-test-styles'
  style.textContent = `
    :root,
    html[data-theme='light'] {
      --color-terminal-background: #fbfbfd;
      --color-terminal-foreground: #1d1d1f;
      --color-terminal-cursor: #1d1d1f;
      --color-terminal-selection-background: rgba(0, 122, 255, 0.22);
      --color-terminal-ansi-black: #000000;
      --color-terminal-ansi-red: #d70015;
      --color-terminal-ansi-green: #1f7f37;
      --color-terminal-ansi-yellow: #a45a00;
      --color-terminal-ansi-blue: #0066cc;
      --color-terminal-ansi-magenta: #af52de;
      --color-terminal-ansi-cyan: #007c89;
      --color-terminal-ansi-white: #6e6e73;
      --color-terminal-ansi-bright-black: #6e6e73;
      --color-terminal-ansi-bright-red: #ff3b30;
      --color-terminal-ansi-bright-green: #34c759;
      --color-terminal-ansi-bright-yellow: #ff9500;
      --color-terminal-ansi-bright-blue: #007aff;
      --color-terminal-ansi-bright-magenta: #bf5af2;
      --color-terminal-ansi-bright-cyan: #32ade6;
      --color-terminal-ansi-bright-white: #1d1d1f;
      --color-terminal-search-match: #bf8700;
      --color-terminal-search-active-match: #fb8f44;
      --color-terminal-search-active-border: #1d1d1f;
    }

    html[data-theme='dark'] {
      --color-terminal-background: #111113;
      --color-terminal-foreground: #f5f5f7;
      --color-terminal-cursor: #f5f5f7;
      --color-terminal-selection-background: rgba(10, 132, 255, 0.32);
      --color-terminal-ansi-black: #1c1c1e;
      --color-terminal-ansi-red: #ff453a;
      --color-terminal-ansi-green: #30d158;
      --color-terminal-ansi-yellow: #ffd60a;
      --color-terminal-ansi-blue: #0a84ff;
      --color-terminal-ansi-magenta: #bf5af2;
      --color-terminal-ansi-cyan: #64d2ff;
      --color-terminal-ansi-white: #d1d1d6;
      --color-terminal-ansi-bright-black: #8e8e93;
      --color-terminal-ansi-bright-red: #ff6961;
      --color-terminal-ansi-bright-green: #32d74b;
      --color-terminal-ansi-bright-yellow: #ffdf5d;
      --color-terminal-ansi-bright-blue: #409cff;
      --color-terminal-ansi-bright-magenta: #da8fff;
      --color-terminal-ansi-bright-cyan: #70d7ff;
      --color-terminal-ansi-bright-white: #ffffff;
      --color-terminal-search-match: #facc15;
      --color-terminal-search-active-match: #fb923c;
      --color-terminal-search-active-border: #ffffff;
    }
  `
  document.head.appendChild(style)
}
