// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  captureTerminalHostGeometry,
  resolveTerminalCreateGeometry,
} from '#/web/components/terminal/terminal-session-geometry.ts'
import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'

const geometryMocks = vi.hoisted(() => ({
  preloadTerminalFont: vi.fn(async () => {}),
  proposeTerminalGeometry: vi.fn(() => ({ cols: 120, rows: 40 })),
}))

vi.mock('#/web/components/terminal/terminal-geometry.ts', () => ({
  preloadTerminalFont: geometryMocks.preloadTerminalFont,
  proposeTerminalGeometry: geometryMocks.proposeTerminalGeometry,
}))

function descriptor(): TerminalDescriptor {
  return {
    key: '/repo\0/repo\0terminal-1',
    worktreeTerminalKey: '/repo\0/repo',
    terminalId: 'terminal-1',
    index: 1,
    repoRoot: '/repo',
    branch: 'main',
    worktreePath: '/repo',
  }
}

describe('terminal session geometry helpers', () => {
  beforeEach(() => {
    geometryMocks.preloadTerminalFont.mockClear()
    geometryMocks.proposeTerminalGeometry.mockClear()
  })

  test('captures geometry from a connected host and caches it', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const geometryByWorktree = new Map<string, { cols: number; rows: number }>()

    const geometry = await captureTerminalHostGeometry({
      worktreeTerminalKey: '/repo\0/repo',
      hostByWorktree: new Map([['/repo\0/repo', host]]),
      geometryByWorktree,
    })

    expect(geometry).toEqual({ cols: 120, rows: 40 })
    expect(geometryByWorktree.get('/repo\0/repo')).toEqual({ cols: 120, rows: 40 })
  })

  test('falls back to selected attachment canonical size or cached geometry', async () => {
    const geometry = await resolveTerminalCreateGeometry({
      worktreeTerminalKey: '/repo\0/repo',
      hostByWorktree: new Map(),
      geometryByWorktree: new Map(),
      selectedDescriptor: descriptor(),
      getAttachmentSnapshot: () => ({
        role: 'controller',
        controllerStatus: 'connected',
        active: true,
        canTakeover: false,
        canonicalCols: 90,
        canonicalRows: 30,
      }),
    })
    expect(geometry).toEqual({ cols: 90, rows: 30 })

    const cached = await resolveTerminalCreateGeometry({
      worktreeTerminalKey: '/repo\0/repo',
      hostByWorktree: new Map(),
      geometryByWorktree: new Map([['/repo\0/repo', { cols: 70, rows: 20 }]]),
      selectedDescriptor: null,
      getAttachmentSnapshot: () => null,
    })
    expect(cached).toEqual({ cols: 70, rows: 20 })
  })
})
