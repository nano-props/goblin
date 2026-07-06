// Bridge between BrowserWindow security policy and the surface registry.
//
// This module is intentionally tiny: attaching a client surface means
// "apply trusted BrowserWindow policy" + "register the surface identity/capabilities".

import type { BrowserWindow } from 'electron'
import {
  registerClientWindowSurface,
  unregisterClientWindowSurface,
  type ClientSurfaceSpec,
} from '#/main/client-surface-registry.ts'
import { configureTrustedBrowserWindow } from '#/main/window-security.ts'

interface AttachClientSurfaceWindowOptions {
  surface: ClientSurfaceSpec
}

export function attachClientSurfaceWindow(win: BrowserWindow, { surface }: AttachClientSurfaceWindowOptions): void {
  configureTrustedBrowserWindow(win)
  registerClientWindowSurface(win, surface)
}

export function detachClientSurfaceWindow(win: BrowserWindow, surface: ClientSurfaceSpec): void {
  unregisterClientWindowSurface(surface, win)
}
