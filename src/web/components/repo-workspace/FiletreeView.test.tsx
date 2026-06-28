// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { userEvent } from '@testing-library/user-event'
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

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

function fileNode(id: string, parentId: string | null = null, status: RepoTreeNode['status'] = 'clean'): RepoTreeNode {
  const name = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  return { id, path: id, name, parentId, kind: 'file', status }
}

function dirNode(id: string, parentId: string | null = null): RepoTreeNode {
  const name = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  return { id, path: id, name, parentId, kind: 'directory', status: 'clean' }
}

function renderView(props: React.ComponentProps<typeof FiletreeView>) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(<FiletreeView {...props} />)
  })
}

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  const win = window as typeof window & { PointerEvent?: typeof PointerEvent }
  win.PointerEvent ??= MouseEvent as unknown as typeof PointerEvent
  globalThis.PointerEvent ??= win.PointerEvent
  globalThis.CSS ??= { escape: (value: string) => value.replace(/["\\]/g, '\\$&') } as typeof CSS
  globalThis.requestAnimationFrame ??= (callback: FrameRequestCallback) => window.setTimeout(callback, 0)
  globalThis.cancelAnimationFrame ??= (id: number) => window.clearTimeout(id)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

function row(name: string): HTMLElement {
  const element = rows().find((candidate) => candidate.getAttribute('aria-label') === name)
  if (!element) throw new Error(`no row for ${name}`)
  return element
}

function rows(): HTMLElement[] {
  return Array.from(container?.querySelectorAll<HTMLElement>('[role="row"][aria-label]') ?? [])
}

function rowNames(): Array<string | null> {
  return rows().map((element) => element.getAttribute('aria-label'))
}

function treegrid(): HTMLElement {
  const element = container?.querySelector<HTMLElement>('[role="treegrid"]')
  if (!element) throw new Error('no treegrid')
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
    renderView({ tree, loading: false, error: null, stale: false })
    expect(container?.querySelector('[data-filetree=""]')).not.toBeNull()
    expect(container?.querySelectorAll('[role="row"]').length).toBe(0)
    expect(container?.textContent).toMatch(/filetree\.empty/)
  })

  test('renders the no-worktree placeholder via the dedicated helper', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => {
      root!.render(<FiletreeNoWorktreeView />)
    })
    expect(container?.textContent).toMatch(/filetree\.no-worktree/)
  })

  test('renders error state when error is set', () => {
    const tree: RepoTreeResult = { nodes: [], truncated: false }
    renderView({ tree, loading: false, error: 'boom', stale: false })
    expect(container?.textContent).toMatch(/filetree\.error/)
  })

  test('renders a React Aria treegrid labelled by i18n', () => {
    renderView({
      tree: { nodes: [fileNode('README.md')], truncated: false },
      loading: false,
      error: null,
      stale: false,
    })
    expect(treegrid().getAttribute('aria-label')).toBe('filetree.aria-label')
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
    renderView({ tree, loading: false, error: null, stale: false })

    expect(rowNames()).toEqual(['src', 'README.md'])
    expect(row('src').getAttribute('aria-level')).toBe('1')
    expect(row('README.md').getAttribute('aria-level')).toBe('1')
  })

  test('toggles a directory by clicking the full row', async () => {
    const user = userEvent.setup()
    const tree: RepoTreeResult = {
      nodes: [dirNode('src'), fileNode('src/index.ts', 'src')],
      truncated: false,
    }
    renderView({ tree, loading: false, error: null, stale: false })

    await user.click(row('src'))

    expect(rowNames()).toEqual(['src', 'index.ts'])
    expect(row('src').getAttribute('aria-expanded')).toBe('true')
    expect(row('index.ts').getAttribute('aria-level')).toBe('2')

    await user.click(row('src'))

    expect(rowNames()).toEqual(['src'])
    expect(row('src').getAttribute('aria-expanded')).toBe('false')
  })

  test('still expands a directory via the React Aria chevron slot', async () => {
    const user = userEvent.setup()
    const tree: RepoTreeResult = {
      nodes: [dirNode('src'), fileNode('src/index.ts', 'src')],
      truncated: false,
    }
    renderView({ tree, loading: false, error: null, stale: false })

    await user.click(row('src').querySelector<HTMLButtonElement>('button[slot="chevron"]')!)

    expect(rowNames()).toEqual(['src', 'index.ts'])
    expect(row('src').getAttribute('aria-expanded')).toBe('true')
  })

  test('emits onSelect when a row is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const tree: RepoTreeResult = { nodes: [fileNode('README.md')], truncated: false }
    renderView({ tree, loading: false, error: null, stale: false, onSelect })

    await user.click(row('README.md'))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0]?.[0]?.id).toBe('README.md')
    expect(row('README.md').getAttribute('aria-selected')).toBe('true')
  })

  test('emits onActivate on Enter key for files', async () => {
    const user = userEvent.setup()
    const onActivate = vi.fn()
    const tree: RepoTreeResult = { nodes: [fileNode('README.md')], truncated: false }
    renderView({ tree, loading: false, error: null, stale: false, onActivate })

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
    renderView({ tree, loading: false, error: null, stale: false })
    expect(container?.textContent).toMatch(/filetree\.truncated/)
  })

  test('shows the stale banner when stale is true', () => {
    const tree: RepoTreeResult = { nodes: [fileNode('README.md')], truncated: false }
    renderView({ tree, loading: false, error: null, stale: true })
    expect(container?.textContent).toMatch(/status\.stale-title/)
  })

  test('marks a dirty file with a status dot', () => {
    const tree: RepoTreeResult = {
      nodes: [fileNode('README.md', null, 'modified')],
      truncated: false,
    }
    renderView({ tree, loading: false, error: null, stale: false })
    const dot = container?.querySelector('[aria-label="filetree.status.modified"]') as HTMLElement
    expect(dot).toBeTruthy()
    expect(dot.style.background).toContain('--color-warning')
  })

  test('treats loading=true with no tree as a placeholder and announces aria-busy', () => {
    renderView({ tree: null, loading: true, error: null, stale: false })
    expect(container?.querySelectorAll('[role="row"]').length).toBe(0)
    expect(container?.textContent).toMatch(/filetree\.loading/)
    expect(container?.textContent).not.toMatch(/filetree\.empty/)
    expect(container?.querySelector('[data-filetree=""]')?.getAttribute('aria-busy')).toBe('true')
  })

  test('resets selection and expansion when the tree identity changes', async () => {
    const user = userEvent.setup()
    const treeA: RepoTreeResult = {
      nodes: [dirNode('src'), fileNode('src/index.ts', 'src'), fileNode('README.md')],
      truncated: false,
    }
    renderView({ tree: treeA, loading: false, error: null, stale: false })

    await user.click(row('src'))
    await user.click(row('README.md'))
    expect(rowNames()).toEqual(['src', 'index.ts', 'README.md'])
    expect(row('README.md').getAttribute('aria-selected')).toBe('true')

    const treeB: RepoTreeResult = {
      nodes: [fileNode('CHANGELOG.md'), dirNode('docs')],
      truncated: false,
    }
    await act(async () => {
      root?.render(<FiletreeView tree={treeB} loading={false} error={null} stale={false} />)
    })

    expect(rowNames()).toEqual(['docs', 'CHANGELOG.md'])
    expect(row('CHANGELOG.md').getAttribute('aria-selected')).toBe('false')
  })
})

describe('FiletreeView — React Aria keyboard integration', () => {
  test('ArrowRight expands the focused directory', async () => {
    const user = userEvent.setup()
    renderView({ tree: buildTree(), loading: false, error: null, stale: false })

    row('src').focus()
    await user.keyboard('{ArrowRight}')

    expect(row('src').getAttribute('aria-expanded')).toBe('true')
    expect(rowNames()).toEqual(['src', 'util', 'index.ts', 'README.md'])
  })

  test('ArrowLeft collapses the focused expanded directory', async () => {
    const user = userEvent.setup()
    renderView({ tree: buildTree(), loading: false, error: null, stale: false })

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
    renderView({ tree, loading: false, error: null, stale: false })

    expect(rowNames()).toEqual(['a', 'A', '2.txt', '10.txt', 'a.txt', 'b.txt'])
  })
})
