import { describe, expect, test } from 'vitest'
import {
  cloneTerminalController,
  resolveTerminalClientRole,
  resolveTerminalOwnership,
} from '#/shared/terminal-ownership.ts'

describe('shared terminal ownership helpers', () => {
  test('resolves controller, viewer, and unowned attachment roles', () => {
    expect(resolveTerminalClientRole(null, 'client_a')).toBe('unowned')
    expect(resolveTerminalClientRole({ clientId: 'client_a', status: 'connected' }, 'client_a')).toBe(
      'controller',
    )
    expect(resolveTerminalClientRole({ clientId: 'client_a', status: 'connected' }, 'client_b')).toBe(
      'viewer',
    )
  })

  test('resolves ownership view model with controller status fallback', () => {
    expect(resolveTerminalOwnership(null, 'client_a')).toEqual({
      role: 'unowned',
      controllerStatus: 'none',
    })
    expect(resolveTerminalOwnership({ clientId: 'client_a', status: 'connected' }, 'client_b')).toEqual({
      role: 'viewer',
      controllerStatus: 'connected',
    })
  })

  test('clones controller objects without sharing references', () => {
    const controller = { clientId: 'client_a', status: 'connected' as const }
    expect(cloneTerminalController(null)).toBeNull()
    const cloned = cloneTerminalController(controller)
    expect(cloned).toEqual(controller)
    expect(cloned).not.toBe(controller)
  })
})
