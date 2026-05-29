import type {
  TerminalExitEvent,
  TerminalMutationResult,
  TerminalNotifyBellInput,
  TerminalOpenInput,
  TerminalOpenResult,
  TerminalOutputEvent,
  TerminalPruneRepoInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionInput,
  TerminalWriteInput,
} from '#/shared/terminal.ts'

function getTerminalBridge(): Window['goblin']['terminal'] {
  const bridge = window.goblin?.terminal
  if (!bridge) throw new Error('Goblin terminal bridge is unavailable')
  return bridge
}

export const terminalBridge = {
  open(input: TerminalOpenInput): Promise<TerminalOpenResult> {
    return getTerminalBridge().open(input)
  },
  restart(input: TerminalRestartInput): Promise<TerminalOpenResult> {
    return getTerminalBridge().restart(input)
  },
  write(input: TerminalWriteInput): Promise<TerminalMutationResult> {
    return getTerminalBridge().write(input)
  },
  resize(input: TerminalResizeInput): Promise<TerminalMutationResult> {
    return getTerminalBridge().resize(input)
  },
  close(input: TerminalSessionInput): Promise<TerminalMutationResult> {
    return getTerminalBridge().close(input)
  },
  pruneRepo(input: TerminalPruneRepoInput): Promise<TerminalMutationResult> {
    return getTerminalBridge().pruneRepo(input)
  },
  notifyBell(input: TerminalNotifyBellInput): Promise<TerminalMutationResult> {
    return getTerminalBridge().notifyBell(input)
  },
  onOutput(cb: (event: TerminalOutputEvent) => void): () => void {
    return getTerminalBridge().onOutput(cb)
  },
  onExit(cb: (event: TerminalExitEvent) => void): () => void {
    return getTerminalBridge().onExit(cb)
  },
}
