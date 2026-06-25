// Bridge between the window shell and the surface registry.
//
// This module is intentionally tiny: attaching a client surface means
// "apply trusted shell policy" + "register the surface identity/capabilities".

import type { BrowserWindow } from 'electron'
import {
  registerClientWindowSurface,
  unregisterClientWindowSurface,
  type ClientSurfaceSpec,
} from '#/main/window-registry.ts'
import { configureTrustedClientWindow } from '#/main/window-shell.ts'

interface AttachClientSurfaceWindowOptions {
  logLabel: string
  surface: ClientSurfaceSpec
}

export function attachClientSurfaceWindow(
  win: BrowserWindow,
  { logLabel, surface }: AttachClientSurfaceWindowOptions,
): void {
  configureTrustedClientWindow(win, logLabel)
  registerClientWindowSurface(win, surface)
}

export function detachClientSurfaceWindow(win: BrowserWindow, surface: ClientSurfaceSpec): void {
  unregisterClientWindowSurface(surface, win)
}
