import type { TerminalComposerSessionState } from '#/web/components/terminal/types.ts'

export function createInitialTerminalComposerState(): TerminalComposerSessionState {
  return {
    expanded: false,
    mode: 'input',
    historyEntries: [],
  }
}
