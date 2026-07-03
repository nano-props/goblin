// @vitest-environment jsdom
import { useCallback, useState, type ComponentProps } from 'react'
import { act, type RenderResult } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderInJsdom } from '#/test-utils/render.tsx'
import type { Key } from 'react-aria-components'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FiletreeNoWorktreeView, FiletreeView } from '#/web/components/repo-workspace/FiletreeView.tsx'
import type { RepoTreeNode, RepoTreeResult } from '#/shared/api-types.ts'

vi.mock('#/web/stores/i18n.ts', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => {
    if (!params) return key
    let out = key
    for (const [k, v] of Object.entries(params)) {
      out = out.replace(`{${k}}`, String(v))
    }
    return out
  },
}))

let compactUi = false
vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => compactUi,
}))

let container: HTMLElement | null = null
let renderResult: RenderResult | null = null

type FiletreeViewHarnessProps = Omit<
  ComponentProps<typeof FiletreeView>,
  | 'selectedKeys'
  | 'expandedKeys'
  | 'onSelectedKeysChange'
  | 'onDirectoryRowToggle'
  | 'onPruneKeys'
  | 'initialTopVisibleRowIndex'
  | 'scrollRestoreKey'
  | 'scrollRestoreReady'
  | 'onTopVisibleRowIndexChange'
> & {
  readonly initialTopVisibleRowIndex?: number
  readonly scrollRestoreKey?: string
  readonly scrollRestoreReady?: boolean
  readonly onTopVisibleRowIndexChange?: (topVisibleRowIndex: number) => void
}

function fileNode(id: string, parentId: string | null = null, status: RepoTreeNode['status'] = 'clean'): RepoTreeNode {
  const name = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  return { id, path: id, name, parentId, kind: 'file', status }
}

function dirNode(id: string, parentId: string | null = null): RepoTreeNode {
  const name = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  return { id, path: id, name, parentId, kind: 'directory', status: 'clean' }
}

function FiletreeViewHarness({
  initialTopVisibleRowIndex = 0,
  scrollRestoreKey = 'test-worktree',
  scrollRestoreReady = true,
  onTopVisibleRowIndexChange = () => {},
  ...props
}: FiletreeViewHarnessProps) {
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<Key>>(new Set())
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<Key>>(new Set())
  const pruneKeys = useCallback((validKeys: ReadonlySet<string>) => {
    setSelectedKeys((current) => filterValidKeys(current, validKeys))
    setExpandedKeys((current) => filterValidKeys(current, validKeys))
  }, [])
  const toggleDirectoryRow = useCallback((key: string, expanded: boolean) => {
    setExpandedKeys((current) => {
      const next = new Set(current)
      if (expanded) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  return (
    <FiletreeView
      {...props}
      selectedKeys={selectedKeys}
      expandedKeys={expandedKeys}
      onSelectedKeysChange={setSelectedKeys}
      onDirectoryRowToggle={toggleDirectoryRow}
      onPruneKeys={pruneKeys}
      initialTopVisibleRowIndex={initialTopVisibleRowIndex}
      scrollRestoreKey={scrollRestoreKey}
      scrollRestoreReady={scrollRestoreReady}
      onTopVisibleRowIndexChange={onTopVisibleRowIndexChange}
    />
  )
}

function filterValidKeys(keys: ReadonlySet<Key>, validKeys: ReadonlySet<string>): ReadonlySet<Key> {
  let changed = false
  const next = new Set<Key>()
  for (const key of keys) {
    if (typeof key === 'string' && validKeys.has(key)) {
      next.add(key)
    } else {
      changed = true
    }
  }
  return changed ? next : keys
}

function renderView(props: FiletreeViewHarnessProps) {
  renderResult = renderInJsdom(<FiletreeViewHarness {...props} />)
  container = renderResult.container
}

function rerenderView(props: FiletreeViewHarnessProps) {
  renderResult?.rerender(<FiletreeViewHarness {...props} />)
}

beforeEach(() => {
  compactUi = false
  const win = window as typeof window & { PointerEvent?: typeof PointerEvent }
  win.PointerEvent ??= MouseEvent as unknown as typeof PointerEvent
  globalThis.PointerEvent ??= win.PointerEvent
  globalThis.CSS ??= { escape: (value: string) => value.replace(/["\\]/g, '\\$&') } as typeof CSS
  globalThis.requestAnimationFrame ??= (callback: FrameRequestCallback) => window.setTimeout(callback, 0)
  globalThis.cancelAnimationFrame ??= (id: number) => window.clearTimeout(id)
})

afterEach(() => {
  renderResult = null
  container = null
})

function row(name: string): HTMLElement {
  const element = rows().find((candidate) => candidate.getAttribute('aria-label') === name)
  if (!element) throw new Error(`no row for ${name}`)
  return element
}

function rows(): HTMLElement[] {
  return Array.from(container?.querySelectorAll<HTMLElement>('[role="treeitem"][aria-label]') ?? [])
}

function rowNames(): Array<string | null> {
  return rows().map((element) => element.getAttribute('aria-label'))
}

function tree(): HTMLElement {
  const element = container?.querySelector<HTMLElement>('[role="tree"]')
  if (!element) throw new Error('no tree')
  return element
}

function scrollViewport(): HTMLDivElement {
  const element = container?.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]')
  if (!element) throw new Error('no scroll viewport')
  return element
}

function buildTree(): RepoTreeResult {
  return {
    nodes: [
      dirNode('src'),
      dirNode('src/util', 'src'),
      fileNode('src/index.ts', 'src'),
      fileNode('src/util/helper.ts', 'src/util'),
      fileNode('README.md'),
    ],
    truncated: false,
  }
}

describe('FiletreeView', () => {
  test('renders the empty state when the tree has no nodes', () => {
    const tree: RepoTreeResult = { nodes: [], truncated: false }
    renderView({ tree, loading: false, error: null })
    expect(container?.querySelector('[data-filetree=""]')).not.toBeNull()
    expect(container?.querySelectorAll('[role="treeitem"]').length).toBe(0)
    expect(container?.textContent).toMatch(/filetree\.empty/)
  })

  test('renders the no-worktree placeholder via the dedicated helper', () => {
    renderResult = renderInJsdom(<FiletreeNoWorktreeView />)
    container = renderResult.container
    expect(container.textContent).toMatch(/filetree\.no-worktree/)
  })

  test('renders error state when error is set', () => {
    const tree: RepoTreeResult = { nodes: [], truncated: false }
    renderView({ tree, loading: false, error: 'boom' })
    expect(container?.textContent).toMatch(/filetree\.error/)
  })

  test('renders a virtualized tree labelled by i18n', () => {
    renderView({
      tree: { nodes: [fileNode('README.md')], truncated: false },
      loading: false,
      error: null,
    })
    expect(tree().getAttribute('aria-label')).toBe('filetree.aria-label')
  })

  test('keeps file action triggers clear of the overlay scrollbar', () => {
    renderView({
      tree: { nodes: [fileNode('README.md')], truncated: false },
      loading: false,
      error: null,
    })

    expect(scrollViewport().parentElement?.getAttribute('data-scrollbar-mode')).toBe('compact')
    expect(row('README.md').firstElementChild?.className).toContain('pr-3')
  })

  test('does not add an extra panel border around the tree body', () => {
    renderView({
      tree: { nodes: [fileNode('README.md')], truncated: false },
      loading: false,
      error: null,
    })
    expect(tree().className).not.toContain('border-l')
  })

  test('uses the app sans font for explorer file names', () => {
    renderView({
      tree: { nodes: [fileNode('README.md')], truncated: false },
      loading: false,
      error: null,
    })
    expect(tree().className).toContain('font-sans')
    expect(tree().className).not.toContain('font-mono')
  })

  test('lists root-level files and directories, directories before files', () => {
    const tree: RepoTreeResult = {
      nodes: [
        dirNode('src'),
        fileNode('README.md'),
        fileNode('src/index.ts', 'src'),
        fileNode('src/util/helper.ts', 'src/util'),
        dirNode('src/util', 'src'),
      ],
      truncated: false,
    }
    renderView({ tree, loading: false, error: null })

    expect(rowNames()).toEqual(['src', 'README.md'])
    expect(row('src').getAttribute('aria-level')).toBe('1')
    expect(row('src').getAttribute('aria-posinset')).toBe('1')
    expect(row('src').getAttribute('aria-setsize')).toBe('2')
    expect(row('README.md').getAttribute('aria-level')).toBe('1')
  })

  test('selects and toggles a directory when clicking the row', async () => {
    const user = userEvent.setup()
    const tree: RepoTreeResult = {
      nodes: [dirNode('src'), fileNode('src/index.ts', 'src')],
      truncated: false,
    }
    renderView({ tree, loading: false, error: null })

    await user.click(row('src'))

    expect(rowNames()).toEqual(['src', 'index.ts'])
    expect(row('src').getAttribute('aria-selected')).toBe('true')
    expect(row('src').getAttribute('aria-expanded')).toBe('true')
    expect(row('index.ts').getAttribute('aria-level')).toBe('2')

    await user.click(row('src'))

    expect(rowNames()).toEqual(['src'])
    expect(row('src').getAttribute('aria-expanded')).toBe('false')

    await user.click(row('src'))

    expect(rowNames()).toEqual(['src', 'index.ts'])
    expect(row('src').getAttribute('aria-expanded')).toBe('true')
  })

  test('row click replaces selection and toggles directory expansion in one interaction', async () => {
    const user = userEvent.setup()
    const tree: RepoTreeResult = {
      nodes: [dirNode('src'), fileNode('src/index.ts', 'src'), fileNode('README.md')],
      truncated: false,
    }
    renderView({ tree, loading: false, error: null })

    await user.click(row('README.md'))
    expect(row('README.md').getAttribute('aria-selected')).toBe('true')

    await user.click(row('src'))

    expect(row('README.md').getAttribute('aria-selected')).toBe('false')
    expect(row('src').getAttribute('aria-selected')).toBe('true')
    expect(row('src').getAttribute('aria-expanded')).toBe('true')
  })

  test('clicking a nested file does not toggle or select its parent directory', async () => {
    const user = userEvent.setup()
    const tree: RepoTreeResult = {
      nodes: [dirNode('src'), fileNode('src/index.ts', 'src')],
      truncated: false,
    }
    renderView({ tree, loading: false, error: null })

    await user.click(row('src'))
    expect(row('src').getAttribute('aria-expanded')).toBe('true')

    await user.click(row('index.ts'))

    expect(row('src').getAttribute('aria-expanded')).toBe('true')
    expect(row('src').getAttribute('aria-selected')).toBe('false')
    expect(row('index.ts').getAttribute('aria-selected')).toBe('true')
  })

  test('shows a file action menu with open and delete items without selecting the row', async () => {
    const user = userEvent.setup()
    const onOpenFile = vi.fn()
    const onRequestTrashFile = vi.fn()
    const tree: RepoTreeResult = { nodes: [fileNode('README.md')], truncated: false }
    renderView({ tree, loading: false, error: null, onOpenFile, onRequestTrashFile })

    const actionButton = row('README.md').querySelector<HTMLButtonElement>('[data-action-popover-trigger]')
    expect(actionButton).toBeTruthy()
    expect(actionButton?.className).toContain('group-hover/filetree-row:opacity-100')
    expect(actionButton?.className).not.toContain('group-focus-within/filetree-row:opacity-100')

    await user.click(actionButton!)

    expect(row('README.md').getAttribute('aria-selected')).toBe('false')
    expect(document.body.textContent).toMatch(/app-chrome\.open/)
    expect(document.body.textContent).toMatch(/menu\.edit\.delete/)
    expect(document.body.querySelector('.border-t')).toBeTruthy()
    const openItem = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'app-chrome.open',
    )
    expect(document.activeElement).not.toBe(openItem)

    const deleteItem = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'menu.edit.delete',
    )
    await user.click(deleteItem!)

    expect(row('README.md').getAttribute('aria-selected')).toBe('false')
    expect(onRequestTrashFile).toHaveBeenCalledTimes(1)
    expect(onRequestTrashFile.mock.calls[0]?.[0]?.path).toBe('README.md')
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  test('keeps the file action menu trigger visible in compact mode', () => {
    compactUi = true
    const tree: RepoTreeResult = { nodes: [fileNode('README.md')], truncated: false }
    renderView({ tree, loading: false, error: null })

    const actionButton = row('README.md').querySelector<HTMLButtonElement>('[data-action-popover-trigger]')
    expect(actionButton).toBeTruthy()
    // Compact mode skips the group-hover reveal and keeps the action icon
    // visible at all times so the touch/compact UI keeps the menu reachable.
    expect(actionButton?.className).toContain('opacity-100')
    expect(actionButton?.className).not.toContain('group-hover/filetree-row:opacity-100')
  })

  test('keeps the file action menu trigger visible and busy while opening the file', async () => {
    const user = userEvent.setup()
    const tree: RepoTreeResult = { nodes: [fileNode('README.md')], truncated: false }
    renderView({
      tree,
      loading: false,
      openingFileKeys: new Set(['README.md']),
      error: null,
    })

    const actionButton = row('README.md').querySelector<HTMLButtonElement>('[data-action-popover-trigger]')
    expect(actionButton).toBeTruthy()
    expect(actionButton?.getAttribute('aria-busy')).toBe('true')
    expect(actionButton?.className).toContain('opacity-100')
    expect(actionButton?.querySelector('svg.animate-spin')).toBeTruthy()

    await user.click(actionButton!)

    const openItem = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'app-chrome.open',
    )
    expect(openItem?.disabled).toBe(true)
    expect(openItem?.querySelector('svg.animate-spin')).toBeTruthy()
  })

  test('opens a file on double click', async () => {
    const user = userEvent.setup()
    const onOpenFile = vi.fn()
    const tree: RepoTreeResult = { nodes: [fileNode('README.md')], truncated: false }
    renderView({ tree, loading: false, error: null, onOpenFile })

    await user.dblClick(row('README.md'))

    expect(onOpenFile).toHaveBeenCalledTimes(1)
    expect(onOpenFile.mock.calls[0]?.[0]?.path).toBe('README.md')
  })

  test('renders selected rows without rounded corners', async () => {
    const user = userEvent.setup()
    const tree: RepoTreeResult = { nodes: [fileNode('README.md')], truncated: false }
    renderView({ tree, loading: false, error: null })

    await user.click(row('README.md'))

    expect(row('README.md').className).toContain('bg-selected')
    expect(row('README.md').className).not.toMatch(/\brounded-/)
  })

  test('still expands a directory via the chevron control', async () => {
    const user = userEvent.setup()
    const tree: RepoTreeResult = {
      nodes: [dirNode('src'), fileNode('src/index.ts', 'src')],
      truncated: false,
    }
    renderView({ tree, loading: false, error: null })

    await user.click(row('src').querySelector<HTMLButtonElement>('button[slot="chevron"]')!)

    expect(rowNames()).toEqual(['src', 'index.ts'])
    expect(row('src').getAttribute('aria-expanded')).toBe('true')
    expect(row('src').getAttribute('aria-selected')).toBe('false')
  })

  test('emits onSelect when a row is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const tree: RepoTreeResult = { nodes: [fileNode('README.md')], truncated: false }
    renderView({ tree, loading: false, error: null, onSelect })

    await user.click(row('README.md'))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0]?.[0]?.id).toBe('README.md')
    expect(row('README.md').getAttribute('aria-selected')).toBe('true')
  })

  test('emits onActivate on Enter key for files', async () => {
    const user = userEvent.setup()
    const onActivate = vi.fn()
    const tree: RepoTreeResult = { nodes: [fileNode('README.md')], truncated: false }
    renderView({ tree, loading: false, error: null, onActivate })

    row('README.md').focus()
    await user.keyboard('{Enter}')

    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onActivate.mock.calls[0]?.[0]?.id).toBe('README.md')
  })

  test('shows the truncated footer when truncated is true', () => {
    const tree: RepoTreeResult = {
      nodes: [fileNode('README.md')],
      truncated: true,
    }
    renderView({ tree, loading: false, error: null })
    expect(container?.textContent).toMatch(/filetree\.truncated/)
  })

  test('does not render a status dot in v1 (git-status overlay deferred)', () => {
    const tree: RepoTreeResult = {
      nodes: [fileNode('README.md', null, 'modified')],
      truncated: false,
    }
    renderView({ tree, loading: false, error: null })
    // The wire union still allows non-clean status values, but v1
    // hardcodes every node to 'clean' (docs/filetree.md) so the view
    // must not emit a status aria-label. When a real overlay lands the
    // assertion flips: assert each status renders its own dot.
    expect(container?.querySelector('[aria-label^="filetree.status."]')).toBeNull()
  })

  test('keeps the initial loading state visually quiet and announces aria-busy', () => {
    renderView({ tree: null, loading: true, error: null })
    expect(container?.querySelectorAll('[role="treeitem"]').length).toBe(0)
    expect(container?.textContent).not.toMatch(/filetree\.loading/)
    expect(container?.textContent).not.toMatch(/filetree\.empty/)
    expect(container?.querySelector('[data-filetree=""]')?.getAttribute('aria-busy')).toBe('true')
  })

  test('reports the top visible row index instead of the raw scroll offset', () => {
    const onTopVisibleRowIndexChange = vi.fn()
    renderView({ tree: buildTree(), loading: false, error: null, onTopVisibleRowIndexChange })
    const viewport = scrollViewport()
    viewport.scrollTop = 145
    act(() => {
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    expect(onTopVisibleRowIndexChange).toHaveBeenCalledWith(6)
  })

  test('preserves selection and expansion when the tree refreshes with the same keys', async () => {
    const user = userEvent.setup()
    const treeA: RepoTreeResult = {
      nodes: [dirNode('src'), fileNode('src/index.ts', 'src'), fileNode('README.md')],
      truncated: false,
    }
    renderView({ tree: treeA, loading: false, error: null })

    await user.click(row('src'))
    await user.click(row('README.md'))
    expect(rowNames()).toEqual(['src', 'index.ts', 'README.md'])
    expect(row('README.md').getAttribute('aria-selected')).toBe('true')

    const treeB: RepoTreeResult = {
      nodes: [dirNode('src'), fileNode('src/index.ts', 'src'), fileNode('README.md')],
      truncated: false,
    }
    await act(async () => {
      rerenderView({ tree: treeB, loading: false, error: null })
    })

    expect(rowNames()).toEqual(['src', 'index.ts', 'README.md'])
    expect(row('src').getAttribute('aria-expanded')).toBe('true')
    expect(row('README.md').getAttribute('aria-selected')).toBe('true')
  })

  test('prunes selection and expansion when refreshed nodes disappear', async () => {
    const user = userEvent.setup()
    const treeA: RepoTreeResult = {
      nodes: [dirNode('src'), fileNode('src/index.ts', 'src'), fileNode('README.md')],
      truncated: false,
    }
    renderView({ tree: treeA, loading: false, error: null })

    await user.click(row('src'))
    await user.click(row('README.md'))
    expect(rowNames()).toEqual(['src', 'index.ts', 'README.md'])
    expect(row('README.md').getAttribute('aria-selected')).toBe('true')

    const treeB: RepoTreeResult = {
      nodes: [fileNode('CHANGELOG.md'), dirNode('docs')],
      truncated: false,
    }
    await act(async () => {
      rerenderView({ tree: treeB, loading: false, error: null })
    })

    expect(rowNames()).toEqual(['docs', 'CHANGELOG.md'])
    expect(row('docs').getAttribute('aria-selected')).toBe('false')
    expect(row('CHANGELOG.md').getAttribute('aria-selected')).toBe('false')
  })
})

describe('FiletreeView — React Aria keyboard integration', () => {
  test('ArrowDown and ArrowUp move focus through visible rows', async () => {
    const user = userEvent.setup()
    renderView({ tree: buildTree(), loading: false, error: null })

    row('src').focus()
    await user.keyboard('{ArrowDown}')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(document.activeElement).toBe(row('README.md'))

    await user.keyboard('{ArrowUp}')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(document.activeElement).toBe(row('src'))
  })

  test('ArrowRight expands the focused directory', async () => {
    const user = userEvent.setup()
    renderView({ tree: buildTree(), loading: false, error: null })

    row('src').focus()
    await user.keyboard('{ArrowRight}')

    expect(row('src').getAttribute('aria-expanded')).toBe('true')
    expect(rowNames()).toEqual(['src', 'util', 'index.ts', 'README.md'])
  })

  test('ArrowLeft collapses the focused expanded directory', async () => {
    const user = userEvent.setup()
    renderView({ tree: buildTree(), loading: false, error: null })

    row('src').focus()
    await user.keyboard('{ArrowRight}')
    await user.keyboard('{ArrowLeft}')

    expect(row('src').getAttribute('aria-expanded')).toBe('false')
    expect(rowNames()).toEqual(['src', 'README.md'])
  })
})

describe('FiletreeView — locale-aware sorting', () => {
  test('sorts child lists by locale-aware name compare, directories first', () => {
    const tree: RepoTreeResult = {
      nodes: [fileNode('10.txt'), dirNode('a'), fileNode('2.txt'), dirNode('A'), fileNode('b.txt'), fileNode('a.txt')],
      truncated: false,
    }
    renderView({ tree, loading: false, error: null })

    expect(rowNames()).toEqual(['a', 'A', '2.txt', '10.txt', 'a.txt', 'b.txt'])
  })
})
