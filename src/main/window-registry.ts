// Registry of trusted renderer BrowserWindows and their capabilities.
//
// Boundary:
// - This module owns client-surface identity and capability lookup.
// - It does NOT own window shell policy (navigation/open-handler), which
//   lives in window-shell.ts.

import { BrowserWindow, type BrowserWindow as BrowserWindowType } from 'electron'
import { windowRegistryNodeLog } from '#/node/logger.ts'

export interface RegisteredRendererSurfaceCapabilities {
  ipcBroadcast: boolean
  themeSync: boolean
}

export type RegisteredRendererSurfaceCapability = keyof RegisteredRendererSurfaceCapabilities

export interface ClientSurfaceSpec {
  windowKey: string
  capabilities?: Partial<RegisteredRendererSurfaceCapabilities>
}

export interface RegisteredRendererSurface {
  windowKey: string
  capabilities: RegisteredRendererSurfaceCapabilities
}

export interface RegisteredRendererSurfaceHandle extends RegisteredRendererSurface {
  webContentsId: number
  window: BrowserWindowType
}

let mainWindow: BrowserWindowType | null = null
const surfacesByWebContentsId = new Map<number, RegisteredRendererSurface>()

function defaultCapabilities(): RegisteredRendererSurfaceCapabilities {
  return {
    ipcBroadcast: true,
    themeSync: true,
  }
}

function resolveCapabilities(
  capabilities?: Partial<RegisteredRendererSurfaceCapabilities>,
): RegisteredRendererSurfaceCapabilities {
  return { ...defaultCapabilities(), ...capabilities }
}

function registerSurface(win: BrowserWindowType, surface: RegisteredRendererSurface): void {
  surfacesByWebContentsId.set(win.webContents.id, surface)
}

function unregisterSurface(win?: BrowserWindowType | null): void {
  if (!win) return
  try {
    surfacesByWebContentsId.delete(win.webContents.id)
  } catch {}
}

export function unregisterMainWindow(win?: BrowserWindowType): void {
  if (win && mainWindow !== win) return
  unregisterSurface(mainWindow ?? win)
  mainWindow = null
}

export function getMainWindow(): BrowserWindowType | null {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  unregisterSurface(mainWindow)
  mainWindow = null
  return null
}

function allRegisteredWindows(): BrowserWindowType[] {
  const main = getMainWindow()
  return main ? [main] : []
}

function allRegisteredSurfaces(): RegisteredRendererSurfaceHandle[] {
  const handles: RegisteredRendererSurfaceHandle[] = []
  for (const win of allRegisteredWindows()) {
    const surface = surfacesByWebContentsId.get(win.webContents.id)
    if (!surface) continue
    handles.push({ ...surface, webContentsId: win.webContents.id, window: win })
  }
  return handles
}

export function allRegisteredSurfacesWithCapability(
  capability: RegisteredRendererSurfaceCapability,
): RegisteredRendererSurfaceHandle[] {
  return allRegisteredSurfaces().filter((surface) => surface.capabilities[capability])
}

export function isRegisteredRendererSurfaceId(webContentsId: number): boolean {
  return registeredRendererSurfaceByWebContentsId(webContentsId) !== null
}

function registeredWindowByWebContentsId(webContentsId: number): BrowserWindowType | null {
  const main = getMainWindow()
  if (main?.webContents.id === webContentsId) return main
  return null
}

export function registeredRendererSurfaceByWebContentsId(webContentsId: number): RegisteredRendererSurface | null {
  const win = registeredWindowByWebContentsId(webContentsId)
  if (!win) {
    surfacesByWebContentsId.delete(webContentsId)
    return null
  }
  return surfacesByWebContentsId.get(webContentsId) ?? null
}

function registeredSurfaceHandleByWebContentsId(webContentsId: number): RegisteredRendererSurfaceHandle | null {
  const surface = registeredRendererSurfaceByWebContentsId(webContentsId)
  const win = registeredWindowByWebContentsId(webContentsId)
  return surface && win ? { ...surface, webContentsId, window: win } : null
}

export function focusedRegisteredSurface(): RegisteredRendererSurfaceHandle | null {
  const focused = getFocusedRegisteredWindow()
  if (!focused) return null
  return registeredSurfaceHandleByWebContentsId(focused.webContents.id)
}

export function getFocusedRegisteredWindow(): BrowserWindowType | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (!focused || focused.isDestroyed()) return null
  return focused === getMainWindow() ? focused : null
}

export function sendToRegisteredWindow(
  win: BrowserWindowType | null | undefined,
  channel: string,
  args: unknown[] = [],
): void {
  if (!win) return
  try {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, ...args)
  } catch (err) {
    windowRegistryNodeLog.warn({ err }, 'failed to send event to window')
  }
}

function broadcastToRegisteredWindows(
  channel: string,
  args: unknown[] = [],
  options?: { excludeWindow?: BrowserWindowType | null | undefined },
): void {
  for (const win of allRegisteredWindows()) {
    if (options?.excludeWindow && options.excludeWindow === win) continue
    sendToRegisteredWindow(win, channel, args)
  }
}

function sendToRegisteredSurface(
  surface: RegisteredRendererSurfaceHandle | null | undefined,
  channel: string,
  args: unknown[] = [],
): void {
  sendToRegisteredWindow(surface?.window, channel, args)
}

function broadcastToRegisteredSurfaces(
  channel: string,
  args: unknown[] = [],
  options?: {
    excludeWebContentsId?: number
    predicate?: (surface: RegisteredRendererSurfaceHandle) => boolean
  },
): void {
  for (const surface of allRegisteredSurfaces()) {
    if (options?.excludeWebContentsId === surface.webContentsId) continue
    if (options?.predicate && !options.predicate(surface)) continue
    sendToRegisteredSurface(surface, channel, args)
  }
}

export function broadcastToSurfaceCapability(
  capability: RegisteredRendererSurfaceCapability,
  channel: string,
  args: unknown[] = [],
  options?: {
    excludeWebContentsId?: number
    predicate?: (surface: RegisteredRendererSurfaceHandle) => boolean
  },
): void {
  broadcastToRegisteredSurfaces(channel, args, {
    excludeWebContentsId: options?.excludeWebContentsId,
    predicate: (surface) => surface.capabilities[capability] && (!options?.predicate || options.predicate(surface)),
  })
}

export function registerClientWindowSurface(win: BrowserWindowType, surface: ClientSurfaceSpec): void {
  mainWindow = win
  registerSurface(win, {
    windowKey: surface.windowKey,
    capabilities: resolveCapabilities(surface.capabilities),
  })
}

export function unregisterClientWindowSurface(_surface: ClientSurfaceSpec, win?: BrowserWindowType): void {
  unregisterMainWindow(win)
}
