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
  parseWorktreeStatusBatch,
  parseWorktrees,
  splitWorktreeStatusBatch,
  WORKTREE_STATUS_BATCH_BOUNDARY,
} from '#/system/git/parsers.ts'

const SEP = FIELD_SEP
const NUL = String.fromCharCode(0)

describe('parseBranches', () => {
  test('returns empty array for empty input', () => {
    expect(parseBranches('', '')).toEqual([])
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
      ['main', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'a', 's', 'd', 'a1', '', ''].join(SEP),
      ['dev', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'b', 's', 'd', 'a1', '', ''].join(SEP),
    ].join('\n')
    const result = parseBranches(out, 'dev')
    expect(result.find((b) => b.name === 'main')?.isCurrent).toBe(false)
    expect(result.find((b) => b.name === 'dev')?.isCurrent).toBe(true)
  })

  test('attaches worktree info when branch matches', () => {
    const line = ['feat', 'hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh', 'h', 's', 'd', 'a', '', ''].join(SEP)
    const result = parseBranches(line, 'main', [
      { path: '/wt/feat', branch: 'feat', isBare: false, isPrimary: false, isDirty: true, changeCount: 3 },
    ])
    expect(result[0]?.worktree?.path).toBe('/wt/feat')
    expect(result[0]?.worktree?.summary?.dirty).toBe(true)
    expect(result[0]?.worktree?.isPrimary).toBe(false)
    expect(result[0]?.worktree?.summary?.changeCount).toBe(3)
  })

  test('attaches primary worktree marker when branch matches the main worktree', () => {
    const line = ['main', 'hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh', 'h', 's', 'd', 'a', '', ''].join(SEP)
    const [branch] = parseBranches(line, 'feature', [{ path: '/repo', branch: 'main', isBare: false, isPrimary: true }])
    expect(branch?.worktree?.path).toBe('/repo')
    expect(branch?.worktree?.isPrimary).toBe(true)
    expect(branch?.worktree).not.toHaveProperty('summary')
  })

  test('preserves SEP-free subjects with spaces and unicode', () => {
    const subject = 'feat: 添加 i18n 🎉'
    const line = ['main', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'a', subject, 'd', 'Z', '', ''].join(SEP)
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
      ['fullsha1', 'sha1', 'HEAD -> main, origin/main', 'first', 'Alice', '2026-05-20T10:00:00+08:00'].join(SEP),
      ['fullsha2', 'sha2', '', 'second', 'Bob', '2026-05-19T10:00:00+08:00'].join(SEP),
    ].join('\n')
    const result = parseLog(out)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      hash: 'fullsha1',
      shortHash: 'sha1',
      refs: 'HEAD -> main, origin/main',
      message: 'first',
      author: 'Alice',
      date: '2026-05-20T10:00:00+08:00',
    })
    expect(result[1]?.author).toBe('Bob')
  })

  test('subjects with embedded spaces survive', () => {
    const out = ['h', 'sh', '', 'feat(scope): hello world', 'a', 'd'].join(SEP)
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
    expect(result[0]).toEqual({ path: '/repo', branch: 'main', isBare: false, isPrimary: true, isLocked: false })
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

describe('splitWorktreeStatusBatch', () => {
  test('returns the worktree list and status stream on either side of the marker', () => {
    const worktreeList = ['worktree /repo', 'HEAD abc', 'branch refs/heads/main'].join('\n')
    const stream = `/repo${NUL}M README.md${NUL}? new.ts${NUL}`
    const output = `${worktreeList}\n${WORKTREE_STATUS_BATCH_BOUNDARY}\n${stream}`

    const { worktreeListOutput, statusStream } = splitWorktreeStatusBatch(output)
    expect(worktreeListOutput).toBe(worktreeList)
    expect(statusStream).toBe(stream)
    // The worktree list is still parseable by the existing helper.
    expect(parseWorktrees(worktreeListOutput)).toHaveLength(1)
  })

  test('falls back to treating the whole output as the worktree list when the marker is missing', () => {
    const { worktreeListOutput, statusStream } = splitWorktreeStatusBatch(
      'worktree /repo\nHEAD a\nbranch refs/heads/main',
    )
    expect(worktreeListOutput).toBe('worktree /repo\nHEAD a\nbranch refs/heads/main')
    expect(statusStream).toBe('')
  })

  test('returns an empty status stream when the marker is not on its own line', () => {
    // Defensive: the marker must be its own line, not embedded in a
    // longer line (the parser searches for `\n<marker>\n`, so any
    // marker surrounded by something other than `\n` on either side
    // is treated as missing).
    const output = `worktree /repo${NUL}__GOBLIN_WT_BATCH_BOUNDARY__${NUL}`
    const { statusStream } = splitWorktreeStatusBatch(output)
    expect(typeof statusStream).toBe('string')
    expect(statusStream).toBe('')
  })

  test('the marker is plain ASCII text so it round-trips through single-quoted bash', () => {
    // The remote script emits the marker via
    //   printf '\n%s\n' '__GOBLIN_WT_BATCH_BOUNDARY__'
    // so the marker constant must be exactly the printable ASCII the
    // bash side will substitute into the format string -- no embedded
    // control bytes or quoting hazards.
    expect(WORKTREE_STATUS_BATCH_BOUNDARY).toBe('__GOBLIN_WT_BATCH_BOUNDARY__')
    expect(WORKTREE_STATUS_BATCH_BOUNDARY).not.toMatch(/[\x00-\x1f]/)
  })

  test('the marker cannot be confused with a legitimate `git worktree list` line', () => {
    // Regression: every line in `git worktree list --porcelain` is
    // prefixed by a keyword (`worktree`, `HEAD`, `branch`, `detached`,
    // `bare`, `locked`). The marker is just the bare text, so the
    // marker search (`\n<marker>\n`) cannot match any real output.
    const lines = ['worktree /repo', 'HEAD abc', 'branch refs/heads/main']
    expect(lines.every((line) => line !== WORKTREE_STATUS_BATCH_BOUNDARY)).toBe(true)
  })
})

describe('parseWorktreeStatusBatch', () => {
  test('returns an empty map for an empty stream', () => {
    expect(parseWorktreeStatusBatch('').size).toBe(0)
  })

  test('parses one clean worktree (empty status) as an empty entries array', () => {
    const stream = `/repo${NUL}${NUL}`
    const result = parseWorktreeStatusBatch(stream)
    expect(result.size).toBe(1)
    expect(result.get('/repo')).toEqual([])
  })

  test('parses one dirty worktree with multiple status entries', () => {
    const stream = [`/repo`, NUL, `M  README.md`, NUL, `?? new.ts`, NUL, `M  src/foo.ts`, NUL].join('')
    const result = parseWorktreeStatusBatch(stream)
    const entries = result.get('/repo')
    expect(entries).toHaveLength(3)
    expect(entries?.[0]).toEqual({ x: 'M', y: ' ', path: 'README.md' })
    expect(entries?.[1]).toEqual({ x: '?', y: '?', path: 'new.ts' })
    expect(entries?.[2]).toEqual({ x: 'M', y: ' ', path: 'src/foo.ts' })
  })

  test('segments multiple worktrees via the empty-record boundary', () => {
    const stream = [`/wt1${NUL}M  a.ts${NUL}${NUL}`, `/wt2${NUL}?? new.txt${NUL}${NUL}`, `/wt3${NUL}${NUL}`].join('')
    const result = parseWorktreeStatusBatch(stream)
    expect(result.size).toBe(3)
    expect(result.get('/wt1')?.map((e) => e.path)).toEqual(['a.ts'])
    expect(result.get('/wt2')?.map((e) => e.path)).toEqual(['new.txt'])
    expect(result.get('/wt3')).toEqual([])
  })

  test('surfaces only the new path for rename entries (skips the original-path record)', () => {
    // `git status -z` emits the new path then the original path as
    // two consecutive NUL-separated records for R/C entries. Our
    // parser drops the original, mirroring parseStatus.
    const stream = [`/repo`, NUL, `R  newname.ts`, NUL, `oldname.ts`, NUL].join('')
    const result = parseWorktreeStatusBatch(stream)
    expect(result.get('/repo')).toEqual([{ x: 'R', y: ' ', path: 'newname.ts' }])
  })

  test('handles paths with embedded newlines (quoted paths in git status -z)', () => {
    // git status -z can include literal newlines inside quoted paths.
    // We must not split on newline; the boundary is the empty NUL
    // record only. Porcelain format is "XY <path>" where X and Y
    // are each one byte -- so `?? "weird\nname.ts"` is 21 chars
    // forming one NUL-terminated record.
    const stream = [`/repo`, NUL, `?? "weird`, `\n`, `name.ts"`, NUL, `${NUL}`].join('')
    const result = parseWorktreeStatusBatch(stream)
    const entries = result.get('/repo')
    expect(entries).toHaveLength(1)
    expect(entries?.[0]?.x).toBe('?')
    expect(entries?.[0]?.y).toBe('?')
    // The path part is the byte slice after the 2-char XY + space,
    // which for a quoted path includes the literal newline.
    expect(entries?.[0]?.path).toContain('weird')
    expect(entries?.[0]?.path).toContain('name.ts')
  })

  test('an unterminated stream does not throw and reports the last section cleanly', () => {
    const stream = `/repo${NUL}M  a.ts${NUL}` // no trailing boundary NUL
    const result = parseWorktreeStatusBatch(stream)
    expect(result.get('/repo')?.map((e) => e.path)).toEqual(['a.ts'])
  })
})
