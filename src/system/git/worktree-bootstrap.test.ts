import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import { bootstrapWorktreeAfterCreate } from '#/system/git/worktree-bootstrap.ts'

const mocks = vi.hoisted(() => ({
  getRepoRoot: vi.fn(),
}))

vi.mock('#/system/git/branches.ts', () => ({
  getRepoRoot: mocks.getRepoRoot,
}))

let tmp = ''
let sourceRoot = ''
let targetRoot = ''

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'worktree-bootstrap-test-'))
  sourceRoot = path.join(tmp, 'repo')
  targetRoot = path.join(tmp, 'repo-worktree')
  await mkdir(sourceRoot, { recursive: true })
  await mkdir(targetRoot, { recursive: true })
  mocks.getRepoRoot.mockResolvedValue(sourceRoot)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('worktree bootstrap', () => {
  test('does nothing when goblin.toml is absent', async () => {
    const result = await bootstrapWorktreeAfterCreate(sourceRoot, targetRoot)

    expect(result).toEqual({ ok: true, message: '' })
    expect(mocks.getRepoRoot).toHaveBeenCalledWith(sourceRoot, { signal: undefined })
  })

  test('copies, symlinks, hardlinks, excludes, and runs setup', async () => {
    await writeFile(path.join(sourceRoot, '.env.local'), 'TOKEN=placeholder\n')
    await mkdir(path.join(sourceRoot, 'config'), { recursive: true })
    await writeFile(path.join(sourceRoot, 'config', 'app.json'), '{"ok":true}\n')
    await writeFile(path.join(sourceRoot, 'config', 'debug.log'), 'skip\n')
    await writeFile(path.join(sourceRoot, 'linked.txt'), 'linked\n')
    await writeFile(path.join(sourceRoot, 'cache.db'), 'cache\n')
    const setupCommand = `${JSON.stringify(process.execPath)} -e "require('node:fs').writeFileSync('setup.txt', 'done')"`
    await writeConfig(`
[worktree]
copy = [".env.local", "config/*"]
symlink = ["linked.txt"]
hardlink = ["cache.db"]
exclude = ["config/*.log"]
setup = ${JSON.stringify(setupCommand)}
`)

    const result = await bootstrapWorktreeAfterCreate(sourceRoot, targetRoot)

    expect(result).toEqual({
      ok: true,
      message: [
        'Copied 2 paths: .env.local, config/app.json',
        'Symlinked 1 path: linked.txt',
        'Hardlinked 1 path: cache.db',
        `Ran setup: ${setupCommand}`,
      ].join('\n'),
      worktreeBootstrap: {
        copy: { count: 2, paths: ['.env.local', 'config/app.json'] },
        symlink: { count: 1, paths: ['linked.txt'] },
        hardlink: { count: 1, paths: ['cache.db'] },
        skippedMissing: { count: 0, paths: [] },
        setup: { command: setupCommand },
      },
    })
    await expect(readFile(path.join(targetRoot, '.env.local'), 'utf8')).resolves.toBe('TOKEN=placeholder\n')
    await expect(readFile(path.join(targetRoot, 'config', 'app.json'), 'utf8')).resolves.toBe('{"ok":true}\n')
    await expect(readFile(path.join(targetRoot, 'config', 'debug.log'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(readlink(path.join(targetRoot, 'linked.txt'))).resolves.toBe(path.join(sourceRoot, 'linked.txt'))
    const sourceCache = await stat(path.join(sourceRoot, 'cache.db'))
    const targetCache = await stat(path.join(targetRoot, 'cache.db'))
    expect(targetCache.ino).toBe(sourceCache.ino)
    await expect(readFile(path.join(targetRoot, 'setup.txt'), 'utf8')).resolves.toBe('done')
  })

  test('reports missing literal sources without failing create', async () => {
    await writeConfig(`
[worktree]
copy = ["missing.env"]
`)

    const result = await bootstrapWorktreeAfterCreate(sourceRoot, targetRoot)

    expect(result).toEqual({
      ok: true,
      message: 'Skipped missing 1 path: missing.env',
      worktreeBootstrap: {
        copy: { count: 0, paths: [] },
        symlink: { count: 0, paths: [] },
        hardlink: { count: 0, paths: [] },
        skippedMissing: { count: 1, paths: ['missing.env'] },
      },
    })
  })

  test('applies excludes inside copied directory trees', async () => {
    await mkdir(path.join(sourceRoot, 'config', 'nested'), { recursive: true })
    await writeFile(path.join(sourceRoot, 'config', 'app.json'), '{"ok":true}\n')
    await writeFile(path.join(sourceRoot, 'config', 'debug.log'), 'skip\n')
    await writeFile(path.join(sourceRoot, 'config', 'nested', 'trace.log'), 'skip nested\n')
    await writeConfig(`
[worktree]
copy = ["config"]
exclude = ["config/*.log", "config/nested"]
`)

    const result = await bootstrapWorktreeAfterCreate(sourceRoot, targetRoot)

    expect(result).toMatchObject({
      ok: true,
      worktreeBootstrap: {
        copy: { count: 1, paths: ['config'] },
      },
    })
    await expect(readFile(path.join(targetRoot, 'config', 'app.json'), 'utf8')).resolves.toBe('{"ok":true}\n')
    await expect(readFile(path.join(targetRoot, 'config', 'debug.log'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(readFile(path.join(targetRoot, 'config', 'nested', 'trace.log'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  test('removes operations nested under excluded parent paths', async () => {
    await mkdir(path.join(sourceRoot, 'config'), { recursive: true })
    await writeFile(path.join(sourceRoot, 'config', 'app.json'), '{"ok":true}\n')
    await writeFile(path.join(sourceRoot, 'config', 'debug.log'), 'skip\n')
    await writeConfig(`
[worktree]
copy = ["config/*"]
exclude = ["config"]
`)

    const result = await bootstrapWorktreeAfterCreate(sourceRoot, targetRoot)

    expect(result).toEqual({ ok: true, message: '' })
    await expect(readFile(path.join(targetRoot, 'config', 'app.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(readFile(path.join(targetRoot, 'config', 'debug.log'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  test('does not copy git metadata from copied directory trees', async () => {
    await mkdir(path.join(sourceRoot, 'config', '.git'), { recursive: true })
    await writeFile(path.join(sourceRoot, 'config', '.git', 'config'), 'skip\n')
    await writeFile(path.join(sourceRoot, 'config', 'app.json'), '{"ok":true}\n')
    await writeConfig(`
[worktree]
copy = ["config"]
`)

    const result = await bootstrapWorktreeAfterCreate(sourceRoot, targetRoot)

    expect(result.ok).toBe(true)
    await expect(readFile(path.join(targetRoot, 'config', 'app.json'), 'utf8')).resolves.toBe('{"ok":true}\n')
    await expect(readFile(path.join(targetRoot, 'config', '.git', 'config'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  test.each([
    ['path escape', '../secret.env', 'escapes repo root'],
    ['git metadata', '.git/config', 'must not target .git'],
    ['repo root', '.', 'must not target repo root'],
    ['windows drive-relative path', 'C:secret.env', 'must be relative'],
    ['windows drive-absolute path', String.raw`C:\secret.env`, 'must be relative'],
    ['windows rooted path', String.raw`\secret.env`, 'must be relative'],
  ])('rejects unsafe %s entries', async (_name, entry, message) => {
    await writeConfig(`
[worktree]
copy = [${JSON.stringify(entry)}]
`)

    const result = await bootstrapWorktreeAfterCreate(sourceRoot, targetRoot)

    expect(result.ok).toBe(false)
    expect(result.message).toContain(message)
  })

  test('fails when a destination already exists and does not write later entries', async () => {
    await writeFile(path.join(sourceRoot, '.env.local'), 'source\n')
    await writeFile(path.join(sourceRoot, 'later.txt'), 'later\n')
    await writeFile(path.join(targetRoot, '.env.local'), 'target\n')
    await writeConfig(`
[worktree]
copy = [".env.local", "later.txt"]
`)

    const result = await bootstrapWorktreeAfterCreate(sourceRoot, targetRoot)

    expect(result).toEqual({
      ok: false,
      message: 'Worktree bootstrap failed: destination already exists: .env.local',
    })
    await expect(readFile(path.join(targetRoot, 'later.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('fails when one path is matched by multiple materialization modes', async () => {
    await writeFile(path.join(sourceRoot, 'shared.local'), 'value\n')
    await writeConfig(`
[worktree]
copy = ["*.local"]
symlink = ["shared.local"]
`)

    const result = await bootstrapWorktreeAfterCreate(sourceRoot, targetRoot)

    expect(result).toEqual({
      ok: false,
      message: 'Worktree bootstrap failed: path matches multiple materialization modes: shared.local',
    })
  })

  test('rejects hardlinking directories', async () => {
    await mkdir(path.join(sourceRoot, 'cache'), { recursive: true })
    await writeConfig(`
[worktree]
hardlink = ["cache"]
`)

    const result = await bootstrapWorktreeAfterCreate(sourceRoot, targetRoot)

    expect(result).toEqual({
      ok: false,
      message: 'Worktree bootstrap failed: hardlink source is not a file: cache',
    })
  })

  test('fails when setup exits non-zero', async () => {
    const setupCommand = `${JSON.stringify(process.execPath)} -e "process.exit(7)"`
    await writeConfig(`
[worktree]
setup = ${JSON.stringify(setupCommand)}
`)

    const result = await bootstrapWorktreeAfterCreate(sourceRoot, targetRoot)

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Worktree bootstrap failed:')
  })

  test('preserves copied symlinks instead of following them outside the repo', async () => {
    const outside = path.join(tmp, 'outside.txt')
    await writeFile(outside, 'outside\n')
    await symlink(outside, path.join(sourceRoot, 'local-link'))
    await writeConfig(`
[worktree]
copy = ["local-link"]
`)

    const result = await bootstrapWorktreeAfterCreate(sourceRoot, targetRoot)

    expect(result).toMatchObject({
      ok: true,
      message: 'Copied 1 path: local-link',
      worktreeBootstrap: {
        copy: { count: 1, paths: ['local-link'] },
      },
    })
    await expect(readlink(path.join(targetRoot, 'local-link'))).resolves.toBe(outside)
  })
})

async function writeConfig(contents: string): Promise<void> {
  await writeFile(path.join(sourceRoot, 'goblin.toml'), contents.trimStart())
}
