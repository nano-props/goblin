import { describe, expect, test } from 'vitest'
import type { TerminalOwnershipState } from '#/server/terminal/terminal-ownership.ts'
import {
  registerTerminalAttachment,
  attachTerminalAttachment,
  claimTerminalAttachmentControl,
  expireTerminalAttachment,
  restartTerminalAttachmentControl,
  updateTerminalAttachmentConnection,
  releaseTerminalAttachmentControl,
  isAuthoritative,
  explainAuthority,
} from '#/server/terminal/terminal-ownership.ts'

function createState(overrides?: Partial<TerminalOwnershipState>): TerminalOwnershipState {
  return {
    attachments: new Map(),
    controller: null,
    allowImplicitAttachControl: true,
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

describe('attachTerminalAttachment', () => {
  test('claims control when allowed, matching, and connected', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]) })
    const effect = attachTerminalAttachment(state, 'a1')
    expect(effect.emitOwnership).toBe(true)
    expect(effect.resizeTo).toBeUndefined()
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
    expect(state.allowImplicitAttachControl).toBe(false)
  })

  test('rejects when controller already exists', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]),
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    const effect = attachTerminalAttachment(state, 'a1')
    expect(effect.emitOwnership).toBe(false)
  })

  test('rejects when implicit attach is disallowed', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]),
      allowImplicitAttachControl: false,
    })
    const effect = attachTerminalAttachment(state, 'a1')
    expect(effect.emitOwnership).toBe(false)
  })

  test('rejects when attachmentId does not match', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]) })
    const effect = attachTerminalAttachment(state, 'a2')
    expect(effect.emitOwnership).toBe(false)
  })

  test('rejects when attachment is not connected', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24, connected: false }]]) })
    const effect = attachTerminalAttachment(state, 'a1')
    expect(effect.emitOwnership).toBe(false)
  })

  test('restores a grace controller to connected on attach', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]),
      controller: { attachmentId: 'a1', status: 'grace' },
      allowImplicitAttachControl: false,
    })
    const effect = attachTerminalAttachment(state, 'a1')
    expect(effect.emitOwnership).toBe(true)
    expect(effect.resizeTo).toBeUndefined()
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
  })

  test('requests resize when reconnecting controller reports a new geometry', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 100, rows: 30, connected: true }]]),
      controller: { attachmentId: 'a1', status: 'grace' },
      allowImplicitAttachControl: false,
      cols: 80,
      rows: 24,
    })
    const effect = attachTerminalAttachment(state, 'a1')
    expect(effect.emitOwnership).toBe(false)
    expect(effect.resizeTo).toEqual({ cols: 100, rows: 30 })
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
  })
})

describe('claimTerminalAttachmentControl', () => {
  test('claims control and emits ownership when size matches', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]) })
    const effect = claimTerminalAttachmentControl(state, 'a1')
    expect(effect.emitOwnership).toBe(true)
    expect(effect.resizeTo).toBeUndefined()
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
    expect(state.allowImplicitAttachControl).toBe(false)
  })

  test('claims control and requests resize when size differs', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 100, rows: 30, connected: true }]]) })
    const effect = claimTerminalAttachmentControl(state, 'a1')
    expect(effect.emitOwnership).toBe(false)
    expect(effect.resizeTo).toEqual({ cols: 100, rows: 30 })
  })

  test('rejects when attachmentId does not match', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]) })
    const effect = claimTerminalAttachmentControl(state, 'a2')
    expect(effect.emitOwnership).toBe(false)
    expect(state.controller).toBeNull()
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
    expect(state.allowImplicitAttachControl).toBe(false)
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

  test('transitions to grace when connected becomes false', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]),
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    const effect = updateTerminalAttachmentConnection(state, 'a1', false)
    expect(effect.emitOwnership).toBe(true)
    expect(state.controller?.status).toBe('grace')
    expect(state.attachments.get('a1')?.connected).toBe(false)
  })

  test('auto-claims control on connect when no controller and implicit attach allowed', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: false }]]),
      controller: null,
    })
    const effect = updateTerminalAttachmentConnection(state, 'a1', true)
    expect(effect.emitOwnership).toBe(true)
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
  })

  test('does not auto-claim when implicit attach is disallowed', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: false }]]),
      controller: null,
      allowImplicitAttachControl: false,
    })
    const effect = updateTerminalAttachmentConnection(state, 'a1', true)
    expect(effect.emitOwnership).toBe(false)
    expect(state.controller).toBeNull()
  })

  test('preserves disconnected viewer attachment state', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]),
      controller: null,
      allowImplicitAttachControl: false,
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
})

describe('releaseTerminalAttachmentControl', () => {
  test('releases control and clears state when disconnected', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: false }]]),
      controller: { attachmentId: 'a1', status: 'grace' },
    })
    const released = releaseTerminalAttachmentControl(state, 'a1')
    expect(released).toBe(true)
    expect(state.controller).toBeNull()
    expect(state.attachments.has('a1')).toBe(false)
    expect(state.allowImplicitAttachControl).toBe(false)
  })

  test('refuses to release when still connected', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]),
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    const released = releaseTerminalAttachmentControl(state, 'a1')
    expect(released).toBe(false)
    expect(state.controller).not.toBeNull()
  })

  test('refuses to release when attachmentId does not match controller', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: false }]]),
      controller: { attachmentId: 'a2', status: 'grace' },
    })
    const released = releaseTerminalAttachmentControl(state, 'a1')
    expect(released).toBe(false)
  })
})

describe('expireTerminalAttachment', () => {
  test('removes a disconnected viewer attachment without emitting ownership', () => {
    const state = createState({
      attachments: new Map([
        ['a1', { cols: 80, rows: 24, connected: true }],
        ['a2', { cols: 100, rows: 30, connected: false }],
      ]),
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    const effect = expireTerminalAttachment(state, 'a2')
    expect(effect).toEqual({ emitOwnership: false, removed: true })
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
    expect(state.attachments.has('a2')).toBe(false)
  })

  test('removes a disconnected grace controller and emits ownership', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: false }]]),
      controller: { attachmentId: 'a1', status: 'grace' },
      allowImplicitAttachControl: false,
    })
    const effect = expireTerminalAttachment(state, 'a1')
    expect(effect).toEqual({ emitOwnership: true, removed: true })
    expect(state.controller).toBeNull()
    expect(state.attachments.has('a1')).toBe(false)
    expect(state.allowImplicitAttachControl).toBe(false)
  })

  test('does not remove a connected attachment', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24, connected: true }]]),
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    const effect = expireTerminalAttachment(state, 'a1')
    expect(effect).toEqual({ emitOwnership: false, removed: false })
    expect(state.attachments.has('a1')).toBe(true)
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
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
