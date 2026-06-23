import { describe, expect, test } from 'vitest'
import type { TerminalOwnershipState } from '#/server/terminal/terminal-ownership.ts'
import {
  registerTerminalAttachment,
  attachTerminalAttachment,
  claimTerminalAttachmentControl,
  restartTerminalAttachmentControl,
  updateTerminalAttachmentConnection,
  isAuthoritative,
  explainAuthority,
} from '#/server/terminal/terminal-ownership.ts'

function createState(overrides?: Partial<TerminalOwnershipState>): TerminalOwnershipState {
  return {
    attachments: new Map(),
    controller: null,
    claimedByOwner: false,
    cols: 80,
    rows: 24,
    ...overrides,
  }
}

describe('registerTerminalAttachment', () => {
  test('registers a new attachment with defaults', () => {
    const state = createState()
    registerTerminalAttachment(state, 'a1', 100, 30)
    expect(state.attachments.get('a1')).toEqual({ cols: 100, rows: 30, connected: false })
  })

  test('preserves existing connected flag when omitted', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]) })
    registerTerminalAttachment(state, 'a1', 100, 30)
    expect(state.attachments.get('a1')?.connected).toBe(true)
  })

  test('overrides existing connected flag when provided', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]) })
    registerTerminalAttachment(state, 'a1', 100, 30, false)
    expect(state.attachments.get('a1')?.connected).toBe(false)
  })

  test('keeps multiple attachments instead of replacing the previous one', () => {
    const state = createState()
    registerTerminalAttachment(state, 'a1', 80, 24, true)
    registerTerminalAttachment(state, 'a2', 100, 30, false)
    expect(state.attachments.get('a1')).toEqual({ cols: 80, rows: 24, connected: true })
    expect(state.attachments.get('a2')).toEqual({ cols: 100, rows: 30, connected: false })
  })
})

describe('attachTerminalAttachment (single-owner model)', () => {
  test('first attach auto-claims and sets claimedByOwner', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]) })
    const effect = attachTerminalAttachment(state, 'a1')
    expect(effect.emitOwnership).toBe(true)
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
    expect(state.claimedByOwner).toBe(true)
  })

  test('rejects when controller already exists on a different attachment', () => {
    const state = createState({
      attachments: new Map([
        ['a1', { cols: 80, rows: 24, connected: true }],
        ['a2', { cols: 100, rows: 30, connected: true }],
      ]),
      controller: { attachmentId: 'a1', status: 'connected' },
      claimedByOwner: true,
    })
    const effect = attachTerminalAttachment(state, 'a2')
    expect(effect.emitOwnership).toBe(false)
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
  })

  test('second attach from a different window auto-claims when no controller (device switch)', () => {
    const state = createState({
      attachments: new Map([
        ['a1', { cols: 80, rows: 24, connected: false }],
        ['a2', { cols: 100, rows: 30, connected: true }],
      ]),
      controller: null,
      claimedByOwner: true,
    })
    const effect = attachTerminalAttachment(state, 'a2')
    // The new attachment reports a different geometry, so the
    // claim goes out as a resize instead of a plain ownership emit.
    expect(effect.emitOwnership).toBe(false)
    expect(effect.resizeTo).toEqual({ cols: 100, rows: 30 })
    expect(state.controller).toEqual({ attachmentId: 'a2', status: 'connected' })
  })

  test('rejects when attachment is not connected', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24, connected: false }]]) })
    const effect = attachTerminalAttachment(state, 'a1')
    expect(effect.emitOwnership).toBe(false)
    expect(state.controller).toBeNull()
  })

  test('same attachment that was controller reattaching auto-claims when slot cleared', () => {
    // The previous design kept the controller in a 'grace' sub-state
    // for 30 s so a reattach could restore it without an explicit
    // takeover. The new design clears the slot on disconnect
    // (see updateTerminalAttachmentConnection), so reattaching is
    // functionally the same as a fresh attach.
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]),
      controller: null,
      claimedByOwner: true,
    })
    const effect = attachTerminalAttachment(state, 'a1')
    expect(effect.emitOwnership).toBe(true)
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
  })

  test('requests resize when reattaching with new geometry', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 100, rows: 30, connected: true }]]),
      controller: null,
      claimedByOwner: true,
      cols: 80,
      rows: 24,
    })
    const effect = attachTerminalAttachment(state, 'a1')
    expect(effect.resizeTo).toEqual({ cols: 100, rows: 30 })
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
  })
})

describe('claimTerminalAttachmentControl', () => {
  test('claims control and emits ownership when size matches', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]) })
    const effect = claimTerminalAttachmentControl(state, 'a1')
    expect(effect.emitOwnership).toBe(true)
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
    expect(state.claimedByOwner).toBe(true)
  })

  test('claims control and requests resize when size differs', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 100, rows: 30, connected: true }]]) })
    const effect = claimTerminalAttachmentControl(state, 'a1')
    expect(effect.emitOwnership).toBe(false)
    expect(effect.resizeTo).toEqual({ cols: 100, rows: 30 })
  })

  test('rejects when not connected but preserves attachment record', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24, connected: false }]]) })
    const effect = claimTerminalAttachmentControl(state, 'a1')
    expect(effect.emitOwnership).toBe(false)
    expect(state.controller).toBeNull()
    expect(state.attachments.get('a1')).toEqual({ cols: 80, rows: 24, connected: false })
  })

  test('rejects when attachment is missing', () => {
    const state = createState()
    const effect = claimTerminalAttachmentControl(state, 'a1')
    expect(effect.emitOwnership).toBe(false)
  })
})

describe('restartTerminalAttachmentControl', () => {
  test('restores controller for matching connected attachment', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]) })
    restartTerminalAttachmentControl(state, 'a1')
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
    expect(state.claimedByOwner).toBe(true)
  })

  test('clears controller when attachmentId does not match', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]),
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    restartTerminalAttachmentControl(state, 'a2')
    expect(state.controller).toBeNull()
  })

  test('clears controller when attachment is disconnected', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: false }]]),
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    restartTerminalAttachmentControl(state, 'a1')
    expect(state.controller).toBeNull()
  })
})

describe('updateTerminalAttachmentConnection', () => {
  test('no-op when connected state unchanged and controller matches', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]),
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    const effect = updateTerminalAttachmentConnection(state, 'a1', true)
    expect(effect.emitOwnership).toBe(false)
  })

  test('clears the controller slot immediately on disconnect (no grace)', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]),
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    const effect = updateTerminalAttachmentConnection(state, 'a1', false)
    expect(effect.emitOwnership).toBe(true)
    expect(state.controller).toBeNull()
    expect(state.attachments.get('a1')?.connected).toBe(false)
  })

  test('reconnect of a freshly-disconnected controller restores the slot', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: false }]]),
      controller: null,
      claimedByOwner: true,
    })
    const effect = updateTerminalAttachmentConnection(state, 'a1', true)
    expect(effect.emitOwnership).toBe(true)
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
  })

  test('auto-claims when a viewer reconnects and the slot is empty', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: false }]]),
      controller: null,
      claimedByOwner: true,
    })
    const effect = updateTerminalAttachmentConnection(state, 'a1', true)
    expect(effect.emitOwnership).toBe(true)
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
  })

  test('does not auto-claim a viewer reconnect when the session has never been claimed', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: false }]]),
      controller: null,
      claimedByOwner: false,
    })
    const effect = updateTerminalAttachmentConnection(state, 'a1', true)
    expect(effect.emitOwnership).toBe(false)
    expect(state.controller).toBeNull()
  })

  test('preserves disconnected viewer attachment state', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]),
      controller: null,
      claimedByOwner: false,
    })
    const effect = updateTerminalAttachmentConnection(state, 'a1', false)
    expect(effect.emitOwnership).toBe(false)
    expect(state.attachments.get('a1')).toEqual({ cols: 80, rows: 24, connected: false })
  })

  test('ignores update for non-matching attachmentId', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]) })
    const effect = updateTerminalAttachmentConnection(state, 'a2', false)
    expect(effect.emitOwnership).toBe(false)
    expect(state.attachments.get('a1')?.connected).toBe(true)
  })

  test('disconnecting a viewer does not disturb a different controller', () => {
    const state = createState({
      attachments: new Map([
        ['a1', { cols: 80, rows: 24, connected: true }],
        ['a2', { cols: 100, rows: 30, connected: true }],
      ]),
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    const effect = updateTerminalAttachmentConnection(state, 'a2', false)
    expect(effect.emitOwnership).toBe(false)
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
    expect(state.attachments.get('a2')).toEqual({ cols: 100, rows: 30, connected: false })
  })

  test('disconnecting the controller hands the slot to a reconnecting sibling', () => {
    // Device-switch simulation: A controls; A disconnects; B
    // reconnects (or first connects) and becomes the new controller.
    const state = createState({
      attachments: new Map([
        ['a1', { cols: 80, rows: 24, connected: true }],
        ['a2', { cols: 100, rows: 30, connected: false }],
      ]),
      controller: { attachmentId: 'a1', status: 'connected' },
      claimedByOwner: true,
    })
    updateTerminalAttachmentConnection(state, 'a1', false)
    expect(state.controller).toBeNull()
    const effect = updateTerminalAttachmentConnection(state, 'a2', true)
    // B reports a different geometry, so the claim goes out as a
    // resize instead of a plain ownership emit.
    expect(effect.emitOwnership).toBe(false)
    expect(effect.resizeTo).toEqual({ cols: 100, rows: 30 })
    expect(state.controller).toEqual({ attachmentId: 'a2', status: 'connected' })
  })
})

describe('isAuthoritative', () => {
  test('allows the controller to write, resize, and restart', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]),
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    expect(isAuthoritative(state, 'a1', 'write')).toBe(true)
    expect(isAuthoritative(state, 'a1', 'resize')).toBe(true)
    expect(isAuthoritative(state, 'a1', 'restart')).toBe(true)
  })

  test('allows takeover for any registered attachment, even a non-controller', () => {
    const state = createState({
      attachments: new Map([
        ['a1', { cols: 80, rows: 24, connected: true }],
        ['a2', { cols: 80, rows: 24, connected: true }],
      ]),
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    expect(isAuthoritative(state, 'a2', 'takeover')).toBe(true)
  })

  test('denies write / resize / restart from a non-controller viewer', () => {
    const state = createState({
      attachments: new Map([
        ['a1', { cols: 80, rows: 24, connected: true }],
        ['a2', { cols: 80, rows: 24, connected: true }],
      ]),
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    expect(isAuthoritative(state, 'a2', 'write')).toBe(false)
    expect(isAuthoritative(state, 'a2', 'resize')).toBe(false)
    expect(isAuthoritative(state, 'a2', 'restart')).toBe(false)
  })

  test('denies write / resize / restart when the session is unowned', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]),
    })
    expect(isAuthoritative(state, 'a1', 'write')).toBe(false)
    expect(isAuthoritative(state, 'a1', 'resize')).toBe(false)
    expect(isAuthoritative(state, 'a1', 'restart')).toBe(false)
  })

  test('denies all actions for an unknown attachment', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]),
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    expect(isAuthoritative(state, 'a-unknown', 'write')).toBe(false)
    expect(isAuthoritative(state, 'a-unknown', 'resize')).toBe(false)
    expect(isAuthoritative(state, 'a-unknown', 'restart')).toBe(false)
    expect(isAuthoritative(state, 'a-unknown', 'takeover')).toBe(false)
  })
})

describe('explainAuthority', () => {
  test('returns null when the action is allowed', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]),
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    expect(explainAuthority(state, 'a1', 'write')).toBeNull()
  })

  test('returns the deny reason for diagnostic consumers', () => {
    const viewerState = createState({
      attachments: new Map([
        ['a1', { cols: 80, rows: 24, connected: true }],
        ['a2', { cols: 80, rows: 24, connected: true }],
      ]),
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    expect(explainAuthority(viewerState, 'a2', 'write')).toBe('not-controller')

    const unownedState = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]),
    })
    expect(explainAuthority(unownedState, 'a1', 'write')).toBe('session-unowned')

    const unknownState = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]),
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    expect(explainAuthority(unknownState, 'a-unknown', 'write')).toBe('unknown-attachment')
  })
})
