// @vitest-environment jsdom

import { defineComponent, ref } from 'vue'
import type { Ref, VNode } from 'vue'
import { describe, expect, test } from 'vitest'
import { flushTestUpdates, renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  EMPTY_TERMINAL_SNAPSHOT,
  TerminalSessionReadScope,
} from '#/web/components/terminal/terminal-session-context.ts'
import {
  useTerminalSessionSummaries,
  useTerminalSnapshot,
  useWorkspaceTerminalBellCounts,
  useTerminalFilesystemTargetBellCount,
  useTerminalFilesystemTargetCount,
  useTerminalFilesystemTargetCreatePending,
  useTerminalFilesystemTargetField,
  useTerminalFilesystemTargetOutputActive,
  useTerminalFilesystemTargetSelectedDescriptor,
} from '#/web/components/terminal/terminal-session-store.ts'
import { terminalDescriptorForTest } from '#/web/test-utils/terminal-model.ts'
import type {
  TerminalSessionReadContextValue,
  TerminalFilesystemTargetSnapshot,
} from '#/web/components/terminal/types.ts'

const WORKTREE_KEY = 'wt:1'
const SESSION_ID = 'session:1'
const WORKSPACE_ID = workspaceIdForTest('goblin+file:///example-workspace')

function makeReadContext(overrides: Partial<TerminalFilesystemTargetSnapshot> = {}): TerminalSessionReadContextValue {
  const snapshot: TerminalFilesystemTargetSnapshot = {
    terminalFilesystemTargetKey: WORKTREE_KEY,
    selectedDescriptor: null,
    sessions: [],
    count: 3,
    bellCount: 2,
    outputActiveCount: 1,
    createPending: false,
    ...overrides,
  }
  return {
    terminalFilesystemTargetSnapshot: (key) =>
      key === WORKTREE_KEY ? snapshot : { ...snapshot, terminalFilesystemTargetKey: key },
    subscribeTerminalFilesystemTarget: () => () => {},
    workspaceBellCount: () => 0,
    subscribeWorkspaceBellCount: () => () => {},
    workspaceTerminalSessions: () => [],
    subscribeWorkspaceTerminalSessions: () => () => {},
    snapshot: () => EMPTY_TERMINAL_SNAPSHOT,
    subscribeSnapshot: () => () => {},
  }
}

function withRead(value: TerminalSessionReadContextValue, child: VNode): VNode {
  return <TerminalSessionReadScope value={value}>{child}</TerminalSessionReadScope>
}

function renderValue<T>(
  context: TerminalSessionReadContextValue,
  composable: () => Ref<T>,
  format: (value: T) => string = String,
): HTMLElement {
  const Probe = defineComponent({
    name: 'TerminalStoreValueProbe',
    setup() {
      const value = composable()
      return () => <span data-testid="v">{format(value.value)}</span>
    },
  })
  const { container } = renderInJsdom(withRead(context, <Probe />))
  const value = container.querySelector<HTMLElement>('[data-testid="v"]')
  if (!value) throw new Error('terminal store value probe did not render')
  return value
}

function expectMissingReadProvider(composable: () => unknown): void {
  const Probe = defineComponent({
    name: 'MissingTerminalStoreProviderProbe',
    setup() {
      composable()
    },
    render: () => null,
  })
  expect(() => renderInJsdom(<Probe />)).toThrow('Terminal session read context is unavailable')
}

describe('terminal filesystem target projections', () => {
  test('reads count, pending, bell, output, descriptor, and sessions fields', async () => {
    const descriptor = terminalDescriptorForTest({
      terminalSessionId: SESSION_ID,
      index: 0,
      workspaceRuntimeId: 'rt:1',
      repoRoot: '/r',
      branch: 'main',
      worktreePath: '/r',
    })
    const sessions = [
      {
        type: 'terminal' as const,
        terminalFilesystemTargetKey: WORKTREE_KEY,
        terminalSessionId: 's1',
        index: 0,
        title: 't1',
        phase: 'opening' as const,
        selected: true,
        hasBell: false,
        hasRecentOutput: false,
      },
    ]
    const context = makeReadContext({
      count: 7,
      createPending: true,
      bellCount: 5,
      outputActiveCount: 2,
      selectedDescriptor: descriptor,
      sessions,
    })

    expect(renderValue(context, () => useTerminalFilesystemTargetCount(WORKTREE_KEY)).textContent).toBe('7')
    expect(renderValue(context, () => useTerminalFilesystemTargetCreatePending(WORKTREE_KEY)).textContent).toBe('true')
    expect(renderValue(context, () => useTerminalFilesystemTargetBellCount(WORKTREE_KEY)).textContent).toBe('5')
    expect(renderValue(context, () => useTerminalFilesystemTargetOutputActive(WORKTREE_KEY)).textContent).toBe('true')
    expect(
      renderValue(
        context,
        () => useTerminalFilesystemTargetSelectedDescriptor(WORKTREE_KEY),
        (value) => value?.terminalSessionId ?? 'none',
      ).textContent,
    ).toBe(SESSION_ID)
    expect(
      renderValue(
        context,
        () => useTerminalSessionSummaries(WORKTREE_KEY),
        (value) => String(value.length),
      ).textContent,
    ).toBe('1')
  })
})

describe('null targets', () => {
  test('derive safe empty values while retaining the provider boundary', async () => {
    const context = makeReadContext()
    expect(renderValue(context, () => useTerminalFilesystemTargetCount(null)).textContent).toBe('0')
    expect(renderValue(context, () => useTerminalFilesystemTargetCreatePending(null)).textContent).toBe('false')
    expect(renderValue(context, () => useTerminalFilesystemTargetOutputActive(null)).textContent).toBe('false')
    expect(renderValue(context, () => useTerminalFilesystemTargetBellCount(null)).textContent).toBe('0')
    expect(
      renderValue(
        context,
        () => useTerminalSnapshot(null),
        (value) => value.phase,
      ).textContent,
    ).toBe(EMPTY_TERMINAL_SNAPSHOT.phase)
  })

  test('still requires the read provider for every target shape', async () => {
    expectMissingReadProvider(() => useTerminalFilesystemTargetCount(null))
    expectMissingReadProvider(() => useTerminalSnapshot(null))
    expectMissingReadProvider(() => useWorkspaceTerminalBellCounts([]))
    expectMissingReadProvider(() => useTerminalFilesystemTargetCount(WORKTREE_KEY))
    expectMissingReadProvider(() => useTerminalSnapshot(SESSION_ID))
    expectMissingReadProvider(() => useWorkspaceTerminalBellCounts([WORKSPACE_ID]))
  })
})

describe('useTerminalFilesystemTargetField selector reactivity', () => {
  test('tracks reactive values captured by the selector', async () => {
    const Parent = defineComponent({
      name: 'ReactiveTerminalSelectorProbe',
      setup() {
        const multiplier = ref(1)
        const value = useTerminalFilesystemTargetField(WORKTREE_KEY, (snapshot) => snapshot.count * multiplier.value)
        return () => (
          <>
            <button
              data-testid="bump"
              onClick={() => {
                multiplier.value += 1
              }}
            />
            <span data-testid="v">{value.value}</span>
          </>
        )
      },
    })
    const { getByTestId } = renderInJsdom(withRead(makeReadContext({ count: 3 }), <Parent />))
    expect(getByTestId('v').textContent).toBe('3')

    await flushTestUpdates(() => getByTestId('bump').click())
    expect(getByTestId('v').textContent).toBe('6')
    await flushTestUpdates(() => getByTestId('bump').click())
    expect(getByTestId('v').textContent).toBe('9')
  })

  test('keeps a stable projection across unrelated rerenders', async () => {
    const Parent = defineComponent({
      name: 'StableTerminalSelectorProbe',
      setup() {
        const tick = ref(0)
        const value = useTerminalFilesystemTargetField(
          WORKTREE_KEY,
          (snapshot) => snapshot.count + tick.value - tick.value,
        )
        return () => (
          <>
            <button
              data-testid="bump"
              onClick={() => {
                tick.value += 1
              }}
            />
            <span data-testid="v">{value.value}</span>
          </>
        )
      },
    })
    const { getByTestId } = renderInJsdom(withRead(makeReadContext({ count: 9 }), <Parent />))
    expect(getByTestId('v').textContent).toBe('9')
    await flushTestUpdates(() => getByTestId('bump').click())
    expect(getByTestId('v').textContent).toBe('9')
  })
})
