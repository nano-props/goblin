// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  beginPrimaryWindowPresentation,
  resetPrimaryWindowPresentationForTest,
} from '#/web/primary-window-presentation.ts'
import {
  claimTerminalAutoFocus,
  fulfillTerminalPresentationFocus,
  resetTerminalAutoFocusForTest,
  terminalHasKeyboardFocus,
} from '#/web/terminal-focus.ts'
import type { TerminalFocusRequest } from '#/web/components/terminal/types.ts'

type RequiredTerminalFocusRequest = Required<TerminalFocusRequest>

beforeEach(() => {
  resetTerminalAutoFocusForTest()
  resetPrimaryWindowPresentationForTest()
})

afterEach(() => {
  resetTerminalAutoFocusForTest()
  resetPrimaryWindowPresentationForTest()
  document.body.replaceChildren()
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

  test('admits at most one automatic-focus intent for a presentation generation', () => {
    const token = beginPrimaryWindowPresentation()
    const firstLease = claimTerminalAutoFocus(token)

    expect(firstLease).not.toBeNull()
    expect(claimTerminalAutoFocus(token)).toBeNull()
    firstLease?.release()
  })

  test('does not move DOM focus while a mouse-created terminal is pending', () => {
    const createButton = document.createElement('button')
    document.body.appendChild(createButton)
    createButton.focus()
    const lease = claimTerminalAutoFocus(beginPrimaryWindowPresentation())
    if (!lease) throw new Error('expected terminal automatic-focus lease')
    const focusTerminal = acceptedFocus()

    lease.commit('term-created', focusTerminal)

    expect(document.activeElement).toBe(createButton)
    expect(terminalHasKeyboardFocus()).toBe(false)
    expect(focusTerminal.mock.calls[0]![1].isCurrent()).toBe(true)
    focusTerminal.mock.calls[0]![1].onSettled()
  })

  test('allows programmatic popover focus restoration before the terminal view mounts', () => {
    const createItem = document.createElement('button')
    const popoverTrigger = document.createElement('button')
    document.body.append(createItem, popoverTrigger)
    createItem.focus()
    const lease = claimTerminalAutoFocus(beginPrimaryWindowPresentation())
    if (!lease) throw new Error('expected terminal automatic-focus lease')
    const beforeMount = rejectedFocus()
    const afterMount = acceptedFocus()

    lease.commit('term-created', beforeMount)
    popoverTrigger.focus()
    fulfillTerminalPresentationFocus('term-created', afterMount)

    expect(beforeMount).toHaveBeenCalledOnce()
    expect(afterMount).toHaveBeenCalledOnce()
    expect(afterMount.mock.calls[0]![1].isCurrent()).toBe(true)
    afterMount.mock.calls[0]![1].onSettled()
  })

  test('does not intercept or retire a pending focus intent after a later key', async () => {
    const lease = claimTerminalAutoFocus(beginPrimaryWindowPresentation())
    if (!lease) throw new Error('expected terminal automatic-focus lease')
    const focusTerminal = acceptedFocus()
    lease.commit('term-created', focusTerminal)
    const request = focusTerminal.mock.calls[0]![1]
    await Promise.resolve()
    const input = new KeyboardEvent('keydown', {
      key: 'w',
      code: 'KeyW',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })

    document.body.dispatchEvent(input)

    expect(input.defaultPrevented).toBe(false)
    expect(request.isCurrent()).toBe(true)
    request.onSettled()
  })

  test('retires pending automatic focus after a later pointer action without consuming it', async () => {
    const lease = claimTerminalAutoFocus(beginPrimaryWindowPresentation())
    if (!lease) throw new Error('expected terminal automatic-focus lease')
    const focusTerminal = acceptedFocus()
    lease.commit('term-created', focusTerminal)
    const request = focusTerminal.mock.calls[0]![1]
    await Promise.resolve()
    const pointer = new PointerEvent('pointerdown', { bubbles: true, cancelable: true })

    document.body.dispatchEvent(pointer)

    expect(pointer.defaultPrevented).toBe(false)
    expect(request.isCurrent()).toBe(false)
    request.onSettled()
  })

  test('retries a committed target when its session materializes at the view boundary', () => {
    const lease = claimTerminalAutoFocus(beginPrimaryWindowPresentation())
    if (!lease) throw new Error('expected terminal automatic-focus lease')
    const beforeMaterialization = rejectedFocus()
    const afterMaterialization = acceptedFocus()

    lease.commit('term-created', beforeMaterialization)
    fulfillTerminalPresentationFocus('term-created', afterMaterialization)

    expect(beforeMaterialization).toHaveBeenCalledOnce()
    expect(afterMaterialization).toHaveBeenCalledOnce()
    const request = afterMaterialization.mock.calls[0]![1]
    expect(request.isCurrent()).toBe(true)
    request.onSettled()
  })

  test('releases the focus intent when a focus callback throws', () => {
    const lease = claimTerminalAutoFocus(beginPrimaryWindowPresentation())
    if (!lease) throw new Error('expected terminal automatic-focus lease')

    expect(() =>
      lease.commit('term-created', () => {
        throw new Error('focus failed')
      }),
    ).toThrow('focus failed')

    const remount = acceptedFocus()
    fulfillTerminalPresentationFocus('term-created', remount)
    expect(remount).not.toHaveBeenCalled()
  })

  test('does not duplicate focus when navigation commit already reached the session', () => {
    const lease = claimTerminalAutoFocus(beginPrimaryWindowPresentation())
    if (!lease) throw new Error('expected terminal automatic-focus lease')
    const focusTerminal = acceptedFocus()
    const mountedFocusTerminal = acceptedFocus()

    lease.commit('term-selected', focusTerminal)
    fulfillTerminalPresentationFocus('term-selected', mountedFocusTerminal)

    expect(focusTerminal).toHaveBeenCalledOnce()
    expect(mountedFocusTerminal).not.toHaveBeenCalled()
    focusTerminal.mock.calls[0]![1].onSettled()
  })

  test('prevents a superseded presentation from focusing its old terminal', () => {
    const firstLease = claimTerminalAutoFocus(beginPrimaryWindowPresentation())
    if (!firstLease) throw new Error('expected first terminal automatic-focus lease')
    const focusFirst = acceptedFocus()
    firstLease.commit('term-a', focusFirst)
    const firstRequest = focusFirst.mock.calls[0]![1]

    const secondLease = claimTerminalAutoFocus(beginPrimaryWindowPresentation())
    if (!secondLease) throw new Error('expected second terminal automatic-focus lease')
    const focusSecond = acceptedFocus()
    secondLease.commit('term-b', focusSecond)
    const secondRequest = focusSecond.mock.calls[0]![1]

    expect(firstRequest.isCurrent()).toBe(false)
    expect(secondRequest.isCurrent()).toBe(true)
    firstRequest.onSettled()
    secondRequest.onSettled()
  })

  test('reports terminal keyboard focus only from the active xterm DOM host', () => {
    const host = document.createElement('div')
    host.className = 'goblin-managed-terminal-host'
    const textarea = document.createElement('textarea')
    host.appendChild(textarea)
    document.body.appendChild(host)

    expect(terminalHasKeyboardFocus()).toBe(false)
    textarea.focus()
    expect(terminalHasKeyboardFocus()).toBe(true)
    textarea.blur()
    expect(terminalHasKeyboardFocus()).toBe(false)
  })
})

function acceptedFocus() {
  return vi.fn((_terminalSessionId: string, _request: RequiredTerminalFocusRequest) => true)
}

function rejectedFocus() {
  return vi.fn((_terminalSessionId: string, _request: RequiredTerminalFocusRequest) => false)
}
