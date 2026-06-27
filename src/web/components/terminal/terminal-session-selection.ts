import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'

export function resolveSelectedTerminalKey(input: {
  worktreeTerminalKey: string
  preferredKey: string | null
  currentKey: string | null
  controllerKey: string | null
  sortedDescriptors: TerminalDescriptor[]
  isSelectedKeyValid: (worktreeTerminalKey: string, key: string) => boolean
}): string | null {
  const { worktreeTerminalKey, preferredKey, currentKey, controllerKey, sortedDescriptors, isSelectedKeyValid } = input
  if (preferredKey && isSelectedKeyValid(worktreeTerminalKey, preferredKey)) return preferredKey
  if (currentKey && isSelectedKeyValid(worktreeTerminalKey, currentKey)) return currentKey
  if (controllerKey && isSelectedKeyValid(worktreeTerminalKey, controllerKey)) return controllerKey
  return sortedDescriptors[0]?.key ?? null
}
