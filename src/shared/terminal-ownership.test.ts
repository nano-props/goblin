import { describe, expect, test } from 'vitest'
import {
  cloneTerminalController,
  resolveTerminalAttachmentRole,
  resolveTerminalOwnership,
} from '#/shared/terminal-ownership.ts'

describe('shared terminal ownership helpers', () => {
  test('resolves controller, viewer, and unowned attachment roles', () => {
    expect(resolveTerminalAttachmentRole(null, 'attachment_a')).toBe('unowned')
    expect(
      resolveTerminalAttachmentRole({ attachmentId: 'attachment_a', status: 'connected' }, 'attachment_a'),
    ).toBe('controller')
    expect(
      resolveTerminalAttachmentRole({ attachmentId: 'attachment_a', status: 'connected' }, 'attachment_b'),
    ).toBe('viewer')
  })

  test('resolves ownership view model with controller status fallback', () => {
    expect(resolveTerminalOwnership(null, 'attachment_a')).toEqual({
      role: 'unowned',
      controllerStatus: 'none',
    })
    expect(resolveTerminalOwnership({ attachmentId: 'attachment_a', status: 'grace' }, 'attachment_b')).toEqual({
      role: 'viewer',
      controllerStatus: 'grace',
    })
  })

  test('clones controller objects without sharing references', () => {
    const controller = { attachmentId: 'attachment_a', status: 'connected' as const }
    expect(cloneTerminalController(null)).toBeNull()
    const cloned = cloneTerminalController(controller)
    expect(cloned).toEqual(controller)
    expect(cloned).not.toBe(controller)
  })
})
