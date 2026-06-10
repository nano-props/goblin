// Unit tests for the pure git output parsers. Run with `bun run test`.
//
// Each test feeds hand-crafted git output (with the actual byte
// separators git emits) and asserts the resulting domain objects.
// Tests double as documentation for the exact output shape we expect
// from each git command.

import { describe, expect, test } from 'vitest'
import { FIELD_SEP, parseBranches, parseLog, parseStatus, parseWorktrees } from '#/system/git/parsers.ts'

const SEP = FIELD_SEP

describe('parseBranches', () => {
  test('returns empty array for empty input', () => {
    expect(parseBranches('', '')).toEqual([])
  })

  test('parses a single branch with no upstream', () => {
    const line = ['main', 'abc1234', 'initial commit', '2026-05-20T10:00:00+08:00', 'Alice', '', ''].join(SEP)
    const result = parseBranches(line, 'main')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'main',
      isCurrent: true,
      ahead: 0,
      behind: 0,
      lastCommitHash: 'abc1234',
      lastCommitMessage: 'initial commit',
      lastCommitDate: '2026-05-20T10:00:00+08:00',
      lastCommitAuthor: 'Alice',
    })
    expect(result[0]?.tracking).toBeUndefined()
    expect(result[0]?.trackingGone).toBeUndefined()
  })

  test('parses ahead/behind from track string', () => {
    const line = [
      'feature',
      'def5678',
      'wip',
      '2026-05-20T10:00:00+08:00',
      'Bob',
      'origin/feature',
      '[ahead 3, behind 2]',
    ].join(SEP)
    const [b] = parseBranches(line, 'main')
    expect(b?.ahead).toBe(3)
    expect(b?.behind).toBe(2)
    expect(b?.tracking).toBe('origin/feature')
    expect(b?.trackingGone).toBe(false)
  })

  test('flags trackingGone when upstream marked [gone]', () => {
    const line = ['stale', 'aaa1111', 'old', '2026-05-20T10:00:00+08:00', 'Carol', 'origin/stale', '[gone]'].join(SEP)
    const [b] = parseBranches(line, 'main')
    expect(b?.tracking).toBe('origin/stale')
    expect(b?.trackingGone).toBe(true)
    expect(b?.ahead).toBe(0)
    expect(b?.behind).toBe(0)
  })

  test('marks isCurrent only for the matching branch', () => {
    const out = [['main', 'a', 's', 'd', 'a1', '', ''].join(SEP), ['dev', 'b', 's', 'd', 'a1', '', ''].join(SEP)].join(
      '\n',
    )
    const result = parseBranches(out, 'dev')
    expect(result.find((b) => b.name === 'main')?.isCurrent).toBe(false)
    expect(result.find((b) => b.name === 'dev')?.isCurrent).toBe(true)
  })

  test('attaches worktree info when branch matches', () => {
    const line = ['feat', 'h', 's', 'd', 'a', '', ''].join(SEP)
    const result = parseBranches(line, 'main', [
      { path: '/wt/feat', branch: 'feat', isBare: false, isPrimary: false, isDirty: true, changeCount: 3 },
    ])
    expect(result[0]?.worktree?.path).toBe('/wt/feat')
    expect(result[0]?.worktree?.summary?.dirty).toBe(true)
    expect(result[0]?.worktree?.isPrimary).toBe(false)
    expect(result[0]?.worktree?.summary?.changeCount).toBe(3)
  })

  test('attaches primary worktree marker when branch matches the main worktree', () => {
    const line = ['main', 'h', 's', 'd', 'a', '', ''].join(SEP)
    const [branch] = parseBranches(line, 'feature', [{ path: '/repo', branch: 'main', isBare: false, isPrimary: true }])
    expect(branch?.worktree?.path).toBe('/repo')
    expect(branch?.worktree?.isPrimary).toBe(true)
    expect(branch?.worktree).not.toHaveProperty('summary')
  })

  test('preserves SEP-free subjects with spaces and unicode', () => {
    const subject = 'feat: 添加 i18n 🎉'
    const line = ['main', 'a', subject, 'd', 'Z', '', ''].join(SEP)
    const [b] = parseBranches(line, 'main')
    expect(b?.lastCommitMessage).toBe(subject)
  })
})

describe('parseLog', () => {
  test('returns empty for empty input', () => {
    expect(parseLog('')).toEqual([])
  })

  test('parses multiple entries', () => {
    const out = [
      ['fullsha1', 'sha1', 'first', 'Alice', '2026-05-20T10:00:00+08:00'].join(SEP),
      ['fullsha2', 'sha2', 'second', 'Bob', '2026-05-19T10:00:00+08:00'].join(SEP),
    ].join('\n')
    const result = parseLog(out)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      hash: 'fullsha1',
      shortHash: 'sha1',
      message: 'first',
      author: 'Alice',
      date: '2026-05-20T10:00:00+08:00',
    })
    expect(result[1]?.author).toBe('Bob')
  })

  test('subjects with embedded spaces survive', () => {
    const out = ['h', 'sh', 'feat(scope): hello world', 'a', 'd'].join(SEP)
    expect(parseLog(out)[0]?.message).toBe('feat(scope): hello world')
  })
})

describe('parseStatus', () => {
  test('returns empty for empty input', () => {
    expect(parseStatus('')).toEqual([])
  })

  test('parses simple modified entries', () => {
    const out = ' M src/file.ts\0?? newfile.ts\0'
    const result = parseStatus(out)
    expect(result).toEqual([
      { x: ' ', y: 'M', path: 'src/file.ts' },
      { x: '?', y: '?', path: 'newfile.ts' },
    ])
  })

  test('handles filenames with spaces (no quoting needed under -z)', () => {
    const out = 'M  file with spaces.txt\0'
    const [e] = parseStatus(out)
    expect(e?.path).toBe('file with spaces.txt')
  })

  test('skips the second record of a rename pair', () => {
    // R<space><space>newpath\0oldpath\0  followed by another entry
    const out = 'R  new/path.ts\0old/path.ts\0 M other.ts\0'
    const result = parseStatus(out)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ x: 'R', y: ' ', path: 'new/path.ts' })
    expect(result[1]).toEqual({ x: ' ', y: 'M', path: 'other.ts' })
  })

  test('handles unicode and special characters in paths', () => {
    const out = ' M 中文/файл.txt\0'
    expect(parseStatus(out)[0]?.path).toBe('中文/файл.txt')
  })

  test('skips records too short to be valid status lines', () => {
    const out = 'M\0 M valid.ts\0'
    const result = parseStatus(out)
    expect(result).toHaveLength(1)
    expect(result[0]?.path).toBe('valid.ts')
  })

  test('tolerates trailing NUL with no further data', () => {
    // git status -z always terminates the last record with \0; the
    // split('\0') produces an empty trailing element which the filter
    // must drop.
    const out = ' M only.ts\0'
    expect(parseStatus(out)).toEqual([{ x: ' ', y: 'M', path: 'only.ts' }])
  })

  test('handles consecutive NULs without crashing', () => {
    // Defensive: should never come from real git, but a malformed
    // output shouldn't crash the parser. Empty records are skipped by
    // the length filter.
    const out = ' M a.ts\0\0 M b.ts\0'
    const result = parseStatus(out)
    expect(result).toHaveLength(2)
    expect(result.map((e) => e.path)).toEqual(['a.ts', 'b.ts'])
  })
})

describe('parseWorktrees', () => {
  test('returns empty for empty input', () => {
    expect(parseWorktrees('')).toEqual([])
  })

  test('parses a single non-bare worktree on a branch', () => {
    const out = ['worktree /repo', 'HEAD abc123', 'branch refs/heads/main'].join('\n')
    const result = parseWorktrees(out)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      path: '/repo',
      branch: 'main',
      head: 'abc123',
      isBare: false,
      isPrimary: true,
      isLocked: false,
    })
  })

  test('flags locked worktrees (with or without reason)', () => {
    // `git worktree list --porcelain` emits either a bare `locked` line
    // or `locked <reason>` when the user passed `--reason` to lock.
    const out = ['worktree /repo/wt', 'HEAD a', 'branch refs/heads/feat', 'locked needed for release'].join('\n')
    const [w] = parseWorktrees(out)
    expect(w?.isLocked).toBe(true)

    const bare = ['worktree /repo/wt2', 'HEAD a', 'branch refs/heads/x', 'locked'].join('\n')
    expect(parseWorktrees(bare)[0]?.isLocked).toBe(true)
  })

  test('detached HEAD has no branch line — branch left undefined', () => {
    const out = ['worktree /repo/wt-detached', 'HEAD abc123', 'detached'].join('\n')
    const [w] = parseWorktrees(out)
    expect(w?.path).toBe('/repo/wt-detached')
    expect(w?.branch).toBeUndefined()
    expect(w?.head).toBe('abc123')
    expect(w?.isBare).toBe(false)
    expect(w?.isPrimary).toBe(true)
  })

  test('flags bare worktrees', () => {
    const out = ['worktree /repo/bare', 'HEAD 0000000', 'bare'].join('\n')
    const [w] = parseWorktrees(out)
    expect(w?.isBare).toBe(true)
    expect(w?.isPrimary).toBe(true)
    expect(w?.branch).toBeUndefined()
  })

  test('parses multiple blocks separated by blank lines', () => {
    const out = [
      'worktree /repo',
      'HEAD a',
      'branch refs/heads/main',
      '',
      'worktree /repo/wt',
      'HEAD b',
      'branch refs/heads/feat',
    ].join('\n')
    const result = parseWorktrees(out)
    expect(result).toHaveLength(2)
    expect(result.map((w) => w.branch)).toEqual(['main', 'feat'])
    expect(result.map((w) => w.isPrimary)).toEqual([true, false])
  })

  test('strips refs/heads/ prefix from branch ref', () => {
    const out = ['worktree /repo', 'HEAD a', 'branch refs/heads/feature/nested/name'].join('\n')
    expect(parseWorktrees(out)[0]?.branch).toBe('feature/nested/name')
  })
})
