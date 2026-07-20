import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'

export function resolveSelectedTerminalSessionId(input: {
  terminalFilesystemTargetKey: string
  preferredSessionId: string | null
  currentSessionId: string | null
  controllerSessionId: string | null
  sortedDescriptors: TerminalDescriptor[]
  isSelectedTerminalSessionIdValid: (terminalFilesystemTargetKey: string, terminalSessionId: string) => boolean
}): string | null {
  const {
    terminalFilesystemTargetKey,
    preferredSessionId,
    currentSessionId,
    controllerSessionId,
    sortedDescriptors,
    isSelectedTerminalSessionIdValid,
  } = input
  if (preferredSessionId && isSelectedTerminalSessionIdValid(terminalFilesystemTargetKey, preferredSessionId))
    return preferredSessionId
  if (currentSessionId && isSelectedTerminalSessionIdValid(terminalFilesystemTargetKey, currentSessionId))
    return currentSessionId
  if (controllerSessionId && isSelectedTerminalSessionIdValid(terminalFilesystemTargetKey, controllerSessionId))
    return controllerSessionId
  return sortedDescriptors[0]?.terminalSessionId ?? null
}
