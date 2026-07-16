import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  MAX_REPO_TREE_NODES,
  type RepoTreeSourceOptions,
  getRepoTreeSourceLocal,
  getRepoTreeSourceRemote,
} from '#/server/modules/repo-tree-source.ts'
import { buildChildNodes, buildLimitedChildNodes } from '#/server/modules/repo-tree-source-pure.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

async function makeTempWorktree(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-tree-source-'))
  await execa('git', ['-C', root, 'init', '-q'])
  // Isolate from the host machine's global gitignore (`core.excludesFile`).
  // Without this, a developer's personal excludes (e.g. a global rule for
  // `.env`) silently changes which fixture files these tests see as
  // ignored, making assertions about *this repo's* `.gitignore` flaky.
  await execa('git', ['-C', root, 'config', 'core.excludesFile', '/dev/null'])
  for (const [relpath, contents] of Object.entries(files)) {
    const full = path.join(root, relpath)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, contents, 'utf8')
  }
  return root
}

describe('repo-tree-source — local direct children', () => {
  let worktree: string | null = null

  beforeEach(() => {
    worktree = null
  })

  afterEach(async () => {
    if (worktree) await fs.rm(worktree, { recursive: true, force: true })
  })

  test('rejects when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(getRepoTreeSourceLocal('/tmp', {}, controller.signal)).rejects.toThrow('aborted')
  })

  test('returns only root direct children', async () => {
    worktree = await makeTempWorktree({
      'src/index.ts': '',
      'src/util/helper.ts': '',
      'README.md': '',
    })

    const result = await getRepoTreeSourceLocal(worktree, {}, undefined)
    expect(result.nodes).toEqual([
      expect.objectContaining({ id: 'src', parentId: null, kind: 'directory', hasChildren: true }),
      expect.objectContaining({ id: 'README.md', parentId: null, kind: 'file' }),
    ])
    expect(result.nodes.map((node) => node.id)).not.toContain('src/index.ts')
  })

  test('returns only prefix direct children', async () => {
    worktree = await makeTempWorktree({
      'src/a.ts': '',
      'src/sub/b.ts': '',
      'docs/readme.md': '',
    })

    const result = await getRepoTreeSourceLocal(worktree, { prefix: 'src' }, undefined)
    expect(result.nodes).toEqual([
      expect.objectContaining({ id: 'src/sub', parentId: 'src', kind: 'directory', hasChildren: true }),
      expect.objectContaining({ id: 'src/a.ts', parentId: 'src', kind: 'file' }),
    ])
  })

  test('honors ignore rules while keeping visible dotfiles', async () => {
    worktree = await makeTempWorktree({
      '.gitignore': 'node_modules\ndist/\n*.log\n',
      '.env': 'VISIBLE=true',
      'src/index.ts': '',
      'node_modules/lib/index.js': '',
      'dist/bundle.js': '',
      'app.log': '',
      'README.md': '',
    })

    const result = await getRepoTreeSourceLocal(worktree, {}, undefined)
    const ids = result.nodes.map((node) => node.id)
    expect(ids).toContain('src')
    expect(ids).toContain('README.md')
    expect(ids).toContain('.env')
    expect(ids).toContain('.gitignore')
    expect(ids).not.toContain('.git')
    expect(ids).not.toContain('node_modules')
    expect(ids).not.toContain('dist')
    expect(ids).not.toContain('app.log')
  })

  test('keeps tracked files and directories even when they match ignore rules', async () => {
    worktree = await makeTempWorktree({
      '.gitignore': '.env\nsecrets/\nbuild/\n',
      '.env': 'TRACKED=true',
      'secrets/tracked.txt': 'tracked',
      'secrets/untracked.txt': 'untracked',
      'build/out.js': 'ignored',
      'README.md': '',
    })
    await execa('git', ['-C', worktree, 'add', '-f', '.env', 'secrets/tracked.txt'])

    const result = await getRepoTreeSourceLocal(worktree, {}, undefined)
    const ids = result.nodes.map((node) => node.id)
    expect(ids).toContain('.env')
    expect(ids).toContain('secrets')
    expect(ids).toContain('README.md')
    expect(ids).not.toContain('build')

    const secrets = await getRepoTreeSourceLocal(worktree, { prefix: 'secrets' }, undefined)
    expect(secrets.nodes.map((node) => node.id)).toEqual(['secrets/tracked.txt'])
  })

  test('rejects when the worktree path does not exist', async () => {
    const missing = path.join(os.tmpdir(), 'definitely-not-a-real-path-' + Date.now())
    await expect(getRepoTreeSourceLocal(missing, {}, undefined)).rejects.toThrow()
  })

  test('rejects unsafe prefixes before filesystem reads', async () => {
    worktree = await makeTempWorktree({ 'src/a.ts': '' })
    await expect(getRepoTreeSourceLocal(worktree, { prefix: '../secret' }, undefined)).rejects.toThrow(
      'invalid tree prefix',
    )
  })
})

describe('repo-tree-source — buildChildNodes pure helper', () => {
  test('sorts directories before files and rejects nested entries', () => {
    const nodes = buildChildNodes({
      prefix: 'src',
      entries: ['src/z.ts', 'src/a-dir/', 'src/nested/file.ts', 'docs/readme.md'],
    })
    expect(nodes).toEqual([
      expect.objectContaining({ id: 'src/a-dir', parentId: 'src', kind: 'directory', hasChildren: true }),
      expect.objectContaining({ id: 'src/z.ts', parentId: 'src', kind: 'file' }),
    ])
  })

  test('strips absolute paths and parent traversals', () => {
    const nodes = buildChildNodes({
      prefix: '',
      entries: ['../etc/passwd', '/abs/file.ts', 'good.ts', 'dir/'],
    })
    const ids = nodes.map((node) => node.id)
    expect(ids).toEqual(['dir', 'good.ts'])
  })

  test('truncates large direct-child result sets', () => {
    const entries = Array.from({ length: MAX_REPO_TREE_NODES + 16 }, (_, index) => `f${index}.txt`)
    const result = buildLimitedChildNodes({ prefix: '', entries, maxNodes: MAX_REPO_TREE_NODES })

    expect(result.nodes).toHaveLength(MAX_REPO_TREE_NODES)
    expect(result.truncated).toBe(true)
  })
})

const remoteMocks = vi.hoisted(() => ({
  getRemoteTreeWalk: vi.fn(),
}))

vi.mock('#/system/ssh/git.ts', () => ({
  getRemoteTreeWalk: remoteMocks.getRemoteTreeWalk,
}))

function remoteTarget(): RemoteRepoTarget {
  return {
    id: 'goblin+ssh://mybox/myrepo',
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

describe('repo-tree-source — remote direct children', () => {
  beforeEach(() => {
    remoteMocks.getRemoteTreeWalk.mockReset()
  })

  test('rejects when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      getRepoTreeSourceRemote(makeRemoteInput('/srv/repos/myrepo/.worktrees/feature', {}, controller.signal)),
    ).rejects.toThrow('aborted')
    expect(remoteMocks.getRemoteTreeWalk).not.toHaveBeenCalled()
  })

  test('walks NUL-separated direct entries into directory and file nodes', async () => {
    remoteMocks.getRemoteTreeWalk.mockResolvedValueOnce({
      ok: true,
      message: ['/srv/repos/myrepo/.worktrees/feature/README.md', '/srv/repos/myrepo/.worktrees/feature/src/'].join(
        NUL,
      ),
    })

    const result = await getRepoTreeSourceRemote(makeRemoteInput('/srv/repos/myrepo/.worktrees/feature'))
    expect(result.nodes).toEqual([
      expect.objectContaining({ id: 'src', parentId: null, kind: 'directory', hasChildren: true }),
      expect.objectContaining({ id: 'README.md', parentId: null, kind: 'file' }),
    ])
  })

  test('passes prefix to the remote tree walk', async () => {
    remoteMocks.getRemoteTreeWalk.mockResolvedValueOnce({ ok: true, message: 'src/a.ts' })

    await getRepoTreeSourceRemote(makeRemoteInput('/srv/repos/myrepo/.worktrees/feature', { prefix: 'src' }))

    expect(remoteMocks.getRemoteTreeWalk).toHaveBeenCalledWith(
      remoteTarget(),
      '/srv/repos/myrepo/.worktrees/feature',
      expect.objectContaining({ prefix: 'src' }),
    )
  })

  test('drops entries outside the requested worktree or prefix', async () => {
    remoteMocks.getRemoteTreeWalk.mockResolvedValueOnce({
      ok: true,
      message: [
        '/srv/repos/myrepo/.worktrees/feature/src/a.ts',
        '/srv/repos/myrepo/.worktrees/feature/src/nested/file.ts',
        '/srv/repos/myrepo/.worktrees/feature/docs/readme.md',
        '/srv/repos/other-worktree/secret.ts',
      ].join(NUL),
    })

    const result = await getRepoTreeSourceRemote(
      makeRemoteInput('/srv/repos/myrepo/.worktrees/feature', { prefix: 'src' }),
    )
    expect(result.nodes.map((node) => node.id)).toEqual(['src/a.ts'])
  })

  test('rejects when the remote walk fails', async () => {
    remoteMocks.getRemoteTreeWalk.mockResolvedValueOnce({ ok: false, message: 'no worktree found' })
    await expect(getRepoTreeSourceRemote(makeRemoteInput('/srv/repos/myrepo/.worktrees/feature'))).rejects.toThrow(
      'no worktree found',
    )
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
