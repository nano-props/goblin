import type { TerminalComposerSessionState } from '#/web/terminal/components/types.ts'

export function createInitialTerminalComposerState(): TerminalComposerSessionState {
  return {
    expanded: false,
    mode: 'input',
    draft: '',
    historyEntries: [],
  }
}
