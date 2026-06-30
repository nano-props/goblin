import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'

export function resolveSelectedTerminalSessionId(input: {
  terminalWorktreeKey: string
  preferredSessionId: string | null
  currentSessionId: string | null
  controllerSessionId: string | null
  sortedDescriptors: TerminalDescriptor[]
  isSelectedTerminalSessionIdValid: (terminalWorktreeKey: string, terminalSessionId: string) => boolean
}): string | null {
  const {
    terminalWorktreeKey,
    preferredSessionId,
    currentSessionId,
    controllerSessionId,
    sortedDescriptors,
    isSelectedTerminalSessionIdValid,
  } = input
  if (preferredSessionId && isSelectedTerminalSessionIdValid(terminalWorktreeKey, preferredSessionId))
    return preferredSessionId
  if (currentSessionId && isSelectedTerminalSessionIdValid(terminalWorktreeKey, currentSessionId))
    return currentSessionId
  if (controllerSessionId && isSelectedTerminalSessionIdValid(terminalWorktreeKey, controllerSessionId))
    return controllerSessionId
  return sortedDescriptors[0]?.terminalSessionId ?? null
}
