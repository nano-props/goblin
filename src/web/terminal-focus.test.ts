// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  beginPrimaryWindowPresentation,
  resetPrimaryWindowPresentationForTest,
} from '#/web/primary-window-presentation.ts'
import {
  claimTerminalInputFocus,
  fulfillTerminalPresentationFocus,
  observeTerminalInputKeyboardActivity,
  TERMINAL_INPUT_FOCUS_SINK_ID,
  terminalOwnsKeyboardInput,
} from '#/web/terminal-focus.ts'
import type { TerminalFocusRequest } from '#/web/components/terminal/types.ts'

type RequiredTerminalFocusRequest = Required<TerminalFocusRequest>

let stopObservingKeyboardActivity: (() => void) | null = null

beforeEach(() => {
  resetPrimaryWindowPresentationForTest()
  installTerminalFocusSink()
  stopObservingKeyboardActivity = observeTerminalInputKeyboardActivity()
})

afterEach(() => {
  stopObservingKeyboardActivity?.()
  stopObservingKeyboardActivity = null
  document.getElementById(TERMINAL_INPUT_FOCUS_SINK_ID)?.remove()
  resetPrimaryWindowPresentationForTest()
})

describe('terminal presentation focus', () => {
  test('focuses an initial terminal route once for its presentation generation', () => {
    const focusTerminal = acceptedFocus()

    fulfillTerminalPresentationFocus('term-initial', focusTerminal)
    fulfillTerminalPresentationFocus('term-initial', focusTerminal)

    expect(focusTerminal).toHaveBeenCalledOnce()
    expect(focusTerminal).toHaveBeenCalledWith(
      'term-initial',
      expect.objectContaining({ isCurrent: expect.any(Function), onSettled: expect.any(Function) }),
    )
    expect(focusTerminal.mock.calls[0]![1].isCurrent()).toBe(true)
  })

  test('does not recreate a settled focus intent during the same presentation', () => {
    const firstMount = acceptedFocus()
    const remount = acceptedFocus()

    fulfillTerminalPresentationFocus('term-initial', firstMount)
    firstMount.mock.calls[0]![1].onSettled()
    fulfillTerminalPresentationFocus('term-initial', remount)

    expect(firstMount).toHaveBeenCalledOnce()
    expect(remount).not.toHaveBeenCalled()
  })

  test('admits at most one raw lease for a presentation generation', () => {
    const token = beginPrimaryWindowPresentation()
    const firstLease = claimTerminalInputFocus(token)

    expect(firstLease).not.toBeNull()
    expect(claimTerminalInputFocus(token)).toBeNull()
    firstLease?.release()
  })

  test('defers automatic focus while inherited input is held and absorbs repeats until keyup', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }))
    const token = beginPrimaryWindowPresentation()
    const lease = claimTerminalInputFocus(token)
    if (!lease) throw new Error('expected terminal input focus lease')
    const focusTerminal = acceptedFocus()
    const sink = document.getElementById(TERMINAL_INPUT_FOCUS_SINK_ID)
    if (!(sink instanceof HTMLElement)) throw new Error('expected terminal input focus sink')

    lease.commit('term-created', focusTerminal)
    expect(focusTerminal).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(sink)
    expect(terminalOwnsKeyboardInput()).toBe(true)

    const repeat = new KeyboardEvent('keydown', {
      key: 'a',
      code: 'KeyA',
      repeat: true,
      bubbles: true,
      cancelable: true,
    })
    sink.dispatchEvent(repeat)
    expect(repeat.defaultPrevented).toBe(true)
    expect(focusTerminal).not.toHaveBeenCalled()

    sink.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', bubbles: true }))
    expect(focusTerminal).toHaveBeenCalledOnce()
    expect(focusTerminal.mock.calls[0]![1].isCurrent()).toBe(true)
    focusTerminal.mock.calls[0]![1].onSettled()
    expect(terminalOwnsKeyboardInput()).toBe(false)
  })

  test('retries automatic focus after input reaching a pending transition sink is released', () => {
    const token = beginPrimaryWindowPresentation()
    const lease = claimTerminalInputFocus(token)
    if (!lease) throw new Error('expected terminal input focus lease')
    const focusTerminal = acceptedFocus()
    lease.commit('term-created', focusTerminal)
    const sink = document.getElementById(TERMINAL_INPUT_FOCUS_SINK_ID)
    if (!(sink instanceof HTMLElement)) throw new Error('expected terminal input focus sink')

    const input = new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true })
    sink.dispatchEvent(input)

    expect(input.defaultPrevented).toBe(true)
    expect(focusTerminal).toHaveBeenCalledOnce()
    expect(focusTerminal.mock.calls[0]![1].isCurrent()).toBe(false)
    expect(terminalOwnsKeyboardInput()).toBe(true)

    focusTerminal.mock.calls[0]![1].onSettled()
    sink.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', bubbles: true }))

    expect(focusTerminal).toHaveBeenCalledTimes(2)
    expect(focusTerminal.mock.calls[1]![1].isCurrent()).toBe(true)
    focusTerminal.mock.calls[1]![1].onSettled()
    expect(terminalOwnsKeyboardInput()).toBe(false)
  })

  test('gates the initiating shortcut key before the document observer sees it', () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true, bubbles: true }),
    )
    const token = beginPrimaryWindowPresentation()
    const lease = claimTerminalInputFocus(token, { kind: 'keyboard', initiatingKey: 'KeyT' })
    if (!lease) throw new Error('expected terminal input focus lease')
    const focusTerminal = acceptedFocus()

    lease.commit('term-created', focusTerminal)
    expect(focusTerminal).not.toHaveBeenCalled()

    const sink = document.getElementById(TERMINAL_INPUT_FOCUS_SINK_ID)
    if (!(sink instanceof HTMLElement)) throw new Error('expected terminal input focus sink')
    sink.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', bubbles: true }))
    expect(focusTerminal).not.toHaveBeenCalled()
    sink.dispatchEvent(new KeyboardEvent('keyup', { key: 't', code: 'KeyT', bubbles: true }))

    expect(focusTerminal).toHaveBeenCalledOnce()
    expect(focusTerminal.mock.calls[0]![1].isCurrent()).toBe(true)
    focusTerminal.mock.calls[0]![1].onSettled()
  })

  test('absorbs a repeating navigation chord and focuses only after the chord is released', () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true, bubbles: true }),
    )
    const token = beginPrimaryWindowPresentation()
    const lease = claimTerminalInputFocus(token, { kind: 'keyboard', initiatingKey: 'KeyT' })
    if (!lease) throw new Error('expected terminal input focus lease')
    const focusTerminal = acceptedFocus()
    lease.commit('term-created', focusTerminal)
    const sink = document.getElementById(TERMINAL_INPUT_FOCUS_SINK_ID)
    if (!(sink instanceof HTMLElement)) throw new Error('expected terminal input focus sink')

    const repeat = new KeyboardEvent('keydown', {
      key: 't',
      code: 'KeyT',
      repeat: true,
      bubbles: true,
      cancelable: true,
    })
    sink.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', bubbles: true }))
    expect(focusTerminal).not.toHaveBeenCalled()
    sink.dispatchEvent(repeat)
    sink.dispatchEvent(new KeyboardEvent('keyup', { key: 't', code: 'KeyT', bubbles: true }))

    expect(repeat.defaultPrevented).toBe(true)
    expect(focusTerminal).toHaveBeenCalledOnce()
    expect(focusTerminal.mock.calls[0]![1].isCurrent()).toBe(true)
    focusTerminal.mock.calls[0]![1].onSettled()
    expect(terminalOwnsKeyboardInput()).toBe(false)
  })

  test('does not create mount-time focus after the user selected another control', () => {
    const userTarget = document.createElement('input')
    document.body.appendChild(userTarget)
    userTarget.focus()
    const focusTerminal = acceptedFocus()

    fulfillTerminalPresentationFocus('term-initial', focusTerminal)

    expect(focusTerminal).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(userTarget)
    userTarget.remove()
  })

  test('retries a committed target when its session materializes at the view boundary', () => {
    const token = beginPrimaryWindowPresentation()
    const lease = claimTerminalInputFocus(token)
    if (!lease) throw new Error('expected terminal input focus lease')
    const beforeMaterialization = rejectedFocus()
    const afterMaterialization = acceptedFocus()

    lease.commit('term-created', beforeMaterialization)
    expect(terminalOwnsKeyboardInput()).toBe(true)

    fulfillTerminalPresentationFocus('term-created', afterMaterialization)

    expect(beforeMaterialization).toHaveBeenCalledOnce()
    expect(afterMaterialization).toHaveBeenCalledOnce()
    const focusRequest = afterMaterialization.mock.calls[0]![1]
    expect(focusRequest.isCurrent()).toBe(true)
    focusRequest.onSettled()
    expect(terminalOwnsKeyboardInput()).toBe(false)
  })

  test('releases keyboard ownership when a focus callback throws', () => {
    const token = beginPrimaryWindowPresentation()
    const lease = claimTerminalInputFocus(token)
    if (!lease) throw new Error('expected terminal input focus lease')

    expect(() =>
      lease.commit('term-created', () => {
        throw new Error('focus failed')
      }),
    ).toThrow('focus failed')
    expect(terminalOwnsKeyboardInput()).toBe(false)
  })

  test('does not duplicate focus when navigation commit already reached the session', () => {
    const token = beginPrimaryWindowPresentation()
    const lease = claimTerminalInputFocus(token)
    if (!lease) throw new Error('expected terminal input focus lease')
    const focusTerminal = acceptedFocus()
    const mountedFocusTerminal = acceptedFocus()

    lease.commit('term-selected', focusTerminal)
    fulfillTerminalPresentationFocus('term-selected', mountedFocusTerminal)

    expect(focusTerminal).toHaveBeenCalledOnce()
    expect(mountedFocusTerminal).not.toHaveBeenCalled()
    focusTerminal.mock.calls[0]![1].onSettled()
    expect(terminalOwnsKeyboardInput()).toBe(false)
  })

  test('prevents a superseded presentation from focusing its old terminal', () => {
    const firstToken = beginPrimaryWindowPresentation()
    const firstLease = claimTerminalInputFocus(firstToken)
    if (!firstLease) throw new Error('expected first terminal input focus lease')
    const focusFirst = acceptedFocus()
    firstLease.commit('term-a', focusFirst)
    const firstRequest = focusFirst.mock.calls[0]![1]

    const secondToken = beginPrimaryWindowPresentation()
    const secondLease = claimTerminalInputFocus(secondToken)
    if (!secondLease) throw new Error('expected second terminal input focus lease')
    const focusSecond = acceptedFocus()
    secondLease.commit('term-b', focusSecond)
    const secondRequest = focusSecond.mock.calls[0]![1]

    expect(firstRequest.isCurrent()).toBe(false)
    expect(secondRequest.isCurrent()).toBe(true)
    firstRequest.onSettled()
    expect(terminalOwnsKeyboardInput()).toBe(true)
    secondRequest.onSettled()
    expect(terminalOwnsKeyboardInput()).toBe(false)
  })

  test('does not reclaim focus after the user leaves a pending terminal presentation', () => {
    const token = beginPrimaryWindowPresentation()
    const lease = claimTerminalInputFocus(token)
    if (!lease) throw new Error('expected terminal input focus lease')
    const focusTerminal = acceptedFocus()
    lease.commit('term-pending', focusTerminal)
    const request = focusTerminal.mock.calls[0]![1]
    const userTarget = document.createElement('input')
    document.body.appendChild(userTarget)

    userTarget.focus()

    expect(request.isCurrent()).toBe(false)
    request.onSettled()
    expect(document.activeElement).toBe(userTarget)
    expect(terminalOwnsKeyboardInput()).toBe(false)
    userTarget.remove()
  })
})

function installTerminalFocusSink(): void {
  const sink = document.createElement('div')
  sink.id = TERMINAL_INPUT_FOCUS_SINK_ID
  sink.tabIndex = -1
  document.body.appendChild(sink)
}

function acceptedFocus() {
  return vi.fn((_terminalSessionId: string, _request: RequiredTerminalFocusRequest) => true)
}

function rejectedFocus() {
  return vi.fn((_terminalSessionId: string, _request: RequiredTerminalFocusRequest) => false)
}
