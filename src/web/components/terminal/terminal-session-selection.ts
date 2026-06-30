import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'

export function resolveSelectedTerminalKey(input: {
  terminalWorktreeKey: string
  preferredTerminalKey: string | null
  currentTerminalKey: string | null
  controllerTerminalKey: string | null
  sortedDescriptors: TerminalDescriptor[]
  isSelectedTerminalKeyValid: (terminalWorktreeKey: string, terminalKey: string) => boolean
}): string | null {
  const {
    terminalWorktreeKey,
    preferredTerminalKey,
    currentTerminalKey,
    controllerTerminalKey,
    sortedDescriptors,
    isSelectedTerminalKeyValid,
  } = input
  if (preferredTerminalKey && isSelectedTerminalKeyValid(terminalWorktreeKey, preferredTerminalKey))
    return preferredTerminalKey
  if (currentTerminalKey && isSelectedTerminalKeyValid(terminalWorktreeKey, currentTerminalKey))
    return currentTerminalKey
  if (controllerTerminalKey && isSelectedTerminalKeyValid(terminalWorktreeKey, controllerTerminalKey))
    return controllerTerminalKey
  return sortedDescriptors[0]?.terminalKey ?? null
}
