// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { renderComposableInJsdom } from '#/test-utils/render.tsx'
import {
  getTerminalSessionProjection,
  setTerminalSessionProjectionForTests,
  type TerminalSessionProjection,
} from '#/web/terminal/components/TerminalSessionProjection.ts'
import { useTerminalSessionProjection } from '#/web/terminal/components/use-terminal-session-projection.ts'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'

let projectionForCleanup: TerminalSessionProjection | null = null

beforeEach(() => {
  setTerminalSessionProjectionForTests(null)
  resetWorkspacesStore()
})

afterEach(() => {
  projectionForCleanup?.destroy()
  projectionForCleanup = null
  setTerminalSessionProjectionForTests(null)
})

describe('useTerminalSessionProjection', () => {
  test('retains the client singleton across a component remount', async () => {
    const firstMount = renderComposableInJsdom(() => useTerminalSessionProjection())
    projectionForCleanup = firstMount.result.value

    expect(
      getTerminalSessionProjection({
        onSelectedFilesystemTargetChange: () => {},
      }),
    ).toBe(projectionForCleanup)

    firstMount.unmount()
    const secondMount = renderComposableInJsdom(() => useTerminalSessionProjection())

    expect(secondMount.result.value).toBe(projectionForCleanup)
    secondMount.unmount()
  })
})
