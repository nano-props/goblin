// Renderer-side convenience re-exports. The canonical encoding lives
// in `src/shared/terminal-session-key.ts` so server and renderer can
// share the same key format.

export {
  formatTerminalSessionKey as terminalSessionKey,
  formatWorktreeTerminalKey as worktreeTerminalKey,
  parseTerminalSessionKey,
  parseWorktreeTerminalKey,
} from '#/shared/terminal-session-key.ts'
