import type { EditorAppState, TerminalAppState } from '#/shared/api-types.ts'
import { getEditorAppAvailability } from '#/system/editors.ts'
import { getTerminalAppAvailability } from '#/system/terminals.ts'

export interface ExternalAppsProbe {
  terminals: TerminalAppState
  editors: EditorAppState
}

let lastDetectedAt = 0

function nextDetectedAt(now = Date.now()): number {
  const detectedAt = Math.max(now, lastDetectedAt + 1)
  lastDetectedAt = detectedAt
  return detectedAt
}

function isAnyAvailable(availability: Record<string, boolean>): boolean {
  return Object.values(availability).some(Boolean)
}

export async function probeTerminalApps(
  signal?: AbortSignal,
  detectedAt = nextDetectedAt(),
): Promise<TerminalAppState> {
  const appAvailability = await getTerminalAppAvailability(signal)
  return {
    available: isAnyAvailable(appAvailability),
    appAvailability,
    detectedAt,
  }
}

export function probeEditorApps(detectedAt = nextDetectedAt()): EditorAppState {
  const appAvailability = getEditorAppAvailability()
  return {
    available: isAnyAvailable(appAvailability),
    appAvailability,
    detectedAt,
  }
}

export async function probeExternalApps(signal?: AbortSignal): Promise<ExternalAppsProbe> {
  const detectedAt = nextDetectedAt()
  const terminals = await probeTerminalApps(signal, detectedAt)
  const editors = probeEditorApps(detectedAt)
  return {
    terminals,
    editors,
  }
}
