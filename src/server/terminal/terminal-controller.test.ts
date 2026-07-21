import { describe, expect, test } from 'vitest'
import type { TerminalControllerState } from '#/server/terminal/terminal-controller.ts'
import {
  attachTerminalClient,
  claimTerminalClientControl,
  effectiveTerminalController,
  expireTerminalClient,
  explainAuthority,
  isAuthoritative,
  registerTerminalClient,
  restartTerminalClientControl,
  terminalIdentityChanged,
} from '#/server/terminal/terminal-controller.ts'

const online = () => true
const offline = () => false
const onlineExcept = (offlineClientId: string) => (clientId: string) => clientId !== offlineClientId

function createState(overrides?: Partial<TerminalControllerState>): TerminalControllerState {
  return {
    attachments: new Map(),
    controllerClientId: null,
    userSticky: false,
    cols: 80,
    rows: 24,
    ...overrides,
  }
}

describe('registerTerminalClient', () => {
  test('stores attachment metadata without copying online state', () => {
    const state = createState()
    registerTerminalClient(state, 'a1', 100, 30)
    expect(state.attachments.get('a1')).toEqual({ cols: 100, rows: 30 })
  })

  test('keeps multiple attachments instead of replacing the previous one', () => {
    const state = createState()
    registerTerminalClient(state, 'a1', 80, 24)
    registerTerminalClient(state, 'a2', 100, 30)
    expect(state.attachments.get('a1')).toEqual({ cols: 80, rows: 24 })
    expect(state.attachments.get('a2')).toEqual({ cols: 100, rows: 30 })
  })
})

describe('expireTerminalClient', () => {
  test('removes only the expired page attachment and its controller intent', () => {
    const state = createState({
      attachments: new Map([
        ['expired', { cols: 80, rows: 24 }],
        ['current', { cols: 100, rows: 30 }],
      ]),
      controllerClientId: 'expired',
      userSticky: true,
    })

    expect(expireTerminalClient(state, 'expired')).toBe(true)
    expect(state.attachments).toEqual(new Map([['current', { cols: 100, rows: 30 }]]))
    expect(state.controllerClientId).toBeNull()
    expect(state.userSticky).toBe(true)
  })
})

describe('effectiveTerminalController', () => {
  test('projects controller intent only when the controller client is online', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24 }]]),
      controllerClientId: 'a1',
    })
    expect(effectiveTerminalController(state, online)).toEqual({ clientId: 'a1', status: 'connected' })
    expect(effectiveTerminalController(state, offline)).toBeNull()
  })

  test('does not clear controller intent when presence is offline', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24 }]]),
      controllerClientId: 'a1',
    })
    expect(effectiveTerminalController(state, offline)).toBeNull()
    expect(state.controllerClientId).toBe('a1')
  })
})

describe('attachTerminalClient', () => {
  test('first online attach auto-claims and sets userSticky', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24 }]]) })
    const effect = attachTerminalClient(state, 'a1', online)
    expect(effect.emitIdentity).toBe(true)
    expect(state.controllerClientId).toBe('a1')
    expect(state.userSticky).toBe(true)
  })

  test('rejects when attachment is offline according to presence', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24 }]]) })
    const effect = attachTerminalClient(state, 'a1', offline)
    expect(effect.emitIdentity).toBe(false)
    expect(state.controllerClientId).toBeNull()
  })

  test('online sibling auto-claims when current controller is not effective', () => {
    const state = createState({
      attachments: new Map([
        ['a1', { cols: 80, rows: 24 }],
        ['a2', { cols: 100, rows: 30 }],
      ]),
      controllerClientId: 'a1',
      userSticky: true,
    })
    const effect = attachTerminalClient(state, 'a2', onlineExcept('a1'))
    expect(effect.emitIdentity).toBe(false)
    expect(effect.resizeTo).toEqual({ cols: 100, rows: 30 })
    expect(state.controllerClientId).toBe('a2')
  })

  test('does not preempt an effective different controller', () => {
    const state = createState({
      attachments: new Map([
        ['a1', { cols: 80, rows: 24 }],
        ['a2', { cols: 100, rows: 30 }],
      ]),
      controllerClientId: 'a1',
      userSticky: true,
    })
    const effect = attachTerminalClient(state, 'a2', online)
    expect(effect.emitIdentity).toBe(false)
    expect(state.controllerClientId).toBe('a1')
  })
})

describe('claimTerminalClientControl', () => {
  test('claims control and emits identity when size matches', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24 }]]) })
    const effect = claimTerminalClientControl(state, 'a1', online)
    expect(effect.emitIdentity).toBe(true)
    expect(state.controllerClientId).toBe('a1')
    expect(state.userSticky).toBe(true)
  })

  test('rejects when presence says the attachment is offline', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24 }]]) })
    const effect = claimTerminalClientControl(state, 'a1', offline)
    expect(effect.emitIdentity).toBe(false)
    expect(state.controllerClientId).toBeNull()
  })
})

describe('restartTerminalClientControl', () => {
  test('restores controller for matching online attachment', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24 }]]) })
    restartTerminalClientControl(state, 'a1', online)
    expect(state.controllerClientId).toBe('a1')
    expect(state.userSticky).toBe(true)
  })

  test('clears controller intent when attachment is not online', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24 }]]),
      controllerClientId: 'a1',
    })
    restartTerminalClientControl(state, 'a1', offline)
    expect(state.controllerClientId).toBeNull()
  })
})

describe('terminalIdentityChanged', () => {
  test('detects effective controller changes across presence transitions', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24 }]]),
      controllerClientId: 'a1',
    })
    expect(terminalIdentityChanged(state, null, online)).toBe(true)
    expect(terminalIdentityChanged(state, { clientId: 'a1', status: 'connected' }, online)).toBe(false)
    expect(terminalIdentityChanged(state, { clientId: 'a1', status: 'connected' }, offline)).toBe(true)
  })
})

describe('isAuthoritative', () => {
  test('allows the effective controller to write, resize, and restart', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24 }]]),
      controllerClientId: 'a1',
    })
    expect(isAuthoritative(state, 'a1', 'write', online)).toBe(true)
    expect(isAuthoritative(state, 'a1', 'resize', online)).toBe(true)
    expect(isAuthoritative(state, 'a1', 'restart', online)).toBe(true)
  })

  test('denies write when controller intent is offline', () => {
    const state = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24 }]]),
      controllerClientId: 'a1',
    })
    expect(isAuthoritative(state, 'a1', 'write', offline)).toBe(false)
  })

  test('allows takeover for any registered attachment', () => {
    const state = createState({ attachments: new Map([['a1', { cols: 80, rows: 24 }]]) })
    expect(isAuthoritative(state, 'a1', 'takeover', offline)).toBe(true)
  })
})

describe('explainAuthority', () => {
  test('returns deny reasons for diagnostic consumers', () => {
    const viewerState = createState({
      attachments: new Map([
        ['a1', { cols: 80, rows: 24 }],
        ['a2', { cols: 80, rows: 24 }],
      ]),
      controllerClientId: 'a1',
    })
    expect(explainAuthority(viewerState, 'a2', 'write', online)).toBe('not-controller')

    const unownedState = createState({ attachments: new Map([['a1', { cols: 80, rows: 24 }]]) })
    expect(explainAuthority(unownedState, 'a1', 'write', online)).toBe('session-unowned')

    const unknownState = createState({
      attachments: new Map([['a1', { cols: 80, rows: 24 }]]),
      controllerClientId: 'a1',
    })
    expect(explainAuthority(unknownState, 'a-unknown', 'write', online)).toBe('unknown-client')
  })
})
