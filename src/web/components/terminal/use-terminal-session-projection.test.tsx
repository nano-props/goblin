// @vitest-environment jsdom

import { StrictMode, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  getTerminalSessionProjection,
  setTerminalSessionProjectionForTests,
  type TerminalSessionProjection,
} from '#/web/components/terminal/TerminalSessionProjection.ts'
import { useTerminalSessionProjection } from '#/web/components/terminal/use-terminal-session-projection.ts'
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
  test('retains the client singleton across StrictMode and a component remount', () => {
    const firstMount = renderHook(() => useTerminalSessionProjection(), { wrapper: StrictModeHarness })
    projectionForCleanup = firstMount.result.current

    expect(
      getTerminalSessionProjection({
        onSelectedFilesystemTargetChange: () => {},
      }),
    ).toBe(projectionForCleanup)

    firstMount.unmount()
    const secondMount = renderHook(() => useTerminalSessionProjection(), { wrapper: StrictModeHarness })

    expect(secondMount.result.current).toBe(projectionForCleanup)
    secondMount.unmount()
  })
})

function StrictModeHarness({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>
}
