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

export type ThemePref = 'auto' | 'light' | 'dark'
export type LangPref = 'auto' | 'en' | 'zh' | 'ko' | 'ja'

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

export interface SessionState {
  /** Repo paths that were open, in tab order. */
  openRepos: string[]
  /** The active tab — null when no repos were open. */
  activeRepo: string | null
  detailCollapsed: boolean
}

/** Bump when a breaking schema change lands (renamed fields, removed
 *  enum values, etc.). loadSettings checks this so a future migration
 *  can rewrite the file before the app reads it. */
export const SETTINGS_SCHEMA_VERSION = 1
export const DEFAULT_SESSION_DETAIL_COLLAPSED = true

export interface Settings {
  /** Schema version of this file. Older files without it are treated as
   *  v0 and quietly upgraded to the current version on next write. */
  version: number
  theme: ThemePref
  lang: LangPref
  /** Auto-fetch interval in seconds for the active repo. 0 = disabled. */
  fetchIntervalSec: number
  windowBounds: WindowBounds | null
  session: SessionState
  recentRepos: string[]
}

const DEFAULTS: Settings = {
  version: SETTINGS_SCHEMA_VERSION,
  theme: 'auto',
  lang: 'auto',
  fetchIntervalSec: 60,
  windowBounds: null,
  session: { openRepos: [], activeRepo: null, detailCollapsed: DEFAULT_SESSION_DETAIL_COLLAPSED },
  recentRepos: [],
}

const WRITE_DEBOUNCE_MS = 200
const MAX_RECENT_REPOS = 10

let cache: Settings | null = null
let writeTimer: NodeJS.Timeout | null = null
let pendingFlush: Promise<void> | null = null

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
  return {
    openRepos,
    activeRepo,
    detailCollapsed:
      typeof value.detailCollapsed === 'boolean' ? value.detailCollapsed : DEFAULTS.session.detailCollapsed,
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

function toSafeSessionPath(p: unknown): string | null {
  if (typeof p !== 'string' || p.length === 0 || p.includes('\0') || !path.isAbsolute(p)) return null
  return path.normalize(p)
}

function normalizeThemePref(value: unknown): ThemePref {
  return value === 'auto' || value === 'light' || value === 'dark' ? value : DEFAULTS.theme
}

function normalizeLangPref(value: unknown): LangPref {
  return value === 'auto' || value === 'en' || value === 'zh' || value === 'ko' || value === 'ja'
    ? value
    : DEFAULTS.lang
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
      lang: normalizeLangPref(parsed.lang),
      fetchIntervalSec: normalizeFetchInterval(parsed.fetchIntervalSec),
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

function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    // Chain a new write on the previous one — a `pendingFlush` already
    // running must complete before we start writing again, otherwise
    // two writes can race and the older snapshot can win.
    const prev = pendingFlush ?? Promise.resolve()
    const current: Promise<void> = prev.then(doFlush).finally(() => {
      // Only clear the slot if it still refers to *this* run; another
      // scheduleWrite may have queued a fresh promise in between.
      if (pendingFlush === current) pendingFlush = null
    })
    pendingFlush = current
  }, WRITE_DEBOUNCE_MS)
}

async function doFlush(): Promise<void> {
  if (!cache) return
  const target = settingsFile()
  // Write to a sibling tmp file then rename. rename(2) is atomic on the
  // same filesystem, so a power loss / process kill mid-write leaves
  // either the old file or the new file intact — never a half-written
  // settings.json that crashes loadSettings on next boot.
  const tmp = target + '.tmp'
  try {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf-8')
    await fs.rename(tmp, target)
  } catch (err) {
    console.warn('[settings] write failed', err)
    // Best-effort cleanup of any orphaned tmp file.
    try {
      await fs.unlink(tmp)
    } catch {
      /* nothing to clean up */
    }
    for (const cb of writeErrorListeners) {
      try {
        cb(err)
      } catch (lerr) {
        console.warn('[settings] write-error listener threw', lerr)
      }
    }
  }
}

/** Wait for any pending write to land. Called from `before-quit`.
 *  Drains both the in-flight write AND the queued debounced one in
 *  order — without that order a queued write can overwrite a flush
 *  that was meant to be the last word. */
export async function flushSettings(): Promise<void> {
  while (writeTimer || pendingFlush) {
    // Cancel the debounced timer and replace it with an immediate flush
    // chained after any in-flight write.
    if (writeTimer) {
      clearTimeout(writeTimer)
      writeTimer = null
      const prev = pendingFlush ?? Promise.resolve()
      pendingFlush = prev.then(doFlush)
    }
    const current = pendingFlush
    if (current) {
      await current
      if (pendingFlush === current) pendingFlush = null
    }
  }
}

export async function setThemePref(pref: ThemePref): Promise<void> {
  const s = await loadSettings()
  if (s.theme === pref) return
  s.theme = pref
  scheduleWrite()
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
