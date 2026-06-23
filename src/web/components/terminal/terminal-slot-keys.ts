// Renderer-side convenience re-exports. The canonical encoding lives
// in `src/shared/terminal-session-key.ts` so server and renderer can
// share the same key format.

export {
  formatTerminalSlotKey as terminalSessionKey,
  formatWorktreeKey as worktreeTerminalKey,
  parseTerminalSlotKey,
  parseWorktreeKey,
} from '#/shared/terminal-slot-key.ts'
