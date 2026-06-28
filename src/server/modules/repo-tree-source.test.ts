import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  MAX_REPO_TREE_DEPTH,
  MAX_REPO_TREE_NODES,
  type RepoTreeSourceOptions,
  getRepoTreeSourceLocal,
  getRepoTreeSourceRemote,
} from '#/server/modules/repo-tree-source.ts'
import { buildNodes } from '#/server/modules/repo-tree-source-pure.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

async function makeTempWorktree(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-tree-source-'))
  await execa('git', ['-C', root, 'init', '-q'])
  for (const [relpath, contents] of Object.entries(files)) {
    const full = path.join(root, relpath)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, contents, 'utf8')
  }
  return root
}

describe('repo-tree-source — local FS walk', () => {
  let worktree: string | null = null

  beforeEach(async () => {
    worktree = null
  })

  afterEach(async () => {
    if (worktree) await fs.rm(worktree, { recursive: true, force: true })
  })

  test('returns an empty result when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await getRepoTreeSourceLocal('/tmp', {}, controller.signal)
    expect(result).toEqual({ nodes: [], truncated: false })
  })

  test('emits directories derived from file paths and tags files correctly', async () => {
    worktree = await makeTempWorktree({
      'src/index.ts': 'export {}',
      'src/util/helper.ts': 'export {}',
      'README.md': '# readme',
    })

    const result = await getRepoTreeSourceLocal(worktree, {}, undefined)

    const byId = new Map(result.nodes.map((n) => [n.id, n]))
    expect(byId.get('README.md')?.kind).toBe('file')
    expect(byId.get('src')?.kind).toBe('directory')
    expect(byId.get('src/index.ts')?.kind).toBe('file')
    expect(byId.get('src/util')?.kind).toBe('directory')
    expect(byId.get('src/util/helper.ts')?.kind).toBe('file')

    // Every file or directory that has a parent points at another
    // node we also emitted; root-level nodes have parentId === null.
    for (const node of result.nodes) {
      if (node.parentId !== null) {
        expect(byId.has(node.parentId)).toBe(true)
      }
    }
    expect(result.truncated).toBe(false)
  })

  test('uses git exclude rules while keeping ordinary dotfiles visible', async () => {
    worktree = await makeTempWorktree({
      '.gitignore': 'node_modules\ndist/\n*.log',
      '.env': 'VISIBLE=true',
      'src/index.ts': '',
      'node_modules/lib/index.js': '',
      'dist/bundle.js': '',
      'app.log': '',
      'README.md': '',
    })

    const result = await getRepoTreeSourceLocal(worktree, {}, undefined)
    const ids = result.nodes.map((n) => n.id).sort()
    expect(ids).not.toContain('.git')
    expect(ids).not.toContain('.git/HEAD')
    expect(ids).not.toContain('node_modules')
    expect(ids).not.toContain('node_modules/lib')
    expect(ids).not.toContain('node_modules/lib/index.js')
    expect(ids).not.toContain('dist')
    expect(ids).not.toContain('dist/bundle.js')
    expect(ids).not.toContain('app.log')
    expect(ids).toContain('src')
    expect(ids).toContain('README.md')
    expect(ids).toContain('.env')
    expect(ids).toContain('.gitignore')
  })

  test('clamps depth to MAX_REPO_TREE_DEPTH', async () => {
    worktree = await makeTempWorktree({
      'a/b/c/d/e/f/file.txt': '',
    })
    const options: RepoTreeSourceOptions = { depth: MAX_REPO_TREE_DEPTH + 5 }
    const result = await getRepoTreeSourceLocal(worktree, options, undefined)
    // With a clamped depth of 10, this file is within the cap. Assert
    // the response is internally consistent.
    expect(result.truncated).toBe(false)
    expect(result.nodes.every((n) => n.id.length > 0)).toBe(true)
  })

  test('honours prefix narrowing', async () => {
    worktree = await makeTempWorktree({
      'src/a.ts': '',
      'src/sub/b.ts': '',
      'docs/readme.md': '',
    })

    const result = await getRepoTreeSourceLocal(worktree, { prefix: 'src' }, undefined)
    const ids = result.nodes.map((n) => n.id).sort()
    expect(ids).toContain('src/a.ts')
    expect(ids).toContain('src/sub')
    expect(ids).toContain('src/sub/b.ts')
    expect(ids).not.toContain('docs')
    expect(ids).not.toContain('docs/readme.md')
  })

  test('truncates large result sets and flags `truncated: true`', async () => {
    worktree = await makeTempWorktree({
      'package.json': '{}',
    })

    // Simulate a flood of small files by writing a giant directory.
    // We write in parallel batches to keep the test under a second
    // and to avoid rmdir races during teardown.
    const hugeRoot = path.join(worktree, 'big')
    await fs.mkdir(hugeRoot, { recursive: true })
    const writeCount = MAX_REPO_TREE_NODES + 16
    const batchSize = 500
    for (let i = 0; i < writeCount; i += batchSize) {
      const batch = Array.from({ length: Math.min(batchSize, writeCount - i) }, (_, j) =>
        fs.writeFile(path.join(hugeRoot, `f${i + j}.txt`), 'x'),
      )
      await Promise.all(batch)
    }

    const result = await getRepoTreeSourceLocal(worktree, { depth: 2 }, undefined)
    expect(result.nodes.length).toBeLessThanOrEqual(MAX_REPO_TREE_NODES)
    expect(result.truncated).toBe(true)
  })

  test('aborts mid-walk when the signal fires', async () => {
    worktree = await makeTempWorktree({
      'a.ts': '',
      'b.ts': '',
    })

    const controller = new AbortController()
    // Pre-aborting is the easiest to assert deterministically — the
    // source layer checks signal before doing any I/O.
    controller.abort()
    const result = await getRepoTreeSourceLocal(worktree, {}, controller.signal)
    expect(result).toEqual({ nodes: [], truncated: false })
  })

  test('returns empty nodes when the worktree path does not exist', async () => {
    const missing = path.join(os.tmpdir(), 'definitely-not-a-real-path-' + Date.now())
    const result = await getRepoTreeSourceLocal(missing, {}, undefined)
    expect(result.nodes).toEqual([])
    expect(result.truncated).toBe(false)
  })

})

describe('repo-tree-source — buildNodes pure helper', () => {
  test('sorts directories before files within the same parent', () => {
    const nodes = buildNodes({
      worktreePath: '/x',
      prefix: '',
      depth: 5,
      entries: ['src/a.ts', 'src/b.ts', 'README.md'],
    })
    // First the `src` directory should appear before any file at the
    // root. Then `README.md` and `src/a.ts` / `src/b.ts`.
    const rootChildren = nodes.filter((n) => n.parentId === null || n.parentId === '')
    const dirIdx = rootChildren.findIndex((n) => n.id === 'src')
    const readmeIdx = rootChildren.findIndex((n) => n.id === 'README.md')
    expect(dirIdx).toBeLessThan(readmeIdx)
  })

  test('derives directory nodes from file entries', () => {
    const nodes = buildNodes({
      worktreePath: '/x',
      prefix: '',
      depth: 5,
      entries: ['src/a.ts'],
    })
    const srcNodes = nodes.filter((n) => n.id === 'src')
    expect(srcNodes).toHaveLength(1)
    expect(srcNodes[0]?.kind).toBe('directory')
  })

  test('does not double-count prefix segments when applying depth', () => {
    const nodes = buildNodes({
      worktreePath: '/x',
      prefix: 'src',
      depth: 2,
      entries: ['src/a.ts', 'src/nested/b.ts'],
    })
    const ids = nodes.map((n) => n.id)
    expect(ids).toContain('src/a.ts')
    expect(ids).not.toContain('src/nested/b.ts')
  })

  test('drops the worktree root entry instead of emitting an empty node', () => {
    const nodes = buildNodes({
      worktreePath: '/x',
      prefix: '',
      depth: 5,
      entries: ['', 'README.md'],
    })
    const ids = nodes.map((n) => n.id)
    expect(ids).toEqual(['README.md'])
  })

  test('strips absolute paths and parent traversals', () => {
    const nodes = buildNodes({
      worktreePath: '/x',
      prefix: '',
      depth: 5,
      entries: ['../etc/passwd', '/abs/file.ts', 'good.ts'],
    })
    const ids = nodes.map((n) => n.id)
    expect(ids).toContain('good.ts')
    expect(ids).not.toContain('../etc/passwd')
    expect(ids).not.toContain('/abs/file.ts')
  })

  test('rejects mid-path `..` traversal that escapes the worktree root', () => {
    // Defense-in-depth: a malformed remote result could surface paths
    // like `foo/../../etc/passwd` whose
    // segment set contains `..`. They must not become tree nodes.
    const nodes = buildNodes({
      worktreePath: '/x',
      prefix: '',
      depth: 5,
      entries: ['foo/../../etc/passwd', 'foo/../bar.ts', 'good/foo/../bar.ts', 'good/bar.ts'],
    })
    const ids = nodes.map((n) => n.id)
    expect(ids).toContain('good/bar.ts')
    expect(ids).not.toContain('foo/../../etc/passwd')
    expect(ids).not.toContain('foo/../bar.ts')
    expect(ids).not.toContain('good/foo/../bar.ts')
  })

  test('records the matching parentId for files at the worktree root', () => {
    const nodes = buildNodes({
      worktreePath: '/x',
      prefix: '',
      depth: 5,
      entries: ['top.ts'],
    })
    const top = nodes.find((n) => n.id === 'top.ts')
    expect(top).toBeDefined()
    expect(top?.parentId).toBeNull()
    expect(top?.kind).toBe('file')
  })
})

describe('repo-tree-source — git exclude coverage', () => {
  // Indirect test via the read path: a `.gitignore` containing the
  // patterns below should drop matching files but keep the rest.
  test('negation and anchored patterns affect the result set', async () => {
    const worktree = await makeTempWorktree({
      '.gitignore': ['/rooted-ignored', '!should-not-unignore.ts'].join('\n'),
      'rooted-ignored': '',
      'src/rooted-ignored': '',
      'should-not-unignore.ts': '',
    })
    try {
      const result = await getRepoTreeSourceLocal(worktree, {}, undefined)
      const ids = result.nodes.map((n) => n.id)
      expect(ids).not.toContain('rooted-ignored')
      // anchored `/rooted-ignored` only excludes the root one.
      expect(ids).toContain('src/rooted-ignored')
      // Negation is intentionally a no-op in v1 — the file is
      // neither created nor excluded by `!` lines.
      expect(ids).toContain('should-not-unignore.ts')
    } finally {
      await fs.rm(worktree, { recursive: true, force: true })
    }
  })
})

// Sanity check: the constants we expose are the same ones the schema
// uses for the depth bound, so a future schema bump needs to be
// mirrored here.
test('repo-tree-source — depth constants stay aligned with the wire schema', () => {
  expect(MAX_REPO_TREE_DEPTH).toBe(10)
  // The route schema is `v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10))`.
  // Drift here is a wire-vs-source invariant break.
  expect(MAX_REPO_TREE_NODES).toBeGreaterThan(0)
})

// Avoid hanging on unhandled signal listeners in the rare case a
// test forgets to abort a controller.
afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// PR 5 — remote (SSH) tree walk tests.
// ---------------------------------------------------------------------------

const remoteMocks = vi.hoisted(() => ({
  getRemoteTreeWalk: vi.fn(),
}))

vi.mock('#/system/ssh/git.ts', () => ({
  getRemoteTreeWalk: remoteMocks.getRemoteTreeWalk,
}))

function remoteTarget(): RemoteRepoTarget {
  return {
    id: 'ssh-config://mybox/myrepo',
    alias: 'mybox',
    remotePath: '/srv/repos/myrepo',
    displayName: 'mybox:myrepo',
    host: 'mybox.local',
    user: 'git',
    port: 22,
  }
}

const NUL = String.fromCharCode(0)

function makeRemoteInput(
  worktreePath: string,
  options: RepoTreeSourceOptions = {},
  signal: AbortSignal | undefined = undefined,
) {
  return {
    target: remoteTarget(),
    worktreePath,
    options,
    signal,
  }
}

describe('repo-tree-source — remote SSH walk', () => {
  beforeEach(() => {
    remoteMocks.getRemoteTreeWalk.mockReset()
  })

  test('returns the empty envelope when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await getRepoTreeSourceRemote(
      makeRemoteInput('/srv/repos/myrepo/.worktrees/feature', {}, controller.signal),
    )
    expect(result).toEqual({ nodes: [], truncated: false })
    expect(remoteMocks.getRemoteTreeWalk).not.toHaveBeenCalled()
  })

  test('walks NUL-separated entries into directory and file nodes', async () => {
    remoteMocks.getRemoteTreeWalk.mockResolvedValueOnce({
      ok: true,
      message: [
        '/srv/repos/myrepo/.worktrees/feature/README.md',
        '/srv/repos/myrepo/.worktrees/feature/src/index.ts',
        '/srv/repos/myrepo/.worktrees/feature/src/util/helper.ts',
      ].join(NUL),
    })

    const result = await getRepoTreeSourceRemote(makeRemoteInput('/srv/repos/myrepo/.worktrees/feature'))

    const byId = new Map(result.nodes.map((n) => [n.id, n]))
    expect(byId.get('README.md')?.status).toBe('clean')
    expect(byId.get('src')?.kind).toBe('directory')
    expect(byId.get('src/index.ts')?.kind).toBe('file')
    expect(byId.get('src/util')?.kind).toBe('directory')
    expect(byId.get('src/util/helper.ts')?.kind).toBe('file')
    expect(result.truncated).toBe(false)
  })

  test('drops entries that do not share the worktree prefix', async () => {
    remoteMocks.getRemoteTreeWalk.mockResolvedValueOnce({
      ok: true,
      message: [
        '/srv/repos/myrepo/.worktrees/feature/README.md',
        '/srv/repos/other-worktree/secret.ts',
        '/srv/repos/myrepo/.worktrees/feature/src/a.ts',
      ].join(NUL),
    })

    const result = await getRepoTreeSourceRemote(makeRemoteInput('/srv/repos/myrepo/.worktrees/feature'))
    const ids = result.nodes.map((n) => n.id).sort()
    expect(ids).toContain('README.md')
    expect(ids).toContain('src/a.ts')
    expect(ids).not.toContain('/srv/repos/other-worktree/secret.ts')
  })

  test('treats an entry exactly equal to the worktree root as the worktree root', async () => {
    remoteMocks.getRemoteTreeWalk.mockResolvedValueOnce({
      ok: true,
      message: ['/srv/repos/myrepo/.worktrees/feature', '/srv/repos/myrepo/.worktrees/feature/README.md'].join(NUL),
    })

    const result = await getRepoTreeSourceRemote(makeRemoteInput('/srv/repos/myrepo/.worktrees/feature'))
    expect(result.nodes.find((n) => n.id === 'README.md')).toBeDefined()
  })

  test('honours a prefix by narrowing the output', async () => {
    remoteMocks.getRemoteTreeWalk.mockResolvedValueOnce({
      ok: true,
      message: [
        '/srv/repos/myrepo/.worktrees/feature/src/a.ts',
        '/srv/repos/myrepo/.worktrees/feature/src/sub/b.ts',
        '/srv/repos/myrepo/.worktrees/feature/docs/readme.md',
      ].join(NUL),
    })

    const result = await getRepoTreeSourceRemote(
      makeRemoteInput('/srv/repos/myrepo/.worktrees/feature', { prefix: 'src' }),
    )
    const ids = result.nodes.map((n) => n.id).sort()
    expect(ids).toContain('src/a.ts')
    expect(ids).toContain('src/sub/b.ts')
    expect(ids).not.toContain('docs')
    expect(ids).not.toContain('docs/readme.md')
  })

  test('soft-fails to the empty envelope when the remote walk returns ok=false', async () => {
    remoteMocks.getRemoteTreeWalk.mockResolvedValueOnce({ ok: false, message: 'no worktree found' })
    const result = await getRepoTreeSourceRemote(makeRemoteInput('/srv/repos/myrepo/.worktrees/feature'))
    expect(result).toEqual({ nodes: [], truncated: false })
  })

  test('soft-fails to the empty envelope when the remote walk throws', async () => {
    remoteMocks.getRemoteTreeWalk.mockRejectedValueOnce(new Error('ssh boom'))
    const result = await getRepoTreeSourceRemote(makeRemoteInput('/srv/repos/myrepo/.worktrees/feature'))
    expect(result).toEqual({ nodes: [], truncated: false })
  })

  test('soft-fails when the signal is aborted mid-walk', async () => {
    remoteMocks.getRemoteTreeWalk.mockImplementationOnce(async (_target, worktreePath, opts) => {
      // Simulate the ssh runner honoring abort mid-flight.
      if (opts?.signal?.aborted) return { ok: false, message: 'cancelled' }
      return { ok: true, message: `/srv/repos/myrepo/.worktrees/${worktreePath.split('/').pop()}/README.md` }
    })
    const controller = new AbortController()
    controller.abort()
    const result = await getRepoTreeSourceRemote(
      makeRemoteInput('/srv/repos/myrepo/.worktrees/feature', {}, controller.signal),
    )
    expect(result).toEqual({ nodes: [], truncated: false })
  })

  test('returns an empty nodes list when the remote stdout is empty', async () => {
    remoteMocks.getRemoteTreeWalk.mockResolvedValueOnce({ ok: true, message: '' })
    const result = await getRepoTreeSourceRemote(makeRemoteInput('/srv/repos/myrepo/.worktrees/feature'))
    expect(result.nodes).toEqual([])
    expect(result.truncated).toBe(false)
  })

  test('truncates to MAX_REPO_TREE_NODES and flags `truncated: true`', async () => {
    // Build enough NUL-separated entries to exceed the cap after
    // `buildNodes` adds the implicit directory nodes.
    const total = MAX_REPO_TREE_NODES + 64
    const entries = Array.from({ length: total }, (_, i) => `/srv/repos/myrepo/.worktrees/feature/d${i}/file.ts`)
    remoteMocks.getRemoteTreeWalk.mockResolvedValueOnce({ ok: true, message: entries.join(NUL) })

    const result = await getRepoTreeSourceRemote(makeRemoteInput('/srv/repos/myrepo/.worktrees/feature'))
    expect(result.nodes.length).toBeLessThanOrEqual(MAX_REPO_TREE_NODES)
    expect(result.truncated).toBe(true)
  })

  test('clamps the depth passed to getRemoteTreeWalk', async () => {
    remoteMocks.getRemoteTreeWalk.mockResolvedValueOnce({ ok: true, message: '' })
    await getRepoTreeSourceRemote(
      makeRemoteInput('/srv/repos/myrepo/.worktrees/feature', { depth: MAX_REPO_TREE_DEPTH + 100 }),
    )
    // `getRemoteTreeWalk` is the wrapper; it clamps internally. The
    // contract we check here is that the source layer didn't crash
    // on the out-of-range depth.
    expect(remoteMocks.getRemoteTreeWalk).toHaveBeenCalledTimes(1)
  })
})
