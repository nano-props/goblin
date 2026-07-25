import { describe, expect, test } from 'vitest'
import {
  claimTerminalClientControl,
  commitTerminalClientAttachment,
  decideTerminalClientAttachment,
  effectiveTerminalController,
  expireTerminalClient,
  explainAuthority,
  isAuthoritative,
  prepareTerminalClientAdmission,
  terminalIdentityChanged,
  type TerminalControllerState,
} from '#/server/terminal/terminal-controller.ts'

const online = () => true
const offline = () => false
const onlineExcept = (offlineClientId: string) => (clientId: string) => clientId !== offlineClientId

function createState(overrides: Partial<TerminalControllerState> = {}): TerminalControllerState {
  return { attachments: new Set(), controllerClientId: null, ...overrides }
}

describe('terminal client admission', () => {
  test('publishes membership and controller intent only on commit', () => {
    const state = createState()
    const admission = prepareTerminalClientAdmission(state, 'fresh', 'controller', online, () => true)

    expect(state).toEqual({ attachments: new Set(), controllerClientId: null })
    admission.commit()
    expect(state).toEqual({ attachments: new Set(['fresh']), controllerClientId: 'fresh' })
  })

  test('rejects an offline or stale admission without retaining membership', () => {
    const offlineState = createState()
    const offlineAdmission = prepareTerminalClientAdmission(offlineState, 'offline', 'controller', offline, () => true)
    expect(() => offlineAdmission.commit()).toThrow('error.unavailable')
    expect(offlineState.attachments).toEqual(new Set())

    const staleState = createState()
    const staleAdmission = prepareTerminalClientAdmission(staleState, 'stale', 'controller', online, () => false)
    expect(() => staleAdmission.commit()).toThrow('error.unavailable')
    expect(staleState.attachments).toEqual(new Set())
  })

  test('restores complete previous membership and controller intent on rollback', () => {
    const state = createState({ attachments: new Set(['existing']), controllerClientId: 'existing' })
    const admission = prepareTerminalClientAdmission(state, 'fresh', 'controller', online, () => true)

    admission.commit()
    admission.rollback()

    expect(state).toEqual({ attachments: new Set(['existing']), controllerClientId: 'existing' })
  })
})

describe('terminal membership and authority', () => {
  test('first online attachment controls while a sibling remains viewer', () => {
    const state = createState()
    const first = decideTerminalClientAttachment(state, 'a1', online)
    if (first !== 'unavailable') commitTerminalClientAttachment(state, 'a1', first)
    const second = decideTerminalClientAttachment(state, 'a2', online)
    if (second !== 'unavailable') commitTerminalClientAttachment(state, 'a2', second)

    expect(first).toBe('controller')
    expect(second).toBe('viewer')
    expect(state).toEqual({ attachments: new Set(['a1', 'a2']), controllerClientId: 'a1' })
  })

  test('an online attachment claims when prior controller intent is offline', () => {
    const state = createState({ attachments: new Set(['a1']), controllerClientId: 'a1' })
    const decision = decideTerminalClientAttachment(state, 'a2', onlineExcept('a1'))
    if (decision !== 'unavailable') commitTerminalClientAttachment(state, 'a2', decision)
    expect(decision).toBe('controller')
    expect(state.controllerClientId).toBe('a2')
  })

  test('explicit takeover atomically admits an online page and claims control', () => {
    const state = createState({ attachments: new Set(['a1', 'a2']), controllerClientId: 'a1' })
    expect(claimTerminalClientControl(state, 'a2', online)).toBe(true)
    expect(claimTerminalClientControl(state, 'fresh', online)).toBe(true)
    expect(claimTerminalClientControl(state, 'a1', offline)).toBe(false)
    expect(state).toEqual({ attachments: new Set(['a1', 'a2', 'fresh']), controllerClientId: 'fresh' })
  })

  test('expiry removes only the page membership and controller intent it owns', () => {
    const state = createState({ attachments: new Set(['expired', 'current']), controllerClientId: 'expired' })
    expect(expireTerminalClient(state, 'expired')).toBe(true)
    expect(state).toEqual({ attachments: new Set(['current']), controllerClientId: null })
  })

  test('derives effective controller from membership and live presence', () => {
    const state = createState({ attachments: new Set(['a1']), controllerClientId: 'a1' })
    expect(effectiveTerminalController(state, online)).toEqual({ clientId: 'a1', status: 'connected' })
    expect(effectiveTerminalController(state, offline)).toBeNull()
    expect(terminalIdentityChanged(state, { clientId: 'a1', status: 'connected' }, offline)).toBe(true)
  })

  test('allows only the effective controller to mutate a binding', () => {
    const state = createState({ attachments: new Set(['a1', 'a2']), controllerClientId: 'a1' })
    expect(isAuthoritative(state, 'a1', online)).toBe(true)
    expect(explainAuthority(state, 'a2', online)).toBe('not-controller')
    expect(explainAuthority(createState({ attachments: new Set(['a1']) }), 'a1', online)).toBe('session-unowned')
    expect(explainAuthority(state, 'missing', online)).toBe('unknown-client')
  })
})
