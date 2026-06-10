import { describe, expect, test } from 'vitest'
import type { TerminalOwnershipState } from '#/server/terminal/terminal-ownership.ts'
import {
  registerTerminalAttachment,
  attachTerminalAttachment,
  claimTerminalAttachmentControl,
  restartTerminalAttachmentControl,
  updateTerminalAttachmentConnection,
  releaseTerminalAttachmentControl,
} from '#/server/terminal/terminal-ownership.ts'

function createState(overrides?: Partial<TerminalOwnershipState>): TerminalOwnershipState {
  return {
    attachmentId: null,
    attachment: null,
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
    expect(state.attachmentId).toBe('a1')
    expect(state.attachment).toEqual({ cols: 100, rows: 30, connected: false })
  })

  test('preserves existing connected flag when omitted', () => {
    const state = createState({ attachment: { cols: 80, rows: 24, connected: true } })
    registerTerminalAttachment(state, 'a1', 100, 30)
    expect(state.attachment?.connected).toBe(true)
  })

  test('overrides existing connected flag when provided', () => {
    const state = createState({ attachment: { cols: 80, rows: 24, connected: true } })
    registerTerminalAttachment(state, 'a1', 100, 30, false)
    expect(state.attachment?.connected).toBe(false)
  })
})

describe('attachTerminalAttachment', () => {
  test('claims control when allowed, matching, and connected', () => {
    const state = createState({ attachmentId: 'a1', attachment: { cols: 80, rows: 24, connected: true } })
    const effect = attachTerminalAttachment(state, 'a1')
    expect(effect.emitOwnership).toBe(true)
    expect(effect.resizeTo).toBeUndefined()
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
    expect(state.allowImplicitAttachControl).toBe(false)
  })

  test('rejects when controller already exists', () => {
    const state = createState({
      attachmentId: 'a1',
      attachment: { cols: 80, rows: 24, connected: true },
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    const effect = attachTerminalAttachment(state, 'a1')
    expect(effect.emitOwnership).toBe(false)
  })

  test('rejects when implicit attach is disallowed', () => {
    const state = createState({
      attachmentId: 'a1',
      attachment: { cols: 80, rows: 24, connected: true },
      allowImplicitAttachControl: false,
    })
    const effect = attachTerminalAttachment(state, 'a1')
    expect(effect.emitOwnership).toBe(false)
  })

  test('rejects when attachmentId does not match', () => {
    const state = createState({ attachmentId: 'a1', attachment: { cols: 80, rows: 24, connected: true } })
    const effect = attachTerminalAttachment(state, 'a2')
    expect(effect.emitOwnership).toBe(false)
  })

  test('rejects when attachment is not connected', () => {
    const state = createState({ attachmentId: 'a1', attachment: { cols: 80, rows: 24, connected: false } })
    const effect = attachTerminalAttachment(state, 'a1')
    expect(effect.emitOwnership).toBe(false)
  })
})

describe('claimTerminalAttachmentControl', () => {
  test('claims control and emits ownership when size matches', () => {
    const state = createState({ attachmentId: 'a1', attachment: { cols: 80, rows: 24, connected: true } })
    const effect = claimTerminalAttachmentControl(state, 'a1')
    expect(effect.emitOwnership).toBe(true)
    expect(effect.resizeTo).toBeUndefined()
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
    expect(state.allowImplicitAttachControl).toBe(false)
  })

  test('claims control and requests resize when size differs', () => {
    const state = createState({ attachmentId: 'a1', attachment: { cols: 100, rows: 30, connected: true } })
    const effect = claimTerminalAttachmentControl(state, 'a1')
    expect(effect.emitOwnership).toBe(false)
    expect(effect.resizeTo).toEqual({ cols: 100, rows: 30 })
  })

  test('rejects when attachmentId does not match', () => {
    const state = createState({ attachmentId: 'a1', attachment: { cols: 80, rows: 24, connected: true } })
    const effect = claimTerminalAttachmentControl(state, 'a2')
    expect(effect.emitOwnership).toBe(false)
    expect(state.controller).toBeNull()
  })

  test('rejects and clears attachment when not connected', () => {
    const state = createState({ attachmentId: 'a1', attachment: { cols: 80, rows: 24, connected: false } })
    const effect = claimTerminalAttachmentControl(state, 'a1')
    expect(effect.emitOwnership).toBe(false)
    expect(state.controller).toBeNull()
    expect(state.attachment).toBeNull()
    expect(state.attachmentId).toBeNull()
  })

  test('rejects when attachment is missing', () => {
    const state = createState({ attachmentId: 'a1', attachment: null })
    const effect = claimTerminalAttachmentControl(state, 'a1')
    expect(effect.emitOwnership).toBe(false)
  })
})

describe('restartTerminalAttachmentControl', () => {
  test('restores controller for matching connected attachment', () => {
    const state = createState({ attachmentId: 'a1', attachment: { cols: 80, rows: 24, connected: true } })
    restartTerminalAttachmentControl(state, 'a1')
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
    expect(state.allowImplicitAttachControl).toBe(false)
  })

  test('clears controller when attachmentId does not match', () => {
    const state = createState({
      attachmentId: 'a1',
      attachment: { cols: 80, rows: 24, connected: true },
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    restartTerminalAttachmentControl(state, 'a2')
    expect(state.controller).toBeNull()
  })

  test('clears controller when attachment is disconnected', () => {
    const state = createState({
      attachmentId: 'a1',
      attachment: { cols: 80, rows: 24, connected: false },
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    restartTerminalAttachmentControl(state, 'a1')
    expect(state.controller).toBeNull()
  })
})

describe('updateTerminalAttachmentConnection', () => {
  test('no-op when connected state unchanged and controller matches', () => {
    const state = createState({
      attachmentId: 'a1',
      attachment: { cols: 80, rows: 24, connected: true },
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    const effect = updateTerminalAttachmentConnection(state, 'a1', true)
    expect(effect.emitOwnership).toBe(false)
  })

  test('transitions to grace when connected becomes false', () => {
    const state = createState({
      attachmentId: 'a1',
      attachment: { cols: 80, rows: 24, connected: true },
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    const effect = updateTerminalAttachmentConnection(state, 'a1', false)
    expect(effect.emitOwnership).toBe(true)
    expect(state.controller?.status).toBe('grace')
    expect(state.attachment?.connected).toBe(false)
  })

  test('auto-claims control on connect when no controller and implicit attach allowed', () => {
    const state = createState({
      attachmentId: 'a1',
      attachment: { cols: 80, rows: 24, connected: false },
      controller: null,
    })
    const effect = updateTerminalAttachmentConnection(state, 'a1', true)
    expect(effect.emitOwnership).toBe(true)
    expect(state.controller).toEqual({ attachmentId: 'a1', status: 'connected' })
  })

  test('does not auto-claim when implicit attach is disallowed', () => {
    const state = createState({
      attachmentId: 'a1',
      attachment: { cols: 80, rows: 24, connected: false },
      controller: null,
      allowImplicitAttachControl: false,
    })
    const effect = updateTerminalAttachmentConnection(state, 'a1', true)
    expect(effect.emitOwnership).toBe(false)
    expect(state.controller).toBeNull()
  })

  test('clears attachment on disconnect when not controller', () => {
    const state = createState({
      attachmentId: 'a1',
      attachment: { cols: 80, rows: 24, connected: true },
      controller: null,
      allowImplicitAttachControl: false,
    })
    const effect = updateTerminalAttachmentConnection(state, 'a1', false)
    expect(effect.emitOwnership).toBe(false)
    expect(state.attachment).toBeNull()
    expect(state.attachmentId).toBeNull()
  })

  test('ignores update for non-matching attachmentId', () => {
    const state = createState({ attachmentId: 'a1', attachment: { cols: 80, rows: 24, connected: true } })
    const effect = updateTerminalAttachmentConnection(state, 'a2', false)
    expect(effect.emitOwnership).toBe(false)
    expect(state.attachment?.connected).toBe(true)
  })
})

describe('releaseTerminalAttachmentControl', () => {
  test('releases control and clears state when disconnected', () => {
    const state = createState({
      attachmentId: 'a1',
      attachment: { cols: 80, rows: 24, connected: false },
      controller: { attachmentId: 'a1', status: 'grace' },
    })
    const released = releaseTerminalAttachmentControl(state, 'a1')
    expect(released).toBe(true)
    expect(state.controller).toBeNull()
    expect(state.attachment).toBeNull()
    expect(state.attachmentId).toBeNull()
    expect(state.allowImplicitAttachControl).toBe(false)
  })

  test('refuses to release when still connected', () => {
    const state = createState({
      attachmentId: 'a1',
      attachment: { cols: 80, rows: 24, connected: true },
      controller: { attachmentId: 'a1', status: 'connected' },
    })
    const released = releaseTerminalAttachmentControl(state, 'a1')
    expect(released).toBe(false)
    expect(state.controller).not.toBeNull()
  })

  test('refuses to release when attachmentId does not match controller', () => {
    const state = createState({
      attachmentId: 'a1',
      attachment: { cols: 80, rows: 24, connected: false },
      controller: { attachmentId: 'a2', status: 'grace' },
    })
    const released = releaseTerminalAttachmentControl(state, 'a1')
    expect(released).toBe(false)
  })
})
