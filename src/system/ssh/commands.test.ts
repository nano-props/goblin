import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterEach, describe, expect, test } from 'vitest'
import {
  buildCanonicalSshConnectionSnapshot,
  buildRemoteCommandInvocation,
  buildRemoteTerminalInvocation,
} from '#/system/ssh/commands.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const originalPath = process.env.PATH
const originalPathExt = process.env.PATHEXT
const tempDirs: string[] = []
const testPosix = process.platform === 'win32' ? test.skip : test

afterEach(() => {
  process.env.PATH = originalPath
  if (originalPathExt === undefined) delete process.env.PATHEXT
  else process.env.PATHEXT = originalPathExt
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('remote ssh command builders', () => {
  testPosix('encodes optional upstream as structured NUL fields', async () => {
    const repo = path.join(os.tmpdir(), `goblin-upstream-protocol-${process.pid}-${Date.now()}`)
    tempDirs.push(repo)
    mkdirSync(repo, { recursive: true })
    await execa('git', ['init', '-q', '-b', 'main', repo])
    await execa('git', ['-C', repo, 'config', 'user.name', 'Test User'])
    await execa('git', ['-C', repo, 'config', 'user.email', 'test@example.test'])
    await execa('git', ['-C', repo, 'commit', '--allow-empty', '-qm', 'initial'])

    const withoutUpstream = buildRemoteCommandInvocation(targetWithPath(repo), {
      type: 'gitUpstream',
      path: repo,
      branch: 'main',
    })
    await expect(execa('bash', ['-lc', withoutUpstream.script])).resolves.toMatchObject({ stdout: '\0\0\0' })

    await execa('git', ['-C', repo, 'remote', 'add', 'origin', 'https://example.test/repo.git'])
    await execa('git', ['-C', repo, 'config', 'branch.main.remote', 'origin'])
    await execa('git', ['-C', repo, 'config', 'branch.main.merge', 'refs/heads/main'])
    const withMissingTrackingRef = await execa('bash', ['-lc', withoutUpstream.script])
    expect(withMissingTrackingRef.stdout).toBe('refs/remotes/origin/main\0origin\0refs/heads/main\0')

    await execa('git', ['-C', repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD'])
    const withResolvableTrackingRef = await execa('bash', ['-lc', withoutUpstream.script])
    expect(withResolvableTrackingRef.stdout).toBe('refs/remotes/origin/main\0origin\0refs/heads/main\0=')
  })

  testPosix('encodes ancestor true and false while preserving Git errors', async () => {
    const repo = path.join(os.tmpdir(), `goblin-ancestor-protocol-${process.pid}-${Date.now()}`)
    tempDirs.push(repo)
    mkdirSync(repo, { recursive: true })
    await execa('git', ['init', '-q', '-b', 'main', repo])
    await execa('git', ['-C', repo, 'config', 'user.name', 'Test User'])
    await execa('git', ['-C', repo, 'config', 'user.email', 'test@example.test'])
    await execa('git', ['-C', repo, 'commit', '--allow-empty', '-qm', 'first'])
    await execa('git', ['-C', repo, 'branch', 'base'])
    await execa('git', ['-C', repo, 'commit', '--allow-empty', '-qm', 'second'])

    const invoke = async (ancestor: string, descendant: string) => {
      const invocation = buildRemoteCommandInvocation(targetWithPath(repo), {
        type: 'gitIsAncestor',
        path: repo,
        ancestor,
        descendant,
      })
      return await execa('bash', ['-lc', invocation.script], { reject: false })
    }

    await expect(invoke('base', 'main')).resolves.toMatchObject({ exitCode: 0, stdout: 'true' })
    await expect(invoke('main', 'base')).resolves.toMatchObject({ exitCode: 0, stdout: 'false' })
    const invalid = await invoke('missing-ref', 'main')
    expect(invalid.exitCode).not.toBe(0)
  })

  testPosix('reads a directory overview with spaces and hidden entries', async () => {
    const root = path.join(os.tmpdir(), `goblin-directory-overview-${process.pid}-${Date.now()}`)
    tempDirs.push(root)
    mkdirSync(path.join(root, 'nested folder'), { recursive: true })
    writeFileSync(path.join(root, 'visible file'), 'abc')
    writeFileSync(path.join(root, '.hidden'), '12345')
    writeFileSync(path.join(root, 'nested folder', 'child'), '1234567')
    const invocation = buildRemoteCommandInvocation(targetWithPath(root), {
      type: 'directoryOverview',
      path: root,
    })

    const result = await execa('sh', ['-lc', invocation.script])

    expect(result.stdout.trim().split('\n').at(-1)).toBe('2\t1\t15')
  })

  testPosix('keeps directory facts when recursive size collection fails', async () => {
    const root = path.join(os.tmpdir(), `goblin-directory-overview-partial-${process.pid}-${Date.now()}`)
    const bin = path.join(root, 'bin')
    tempDirs.push(root)
    mkdirSync(path.join(root, 'blocked'), { recursive: true })
    mkdirSync(bin)
    writeFileSync(path.join(root, 'visible'), 'abc')
    writeFileSync(path.join(root, 'blocked', 'nested'), 'not measurable')
    const statShim = path.join(bin, 'stat')
    writeFileSync(
      statShim,
      '#!/bin/sh\ncase "$*" in *blocked*) exit 1;; esac\nPATH=/usr/bin:/bin\nexport PATH\nexec stat "$@"\n',
    )
    chmodSync(statShim, 0o755)
    const invocation = buildRemoteCommandInvocation(targetWithPath(root), {
      type: 'directoryOverview',
      path: root,
    })

    const result = await execa('sh', ['-c', invocation.script], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
    })

    expect(result.stdout.trim().split('\n').at(-1)).toBe('1\t2\t-')
  })

  test('uses an ssh executable discovered on PATH', () => {
    const dir = path.join(os.tmpdir(), `goblin-ssh-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    mkdirSync(dir, { recursive: true })
    const executable = path.join(dir, process.platform === 'win32' ? 'ssh.exe' : 'ssh')
    writeFileSync(executable, '#!/bin/sh\nexit 0\n')
    if (process.platform !== 'win32') chmodSync(executable, 0o755)
    process.env.PATH = dir
    process.env.PATHEXT = '.EXE'

    const invocation = buildRemoteTerminalInvocation(target(), '/srv/repo', { cols: 80, rows: 24 })

    expect(invocation.command).toBe(executable)
  })

  test('falls back to the bare "ssh" name when no executable is on PATH', () => {
    process.env.PATH = path.join(os.tmpdir(), 'definitely-not-on-path-' + process.pid)
    delete process.env.PATHEXT

    const invocation = buildRemoteTerminalInvocation(target(), '/srv/repo', { cols: 80, rows: 24 })

    expect(invocation.command).toBe('ssh')
  })

  test('ignores non-executable ssh candidates on PATH', () => {
    const dir = path.join(os.tmpdir(), `goblin-ssh-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    mkdirSync(dir, { recursive: true })
    const candidate = path.join(dir, process.platform === 'win32' ? 'ssh.exe' : 'ssh')
    if (process.platform === 'win32') {
      mkdirSync(candidate)
    } else {
      writeFileSync(candidate, '#!/bin/sh\nexit 0\n')
      chmodSync(candidate, 0o644)
    }
    process.env.PATH = dir
    process.env.PATHEXT = '.EXE'

    const invocation = buildRemoteTerminalInvocation(target(), '/srv/repo', { cols: 80, rows: 24 })

    expect(invocation.command).toBe('ssh')
  })

  test('binds ControlPath to the complete captured SSH connection snapshot', () => {
    const withConnection = (effectiveConfig: string): RemoteWorkspaceTarget => {
      const remote = target()
      return { ...remote, sshConnection: buildCanonicalSshConnectionSnapshot(remote, effectiveConfig) }
    }
    const controlPath = (remote: RemoteWorkspaceTarget): string | undefined =>
      buildRemoteCommandInvocation(remote, { type: 'printHome' }).args.find((arg) => arg.startsWith('ControlPath='))
    const base = ['hostname example.test', 'user deploy', 'port 22', 'proxycommand route-a %n %h'].join('\n')
    const changedProxy = ['hostname example.test', 'user deploy', 'port 22', 'proxycommand route-b %n %h'].join('\n')
    const changedIdentity = [base, 'identityfile /keys/deploy-b'].join('\n')
    const changedHostKey = [base, 'hostkeyalias deploy-b', 'userknownhostsfile /known-hosts/b'].join('\n')

    expect(controlPath(withConnection(base))).toBe(controlPath(withConnection(base)))
    expect(controlPath(withConnection(changedProxy))).not.toBe(controlPath(withConnection(base)))
    expect(controlPath(withConnection(changedIdentity))).not.toBe(controlPath(withConnection(base)))
    expect(controlPath(withConnection(changedHostKey))).not.toBe(controlPath(withConnection(base)))
  })

  test('replays the alias as %n while captured HostName fixes %h for commands and terminals', () => {
    const remote = { ...target(), host: 'edge.example.test' }
    const sshConnection = buildCanonicalSshConnectionSnapshot(
      remote,
      ['hostname edge.example.test', 'user deploy', 'port 22', 'proxycommand route --alias %n --host %h'].join('\n'),
    )
    const captured = { ...remote, sshConnection }
    const command = buildRemoteCommandInvocation(captured, { type: 'printHome' })
    const terminal = buildRemoteTerminalInvocation(captured, '/srv/repo', { cols: 80, rows: 24 })

    for (const invocation of [command, terminal]) {
      expect(invocation.args).toEqual(
        expect.arrayContaining(['-F', expect.any(String), '-o', 'hostname=edge.example.test']),
      )
      expect(invocation.args).toContain('proxycommand=route --alias %n --host %h')
      expect(invocation.args.at(-2)).toBe('prod')
    }
  })

  test('remote terminal startup shell command runs before returning to an interactive shell', () => {
    const invocation = buildRemoteTerminalInvocation(
      target(),
      '/srv/repo worktree',
      { cols: 80, rows: 24 },
      { startupShellCommand: "  bat '/srv/repo worktree/README.md'\r" },
    )

    expect(invocation.script).toContain(
      `cd '/srv/repo worktree' && exec "\${SHELL:-/bin/sh}" -ilc '  bat '\\''/srv/repo worktree/README.md'\\''`,
    )
    expect(invocation.script).toContain('exec "${SHELL:-/bin/sh}" -l')
  })

  test('remote filesystem walk lists direct children without Git filtering', () => {
    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'directoryChildren',
      path: '/srv/repo worktree',
      prefix: 'src/app',
    })

    expect(invocation.script).toContain('find "$dir" -mindepth 1 -maxdepth 1')
    expect(invocation.script).not.toContain('check-ignore')
    expect(invocation.script).not.toContain('ls-files -- "$rel"')
    expect(invocation.script).toContain('error.workspace-path-not-found')
  })

  test('remote Git worktree walk decorates direct children with ignore state', () => {
    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'gitDirectoryChildren',
      path: '/srv/repo worktree',
      prefix: 'src/app',
    })

    expect(invocation.script).toContain('check-ignore')
    expect(invocation.script).toContain('ls-files -- "$rel"')
    expect(invocation.script).not.toContain('ls-files -co --exclude-standard -z')
  })

  test('remote commandExists checks the command in the remote login shell', () => {
    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'commandExists',
      path: '/srv/repo worktree',
      commandName: 'bat',
    })

    expect(invocation.script).toContain("cd -- '/srv/repo worktree'")
    expect(invocation.script).toContain('"$SHELL" -ilc')
    expect(invocation.script).toContain("command -v '\\''bat'\\'' >/dev/null 2>&1")
  })

  test('remote commandExists rejects unsafe command names', () => {
    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'commandExists',
      path: '/srv/repo',
      commandName: 'bat; touch /tmp/pwned',
    })

    expect(invocation.script).toBe('exit 1')
  })

  test('remote branch delete push quotes remote and branch arguments', () => {
    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'gitPushDeleteBranch',
      path: '/srv/repo worktree',
      remote: 'origin',
      branch: "topic/feature with 'quote'",
    })

    expect(invocation.script).toContain("git -C '/srv/repo worktree' push --delete -- 'origin'")
    expect(invocation.script).toContain("'topic/feature with '\\''quote'\\'''")
  })

  test('remote bootstrap script handles space paths and excludes copied tree children', async () => {
    const dir = path.join(os.tmpdir(), `goblin-remote-bootstrap-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    const sourceRoot = path.join(dir, 'repo root')
    const targetRoot = path.join(dir, 'worktree root')
    mkdirSync(path.join(sourceRoot, 'config dir', '.git'), { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    writeFileSync(path.join(sourceRoot, 'foo bar.txt'), 'space\n')
    writeFileSync(path.join(sourceRoot, 'config dir', 'app.json'), 'ok\n')
    writeFileSync(path.join(sourceRoot, 'config dir', 'debug.log'), 'skip\n')
    writeFileSync(path.join(sourceRoot, 'config dir', '.git', 'config'), 'skip git\n')

    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'bootstrapRemoteWorktree',
      sourceRoot,
      targetRoot,
      copy: ['foo bar.txt', 'config dir'],
      symlink: [],
      hardlink: [],
      exclude: ['config dir/*.log'],
    })

    const result = await execa('bash', ['-lc', invocation.script])

    expect(result.stdout.split('\n')).toEqual(['GOBLIN_BOOTSTRAP_COPY foo bar.txt', 'GOBLIN_BOOTSTRAP_COPY config dir'])
    expect(readFileSync(path.join(targetRoot, 'foo bar.txt'), 'utf8')).toBe('space\n')
    expect(readFileSync(path.join(targetRoot, 'config dir', 'app.json'), 'utf8')).toBe('ok\n')
    expect(existsSync(path.join(targetRoot, 'config dir', 'debug.log'))).toBe(false)
    expect(existsSync(path.join(targetRoot, 'config dir', '.git', 'config'))).toBe(false)
  })

  testPosix('remote bootstrap script rejects sources under a symlink parent', async () => {
    const dir = path.join(os.tmpdir(), `goblin-remote-bootstrap-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    const sourceRoot = path.join(dir, 'repo')
    const targetRoot = path.join(dir, 'worktree')
    const outside = path.join(dir, 'outside')
    mkdirSync(sourceRoot, { recursive: true })
    mkdirSync(outside, { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    writeFileSync(path.join(outside, 'secret.txt'), 'secret\n')
    symlinkSync(outside, path.join(sourceRoot, 'linked-dir'), 'dir')

    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'bootstrapRemoteWorktree',
      sourceRoot,
      targetRoot,
      copy: ['linked-dir/secret.txt'],
      symlink: [],
      hardlink: [],
      exclude: [],
    })

    const result = await execa('bash', ['-lc', invocation.script], { reject: false })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('bootstrap path uses symlink parent: linked-dir')
    expect(existsSync(path.join(targetRoot, 'linked-dir', 'secret.txt'))).toBe(false)
  })

  testPosix('remote bootstrap script rejects targets under a symlink parent', async () => {
    const dir = path.join(os.tmpdir(), `goblin-remote-bootstrap-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    const sourceRoot = path.join(dir, 'repo')
    const targetRoot = path.join(dir, 'worktree')
    const outside = path.join(dir, 'outside')
    mkdirSync(path.join(sourceRoot, 'linked-dir'), { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(path.join(sourceRoot, 'linked-dir', 'secret.txt'), 'secret\n')
    symlinkSync(outside, path.join(targetRoot, 'linked-dir'), 'dir')

    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'bootstrapRemoteWorktree',
      sourceRoot,
      targetRoot,
      copy: ['linked-dir/secret.txt'],
      symlink: [],
      hardlink: [],
      exclude: [],
    })

    const result = await execa('bash', ['-lc', invocation.script], { reject: false })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('bootstrap target path uses symlink parent: linked-dir')
    expect(existsSync(path.join(outside, 'secret.txt'))).toBe(false)
  })

  testPosix('readRemoteFile fails when the path is not a regular file', async () => {
    const dir = path.join(os.tmpdir(), `goblin-remote-read-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    mkdirSync(dir, { recursive: true })

    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'readRemoteFile',
      path: dir,
    })

    const result = await execa('bash', ['-lc', invocation.script], { reject: false })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(`error: remote file is not readable: ${dir}`)
  })

  test('remote bootstrap script keeps setup output out of the marker stream', async () => {
    const dir = path.join(os.tmpdir(), `goblin-remote-bootstrap-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    const sourceRoot = path.join(dir, 'repo')
    const targetRoot = path.join(dir, 'worktree')
    mkdirSync(sourceRoot, { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    const setup = "printf 'GOBLIN_BOOTSTRAP_COPY spoofed\\n'; printf 'setup stderr\\n' >&2"

    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'bootstrapRemoteWorktree',
      sourceRoot,
      targetRoot,
      copy: [],
      symlink: [],
      hardlink: [],
      exclude: [],
      setup,
    })

    const result = await execa('bash', ['-lc', invocation.script], { env: { SHELL: '/bin/sh' } })

    expect(result.stdout).toBe(`GOBLIN_BOOTSTRAP_SETUP ${setup}`)
    expect(result.stderr).toBe('')
  })

  test('remote bootstrap script rejects ambiguous paths before writing', async () => {
    const dir = path.join(os.tmpdir(), `goblin-remote-bootstrap-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    const sourceRoot = path.join(dir, 'repo')
    const targetRoot = path.join(dir, 'worktree')
    mkdirSync(sourceRoot, { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    writeFileSync(path.join(sourceRoot, 'shared.local'), 'value\n')

    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'bootstrapRemoteWorktree',
      sourceRoot,
      targetRoot,
      copy: ['*.local'],
      symlink: ['shared.local'],
      hardlink: [],
      exclude: [],
    })

    const result = await execa('bash', ['-lc', invocation.script], { reject: false })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('path matches multiple materialization modes: shared.local')
    expect(existsSync(path.join(targetRoot, 'shared.local'))).toBe(false)
  })

  test('remote bootstrap script ignores .git matches from globs', async () => {
    const dir = path.join(os.tmpdir(), `goblin-remote-bootstrap-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    const sourceRoot = path.join(dir, 'repo')
    const targetRoot = path.join(dir, 'worktree')
    mkdirSync(path.join(sourceRoot, 'config', '.git'), { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    writeFileSync(path.join(sourceRoot, 'config', 'app.json'), 'ok\n')
    writeFileSync(path.join(sourceRoot, 'config', '.git', 'config'), 'skip git\n')

    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'bootstrapRemoteWorktree',
      sourceRoot,
      targetRoot,
      copy: ['config/*'],
      symlink: [],
      hardlink: [],
      exclude: [],
    })

    const result = await execa('bash', ['-lc', invocation.script])

    expect(result.stdout).toBe('GOBLIN_BOOTSTRAP_COPY config/app.json')
    expect(readFileSync(path.join(targetRoot, 'config', 'app.json'), 'utf8')).toBe('ok\n')
    expect(existsSync(path.join(targetRoot, 'config', '.git', 'config'))).toBe(false)
  })

  testPosix('remote bootstrap script fails when a materialization command fails', async () => {
    const dir = path.join(os.tmpdir(), `goblin-remote-bootstrap-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    const sourceRoot = path.join(dir, 'repo')
    const targetRoot = path.join(dir, 'worktree')
    mkdirSync(sourceRoot, { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    writeFileSync(path.join(sourceRoot, 'a.txt'), 'a\n')
    chmodSync(targetRoot, 0o500)

    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'bootstrapRemoteWorktree',
      sourceRoot,
      targetRoot,
      copy: ['a.txt'],
      symlink: [],
      hardlink: [],
      exclude: [],
    })

    try {
      const result = await execa('bash', ['-lc', invocation.script], { reject: false })

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('failed to copy a.txt')
      expect(existsSync(path.join(targetRoot, 'a.txt'))).toBe(false)
    } finally {
      chmodSync(targetRoot, 0o700)
    }
  })
})


async function initRepoWithWorktrees(
  specs: Array<{ branch: string; files: Array<[string, string]> }>,
): Promise<string> {
  const dir = path.join(os.tmpdir(), `goblin-wt-batch-${Date.now()}-${process.pid}`)
  tempDirs.push(dir)
  mkdirSync(dir, { recursive: true })

  const runGit = async (...args: string[]): Promise<void> => {
    await execa('git', ['-C', dir, ...args])
  }

  await runGit('init', '-q', '--initial-branch=main')
  await runGit('config', 'user.email', 'test@goblin.local')
  await runGit('config', 'user.name', 'Goblin Test')

  // The primary worktree IS dir itself; no separate create needed.
  for (const [name, contents] of specs[0]?.files ?? []) {
    const filePath = path.join(dir, name)
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, contents)
  }
  // `git add` with the empty allow-empty / always-create flag is
  // not what we want; this is the standard "stage and commit"
  // pair. The first commit must have content, otherwise `git status`
  // will report "nothing to commit" against the primary worktree
  // and the script has no records to emit.
  await runGit('add', '-A')
  if (specs[0]?.files?.length) {
    await runGit('commit', '-q', '-m', 'initial')
  }

  // Create additional worktrees for each subsequent spec.
  for (let i = 1; i < specs.length; i++) {
    const spec = specs[i]!
    const wtPath = path.join(dir, '.worktrees', spec.branch)
    await runGit('worktree', 'add', '-b', spec.branch, wtPath)
    if (spec.files.length === 0) continue
    for (const [name, contents] of spec.files) {
      const filePath = path.join(wtPath, name)
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, contents)
    }
    await execa('git', ['-C', wtPath, 'add', '-A'])
    await execa('git', ['-C', wtPath, 'commit', '-q', '-m', spec.branch])
  }

  return dir
}

function targetWithPath(repoPath: string): RemoteWorkspaceTarget {
  return {
    id: workspaceIdForTest(`goblin+ssh://prod${repoPath}`),
    alias: 'prod',
    host: 'example.test',
    user: 'deploy',
    port: 22,
    remotePath: repoPath,
    displayName: `prod:${path.basename(repoPath)}`,
  }
}

function target(): RemoteWorkspaceTarget {
  return {
    id: workspaceIdForTest('goblin+ssh://prod/srv/repo'),
    alias: 'prod',
    host: 'example.test',
    user: 'deploy',
    port: 22,
    remotePath: '/srv/repo',
    displayName: 'prod:repo',
  }
}
