// Registry of trusted client BrowserWindows and their capabilities.
//
// Boundary:
// - This module owns client-surface identity and capability lookup.
// - It does NOT own BrowserWindow security policy (navigation/open-handler),
//   which lives in window-security.ts.

import { BrowserWindow, type BrowserWindow as BrowserWindowType } from 'electron'
import { windowRegistryNodeLog } from '#/node/logger.ts'

export interface RegisteredClientSurfaceCapabilities {
  ipcBroadcast: boolean
  themeSync: boolean
}

export type RegisteredClientSurfaceCapability = keyof RegisteredClientSurfaceCapabilities

export interface ClientSurfaceSpec {
  windowKey: string
  capabilities?: Partial<RegisteredClientSurfaceCapabilities>
}

export interface RegisteredClientSurface {
  windowKey: string
  capabilities: RegisteredClientSurfaceCapabilities
}

export interface RegisteredClientSurfaceHandle extends RegisteredClientSurface {
  webContentsId: number
  window: BrowserWindowType
}

let primaryWindow: BrowserWindowType | null = null
const surfacesByWebContentsId = new Map<number, RegisteredClientSurface>()

function defaultCapabilities(): RegisteredClientSurfaceCapabilities {
  return {
    ipcBroadcast: true,
    themeSync: true,
  }
}

function resolveCapabilities(
  capabilities?: Partial<RegisteredClientSurfaceCapabilities>,
): RegisteredClientSurfaceCapabilities {
  return { ...defaultCapabilities(), ...capabilities }
}

function registerSurface(win: BrowserWindowType, surface: RegisteredClientSurface): void {
  surfacesByWebContentsId.set(win.webContents.id, surface)
}

function unregisterSurface(win?: BrowserWindowType | null): void {
  if (!win) return
  try {
    surfacesByWebContentsId.delete(win.webContents.id)
  } catch {}
}

export function unregisterPrimaryWindow(win?: BrowserWindowType): void {
  if (win && primaryWindow !== win) return
  unregisterSurface(primaryWindow ?? win)
  primaryWindow = null
}

export function getPrimaryWindow(): BrowserWindowType | null {
  if (primaryWindow && !primaryWindow.isDestroyed()) return primaryWindow
  unregisterSurface(primaryWindow)
  primaryWindow = null
  return null
}

function allRegisteredWindows(): BrowserWindowType[] {
  const primary = getPrimaryWindow()
  return primary ? [primary] : []
}

function allRegisteredSurfaces(): RegisteredClientSurfaceHandle[] {
  const handles: RegisteredClientSurfaceHandle[] = []
  for (const win of allRegisteredWindows()) {
    const surface = surfacesByWebContentsId.get(win.webContents.id)
    if (!surface) continue
    handles.push({ ...surface, webContentsId: win.webContents.id, window: win })
  }
  return handles
}

export function allRegisteredSurfacesWithCapability(
  capability: RegisteredClientSurfaceCapability,
): RegisteredClientSurfaceHandle[] {
  return allRegisteredSurfaces().filter((surface) => surface.capabilities[capability])
}

export function isRegisteredClientSurfaceId(webContentsId: number): boolean {
  return registeredClientSurfaceByWebContentsId(webContentsId) !== null
}

function registeredWindowByWebContentsId(webContentsId: number): BrowserWindowType | null {
  const primary = getPrimaryWindow()
  if (primary?.webContents.id === webContentsId) return primary
  return null
}

export function registeredClientSurfaceByWebContentsId(webContentsId: number): RegisteredClientSurface | null {
  const win = registeredWindowByWebContentsId(webContentsId)
  if (!win) {
    surfacesByWebContentsId.delete(webContentsId)
    return null
  }
  return surfacesByWebContentsId.get(webContentsId) ?? null
}

function registeredClientSurfaceHandleByWebContentsId(webContentsId: number): RegisteredClientSurfaceHandle | null {
  const surface = registeredClientSurfaceByWebContentsId(webContentsId)
  const win = registeredWindowByWebContentsId(webContentsId)
  return surface && win ? { ...surface, webContentsId, window: win } : null
}

export function focusedRegisteredSurface(): RegisteredClientSurfaceHandle | null {
  const focused = getFocusedRegisteredWindow()
  if (!focused) return null
  return registeredClientSurfaceHandleByWebContentsId(focused.webContents.id)
}

export function getFocusedRegisteredWindow(): BrowserWindowType | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (!focused || focused.isDestroyed()) return null
  return focused === getPrimaryWindow() ? focused : null
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
  surface: RegisteredClientSurfaceHandle | null | undefined,
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
    predicate?: (surface: RegisteredClientSurfaceHandle) => boolean
  },
): void {
  for (const surface of allRegisteredSurfaces()) {
    if (options?.excludeWebContentsId === surface.webContentsId) continue
    if (options?.predicate && !options.predicate(surface)) continue
    sendToRegisteredSurface(surface, channel, args)
  }
}

export function broadcastToSurfaceCapability(
  capability: RegisteredClientSurfaceCapability,
  channel: string,
  args: unknown[] = [],
  options?: {
    excludeWebContentsId?: number
    predicate?: (surface: RegisteredClientSurfaceHandle) => boolean
  },
): void {
  broadcastToRegisteredSurfaces(channel, args, {
    excludeWebContentsId: options?.excludeWebContentsId,
    predicate: (surface) => surface.capabilities[capability] && (!options?.predicate || options.predicate(surface)),
  })
}

export function registerClientWindowSurface(win: BrowserWindowType, surface: ClientSurfaceSpec): void {
  primaryWindow = win
  registerSurface(win, {
    windowKey: surface.windowKey,
    capabilities: resolveCapabilities(surface.capabilities),
  })
}

export function unregisterClientWindowSurface(_surface: ClientSurfaceSpec, win?: BrowserWindowType): void {
  unregisterPrimaryWindow(win)
}
