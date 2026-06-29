import type { StatusTone } from '#/web/components/ui/status-tones.ts'

export type HistoryRefDisplay =
  | { kind: 'single'; refName: string; tone: StatusTone }
  | { kind: 'mergedRemote'; refName: string; label: string; tone: StatusTone; remoteNames: string[]; remoteRefs: string[] }

interface ParsedRemoteRef {
  refName: string
  remote: string
  branch: string
}

const MERGEABLE_REMOTE_NAMES = new Set(['origin', 'upstream', 'fork'])

export function parseHistoryRefs(refs: string): string[] {
  return refs
    .split(',')
    .map((ref) => ref.trim())
    .filter(Boolean)
}

export function historyRefDisplays(refs: string[]): HistoryRefDisplay[] {
  const remoteRefs = refs.flatMap((refName) => {
    const remote = parseMergeableRemoteRef(refName)
    return remote ? [remote] : []
  })
  const remoteRefsByBranch = new Map<string, ParsedRemoteRef[]>()
  for (const remote of remoteRefs) {
    remoteRefsByBranch.set(remote.branch, [...(remoteRefsByBranch.get(remote.branch) ?? []), remote])
  }
  const localBranches = new Set(refs.flatMap((ref) => localBranchNamesForRef(ref)))
  const emittedRemoteRefs = new Set<string>()
  const displays: HistoryRefDisplay[] = []
  for (const refName of refs) {
    const remote = parseMergeableRemoteRef(refName)
    if (remote && localBranches.has(remote.branch)) continue
    if (remote) {
      emittedRemoteRefs.add(remote.refName)
      displays.push({ kind: 'single', refName: remote.refName, tone: 'warning' })
      continue
    }
    const localBranchesForRef = localBranchNamesForRef(refName)
    const branchRemoteRefs = localBranchesForRef.flatMap((branch) => remoteRefsByBranch.get(branch) ?? [])
    const matchingRemoteRefs = uniqueRemoteRefs(branchRemoteRefs).filter(
      (remoteRef) => !emittedRemoteRefs.has(remoteRef.refName),
    )
    for (const matchingRemoteRef of matchingRemoteRefs) emittedRemoteRefs.add(matchingRemoteRef.refName)
    displays.push(
      matchingRemoteRefs.length > 0
        ? {
            kind: 'mergedRemote',
            refName,
            label: compactRefLabel(refName),
            tone: historyRefTone(refName),
            remoteNames: uniqueStrings(matchingRemoteRefs.map((item) => item.remote)),
            remoteRefs: matchingRemoteRefs.map((item) => item.refName),
          }
        : { kind: 'single', refName, tone: historyRefTone(refName) },
    )
  }
  for (const remote of remoteRefs) {
    if (!emittedRemoteRefs.has(remote.refName)) displays.push({ kind: 'single', refName: remote.refName, tone: 'warning' })
  }
  return displays
}

function parseMergeableRemoteRef(refName: string): ParsedRemoteRef | null {
  const slashIndex = refName.indexOf('/')
  if (slashIndex <= 0) return null
  const remote = refName.slice(0, slashIndex)
  const branch = refName.slice(slashIndex + 1)
  return branch && MERGEABLE_REMOTE_NAMES.has(remote) ? { refName, remote, branch } : null
}

function localBranchNamesForRef(refName: string): string[] {
  if (refName.startsWith('tag: ')) return []
  if (refName === 'HEAD') return []
  if (refName.startsWith('HEAD -> ')) return [refName.slice('HEAD -> '.length)]
  return parseMergeableRemoteRef(refName) ? [] : [refName]
}

function compactRefLabel(refName: string): string {
  return refName.startsWith('HEAD -> ') ? `HEAD → ${refName.slice('HEAD -> '.length)}` : refName
}

function uniqueRemoteRefs(refs: ParsedRemoteRef[]): ParsedRemoteRef[] {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    if (seen.has(ref.refName)) return false
    seen.add(ref.refName)
    return true
  })
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

function historyRefTone(ref: string): StatusTone {
  if (ref === 'HEAD' || ref.startsWith('HEAD -> ')) return 'brand'
  if (ref.startsWith('tag: ')) return 'danger'
  if (parseMergeableRemoteRef(ref)) return 'warning'
  return 'success'
}
