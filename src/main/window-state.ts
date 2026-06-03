import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

interface WindowState {
  windowBounds: WindowBounds | null
}

const DEFAULT_WINDOW_STATE: WindowState = {
  windowBounds: null,
}

const WRITE_DEBOUNCE_MS = 200

let cache: WindowState | null = null
let writeTimer: NodeJS.Timeout | null = null
let pendingFlush: Promise<boolean> | null = null

function windowStateFile(): string {
  return path.join(app.getPath('userData'), 'window-state.json')
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

export async function loadWindowState(): Promise<WindowState> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(windowStateFile(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<WindowState>
    cache = {
      windowBounds: normalizeWindowBounds(parsed.windowBounds),
    }
  } catch {
    cache = { ...DEFAULT_WINDOW_STATE }
  }
  return cache
}

function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    const prev = pendingFlush ?? Promise.resolve(true)
    const current: Promise<boolean> = chainFlush(prev).finally(() => {
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
  const target = windowStateFile()
  try {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await writeFileAtomic(target, JSON.stringify(cache, null, 2), { encoding: 'utf-8' })
    return true
  } catch (err) {
    console.warn('[window-state] write failed', err)
    return false
  }
}

export async function flushWindowState(): Promise<boolean> {
  let ok = true
  while (writeTimer || pendingFlush) {
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

export async function setWindowBounds(bounds: WindowBounds): Promise<void> {
  const state = await loadWindowState()
  state.windowBounds = bounds
  scheduleWrite()
}
