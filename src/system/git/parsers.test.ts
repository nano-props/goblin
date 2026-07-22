// Unit tests for the pure git output parsers. Run with `bun run test`.
//
// Each test feeds hand-crafted git output (with the actual byte
// separators git emits) and asserts the resulting domain objects.
// Tests double as documentation for the exact output shape we expect
// from each git command.

import { describe, expect, test } from 'vitest'
import {
  FIELD_SEP,
  parseBranches,
  parseLog,
  parseStatus,
  parseWorktrees,
} from '#/system/git/parsers.ts'

const SEP = FIELD_SEP
const NUL = String.fromCharCode(0)

describe('parseBranches', () => {
  test('returns empty array for empty input', () => {
    expect(parseBranches('', '')).toEqual([])
  })

  test('strict parsing rejects incomplete and invalid authoritative rows', () => {
    expect(() => parseBranches(`main${SEP}abc1234`, 'main')).toThrow('Invalid branch snapshot row')
    expect(
      () => parseBranches(
        ['invalid branch name', 'abc1234000000000000000000000000000000000', 'abc1234', '', '2026-05-20', '', '', ''].join(
          SEP,
        ),
        'main',
      ),
    ).toThrow('Invalid branch snapshot identity')
  })

  test('parses a single branch with no upstream', () => {
    const line = [
      'main',
      'abc1234000000000000000000000000000000000',
      'abc1234',
      'initial commit',
      '2026-05-20T10:00:00+08:00',
      'Alice',
      '',
      '',
    ].join(SEP)
    const result = parseBranches(line, 'main')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'main',
      isCurrent: true,
      ahead: 0,
      behind: 0,
      lastCommitHash: 'abc1234000000000000000000000000000000000',
      lastCommitShortHash: 'abc1234',
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
      'def567800000000000000000000000000000000',
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
    const line = [
      'stale',
      'aaa111100000000000000000000000000000000',
      'aaa1111',
      'old',
      '2026-05-20T10:00:00+08:00',
      'Carol',
      'origin/stale',
      '[gone]',
    ].join(SEP)
    const [b] = parseBranches(line, 'main')
    expect(b?.tracking).toBe('origin/stale')
    expect(b?.trackingGone).toBe(true)
    expect(b?.ahead).toBe(0)
    expect(b?.behind).toBe(0)
  })

  test('marks isCurrent only for the matching branch', () => {
    const out = [
      ['main', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'aaaaaaa', 's', '2026-05-20', 'a1', '', ''].join(SEP),
      ['dev', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'bbbbbbb', 's', '2026-05-20', 'a1', '', ''].join(SEP),
    ].join('\n')
    const result = parseBranches(out, 'dev')
    expect(result.find((b) => b.name === 'main')?.isCurrent).toBe(false)
    expect(result.find((b) => b.name === 'dev')?.isCurrent).toBe(true)
  })

  test('attaches worktree info when branch matches', () => {
    const line = ['feat', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'aaaaaaa', 's', '2026-05-20', 'a', '', ''].join(SEP)
    const result = parseBranches(line, 'main', [
      { path: '/wt/feat', branch: 'feat', isBare: false, isPrimary: false, isDirty: true, changeCount: 3 },
    ])
    expect(result[0]?.worktree?.path).toBe('/wt/feat')
    expect(result[0]?.worktree?.summary?.dirty).toBe(true)
    expect(result[0]?.worktree?.isPrimary).toBe(false)
    expect(result[0]?.worktree?.summary?.changeCount).toBe(3)
  })

  test('attaches primary worktree marker when branch matches the main worktree', () => {
    const line = ['main', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'aaaaaaa', 's', '2026-05-20', 'a', '', ''].join(SEP)
    const [branch] = parseBranches(line, 'feature', [{ path: '/repo', branch: 'main', isBare: false, isPrimary: true }])
    expect(branch?.worktree?.path).toBe('/repo')
    expect(branch?.worktree?.isPrimary).toBe(true)
    expect(branch?.worktree).not.toHaveProperty('summary')
  })

  test('preserves SEP-free subjects with spaces and unicode', () => {
    const subject = 'feat: 添加 i18n 🎉'
    const line = ['main', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'aaaaaaa', subject, '2026-05-20', 'Z', '', ''].join(SEP)
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
      ['aaaaaaaa', 'aaaaaaa', 'HEAD -> main, origin/main', 'first', 'Alice', '2026-05-20T10:00:00+08:00'].join(SEP),
      ['bbbbbbbb', 'bbbbbbb', '', 'second', 'Bob', '2026-05-19T10:00:00+08:00'].join(SEP),
    ].join('\n')
    const result = parseLog(out)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      hash: 'aaaaaaaa',
      shortHash: 'aaaaaaa',
      refs: 'HEAD -> main, origin/main',
      message: 'first',
      author: 'Alice',
      date: '2026-05-20T10:00:00+08:00',
    })
    expect(result[1]?.author).toBe('Bob')
  })

  test('subjects with embedded spaces survive', () => {
    const out = ['aaaaaaaa', 'aaaaaaa', '', 'feat(scope): hello world', 'a', '2026-05-20T10:00:00Z'].join(SEP)
    expect(parseLog(out)[0]?.message).toBe('feat(scope): hello world')
  })

  test.each([
    ['missing field', ['aaaaaaaa', 'aaaaaaa', '', 'message', 'author'].join(SEP)],
    ['extra field', ['aaaaaaaa', 'aaaaaaa', '', 'message', 'author', '2026-05-20T10:00:00Z', 'extra'].join(SEP)],
    ['invalid full hash', ['not-a-hash', 'aaaaaaa', '', 'message', 'author', '2026-05-20T10:00:00Z'].join(SEP)],
    ['invalid short hash', ['aaaaaaaa', 'short', '', 'message', 'author', '2026-05-20T10:00:00Z'].join(SEP)],
    ['invalid date', ['aaaaaaaa', 'aaaaaaa', '', 'message', 'author', 'not-a-date'].join(SEP)],
  ])('rejects %s', (_name, output) => {
    expect(() => parseLog(output)).toThrow()
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

  test.each([
    ['R', ' '],
    ['C', ' '],
    [' ', 'R'],
    [' ', 'C'],
  ])('consumes the paired path when status is %s%s', (x, y) => {
    const result = parseStatus(`${x}${y} new/path.ts\0old/path.ts\0 M next.ts\0`)
    expect(result).toEqual([
      { x, y, path: 'new/path.ts' },
      { x: ' ', y: 'M', path: 'next.ts' },
    ])
  })

  test.each(['R ', 'C ', ' R', ' C'])('rejects %s without its paired path', (status) => {
    expect(() => parseStatus(`${status} new/path.ts\0`)).toThrow('Invalid status rename record')
  })

  test('handles unicode and special characters in paths', () => {
    const out = ' M 中文/файл.txt\0'
    expect(parseStatus(out)[0]?.path).toBe('中文/файл.txt')
  })

  test('rejects records too short to be valid status lines', () => {
    const out = 'M\0 M valid.ts\0'
    expect(() => parseStatus(out)).toThrow('Invalid status record')
  })

  test('tolerates trailing NUL with no further data', () => {
    // git status -z always terminates the last record with \0; the
    // split('\0') produces an empty trailing element which the filter
    // must drop.
    const out = ' M only.ts\0'
    expect(parseStatus(out)).toEqual([{ x: ' ', y: 'M', path: 'only.ts' }])
  })

  test('rejects an empty record between consecutive NULs', () => {
    const out = ' M a.ts\0\0 M b.ts\0'
    expect(() => parseStatus(out)).toThrow('Invalid status record')
  })
})

describe('parseWorktrees', () => {
  test('rejects empty output because a Git repository always has a primary or bare worktree', () => {
    expect(() => parseWorktrees('')).toThrow('Invalid worktree output')
  })

  test('parses a single non-bare worktree on a branch', () => {
    const out = ['worktree /repo', 'HEAD abc1234', 'branch refs/heads/main'].join(NUL) + NUL + NUL
    const result = parseWorktrees(out)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ path: '/repo', branch: 'main', isBare: false, isPrimary: true, isLocked: false })
  })

  test('flags locked worktrees (with or without reason)', () => {
    // `git worktree list --porcelain` emits either a bare `locked` line
    // or `locked <reason>` when the user passed `--reason` to lock.
    const out = ['worktree /repo/wt', 'HEAD aaaaaaa', 'branch refs/heads/feat', 'locked needed for release'].join(NUL) + NUL + NUL
    const [w] = parseWorktrees(out)
    expect(w?.isLocked).toBe(true)

    const bare = ['worktree /repo/wt2', 'HEAD aaaaaaa', 'branch refs/heads/x', 'locked'].join(NUL) + NUL + NUL
    expect(parseWorktrees(bare)[0]?.isLocked).toBe(true)
  })

  test('models prunable metadata while excluding it from the usable projection', () => {
    const out = [
      'worktree /repo',
      'HEAD aaaaaaa',
      'branch refs/heads/main',
      '',
      'worktree /repo/missing',
      'HEAD bbbbbbb',
      'branch refs/heads/stale',
      'prunable gitdir file points to non-existent location',
      '',
      'worktree /repo/live',
      'HEAD ccccccc',
      'branch refs/heads/live',
    ].join(NUL) + NUL + NUL

    expect(parseWorktrees(out).map((worktree) => worktree.path)).toEqual(['/repo', '/repo/live'])
  })

  test('accepts an absolute Windows path in authoritative porcelain output', () => {
    const out = ['worktree C:/repo', 'HEAD aaaaaaa', 'branch refs/heads/main'].join(NUL) + NUL + NUL
    expect(parseWorktrees(out)).toEqual([
      { path: 'C:/repo', branch: 'main', isBare: false, isPrimary: true, isLocked: false },
    ])
  })

  test.each(['/repo/line\nbreak', '/repo/tab\tpath'])('preserves special characters in worktree path %j', (worktreePath) => {
    const out = [`worktree ${worktreePath}`, 'HEAD aaaaaaa', 'branch refs/heads/main'].join(NUL) + NUL + NUL
    expect(parseWorktrees(out)[0]?.path).toBe(worktreePath)
  })

  test('detached HEAD has no branch line — branch left undefined', () => {
    const out = ['worktree /repo/wt-detached', 'HEAD abc1234', 'detached'].join(NUL) + NUL + NUL
    const [w] = parseWorktrees(out)
    expect(w?.path).toBe('/repo/wt-detached')
    expect(w?.branch).toBeUndefined()
    expect(w?.isBare).toBe(false)
    expect(w?.isPrimary).toBe(true)
  })

  test('flags bare worktrees', () => {
    const out = ['worktree /repo/bare', 'bare'].join(NUL) + NUL + NUL
    const [w] = parseWorktrees(out)
    expect(w?.isBare).toBe(true)
    expect(w?.isPrimary).toBe(true)
    expect(w?.branch).toBeUndefined()
  })

  test('parses multiple blocks separated by blank lines', () => {
    const out = [
      'worktree /repo',
      'HEAD aaaaaaa',
      'branch refs/heads/main',
      '',
      'worktree /repo/wt',
      'HEAD bbbbbbb',
      'branch refs/heads/feat',
    ].join(NUL) + NUL + NUL
    const result = parseWorktrees(out)
    expect(result).toHaveLength(2)
    expect(result.map((w) => w.branch)).toEqual(['main', 'feat'])
    expect(result.map((w) => w.isPrimary)).toEqual([true, false])
  })

  test('strips refs/heads/ prefix from branch ref', () => {
    const out = ['worktree /repo', 'HEAD aaaaaaa', 'branch refs/heads/feature/nested/name'].join(NUL) + NUL + NUL
    expect(parseWorktrees(out)[0]?.branch).toBe('feature/nested/name')
  })
})
