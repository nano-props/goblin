import type { EditorAppState, EditorPref, TerminalAppState, TerminalPref } from '#/shared/rpc.ts'
import { getEditorAppAvailability, resolveEditorApp } from '#/system/editors.ts'
import { getTerminalAppAvailability, resolveTerminalApp } from '#/system/terminals.ts'

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

export async function probeTerminalApps(
  pref: TerminalPref,
  signal?: AbortSignal,
  detectedAt = nextDetectedAt(),
): Promise<TerminalAppState> {
  const appAvailability = await getTerminalAppAvailability(signal)
  const resolved = resolveTerminalApp(pref, appAvailability)
  return {
    pref,
    resolved,
    available: resolved !== null,
    appAvailability,
    detectedAt,
  }
}

export function probeEditorApps(pref: EditorPref, detectedAt = nextDetectedAt()): EditorAppState {
  const appAvailability = getEditorAppAvailability()
  const resolved = resolveEditorApp(pref, appAvailability)
  return {
    pref,
    resolved,
    available: resolved !== null,
    appAvailability,
    detectedAt,
  }
}

export async function probeExternalApps(
  terminalPref: TerminalPref,
  editorPref: EditorPref,
  signal?: AbortSignal,
): Promise<ExternalAppsProbe> {
  const detectedAt = nextDetectedAt()
  const terminals = await probeTerminalApps(terminalPref, signal, detectedAt)
  const editors = probeEditorApps(editorPref, detectedAt)
  return {
    terminals,
    editors,
  }
}
