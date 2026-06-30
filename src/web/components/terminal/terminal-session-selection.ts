import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'

export function resolveSelectedTerminalKey(input: {
  worktreeTerminalKey: string
  preferredTerminalKey: string | null
  currentTerminalKey: string | null
  controllerTerminalKey: string | null
  sortedDescriptors: TerminalDescriptor[]
  isSelectedTerminalKeyValid: (worktreeTerminalKey: string, terminalKey: string) => boolean
}): string | null {
  const {
    worktreeTerminalKey,
    preferredTerminalKey,
    currentTerminalKey,
    controllerTerminalKey,
    sortedDescriptors,
    isSelectedTerminalKeyValid,
  } = input
  if (preferredTerminalKey && isSelectedTerminalKeyValid(worktreeTerminalKey, preferredTerminalKey))
    return preferredTerminalKey
  if (currentTerminalKey && isSelectedTerminalKeyValid(worktreeTerminalKey, currentTerminalKey))
    return currentTerminalKey
  if (controllerTerminalKey && isSelectedTerminalKeyValid(worktreeTerminalKey, controllerTerminalKey))
    return controllerTerminalKey
  return sortedDescriptors[0]?.terminalKey ?? null
}
