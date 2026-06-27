// Client-side convenience re-exports. The canonical encoding lives
// in `src/shared/terminal-slot-key.ts` so server and client can
// share the same key format.

export {
  formatTerminalSlotKey as terminalSlotKey,
  formatWorktreeKey as worktreeTerminalKey,
  parseTerminalSlotKey,
  parseWorktreeKey,
} from '#/shared/terminal-slot-key.ts'
