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
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
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
    const withConnection = (effectiveConfig: string): RemoteRepoTarget => {
      const remote = target()
      return { ...remote, sshConnection: buildCanonicalSshConnectionSnapshot(remote, effectiveConfig) }
    }
    const controlPath = (remote: RemoteRepoTarget): string | undefined =>
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

describe('remote gitWorktreeListAndStatus script (F5 end-to-end)', () => {
  // F5: the previous sequential `while read -r wt; do ...; done`
  // serialised per-worktree git status. The fix parallelises with
  // indexed tmp files then concatenates in order.
  // These tests run the real POSIX shell script against a local git repo
  // (the script does not touch the network)
  // and verify the output is parseable by the existing parsers.

  testPosix('emits the worktree list above the boundary and NUL-batched status below', async () => {
    const repoDir = await initRepoWithWorktrees([
      { branch: 'main', files: [['README.md', 'root readme\n']] },
      { branch: 'feature', files: [['src/index.ts', 'export {}\n']] },
    ])

    const invocation = buildRemoteCommandInvocation(targetWithPath(repoDir), {
      type: 'gitWorktreeListAndStatus',
      path: repoDir,
    })

    const result = await execa('sh', ['-lc', invocation.script])

    // Boundary marker must appear on its own line. The script emits
    // it via `printf '\n%s\n' '<marker>'` so it is its own line in
    // stdout -- the parser searches for `\n<marker>\n`. Every line
    // in `git worktree list --porcelain` is prefixed by a keyword
    // (`worktree`, `HEAD`, `branch`, `detached`, `bare`, `locked`),
    // so the marker text can never be produced as a standalone
    // legitimate line.
    const lines = result.stdout.split('\n')
    const boundary = lines.indexOf('__GOBLIN_WT_BATCH_BOUNDARY__')
    expect(boundary).toBeGreaterThan(0)

    // The worktree list block above the boundary must mention every
    // worktree; the section below must include one NUL-terminated
    // path per non-bare worktree followed by its status records.
    const listBlock = lines.slice(0, boundary).join('\n')
    expect(listBlock).toContain('worktree ')

    // Round-trip the result through the parser pipeline. The script's
    // output must satisfy the same shape the production code
    // expects.
    const { splitWorktreeStatusBatch } = await import('#/system/git/parsers.ts')
    const { statusStream } = splitWorktreeStatusBatch(result.stdout)
    const { parseWorktreeStatusBatch } = await import('#/system/git/parsers.ts')
    const parsed = parseWorktreeStatusBatch(statusStream)
    expect(parsed.size).toBe(2)
  })

  testPosix('accepts a bare-only repository as a complete empty status read', async () => {
    const repoDir = path.join(os.tmpdir(), `goblin-ssh-bare-test-${Date.now()}-${process.pid}`)
    tempDirs.push(repoDir)
    await execa('git', ['init', '--bare', repoDir])
    const invocation = buildRemoteCommandInvocation(targetWithPath(repoDir), {
      type: 'gitWorktreeListAndStatus',
      path: repoDir,
    })

    const result = await execa('sh', ['-lc', invocation.script])
    const { parseWorktreeStatusBatch, parseWorktrees, splitWorktreeStatusBatch } =
      await import('#/system/git/parsers.ts')
    const { worktreeListOutput, statusStream } = splitWorktreeStatusBatch(result.stdout)

    expect(parseWorktrees(worktreeListOutput)).toEqual([
      expect.objectContaining({ path: realpathSync(repoDir), isBare: true }),
    ])
    expect(parseWorktreeStatusBatch(statusStream).size).toBe(0)
  })

  testPosix('skips prunable worktrees before running remote status jobs', async () => {
    const repoDir = await initRepoWithWorktrees([
      { branch: 'main', files: [['README.md', 'root\n']] },
      { branch: 'stale', files: [] },
    ])
    const stalePath = path.join(repoDir, '.worktrees', 'stale')
    renameSync(stalePath, path.join(repoDir, 'removed-stale-worktree'))
    const invocation = buildRemoteCommandInvocation(targetWithPath(repoDir), {
      type: 'gitWorktreeListAndStatus',
      path: repoDir,
    })

    const result = await execa('sh', ['-lc', invocation.script])
    const { parseUsableWorktrees, parseWorktreeStatusBatch, parseWorktrees, splitWorktreeStatusBatch } =
      await import('#/system/git/parsers.ts')
    const { worktreeListOutput, statusStream } = splitWorktreeStatusBatch(result.stdout)

    expect(worktreeListOutput).toContain('prunable ')
    expect(parseWorktrees(worktreeListOutput)).toEqual([
      expect.objectContaining({ path: realpathSync(repoDir), isPrimary: true }),
      expect.objectContaining({ isPrunable: true }),
    ])
    expect(parseUsableWorktrees(worktreeListOutput)).toEqual([
      expect.objectContaining({ path: realpathSync(repoDir), isPrimary: true }),
    ])
    expect([...parseWorktreeStatusBatch(statusStream).keys()]).toEqual([realpathSync(repoDir)])
  })

  testPosix('runs per-worktree status work in parallel via POSIX background jobs (F5 regression check)', async () => {
    // The script source must contain the parallelisation primitives
    // we documented; a future refactor that re-serialises the loop
    // will be caught here. We use POSIX background processes (`&` +
    // `wait`) rather than `xargs -P` because:
    //   - xargs `-I {}` collapses whitespace in the input line,
    //     which would eat the TAB separator inside `<idx>\t<path>`
    //     jobs.
    //   - xargs `-n2` against a NUL stream silently drops the last
    //     record on odd job counts under GNU xargs with `-x`.
    // Background processes keep the whole line intact and the ordering comes from
    // zero-padded `<idx>.out` filenames globbed in numeric order.
    const repoDir = await initRepoWithWorktrees([{ branch: 'main', files: [] }])
    const invocation = buildRemoteCommandInvocation(targetWithPath(repoDir), {
      type: 'gitWorktreeListAndStatus',
      path: repoDir,
    })
    // The script must launch background workers (`&` lines inside
    // the while loop) and bound concurrency via a semaphore.
    expect(invocation.script).toMatch(/&$/m)
    expect(invocation.script).toMatch(/wait "\$first_pid"/)
    expect(invocation.script).toMatch(/max_in_flight=8/)
    expect(invocation.script).toMatch(/mktemp -d/)
    expect(invocation.script).toContain('mv "$tmp" "$out"')
    expect(invocation.script).not.toMatch(/status --porcelain -z -uall[^\n]*\|\| true/)
    expect(invocation.script).not.toMatch(/wait -n/)
    expect(invocation.script).not.toMatch(/\$'\\t'/)
    // The previous serial-loop shape must NOT have crept back in.
    expect(invocation.script).not.toMatch(/while IFS= read -r wt;\s*do\s*$/m)
    expect(invocation.script).not.toMatch(/xargs .*-P/)
  })

  testPosix('preserves the original worktree-list order across parallel workers', async () => {
    // The script writes each per-worktree section to <tmpdir>/<idx>.out
    // and concatenates files in index order. If that step regresses
    // (e.g. someone removes the ordered concat loop), the parser
    // would mis-align sections with worktrees. We confirm the order
    // by leaving a unique untracked file in each worktree and
    // checking the parsed result keeps the same ordering as the
    // worktree list. Untracked files are easier to reason about
    // than tracked ones because each worktree sees only its own.
    const repoDir = await initRepoWithWorktrees([
      { branch: 'main', files: [] },
      { branch: 'feature-a', files: [] },
      { branch: 'feature-b', files: [] },
      { branch: 'feature-c', files: [] },
    ])

    // The worktrees themselves live under .worktrees/, which is
    // untracked from the primary worktree's point of view. Add a
    // .gitignore so the primary worktree's status is otherwise
    // empty -- otherwise the script's status stream gets cluttered
    // with paths that aren't part of the test's signal.
    writeFileSync(path.join(repoDir, '.gitignore'), '.worktrees\n')

    // Drop a unique untracked marker file in each worktree. The
    // primary worktree's marker goes at the root; the others live
    // inside their respective worktree directories. We resolve the
    // primary repo path via realpath because macOS aliases /var to
    // /private/var and `mktemp` returns the un-resolved path --
    // the parsed worktree list will use the canonical path.
    const canonicalRepoDir = realpathSync(repoDir)
    const markers: Array<[string, string]> = [
      [canonicalRepoDir, 'marker-main.txt'],
      [path.join(canonicalRepoDir, '.worktrees', 'feature-a'), 'marker-a.txt'],
      [path.join(canonicalRepoDir, '.worktrees', 'feature-b'), 'marker-b.txt'],
      [path.join(canonicalRepoDir, '.worktrees', 'feature-c'), 'marker-c.txt'],
    ]
    const expectedByWorktree = new Map<string, string>()
    for (const [wtPath, name] of markers) {
      writeFileSync(path.join(wtPath, name), `${name}\n`)
      expectedByWorktree.set(wtPath, name)
    }

    const invocation = buildRemoteCommandInvocation(targetWithPath(repoDir), {
      type: 'gitWorktreeListAndStatus',
      path: repoDir,
    })

    const result = await execa('sh', ['-lc', invocation.script])

    const { splitWorktreeStatusBatch, parseWorktreeStatusBatch } = await import('#/system/git/parsers.ts')
    const { worktreeListOutput, statusStream } = splitWorktreeStatusBatch(result.stdout)
    const { parseWorktrees } = await import('#/system/git/parsers.ts')
    const list = parseWorktrees(worktreeListOutput)
    const statuses = parseWorktreeStatusBatch(statusStream)

    // Each worktree in the list must have its marker file's status
    // entry in its status section. If sections were misaligned the
    // mapping would either miss or return the wrong worktree.
    for (const wt of list) {
      if (wt.isBare) continue
      const expected = expectedByWorktree.get(wt.path)
      expect(expected, `test fixture missing a marker for ${wt.path}`).toBeTruthy()
      const entries = statuses.get(wt.path) ?? []
      const found = entries.find((entry) => entry.path === expected)
      expect(
        found,
        `expected marker ${expected} in ${wt.path}, got ${JSON.stringify(entries.map((e) => e.path))}`,
      ).toBeTruthy()
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

function targetWithPath(repoPath: string): RemoteRepoTarget {
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

function target(): RemoteRepoTarget {
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
