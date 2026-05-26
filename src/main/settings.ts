// Persisted user state. JSON file in `app.getPath('userData')`. One file
// for everything keeps the read path simple — settings + session
// (which repos were open) + window bounds all hydrate together before
// the first render so the UI doesn't flicker through default state.
//
// Writes are debounced (200ms) so a burst of changes — typing in
// settings, dragging the window, switching tabs — collapses into one
// disk hit. `flushSettings()` from `before-quit` drains the pending
// write so the last edit isn't lost.

import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { DEFAULT_GLOBAL_SHORTCUT, normalizeGlobalShortcut } from '#/shared/accelerator.ts'
import {
  DEFAULT_WORKSPACE_LAYOUT,
  DEFAULT_DETAIL_COLLAPSED,
  DEFAULT_DETAIL_PANE_SIZES,
  effectiveDetailCollapsed,
  normalizeDetailPaneSizes,
  normalizeWorkspaceLayout,
  type WorkspaceDetailPaneSizes,
  type WorkspaceLayout,
} from '#/shared/workspace-layout.ts'
import { DEFAULT_COLOR_THEME, isColorTheme } from '#/shared/color-theme.ts'
import { toSafeSessionPath } from '#/main/ipc/validation.ts'
import type { EditorPref, LangPref, SessionState, TerminalPref, ThemePref } from '#/shared/rpc.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

/** Bump when a breaking schema change lands (renamed fields, removed
 *  enum values, etc.). loadSettings checks this so a future migration
 *  can rewrite the file before the app reads it. */
export const SETTINGS_SCHEMA_VERSION = 1
export const DEFAULT_SESSION_DETAIL_COLLAPSED = DEFAULT_DETAIL_COLLAPSED
export const DEFAULT_SESSION_DETAIL_FOCUS_MODE = false
export const DEFAULT_SESSION_WORKSPACE_LAYOUT: WorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT
export const DEFAULT_SESSION_DETAIL_PANE_SIZES: WorkspaceDetailPaneSizes = DEFAULT_DETAIL_PANE_SIZES

export interface Settings {
  /** Schema version of this file. Older files without it are treated as
   *  v0 and quietly upgraded to the current version on next write. */
  version: number
  theme: ThemePref
  colorTheme: ColorTheme
  lang: LangPref
  /** Auto-fetch interval in seconds for the active repo. 0 = disabled. */
  fetchIntervalSec: number
  shortcutsDisabled: boolean
  globalShortcutDisabled: boolean
  swapCloseShortcuts: boolean
  globalShortcut: string
  terminalApp: TerminalPref
  editorApp: EditorPref
  windowBounds: WindowBounds | null
  session: SessionState
  recentRepos: string[]
}

const DEFAULTS: Settings = {
  version: SETTINGS_SCHEMA_VERSION,
  theme: 'auto',
  colorTheme: DEFAULT_COLOR_THEME,
  lang: 'auto',
  fetchIntervalSec: 120,
  shortcutsDisabled: false,
  globalShortcutDisabled: false,
  swapCloseShortcuts: false,
  globalShortcut: DEFAULT_GLOBAL_SHORTCUT,
  terminalApp: 'auto',
  editorApp: 'auto',
  windowBounds: null,
  session: {
    openRepos: [],
    activeRepo: null,
    detailCollapsed: DEFAULT_SESSION_DETAIL_COLLAPSED,
    detailFocusMode: DEFAULT_SESSION_DETAIL_FOCUS_MODE,
    workspaceLayout: DEFAULT_SESSION_WORKSPACE_LAYOUT,
    detailPaneSizes: DEFAULT_SESSION_DETAIL_PANE_SIZES,
  },
  recentRepos: [],
}

const WRITE_DEBOUNCE_MS = 200
const MAX_RECENT_REPOS = 10

let cache: Settings | null = null
let writeTimer: NodeJS.Timeout | null = null
let pendingFlush: Promise<boolean> | null = null

type WriteErrorListener = (err: unknown) => void
const writeErrorListeners = new Set<WriteErrorListener>()

/** Subscribe to settings write failures. Wired by the renderer-broadcast
 *  layer so the user sees a toast instead of silently losing prefs. */
export function onSettingsWriteError(cb: WriteErrorListener): () => void {
  writeErrorListeners.add(cb)
  return () => writeErrorListeners.delete(cb)
}

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function normalizeSession(session: unknown): SessionState {
  if (!session || typeof session !== 'object') return { ...DEFAULTS.session }
  const value = session as Partial<SessionState>
  const openRepos = Array.isArray(value.openRepos)
    ? value.openRepos.map(toSafeSessionPath).filter((p): p is string => p !== null)
    : []
  const activePath = toSafeSessionPath(value.activeRepo)
  const activeRepo = activePath && openRepos.includes(activePath) ? activePath : null
  const workspaceLayout = normalizeWorkspaceLayout(value.workspaceLayout)
  const detailCollapsed =
    typeof value.detailCollapsed === 'boolean' ? value.detailCollapsed : DEFAULTS.session.detailCollapsed
  const detailFocusMode =
    workspaceLayout === 'top-bottom' && typeof value.detailFocusMode === 'boolean'
      ? value.detailFocusMode
      : DEFAULTS.session.detailFocusMode
  return {
    openRepos,
    activeRepo,
    detailCollapsed: effectiveDetailCollapsed(workspaceLayout, detailCollapsed),
    detailFocusMode,
    workspaceLayout,
    detailPaneSizes: normalizeDetailPaneSizes(value.detailPaneSizes),
  }
}

function normalizeRecentRepos(recentRepos: unknown): string[] {
  if (!Array.isArray(recentRepos)) return []
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of recentRepos) {
    const safePath = toSafeSessionPath(value)
    if (!safePath || seen.has(safePath)) continue
    seen.add(safePath)
    normalized.push(safePath)
    if (normalized.length >= MAX_RECENT_REPOS) break
  }
  return normalized
}

function normalizeThemePref(value: unknown): ThemePref {
  return value === 'auto' || value === 'light' || value === 'dark' ? value : DEFAULTS.theme
}

function normalizeColorTheme(value: unknown): ColorTheme {
  return isColorTheme(value) ? value : DEFAULTS.colorTheme
}

function normalizeLangPref(value: unknown): LangPref {
  return value === 'auto' || value === 'en' || value === 'zh' || value === 'ko' || value === 'ja'
    ? value
    : DEFAULTS.lang
}

function normalizeTerminalPref(value: unknown): TerminalPref {
  return value === 'auto' || value === 'ghostty' || value === 'terminal' ? value : DEFAULTS.terminalApp
}

function normalizeEditorPref(value: unknown): EditorPref {
  return value === 'auto' || value === 'vscode' || value === 'cursor' || value === 'windsurf'
    ? value
    : DEFAULTS.editorApp
}

function normalizeFetchInterval(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(3600, Math.round(value)))
    : DEFAULTS.fetchIntervalSec
}

function normalizeWindowBounds(value: unknown): WindowBounds | null {
  if (!value || typeof value !== 'object') return null
  const bounds = value as Partial<WindowBounds>
  if (
    typeof bounds.width !== 'number' ||
    typeof bounds.height !== 'number' ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return null
  }
  const normalized: WindowBounds = { width: bounds.width, height: bounds.height }
  if (typeof bounds.x === 'number' && Number.isFinite(bounds.x)) normalized.x = bounds.x
  if (typeof bounds.y === 'number' && Number.isFinite(bounds.y)) normalized.y = bounds.y
  return normalized
}

export async function loadSettings(): Promise<Settings> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(settingsFile(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<Settings>
    // version is read but not yet used — no migrations exist for v1.
    // When v2 ships, add a migrate(parsed) step here that rewrites
    // fields before the field-by-field merge below.
    cache = {
      version: SETTINGS_SCHEMA_VERSION,
      theme: normalizeThemePref(parsed.theme),
      colorTheme: normalizeColorTheme(parsed.colorTheme),
      lang: normalizeLangPref(parsed.lang),
      fetchIntervalSec: normalizeFetchInterval(parsed.fetchIntervalSec),
      shortcutsDisabled: parsed.shortcutsDisabled === true,
      globalShortcutDisabled: parsed.globalShortcutDisabled === true,
      swapCloseShortcuts: parsed.swapCloseShortcuts === true,
      globalShortcut: normalizeGlobalShortcut(parsed.globalShortcut),
      terminalApp: normalizeTerminalPref(parsed.terminalApp),
      editorApp: normalizeEditorPref(parsed.editorApp),
      windowBounds: normalizeWindowBounds(parsed.windowBounds),
      session: normalizeSession(parsed.session),
      recentRepos: normalizeRecentRepos(parsed.recentRepos),
    }
  } catch {
    // Missing file or malformed JSON: start clean rather than crashing the
    // app at boot. The first save will write a fresh file.
    cache = { ...DEFAULTS, session: { ...DEFAULTS.session }, recentRepos: [] }
  }
  return cache
}

export function getRecentRepos(): string[] {
  return cache?.recentRepos ?? []
}

export function getShortcutsDisabled(): boolean {
  return cache?.shortcutsDisabled ?? DEFAULTS.shortcutsDisabled
}

export function getGlobalShortcutDisabled(): boolean {
  return cache?.globalShortcutDisabled ?? DEFAULTS.globalShortcutDisabled
}

export function getSwapCloseShortcuts(): boolean {
  return cache?.swapCloseShortcuts ?? DEFAULTS.swapCloseShortcuts
}

export function getGlobalShortcut(): string {
  return cache?.globalShortcut ?? DEFAULTS.globalShortcut
}

export function getLangPref(): LangPref {
  return cache?.lang ?? DEFAULTS.lang
}

export function getSession(): SessionState {
  return cache?.session ?? DEFAULTS.session
}

export function getTerminalApp(): TerminalPref {
  return cache?.terminalApp ?? DEFAULTS.terminalApp
}

export function getEditorApp(): EditorPref {
  return cache?.editorApp ?? DEFAULTS.editorApp
}

function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    // Chain a new write on the previous one — a `pendingFlush` already
    // running must complete before we start writing again, otherwise
    // two writes can race and the older snapshot can win.
    const prev = pendingFlush ?? Promise.resolve(true)
    const current: Promise<boolean> = chainFlush(prev).finally(() => {
      // Only clear the slot if it still refers to *this* run; another
      // scheduleWrite may have queued a fresh promise in between.
      if (pendingFlush === current) pendingFlush = null
    })
    pendingFlush = current
  }, WRITE_DEBOUNCE_MS)
}

async function chainFlush(prev: Promise<boolean>): Promise<boolean> {
  const prevOk = await prev
  const currentOk = await doFlush()
  return prevOk && currentOk
}

async function doFlush(): Promise<boolean> {
  if (!cache) return true
  const target = settingsFile()
  // write-file-atomic writes to a sibling tmp file, fsyncs it, then renames
  // it over the target so the next boot never reads a half-written JSON file.
  try {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await writeFileAtomic(target, JSON.stringify(cache, null, 2), { encoding: 'utf-8' })
    return true
  } catch (err) {
    console.warn('[settings] write failed', err)
    for (const cb of writeErrorListeners) {
      try {
        cb(err)
      } catch (lerr) {
        console.warn('[settings] write-error listener threw', lerr)
      }
    }
    return false
  }
}

/** Wait for any pending write to land. Called from `before-quit`.
 *  Drains both the in-flight write AND the queued debounced one in
 *  order — without that order a queued write can overwrite a flush
 *  that was meant to be the last word. */
export async function flushSettings(): Promise<boolean> {
  let ok = true
  while (writeTimer || pendingFlush) {
    // Cancel the debounced timer and replace it with an immediate flush
    // chained after any in-flight write.
    if (writeTimer) {
      clearTimeout(writeTimer)
      writeTimer = null
      const prev = pendingFlush ?? Promise.resolve(true)
      pendingFlush = chainFlush(prev)
    }
    const current = pendingFlush
    if (current) {
      ok = (await current) && ok
      if (pendingFlush === current) pendingFlush = null
    }
  }
  return ok
}

export async function setThemePref(pref: ThemePref): Promise<void> {
  const s = await loadSettings()
  if (s.theme === pref) return
  s.theme = pref
  scheduleWrite()
}

export async function setColorTheme(colorTheme: ColorTheme): Promise<ColorTheme> {
  const s = await loadSettings()
  const normalized = normalizeColorTheme(colorTheme)
  if (s.colorTheme === normalized) return normalized
  s.colorTheme = normalized
  scheduleWrite()
  return normalized
}

export async function setLangPref(pref: LangPref): Promise<void> {
  const s = await loadSettings()
  if (s.lang === pref) return
  s.lang = pref
  scheduleWrite()
}

export async function setFetchInterval(sec: number): Promise<number> {
  const s = await loadSettings()
  const clamped = Number.isFinite(sec) ? Math.max(0, Math.min(3600, Math.round(sec))) : s.fetchIntervalSec
  if (s.fetchIntervalSec === clamped) return clamped
  s.fetchIntervalSec = clamped
  scheduleWrite()
  return clamped
}

export async function setShortcutsDisabled(disabled: boolean): Promise<boolean> {
  const s = await loadSettings()
  if (s.shortcutsDisabled === disabled) return disabled
  s.shortcutsDisabled = disabled
  scheduleWrite()
  return disabled
}

export async function setGlobalShortcutDisabled(disabled: boolean): Promise<boolean> {
  const s = await loadSettings()
  if (s.globalShortcutDisabled === disabled) return disabled
  s.globalShortcutDisabled = disabled
  scheduleWrite()
  return disabled
}

export async function setSwapCloseShortcuts(swapped: boolean): Promise<boolean> {
  const s = await loadSettings()
  if (s.swapCloseShortcuts === swapped) return swapped
  s.swapCloseShortcuts = swapped
  scheduleWrite()
  return swapped
}

export async function setGlobalShortcut(accelerator: string): Promise<string> {
  const s = await loadSettings()
  const normalized = normalizeGlobalShortcut(accelerator)
  if (s.globalShortcut === normalized) return normalized
  s.globalShortcut = normalized
  scheduleWrite()
  return normalized
}

export async function setTerminalApp(pref: TerminalPref): Promise<TerminalPref> {
  const s = await loadSettings()
  const normalized = normalizeTerminalPref(pref)
  if (s.terminalApp === normalized) return normalized
  s.terminalApp = normalized
  scheduleWrite()
  return normalized
}

export async function setEditorApp(pref: EditorPref): Promise<EditorPref> {
  const s = await loadSettings()
  const normalized = normalizeEditorPref(pref)
  if (s.editorApp === normalized) return normalized
  s.editorApp = normalized
  scheduleWrite()
  return normalized
}

export async function setWindowBounds(bounds: WindowBounds): Promise<void> {
  const s = await loadSettings()
  s.windowBounds = bounds
  scheduleWrite()
}

export async function setSession(session: SessionState): Promise<void> {
  const s = await loadSettings()
  s.session = session
  scheduleWrite()
}

export async function addRecentRepo(repoPath: string): Promise<string[]> {
  const safePath = toSafeSessionPath(repoPath)
  if (!safePath) return getRecentRepos()
  const s = await loadSettings()
  s.recentRepos = [safePath, ...s.recentRepos.filter((p) => p !== safePath)].slice(0, MAX_RECENT_REPOS)
  scheduleWrite()
  return s.recentRepos
}

export async function clearRecentRepos(): Promise<void> {
  const s = await loadSettings()
  if (s.recentRepos.length === 0) return
  s.recentRepos = []
  scheduleWrite()
}
