// Client-side convenience re-exports. The canonical encoding lives
// in `src/shared/terminal-workspace-slot-key.ts` so server and client can
// share the same key format.

export {
  formatTerminalWorkspaceSlotKey,
  formatWorktreeKey as worktreeTerminalKey,
  parseTerminalWorkspaceSlotKey,
  parseWorktreeKey,
} from '#/shared/terminal-workspace-slot-key.ts'
